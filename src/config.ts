import { parseExecution } from './eligibility.ts';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { inside, normalize, resolveTarget } from './paths.ts';
import type { Decision, Operation, Policy, Rule } from './policy.ts';

type ObjectValue = Record<string, unknown>;
const operations = ['read', 'write', 'edit'];
export const destructiveCategories = ['gitResetHard', 'gitClean', 'gitDeleteRef', 'gitRewrite', 'recursiveDelete', 'systemDestructive'];
export const publicationCategories = ['gitPush', 'gitForcePush', 'gitDeletePush', 'packagePublish'];
function object(value: unknown, keys: string[]): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('POLICY_STRUCTURE');
  if (Object.keys(value).some(k => !keys.includes(k))) throw new Error('POLICY_FIELD');
  return value as ObjectValue;
}
function decision(value: unknown): Decision {
  if (value !== 'ALLOW' && value !== 'ASK' && value !== 'DENY') throw new Error('POLICY_DECISION');
  return value;
}
function decisions(value: unknown, keys: string[], required = false): Record<string, Decision> {
  const obj = object(value, keys);
  if (required && keys.some(k => !(k in obj))) throw new Error('POLICY_REQUIRED');
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, decision(v)]));
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('POLICY_ARRAY');
  return value;
}
function anchor(obj: ObjectValue, cwd: string): string {
  if (typeof obj.path !== 'string' || !['project', 'home', 'absolute'].includes(String(obj.base))) throw new Error('POLICY_PATH');
  if (obj.base === 'absolute' ? !isAbsolute(obj.path) : isAbsolute(obj.path) || obj.path.startsWith('~')) throw new Error('POLICY_PATH');
  const base = obj.base === 'project' ? cwd : obj.base === 'home' ? homedir() : '/';
  const path = normalize(obj.path, base);
  if (obj.base !== 'absolute' && !inside(base, path)) throw new Error('POLICY_PATH');
  return path;
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}

export function parseJson(source: string): unknown {
  if (source.length > 1024 * 1024) throw new Error('POLICY_SIZE');
  const value: unknown = JSON.parse(source);
  // JSON.parse accepts duplicate keys. Reject that ambiguous last-key-wins input.
  const tokens = source.match(/"(?:\\.|[^"\\])*"|[{}\[\],:]|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g) ?? [];
  const stack: (Set<string> | null)[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === '{') stack.push(new Set());
    else if (token === '[') stack.push(null);
    else if (token === '}' || token === ']') stack.pop();
    else if (token.startsWith('"') && tokens[i + 1] === ':') {
      const keys = stack.at(-1);
      const key = JSON.parse(token) as string;
      if (!keys || keys.has(key)) throw new Error('POLICY_DUPLICATE_KEY');
      keys.add(key);
    }
  }
  return value;
}

export async function parsePolicy(value: unknown, cwd: string, global: boolean): Promise<Policy> {
  const raw = object(value, ['version', 'tools', 'paths', 'bash', 'publication', 'customTools', 'execution', ...(global ? ['profile'] : [])]);
  if (raw.version !== 1) throw new Error('POLICY_VERSION');
  if (global && ['tools', 'paths', 'bash', 'publication'].some(k => !(k in raw))) throw new Error('POLICY_REQUIRED');
  const policy: Policy = { tools: {}, protected: [], bash: { ordinary: [], destructive: {} }, publication: {} };
  if (raw.execution !== undefined) policy.execution = parseExecution(raw.execution, global);
  if (raw.profile !== undefined) {
    if (raw.profile !== 'guarded' && raw.profile !== 'trusted') throw new Error('POLICY_PROFILE');
    policy.profile = raw.profile;
  }
  if (raw.tools !== undefined) policy.tools = decisions(raw.tools, [...operations, 'bash'], global);
  if (raw.paths !== undefined) {
    const p = object(raw.paths, ['roots', 'inside', 'outside', 'protected']);
    const scopeFields = ['roots', 'inside', 'outside'];
    if ((global || scopeFields.some(k => k in p)) && scopeFields.some(k => !(k in p))) throw new Error('POLICY_SCOPE');
    if (p.roots !== undefined) {
      const roots = await Promise.all(array(p.roots).map(async item => {
        const root = object(item, ['base', 'path']);
        const target = await resolveTarget(anchor(root, cwd), cwd);
        if (!target.directory) throw new Error('POLICY_ROOT');
        return target;
      }));
      policy.paths = { roots, inside: decisions(p.inside, operations, global), outside: decisions(p.outside, operations, global), protected: [] };
    }
    if (p.protected !== undefined) {
      for (const item of array(p.protected)) {
        const r = object(item, ['component', 'base', 'path', 'kind', ...operations]);
        const rules = Object.fromEntries(operations.filter(k => k in r).map(k => [k, decision(r[k])])) as Partial<Record<Operation, Decision>>;
        if (!Object.keys(rules).length) throw new Error('POLICY_RULE');
        let rule: Rule;
        if ('component' in r) {
          if (['base', 'path', 'kind'].some(k => k in r) || typeof r.component !== 'string'
            || !r.component || ['.', '..'].includes(r.component) || /[/\\\x00-\x1f\x7f]/.test(r.component)) throw new Error('POLICY_SELECTOR');
          rule = { component: r.component, decisions: rules };
        } else {
          if (r.kind !== 'file' && r.kind !== 'tree') throw new Error('POLICY_SELECTOR');
          rule = { target: await resolveTarget(anchor(r, cwd), cwd, true), kind: r.kind, decisions: rules };
        }
        policy.protected.push(rule);
      }
    }
  }
  if (raw.bash !== undefined) {
    const b = object(raw.bash, ['unknown', 'ordinary', 'destructive']);
    if (global && b.unknown === undefined) throw new Error('POLICY_REQUIRED');
    if (b.unknown !== undefined) policy.bash.unknown = decision(b.unknown);
    if (b.destructive !== undefined) policy.bash.destructive = decisions(b.destructive, destructiveCategories);
    if (b.ordinary !== undefined) for (const item of array(b.ordinary)) {
      const entry = object(item, ['argv', 'decision']);
      const argv = array(entry.argv);
      if (!argv.length || argv.some(a => typeof a !== 'string' || /[\x00-\x1f\x7f]/.test(a))) throw new Error('POLICY_ARGV');
      policy.bash.ordinary.push({ argv: argv as string[], decision: decision(entry.decision) });
    }
  }
  if (raw.publication !== undefined) policy.publication = decisions(raw.publication, publicationCategories);
  if (raw.customTools !== undefined) {
    const c = object(raw.customTools, ['unknown', 'recall', 'operations']);
    policy.customTools = {};
    if (c.unknown !== undefined) {
      policy.customTools.unknown = decision(c.unknown);
      // Unknown semantics cannot acquire a blanket declarative ALLOW.
      if (c.unknown === 'ALLOW') throw new Error('POLICY_UNKNOWN_ALLOW');
    }
    if (c.recall !== undefined) policy.customTools.recall = decision(c.recall);
    if (c.operations !== undefined) policy.customTools.operations = decisions(c.operations, ['recall.activeLineage', 'recall.allLineages']);
  }
  return freeze(policy);
}

export interface Snapshot { global: Policy; project?: Policy; cwd: string; policyFiles: string[] }
export async function loadSnapshot(globalPath: string, cwd: string): Promise<Snapshot> {
  const canonicalCwd = await realpath(cwd);
  const global = await parsePolicy(parseJson(await readFile(globalPath, 'utf8')), canonicalCwd, true);
  const projectPath = join(canonicalCwd, '.pi', 'pi-monotonic-permissions.json');
  let project: Policy | undefined;
  // Only ENOENT for truly absent components is neutral. Dangling policy aliases are errors.
  const piDir = join(canonicalCwd, '.pi');
  let hasDir = true;
  try { await lstat(piDir); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') hasDir = false; else throw e; }
  if (hasDir) {
    const parent = await resolveTarget(piDir, canonicalCwd);
    if (!parent.directory || parent.canonical !== piDir) throw new Error('POLICY_LOCATION');
    let present = true;
    try { await lstat(projectPath); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') present = false; else throw e; }
    if (present) {
      const target = await resolveTarget(projectPath, canonicalCwd);
      if (target.canonical !== projectPath) throw new Error('POLICY_LOCATION');
      project = await parsePolicy(parseJson(await readFile(projectPath, 'utf8')), canonicalCwd, false);
    }
  }
  return freeze({ global, project, cwd: canonicalCwd, policyFiles: [globalPath, projectPath] });
}
