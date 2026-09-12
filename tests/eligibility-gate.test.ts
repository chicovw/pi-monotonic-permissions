import test from 'node:test';
import assert from 'node:assert/strict';
import { symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createGate } from '../src/index.ts';
import { fixture, policy, request, context } from './fixtures.ts';
import { fixtureIdentity } from './gate-fixture.ts';
import type { Classification, ResolvedRoute } from '../src/eligibility.ts';
const hosted: ResolvedRoute = { provider: 'hosted-fixture', api: 'openai-completions', baseUrl: 'https://example.invalid/v1', runtime: 'synthetic', environment: 'HOSTED_CONTROLLED', ceiling: 'PUBLIC' };

for (const mode of ['guarded', 'trusted', 'yolo']) test(`${mode}: eligibility dominates policy, approval and SECRET aliases`, async t => {
  const f = await fixture(); t.after(f.cleanup);
  const p = policy(); p.execution.routes.push(hosted); p.execution.tools['*'] = 'PRIVATE';
  p.execution.protected = [{ component: '.env', classification: 'SECRET' }]; await f.setGlobal(p);
  await symlink('.env', join(f.cwd, 'alias')); await symlink('alias', join(f.cwd, 'chain'));
  let route = fixtureIdentity; let prompts = 0;
  const gate = createGate(f.globalPath, undefined, undefined, { mode, resolveExecution: async () => route }); await gate.start(f.cwd);
  const ctx = context(f.cwd, async () => { prompts++; return true; });
  assert.equal(await gate.call(request('read', 'safe.txt'), ctx), undefined);
  for (const path of ['.env', 'alias', 'chain']) assert.equal((await gate.call(request('read', path), ctx))?.block, true);
  route = hosted;
  assert.equal((await gate.call(request('read', 'safe.txt'), ctx))?.block, true);
  assert.equal(prompts, 0);
});

test('project and global execution ceilings compose monotonically', async t => {
  const f = await fixture(); t.after(f.cleanup); const p = policy(); p.execution.context = 'PRIVATE'; await f.setGlobal(p);
  await f.setProject({ version: 1, execution: { ceiling: 'PUBLIC', context: 'PUBLIC' } });
  const make = async () => { const g = createGate(f.globalPath, undefined, undefined, { mode: 'yolo', resolveExecution: async () => fixtureIdentity }); await g.start(f.cwd); return g; };
  assert.equal((await (await make()).call(request('read', 'safe.txt'), context(f.cwd)))?.block, true);
  p.execution.ceiling = 'PUBLIC'; await f.setGlobal(p);
  await f.setProject({ version: 1, execution: { ceiling: 'PRIVATE' } });
  assert.equal((await (await make()).call(request('read', 'safe.txt'), context(f.cwd)))?.block, true);
  await f.setProject({ version: 1, execution: { routes: [hosted] } });
  assert.equal((await make()).profile(), 'unavailable');
});

test('unknown exposure and missing route deny even in YOLO', async t => {
  const f = await fixture(); t.after(f.cleanup); const p = policy(); p.execution.tools = { read: 'PUBLIC' }; await f.setGlobal(p);
  const g = createGate(f.globalPath, undefined, undefined, { mode: 'yolo', resolveExecution: async () => fixtureIdentity }); await g.start(f.cwd);
  assert.equal((await g.call({toolName:'unknown',toolCallId:'u',input:{}},context(f.cwd)))?.block,true);
  const missing = createGate(f.globalPath, undefined, undefined, {mode:'yolo'}); await missing.start(f.cwd);
  assert.equal((await missing.call(request('read','safe.txt'),context(f.cwd)))?.block,true);
});

test('admitted information raises context classification and survives restart metadata', async t => {
  const f = await fixture(); t.after(f.cleanup); const p = policy(); p.execution.tools.read = 'PRIVATE'; p.execution.routes.push(hosted); await f.setGlobal(p);
  const labels: Classification[] = []; const options = {mode:'yolo',resolveExecution: async()=>fixtureIdentity,recordClassification:(c:Classification)=>{labels.push(c);}};
  const g = createGate(f.globalPath,undefined,undefined,options); await g.start(f.cwd);
  await g.release(hosted); // Initial explicitly PUBLIC synthetic context.
  assert.equal(await g.call(request('read','safe.txt'),context(f.cwd)),undefined);
  assert.deepEqual(labels,['PRIVATE']); await assert.rejects(g.release(hosted));
  g.shutdown(); const next = createGate(f.globalPath,undefined,undefined,options); await next.start(f.cwd,labels);
  await assert.rejects(next.release(hosted));
  await next.start(f.cwd,['broken' as Classification]); await assert.rejects(next.release(fixtureIdentity));
});

test('historical recall classification and approval route changes cannot release to hosted', async t => {
  const f = await fixture(); t.after(f.cleanup); const p = policy(); p.execution.history = 'PRIVATE'; p.execution.routes.push(hosted); await f.setGlobal(p);
  const g = createGate(f.globalPath,undefined,undefined,{mode:'trusted',resolveExecution:async()=>hosted}); await g.start(f.cwd);
  let prompts = 0; assert.equal((await g.call({toolName:'recall',toolCallId:'r',input:{}},context(f.cwd,async()=>{prompts++;return true;})))?.block,true); assert.equal(prompts,0);
  p.execution.history='PUBLIC'; p.execution.tools['*']='PRIVATE'; await f.setGlobal(p);
  let route=fixtureIdentity; const pending=createGate(f.globalPath,undefined,undefined,{mode:'trusted',resolveExecution:async()=>route}); await pending.start(f.cwd);
  assert.equal((await pending.call({toolName:'unknown',toolCallId:'u',input:{}},context(f.cwd,async()=>{route=hosted;return true;})))?.block,true);
});

test('session grant cannot override a later classification denial', async t => {
  const f=await fixture();t.after(f.cleanup);const p=policy();p.execution.routes.push(hosted);p.execution.tools['*']='PRIVATE';await f.setGlobal(p);
  let route=fixtureIdentity;const g=createGate(f.globalPath,undefined,undefined,{mode:'trusted',resolveExecution:async()=>route});await g.start(f.cwd);
  const r={toolName:'unknown',toolCallId:'u',input:{}};let prompts=0;
  const ctx={...context(f.cwd),ui:{select:async()=>{prompts++;return 'Allow for session';}}};
  assert.equal(await g.call(r,ctx),undefined);assert.equal(await g.call(r,ctx),undefined);assert.equal(prompts,1);
  route=hosted;assert.equal((await g.call(r,ctx))?.block,true);assert.equal(prompts,1);
});

test('YOLO cannot mutate classification authority and changed declarations fail closed', async t=>{
  const f=await fixture();t.after(f.cleanup);const g=createGate(f.globalPath,undefined,undefined,{mode:'yolo',resolveExecution:async()=>fixtureIdentity});await g.start(f.cwd);
  assert.equal((await g.call(request('write',f.globalPath),context(f.cwd)))?.block,true);
  await writeFile(f.globalPath,'{');assert.equal((await g.call(request('read','safe.txt'),context(f.cwd)))?.block,true);
});

test('YOLO cannot rewrite session classification metadata through a canonical alias', async t => {
  const f=await fixture();t.after(f.cleanup);const state=join(f.agentDir,'session.jsonl');await writeFile(state,'synthetic session metadata');
  await symlink(state,join(f.cwd,'session-alias'));
  const g=createGate(f.globalPath,undefined,undefined,{mode:'yolo',resolveExecution:async()=>fixtureIdentity});await g.start(f.cwd);
  const ctx={...context(f.cwd),sessionManager:{getBranch:()=>[],getSessionFile:()=>state}};
  assert.equal((await g.call(request('write','session-alias'),ctx))?.block,true);
  assert.equal((await g.call({toolName:'bash',toolCallId:'b',input:{command:`rm -rf '${f.agentDir}'`}},ctx))?.block,true);
});

test('startup context classification is retained when later operator defaults are lower', async t => {
  const f=await fixture();t.after(f.cleanup);const p=policy();p.execution.context='PRIVATE';p.execution.routes.push(hosted);await f.setGlobal(p);
  const labels:Classification[]=[];const g=createGate(f.globalPath,undefined,undefined,{recordClassification:c=>{labels.push(c);}});await g.start(f.cwd);
  assert.deepEqual(labels,['PRIVATE']);g.shutdown();
  p.execution.context='PUBLIC';await f.setGlobal(p);await g.start(f.cwd,labels);
  await assert.rejects(g.release(hosted));
});

test('operator startup classification seed is monotonic and fail closed', async t => {
  const f = await fixture(); t.after(f.cleanup);
  const make = async (seed: unknown, context = 'PUBLIC' as Classification) => {
    const p = policy(); p.execution.context = context; await f.setGlobal(p);
    const g = createGate(f.globalPath, undefined, undefined, { mode: 'yolo', startupClassification: seed, resolveExecution: async () => fixtureIdentity });
    await g.start(f.cwd); return g;
  };
  // No seed preserves the existing policy-derived classification.
  assert.equal((await (await make(undefined)).call(request('read', 'safe.txt'), context(f.cwd)))?.block, undefined);
  // A seed may raise, never lower, and SECRET is still ineligible even in YOLO.
  assert.equal((await (await make('PRIVATE')).call(request('read', 'safe.txt'), context(f.cwd)))?.block, undefined);
  assert.equal((await (await make('INTERNAL')).call(request('read', 'safe.txt'), context(f.cwd)))?.block, undefined);
  assert.equal((await (await make('PUBLIC', 'PRIVATE')).call(request('read', 'safe.txt'), context(f.cwd)))?.block, undefined);
  assert.equal((await (await make('SECRET')).call(request('read', 'safe.txt'), context(f.cwd)))?.block, true);
  assert.equal((await (await make('private')).call(request('read', 'safe.txt'), context(f.cwd)))?.block, true);
});
