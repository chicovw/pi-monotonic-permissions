import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ToolInfo } from '@earendil-works/pi-coding-agent';
import { createGate } from './gate-fixture.ts';
import { describeCustom, recallSchema } from '../src/custom-tools.ts';
import { evaluate } from '../src/policy.ts';
import { fingerprint, GrantStore } from '../src/grants.ts';
import { fixture, policy, context, request } from './fixtures.ts';

const recall = (input: Record<string, unknown> = {}) => ({ toolName: 'recall', toolCallId: 'r', input });
const branch = { getBranch: () => [{ id: 'active-entry' }] } as any;
async function setup(t: any, profile = 'trusted', customTools?: unknown) {
  const f = await fixture(); t.after(f.cleanup);
  await f.setGlobal({ ...policy(), profile, ...(customTools ? { customTools } : {}) });
  const source = join(f.root, 'extension.ts'); await writeFile(source, 'reviewed synthetic extension v1');
  const info = { name: 'recall', description: 'synthetic reviewed contract', parameters: structuredClone(recallSchema),
    sourceInfo: { path: source, source: 'fixture:0.5.3', scope: 'temporary', origin: 'top-level' } } as ToolInfo;
  const grantsPath = join(f.agentDir, 'pi-monotonic-permissions', 'grants.json');
  const make = async (mode?: string) => { const gate = createGate(f.globalPath, undefined, evaluate, { mode, grantsPath, toolInfo: n => n === 'recall' ? info : undefined }); await gate.start(f.cwd); return gate; };
  let prompts = 0, choice = 'Cancel'; let choices: string[] = []; let title = '';
  const ctx = { ...context(f.cwd), sessionManager: branch, ui: { select: async (message: string, options: string[]) => { prompts++; choices = options; title = message; return choice; } } };
  return { ...f, source, info, grantsPath, make, ctx, prompts: () => prompts, choices: () => choices, title: () => title, choose: (v: string) => { choice = v; } };
}
for (const input of [{}, { expand: [0] }, { query: '#12' }, { query: '#12:src/file.ts' }, { query: '#12:text:20:10' },
  { query: '012345abcdef' }, { query: 'failure.*detail', page: 2 }, { mode: 'file' }, { mode: 'touched' },
  { expand: [1, 12] }, { query: 'scope:all' }, { scope: 'lineage' }]) {
  test(`reviewed recall active lineage ${JSON.stringify(input)}`, async t => {
    const f = await setup(t); const gate = await f.make();
    assert.equal((await describeCustom(recall(input), f.info)).custom?.operation, 'recall.activeLineage');
    assert.equal(await gate.call(recall(input), f.ctx), undefined); assert.equal(f.prompts(), 0);
  });
}
for (const input of [{ scope: 'all' }, { scope: 'all', query: '#12' }, { scope: 'all', query: '#12:file' }, { scope: 'all', expand: [12] }]) {
  test(`reviewed broader recall ${JSON.stringify(input)}`, async t => {
    const f = await setup(t); const gate = await f.make();
    assert.equal((await describeCustom(recall(input), f.info)).custom?.operation, 'recall.allLineages');
    assert.match((await gate.call(recall(input), f.ctx))!.reason, /APPROVAL_DECLINED/); assert.equal(f.prompts(), 1);
  });
}
for (const input of [{ scope: ['all'] }, { mode: ['file'] }, { scope: 'ALL' }, { scope: null }, { query: 123 }, { page: 0 }, { page: 1.5 }, { expand: [-1] }, { expand: [Infinity] }, { expand: '1' }, { mode: 'anything' }, { extra: true }]) {
  test(`malformed recall denies ${JSON.stringify(input)}`, async t => {
    const f = await setup(t); f.choose('Allow once');
    assert.equal((await (await f.make()).call(recall(input), f.ctx))?.block, true); assert.equal(f.prompts(), 0);
  });
}
for (const [g, p, expected] of [['DENY', 'ALLOW', 'DENY'], ['DENY', 'ASK', 'DENY'], ['ASK', 'ALLOW', 'ASK'], ['ALLOW', 'DENY', 'DENY']]) {
  test(`custom policy monotonic ${g} + ${p}`, async t => {
    const f = await setup(t, 'trusted', { recall: g }); await f.setProject({ version: 1, customTools: { recall: p } });
    const result = await (await f.make()).call(recall(), f.ctx);
    assert.match(result!.reason, expected === 'DENY' ? /POLICY_DENY/ : /APPROVAL_DECLINED/);
    assert.equal(f.prompts(), expected === 'DENY' ? 0 : 1);
  });
}
test('guarded active recall asks and unknown tools deny; explicit unknown ASK is available', async t => {
  const f = await setup(t, 'guarded'); const gate = await f.make();
  assert.match((await gate.call(recall(), f.ctx))!.reason, /APPROVAL_DECLINED/);
  assert.match((await gate.call({ ...recall(), toolName: 'unknown' }, f.ctx))!.reason, /POLICY_DENY/);
  await f.setGlobal({ ...policy(), profile: 'guarded', customTools: { unknown: 'ASK' } });
  assert.match((await (await f.make()).call({ ...recall(), toolName: 'unknown' }, f.ctx))!.reason, /APPROVAL_DECLINED/);
});
test('unknown trusted tool: sanitized complete proposal, exact session grants, no persistent choice', async t => {
  const f = await setup(t); const gate = await f.make(); const r = { ...recall({ payload: '\u001b\u202e' }), toolName: 'custom' };
  f.choose('Always allow'); assert.equal((await gate.call(r, f.ctx))?.block, true);
  assert.ok(!f.choices().includes('Always allow')); assert.match(f.title(), /UNKNOWN/); assert.match(f.title(), /\\u001b/);
  f.choose('Allow for session'); assert.equal(await gate.call(r, f.ctx), undefined);
  assert.equal(await gate.call(r, f.ctx), undefined); assert.equal(f.prompts(), 2);
  assert.equal(await gate.call({ ...r, input: { payload: 'changed' } }, f.ctx), undefined); assert.equal(f.prompts(), 3);
  gate.shutdown(); await gate.start(f.cwd); assert.equal(await gate.call(r, f.ctx), undefined); assert.equal(f.prompts(), 4);
});
test('unknown malformed and unrenderable calls never open approval', async t => {
  const f = await setup(t); const gate = await f.make(); f.choose('Allow once');
  const cycle: any = {}; cycle.self = cycle;
  for (const input of [null, [], { x: undefined }, { x: NaN }, { x: 1n }, cycle, { x: 'a'.repeat(2000) }]) {
    assert.equal((await gate.call({ toolName: 'custom', toolCallId: 'x', input } as any, f.ctx))?.block, true);
  }
  assert.equal((await gate.call({ toolName: '\u001b', toolCallId: 'x', input: {} }, f.ctx))?.block, true);
  assert.equal(f.prompts(), 0);
});
test('recall one-shot, session scope, session end and persistent restart semantics', async t => {
  const f = await setup(t); let gate = await f.make(); const r = recall({ scope: 'all' });
  assert.equal((await gate.call(r, f.ctx))?.block, true);
  f.choose('Allow once'); assert.equal(await gate.call(r, f.ctx), undefined); assert.equal(await gate.call(r, f.ctx), undefined); assert.equal(f.prompts(), 3);
  f.choose('Allow for session'); assert.equal(await gate.call(r, f.ctx), undefined); assert.equal(await gate.call(recall({ scope: 'all', query: 'next' }), f.ctx), undefined); assert.equal(f.prompts(), 4);
  gate.shutdown(); gate = await f.make(); f.choose('Always allow'); assert.equal(await gate.call(r, f.ctx), undefined); assert.equal(f.prompts(), 5);
  assert.equal(await gate.call(r, f.ctx), undefined); gate.shutdown(); gate = await f.make();
  assert.equal(await gate.call(r, f.ctx), undefined); assert.equal(f.prompts(), 5);
  const state = JSON.parse(await readFile(f.grantsPath, 'utf8')); assert.equal(state.grants[0].operation, 'recall.allLineages');
  assert.equal((await stat(f.grantsPath)).mode & 0o777, 0o600); assert.equal((await stat(join(f.agentDir, 'pi-monotonic-permissions'))).mode & 0o777, 0o700);
  assert.deepEqual(JSON.parse(await readFile(f.globalPath, 'utf8')), { ...policy(), profile: 'trusted' });
  await writeFile(f.grantsPath, '{"version":1,"grants":[]}'); f.choose('Cancel'); assert.equal((await gate.call(r, f.ctx))?.block, true); assert.equal(f.prompts(), 6);
});
test('active-lineage grant never grants all lineages', async t => {
  const f = await setup(t, 'trusted', { operations: { 'recall.activeLineage': 'ASK' } }); const gate = await f.make();
  f.choose('Always allow'); assert.equal(await gate.call(recall(), f.ctx), undefined);
  f.choose('Cancel'); assert.match((await gate.call(recall({ scope: 'all' }), f.ctx))!.reason, /APPROVAL_DECLINED/);
});
for (const change of ['schema', 'source', 'description', 'sourceIdentity', 'projectDeny', 'globalDeny', 'mode']) {
  test(`grant invalidation ${change}`, async t => {
    const f = await setup(t); let gate = await f.make(); const r = recall({ scope: 'all' });
    f.choose('Always allow'); assert.equal(await gate.call(r, f.ctx), undefined); f.choose('Cancel');
    if (change === 'schema') (f.info.parameters as any).additionalProperties = false;
    if (change === 'source') await writeFile(f.source, 'changed implementation');
    if (change === 'description') f.info.description = 'changed semantics';
    if (change === 'sourceIdentity') f.info.sourceInfo.source = 'fixture:0.6.0';
    if (change === 'projectDeny') await f.setProject({ version: 1, customTools: { recall: 'DENY' } });
    if (change === 'globalDeny') await f.setGlobal({ ...policy(), profile: 'trusted', customTools: { recall: 'DENY' } });
    gate = await f.make(change === 'mode' ? 'guarded' : undefined);
    const result = await gate.call(r, f.ctx); assert.equal(result?.block, true);
    assert.equal(f.prompts(), change.endsWith('Deny') ? 1 : 2);
  });
}
test('changed recall schema cannot escape a global recall DENY', async t => {
  const f = await setup(t, 'trusted', { recall: 'DENY' }); (f.info.parameters as any).additionalProperties = false;
  assert.match((await (await f.make()).call(recall(), f.ctx))!.reason, /POLICY_DENY/); assert.equal(f.prompts(), 0);
});
for (const getBranch of [() => [], () => { throw new Error('private error'); }, () => [{ id: '' }]]) {
  test('indeterminate active lineage blocks Blackhole all-entry fallback', async t => {
    const f = await setup(t); f.ctx.sessionManager = { getBranch } as any;
    assert.equal((await (await f.make()).call(recall(), f.ctx))?.block, true); assert.equal(f.prompts(), 0);
  });
}
test('operator startup YOLO bypasses ordinary policy only after eligibility', async t => {
  const f = await setup(t); const gate = await f.make('yolo');
  assert.equal(gate.profile(), 'YOLO ⚠');
  for (const r of [request('read', '.env'), { ...recall(), toolName: 'unknown' }]) assert.equal(await gate.call(r, f.ctx), undefined);
  assert.equal((await gate.call(null as any, f.ctx))?.block, true);
  assert.equal(f.prompts(), 0);
  await writeFile(f.globalPath, '{');
  assert.equal((await gate.call(recall(), f.ctx))?.block, true);
  gate.shutdown(); assert.equal((await gate.call(recall(), f.ctx))?.block, true);
});
test('model tool and project configuration cannot enter YOLO; startup mode is captured', async t => {
  const f = await setup(t); const options = { mode: 'trusted' }; const gate = createGate(f.globalPath, undefined, evaluate, options); await gate.start(f.cwd); options.mode = 'yolo';
  f.choose('Allow once'); await gate.call({ toolName: 'permissions', toolCallId: 'x', input: { mode: 'yolo' } }, f.ctx);
  assert.equal(gate.profile(), 'trusted'); assert.equal((await gate.call(request('read', '.env'), f.ctx))?.block, true);
  await f.setProject({ version: 1, profile: 'yolo' }); assert.equal((await (await f.make()).call(request('read', 'safe.txt'), f.ctx))?.block, true);
});
test('grant file rejects unsafe permissions, symlinks, malformed and oversized state', async t => {
  const f = await setup(t); const dir = join(f.agentDir, 'pi-monotonic-permissions'); await mkdir(dir, { mode: 0o700 });
  const store = new GrantStore(f.grantsPath);
  await writeFile(f.grantsPath, '{}', { mode: 0o600 }); await assert.rejects(store.read());
  await writeFile(f.grantsPath, JSON.stringify({ version: 1, grants: [] })); await chmod(f.grantsPath, 0o644); await assert.rejects(store.read());
  await chmod(f.grantsPath, 0o600); assert.deepEqual(await store.read(), []);
  await writeFile(f.grantsPath, 'x'.repeat(65537)); await assert.rejects(store.read());
  const link = join(dir, 'alias.json'); await symlink(f.grantsPath, link); await assert.rejects(new GrantStore(link).read());
  await chmod(dir, 0o755); await assert.rejects(store.read());
});
test('grant state is protected against direct and aliased native mutations', async t => {
  const f = await setup(t); const p = { ...policy(), profile: 'trusted' }; p.paths.roots.push({ base: 'absolute', path: '/' }); await f.setGlobal(p);
  const gate = await f.make(); f.choose('Always allow'); await gate.call(recall({ scope: 'all' }), f.ctx);
  const alias = join(f.cwd, 'grants-alias'); await symlink(f.grantsPath, alias);
  for (const path of [f.grantsPath, alias]) assert.equal((await gate.call(request('write', path), f.ctx))?.block, true);
});
test('identity canonicalizes key order and rejects getters', () => {
  assert.equal(fingerprint({ b: 1, a: 2 }), fingerprint({ a: 2, b: 1 }));
  assert.throws(() => fingerprint({ get value() { throw new Error('must not run'); } }));
});

test('active-lineage ASK rechecks branch identity before one-shot execution', async t => {
  const f = await setup(t, 'guarded'); let current = 'first';
  const ctx = { ...f.ctx, sessionManager: { getBranch: () => [{ id: current }] } as any,
    ui: { select: async () => { current = 'different'; return 'Allow once'; } } };
  assert.match((await (await f.make()).call(recall(), ctx))!.reason, /ACTION_CHANGED/);
});
test('a matching persistent grant cannot defeat evaluator DENY', async t => {
  const f = await setup(t); f.choose('Always allow'); const r = recall({ scope: 'all' });
  assert.equal(await (await f.make()).call(r, f.ctx), undefined);
  const gate = createGate(f.globalPath, undefined, () => ({ decision: 'DENY', reasons: [{ decision: 'DENY', layer: 'global', code: 'TEST_DENY' }] }),
    { grantsPath: f.grantsPath, toolInfo: () => f.info });
  await gate.start(f.cwd); assert.match((await gate.call(r, f.ctx))!.reason, /POLICY_DENY/); assert.equal(f.prompts(), 1);
});
test('changed contract during approval blocks without saving a persistent grant', async t => {
  const f = await setup(t); const gate = await f.make();
  const ctx = { ...f.ctx, ui: { select: async () => { f.info.description = 'changed'; return 'Always allow'; } } };
  assert.match((await gate.call(recall({ scope: 'all' }), ctx))!.reason, /ACTION_CHANGED/);
  assert.deepEqual(await new GrantStore(f.grantsPath).read(), []);
});
test('native once approval cannot install session or persistent executable authority', async t => {
  const f = await setup(t); const gate = await f.make();
  const r = { toolName: 'bash', toolCallId: 'b', input: { command: 'printf synthetic' } };
  for (const choice of ['Always allow', 'Allow for session']) { f.choose(choice); assert.equal((await gate.call(r, f.ctx))?.block, true); }
  assert.deepEqual(f.choices(), ['Cancel', 'Allow once']);
});

test('matching persistent grant cannot declassify recall after a route change', async t => {
  const f = await setup(t);
  const { fixtureIdentity } = await import('./gate-fixture.ts');
  const hosted = { provider: 'hosted-fixture', api: 'openai-completions', baseUrl: 'https://example.invalid/v1', runtime: 'synthetic', environment: 'HOSTED_CONTROLLED' as const, ceiling: 'PUBLIC' as const };
  const p = { ...policy(), profile: 'trusted' }; p.execution.tools.recall = 'PRIVATE'; p.execution.routes.push(hosted); await f.setGlobal(p);
  let route = fixtureIdentity;
  const options = {mode:'trusted',grantsPath:f.grantsPath,toolInfo:()=>f.info,resolveExecution:async()=>route};
  let gate = createGate(f.globalPath,undefined,evaluate,options); await gate.start(f.cwd);
  f.choose('Always allow'); assert.equal(await gate.call(recall({scope:'all'}),f.ctx),undefined);
  const bytes = await readFile(f.grantsPath,'utf8'); assert.equal(f.prompts(),1);
  gate.shutdown(); gate = createGate(f.globalPath,undefined,evaluate,options); await gate.start(f.cwd);
  assert.equal(await gate.call(recall({scope:'all'}),f.ctx),undefined); assert.equal(f.prompts(),1);
  route = hosted;
  assert.equal((await gate.call(recall({scope:'all'}),f.ctx))?.block,true); assert.equal(f.prompts(),1);
  assert.equal(await readFile(f.grantsPath,'utf8'),bytes);
});
