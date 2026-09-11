import test from 'node:test';
import assert from 'node:assert/strict';
import { compose, evaluate, mostRestrictive } from '../src/policy.ts';
import type { Decision } from '../src/policy.ts';
import { parsePolicy } from '../src/config.ts';
import { resolveTarget } from '../src/paths.ts';
import { fixture, policy } from './fixtures.ts';

const values: Decision[] = ['ALLOW', 'ASK', 'DENY'];
for (const [a, global] of values.entries()) for (const [b, project] of values.entries()) {
  test(`monotonic ${global} + ${project}`, () => {
    assert.equal(compose({ decision: global, reasons: [] }, { decision: project, reasons: [] }).decision, values[Math.max(a, b)]);
    assert.equal(mostRestrictive(global, project), values[Math.max(a, b)]);
  });
}
test('partial project is neutral; larger project roots cannot weaken global scope', async t => {
  const f = await fixture(); t.after(f.cleanup);
  const global = await parsePolicy(policy(), f.cwd, true);
  const neutral = await parsePolicy({ version: 1 }, f.cwd, false);
  const broader = await parsePolicy({ version: 1, paths: { roots: [{ base: 'absolute', path: f.root }], inside: { read: 'ALLOW' }, outside: { read: 'ALLOW' } } }, f.cwd, false);
  const action = { tool: 'read', targets: [{ target: await resolveTarget(`${f.external}/outside.txt`, f.cwd), operations: ['read' as const] }] };
  assert.equal(evaluate(neutral, action, 'project').decision, 'ALLOW');
  assert.equal(evaluate(broader, action, 'project').decision, 'ALLOW');
  assert.equal(compose(evaluate(global, action, 'global'), evaluate(broader, action, 'project')).decision, 'DENY');
});
test('protected ALLOW never weakens a tool DENY and edit includes read restrictions', async t => {
  const f = await fixture(); t.after(f.cleanup);
  const p = policy(); p.tools.read = 'DENY'; p.paths.protected[0].read = 'ALLOW'; await f.setGlobal(p);
  const gate = await f.gate();
  const { request, context } = await import('./fixtures.ts');
  assert.equal((await gate.call(request('read', '.env'), context(f.cwd)))?.block, true);
  p.tools.read = 'ALLOW'; p.paths.protected[0].read = 'DENY'; p.paths.protected[0].write = 'ALLOW'; p.paths.protected[0].edit = 'ALLOW';
  await f.setGlobal(p); await gate.start(f.cwd);
  assert.equal((await gate.call(request('edit', '.env'), context(f.cwd)))?.block, true);
});
