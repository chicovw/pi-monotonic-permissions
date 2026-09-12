import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createGate } from '../src/index.ts';
import { fixture, policy, context } from './fixtures.ts';
import { fixtureIdentity } from './gate-fixture.ts';
import { parsePolicy } from '../src/config.ts';

const hosted = { provider: 'hosted-fixture', api: 'openai-completions', baseUrl: 'https://example.invalid/v1', runtime: 'synthetic', environment: 'HOSTED_CONTROLLED', ceiling: 'PUBLIC' } as const;
const local = { ...fixtureIdentity, runtime: 'offline-synthetic-fixture', environment: 'LOCAL_TRUSTED', ceiling: 'PRIVATE' } as const;

function v2(cwd: string, defaultClassification: 'PUBLIC' | 'INTERNAL' | 'PRIVATE' = 'PRIVATE') {
  const p = policy();
  p.version = 2;
  p.execution = {
    defaultClassification,
    opaqueTools: { bash: 'PRIVATE', recall: 'PRIVATE', '*': 'PRIVATE' },
    routes: [local, hosted],
    projects: [{ path: cwd, classification: 'PUBLIC' }],
    resources: [
      { component: '.env', classification: 'SECRET' },
      { base: 'project', path: 'private.txt', kind: 'file', classification: 'PRIVATE' },
      { base: 'project', path: 'private-tree', kind: 'tree', classification: 'PRIVATE' },
      { component: 'credentials.json', classification: 'SECRET' }
    ]
  } as any;
  return p;
}
const read = (path: string) => ({ toolName: 'read', toolCallId: `read-${path}`, input: { path } });
async function current(gate: ReturnType<typeof createGate>) {
  const value = await gate.broker().currentClassification();
  assert.equal(value.available, true);
  return (value as { classification: string }).classification;
}

test('V2 defaults, fresh selection, public filesystem operations, and monotonic admission', async t => {
  const f = await fixture(); t.after(f.cleanup);
  await mkdir(join(f.cwd, 'private-tree')); await mkdir(join(f.cwd, 'public-tree')); await writeFile(join(f.cwd, 'private.txt'), 'private\n');
  await writeFile(join(f.cwd, 'private-tree', 'note.txt'), 'private\n');
  await writeFile(join(f.cwd, 'public-tree', 'note.txt'), 'public\n');
  await symlink('private.txt', join(f.cwd, 'private-alias')); await symlink('private-alias', join(f.cwd, 'private-chain'));
  await symlink('.env', join(f.cwd, 'secret-alias')); await symlink('secret-alias', join(f.cwd, 'secret-chain'));
  await f.setGlobal(v2(f.cwd));

  const defaultGate = createGate(f.globalPath, undefined, undefined, { resolveExecution: async () => hosted });
  await defaultGate.start(f.cwd);
  assert.equal(await current(defaultGate), 'PRIVATE');
  await assert.rejects(defaultGate.release(hosted));

  let route: any = hosted;
  const gate = createGate(f.globalPath, undefined, undefined, { sessionClassification: 'PUBLIC', resolveExecution: async () => route });
  await gate.start(f.cwd);
  assert.equal(await current(gate), 'PUBLIC');
  // Target-classifiable operations remain PUBLIC when every exposed target is PUBLIC.
  for (const request of [read('safe.txt'),
    { toolName: 'grep', toolCallId: 'grep', input: { pattern: 'safe', path: 'safe.txt' } },
    { toolName: 'find', toolCallId: 'find', input: { pattern: '*', path: 'public-tree' } },
    { toolName: 'ls', toolCallId: 'ls', input: { path: 'public-tree' } },
    { toolName: 'write', toolCallId: 'write', input: { path: 'public.txt', content: 'public\n' } },
    { toolName: 'edit', toolCallId: 'edit', input: { path: 'safe.txt', edits: [{ oldText: 'safe', newText: 'safe' }] } }]) {
    assert.equal((await gate.call(request as any, context(f.cwd)))?.block, undefined);
  }
  assert.equal(await current(gate), 'PUBLIC');

  // A local read admits PRIVATE context before a later hosted request is considered.
  route = local;
  assert.equal((await gate.call(read('private-chain'), context(f.cwd)))?.block, undefined);
  assert.equal(await current(gate), 'PRIVATE');
  route = hosted;
  await assert.rejects(gate.release(hosted));

  const secretListing = createGate(f.globalPath, undefined, undefined, { sessionClassification: 'PUBLIC', resolveExecution: async () => local });
  await secretListing.start(f.cwd);
  assert.equal((await secretListing.call({ toolName: 'ls', toolCallId: 'secret-ls', input: { path: '.' } }, context(f.cwd)))?.block, true);
  assert.equal((await secretListing.call({ toolName: 'find', toolCallId: 'secret-find', input: { pattern: '*', path: '.' } }, context(f.cwd)))?.block, true);
  assert.equal((await secretListing.call(read('secret-chain'), context(f.cwd)))?.block, true);
});

test('V2 operator project authority, local tightening, resources, inheritance, and malformed startup fail closed', async t => {
  const f = await fixture(); t.after(f.cleanup);
  await mkdir(join(f.cwd, 'private-tree')); await writeFile(join(f.cwd, 'private-tree', 'note.txt'), 'private\n');
  const p = v2(f.cwd, 'PUBLIC'); await f.setGlobal(p);
  const publicGate = createGate(f.globalPath, undefined, undefined, { sessionClassification: 'PUBLIC', resolveExecution: async () => local });
  await publicGate.start(f.cwd);
  assert.equal((await publicGate.call({ toolName: 'find', toolCallId: 'private-find', input: { pattern: '*', path: 'private-tree' } }, context(f.cwd)))?.block, undefined);
  assert.equal(await current(publicGate), 'PRIVATE');

  const secretGate = createGate(f.globalPath, undefined, undefined, { sessionClassification: 'PUBLIC', resolveExecution: async () => local });
  await secretGate.start(f.cwd);
  assert.equal((await secretGate.call(read('.env'), context(f.cwd)))?.block, true);
  assert.equal(await current(secretGate), 'PUBLIC');

  const privateWrite = createGate(f.globalPath, undefined, undefined, { sessionClassification: 'PUBLIC', resolveExecution: async () => local });
  await privateWrite.start(f.cwd);
  assert.equal((await privateWrite.call({ toolName: 'write', toolCallId: 'private-write', input: { path: 'private-tree/note.txt', content: 'private\n' } }, context(f.cwd)))?.block, undefined);
  assert.equal(await current(privateWrite), 'PRIVATE');

  (p.execution as any).projects[0].classification = 'PRIVATE'; await f.setGlobal(p);
  const privateProject = createGate(f.globalPath, undefined, undefined, { sessionClassification: 'PUBLIC', resolveExecution: async () => local });
  await privateProject.start(f.cwd);
  assert.equal(await current(privateProject), 'PRIVATE');

  (p.execution as any).projects[0].classification = 'PUBLIC'; await f.setGlobal(p);
  await f.setProject({ version: 2, execution: { minimumClassification: 'PRIVATE' } });
  const localTightening = createGate(f.globalPath, undefined, undefined, { sessionClassification: 'PUBLIC', resolveExecution: async () => local });
  await localTightening.start(f.cwd);
  assert.equal(await current(localTightening), 'PRIVATE');
  await f.setProject({ version: 2, execution: { projects: [{ path: f.cwd, classification: 'PUBLIC' }] } });
  const untrustedRegistry = createGate(f.globalPath, undefined, undefined, { sessionClassification: 'PUBLIC', resolveExecution: async () => local });
  await untrustedRegistry.start(f.cwd);
  assert.equal(untrustedRegistry.profile(), 'unavailable');

  await f.setProject({ version: 2 });
  const inherited = createGate(f.globalPath, undefined, undefined, { sessionClassification: 'PUBLIC', inheritedClassification: 'PRIVATE', resolveExecution: async () => local });
  await inherited.start(f.cwd);
  assert.equal(await current(inherited), 'PRIVATE');
  const malformed = createGate(f.globalPath, undefined, undefined, { sessionClassification: 'private', resolveExecution: async () => local });
  await malformed.start(f.cwd);
  assert.equal(malformed.profile(), 'unavailable');
});

test('V2 PUBLIC bounded engineering reconnaissance stays PUBLIC and protected targets never execute', async t => {
  const f = await fixture(); t.after(f.cleanup);
  await mkdir(join(f.cwd, 'src')); await mkdir(join(f.cwd, 'docs')); await mkdir(join(f.cwd, 'schema')); await mkdir(join(f.cwd, 'secrets')); await mkdir(join(f.cwd, 'private-tree'));
  await writeFile(join(f.cwd, 'package.json'), '{"scripts":{"test":"node --test"}}\n');
  await writeFile(join(f.cwd, 'src', 'app.ts'), 'export const classification = "PUBLIC";\n');
  await writeFile(join(f.cwd, 'docs', 'note.md'), 'PUBLIC note\n');
  await writeFile(join(f.cwd, 'schema', 'public.sql'), 'select 1;\n');
  await writeFile(join(f.cwd, 'secrets', 'token.txt'), 'SYNTHETIC_SECRET_MARKER\n');
  await writeFile(join(f.cwd, 'private.txt'), 'private\n'); await writeFile(join(f.cwd, 'private-tree', 'note.txt'), 'private\n');
  const p = v2(f.cwd, 'PRIVATE');
  p.bash.ordinary.push({ argv: ['git', 'diff', '--check'], decision: 'ALLOW' }, { argv: ['npm', 'test'], decision: 'ALLOW' });
  (p.execution as any).resources.push({ base: 'project', path: 'secrets', kind: 'tree', classification: 'SECRET' });
  (p.paths.protected as any).push({ component: 'secrets', read: 'DENY', write: 'DENY', edit: 'DENY' });
  await parsePolicy(p, f.cwd, true);
  await f.setGlobal(p);
  const gate = createGate(f.globalPath, undefined, undefined, { sessionClassification: 'PUBLIC', resolveExecution: async () => hosted });
  await gate.start(f.cwd);
  assert.notEqual(gate.profile(), 'unavailable');
  const call = (command: string) => gate.call({ toolName: 'bash', toolCallId: command, input: { command } }, context(f.cwd));
  for (const command of [
    'pwd', 'git status', 'git status --short', 'git branch --show-current', 'git rev-parse HEAD',
    'git rev-parse --show-toplevel', 'git rev-parse --show-prefix', 'git rev-parse --is-inside-work-tree',
    'git diff --stat', 'git diff --check', 'git log', 'git log --oneline --decorate',
    'find src -maxdepth 2 -type f', "stat -f '%N %z bytes' schema/public.sql", 'shasum -a 256 schema/public.sql',
    'rg PUBLIC src', 'npm test', 'pwd && git status --short', 'find src -maxdepth 2 -type f | sort | head -200'
  ]) { const result = await call(command); assert.equal(result?.block, undefined, `${command}: ${result?.reason}`); }
  assert.equal(await current(gate), 'PUBLIC');
  assert.deepEqual(await gate.broker().evaluateRoute(hosted), { allowed: true, reason: 'ELIGIBLE', classification: 'PUBLIC', ceiling: 'PUBLIC' });
  for (const command of ['stat .env', 'shasum .env', 'rg SYNTHETIC_SECRET_MARKER secrets']) assert.equal((await call(command))?.block, true, command);
  const directoryRead = await gate.call({ toolName: 'read', toolCallId: 'read-directory', input: { path: 'src' } }, context(f.cwd));
  assert.match(directoryRead?.reason ?? '', /REGULAR_FILE_REQUIRED/);
  assert.equal(await current(gate), 'PUBLIC');
});

test('V2 reviewed PUBLIC delegation stays eligible while PRIVATE parent remains ineligible for hosted PUBLIC', async t => {
  const f = await fixture(); t.after(f.cleanup);
  await mkdir(join(f.cwd, 'private-tree')); await writeFile(join(f.cwd, 'private.txt'), 'private\n'); await writeFile(join(f.cwd, 'private-tree', 'note.txt'), 'private\n');
  const source = join(f.root, 'governed-role-router.ts'); await writeFile(source, 'operator-owned router v1');
  const { delegateRoleSchema } = await import('../src/custom-tools.ts');
  const info = { name: 'delegate_role', description: 'Operator-owned role delegation', parameters: structuredClone(delegateRoleSchema), sourceInfo: { path: source, source: 'fixture:router-v1', scope: 'temporary', origin: 'top-level' } } as any;
  const p = v2(f.cwd, 'PRIVATE'); (p as any).customTools = { operations: { 'delegate.scout': 'ALLOW' } }; await parsePolicy(p, f.cwd, true); await f.setGlobal(p);
  const options = { toolInfo: (name: string) => name === 'delegate_role' ? info : undefined, resolveExecution: async () => hosted };
  const publicGate = createGate(f.globalPath, undefined, undefined, { ...options, sessionClassification: 'PUBLIC' }); await publicGate.start(f.cwd);
  assert.notEqual(publicGate.profile(), 'unavailable');
  const delegated = await publicGate.call({ toolName: 'delegate_role', toolCallId: 'delegate', input: { role: 'scout', task: 'inspect public workspace' } }, context(f.cwd));
  assert.equal(delegated?.block, undefined, delegated?.reason);
  assert.equal(await current(publicGate), 'PUBLIC');
  assert.equal((await publicGate.broker().evaluateRoute(hosted)).allowed, true);
  const privateGate = createGate(f.globalPath, undefined, undefined, { ...options, sessionClassification: 'PRIVATE' }); await privateGate.start(f.cwd);
  assert.equal((await privateGate.broker().evaluateRoute(hosted)).allowed, false);
});
