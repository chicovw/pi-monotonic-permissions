import { componentMatch, inside } from './paths.ts';
import type { Command } from './bash.ts';
import type { Target } from './paths.ts';

export type Decision = 'ALLOW' | 'ASK' | 'DENY';
export type Operation = 'read' | 'write' | 'edit';
export type Layer = 'global' | 'project' | 'enforcement';
export interface Reason { decision: Decision; layer: Layer; code: string }
export interface Result { decision: Decision; reasons: Reason[] }
export interface Rule {
  component?: string;
  target?: Target;
  kind?: 'file' | 'tree';
  decisions: Partial<Record<Operation, Decision>>;
}
export interface Policy {
  profile?: 'guarded' | 'trusted';
  tools: Partial<Record<'read' | 'write' | 'edit' | 'bash', Decision>>;
  paths?: { roots: Target[]; inside: Partial<Record<Operation, Decision>>; outside: Partial<Record<Operation, Decision>>; protected: Rule[] };
  protected: Rule[];
  bash: { unknown?: Decision; ordinary: { argv: string[]; decision: Decision }[]; destructive: Record<string, Decision> };
  publication: Record<string, Decision>;
}
export interface Action {
  tool: string;
  targets: { target: Target; operations: Operation[] }[];
  commands?: Command[];
}

const severity: Record<Decision, number> = { ALLOW: 0, ASK: 1, DENY: 2 };
export function mostRestrictive(...decisions: Decision[]): Decision {
  return decisions.reduce((a, b) => severity[a] >= severity[b] ? a : b, 'ALLOW');
}
function matches(rule: Rule, target: Target): boolean {
  if (rule.component) return componentMatch(target.lexical, rule.component) || componentMatch(target.canonical, rule.component);
  const r = rule.target!;
  if (rule.kind === 'file') return [r.lexical, r.canonical].some(p => p === target.lexical || p === target.canonical)
    || (r.exists && target.exists && r.identity === target.identity);
  return [r.lexical, r.canonical].some(p => inside(p, target.lexical) || inside(p, target.canonical));
}

export function evaluate(policy: Policy, action: Action, layer: 'global' | 'project'): Result {
  const reasons: Reason[] = [];
  const add = (decision: Decision | undefined, code: string) => {
    if (decision && decision !== 'ALLOW') reasons.push({ decision, layer, code });
  };
  const tool = action.tool === 'grep' ? 'read' : action.tool;
  add(policy.tools[tool as keyof Policy['tools']], 'TOOL');
  if (action.commands?.some(command => command.scan)) add(policy.tools.read, 'TOOL');
  if (policy.profile === 'guarded' && ['write', 'edit'].includes(action.tool)) add('ASK', 'PROFILE_GUARDED');
  for (const { target, operations } of action.targets) {
    for (const op of operations) {
      if (policy.paths) {
        for (const identity of ['lexical', 'canonical'] as const) {
          const within = policy.paths.roots.some(root => inside(root[identity], target[identity]));
          add((within ? policy.paths.inside : policy.paths.outside)[op], within ? 'PATH_INSIDE' : 'PATH_OUTSIDE');
        }
      }
      for (const rule of policy.protected) if (matches(rule, target)) add(rule.decisions[op], 'PROTECTED');
    }
  }
  for (const command of action.commands ?? []) {
    const ordinary = policy.bash.ordinary.filter(x => JSON.stringify(x.argv) === JSON.stringify(command.argv));
    // Known categories do not inherit generic unknown ASK, but always retain explicit restrictions.
    if (!command.inspection && command.categories.length === 0 && ordinary.length === 0) add(policy.bash.unknown, 'BASH_UNKNOWN');
    for (const entry of ordinary) add(entry.decision, 'BASH_ORDINARY');
    for (const category of command.categories) {
      add(policy.publication[category] ?? policy.bash.destructive[category] ?? (layer === 'global' ? 'ASK' : undefined), category);
    }
  }
  return { decision: mostRestrictive(...reasons.map(r => r.decision)), reasons };
}

export function compose(global: Result, project?: Result): Result {
  return { decision: mostRestrictive(global.decision, project?.decision ?? 'ALLOW'), reasons: [...global.reasons, ...(project?.reasons ?? [])] };
}
