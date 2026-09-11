import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, symlink, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parsePolicy, parseJson, loadSnapshot } from '../src/config.ts';
import { createGate } from '../src/index.ts';
import { fixture, policy, context, request } from './fixtures.ts';

for (const mutation of [
  (p: any) => p.version = 2,
  (p: any) => p.extra = true,
  (p: any) => p.tools.read = 'YES',
  (p: any) => p.paths.roots[0].path = '../outside',
  (p: any) => p.paths.protected[0].glob = '**/*',
  (p: any) => p.paths.protected[0].path = '.env',
  (p: any) => p.bash.ordinary[0].argv = 'npm test',
  (p: any) => p.publication.gitPuhs = 'DENY',
  (p: any) => delete p.tools
]) test(`strict policy rejects malformed structure ${mutation.toString()}`, async t => {
  const f = await fixture(); t.after(f.cleanup); const p = policy(); mutation(p);
  await assert.rejects(parsePolicy(p, f.cwd, true));
});
test('snapshots are deeply immutable; absent project is neutral', async t => {
  const f = await fixture(); t.after(f.cleanup); const s = await loadSnapshot(f.globalPath, f.cwd);
  assert.equal(s.project, undefined); assert.ok(Object.isFrozen(s.global.paths?.roots[0]));
  assert.throws(() => { s.global.tools.read = 'DENY'; });
});
test('duplicate and escaped duplicate keys are rejected, including nested objects', () => {
  for (const text of ['{"version":1,"version":2}', '{"tools":{"read":"DENY","read":"ALLOW"}}', '{"read":1,"\\u0072ead":2}']) assert.throws(() => parseJson(text));
  assert.deepEqual(parseJson('{"a":[{"x":1},{"x":2}]}'), { a: [{ x: 1 }, { x: 2 }] });
});
for (const failure of ['missing', 'malformed-global', 'malformed-project', 'inaccessible-global', 'inaccessible-project', 'dangling-project']) {
  test(`${failure} leaves loaded gate blocking`, async t => {
    const f = await fixture(); t.after(f.cleanup);
    if (failure === 'missing') await unlink(f.globalPath);
    if (failure === 'malformed-global') await writeFile(f.globalPath, '{');
    if (failure === 'inaccessible-global') await chmod(f.globalPath, 0);
    if (failure.includes('project')) {
      await f.setProject({ version: 1 }); const path = join(f.cwd, '.pi/pi-monotonic-permissions.json');
      if (failure === 'malformed-project') await writeFile(path, '{');
      if (failure === 'inaccessible-project') await chmod(path, 0);
      if (failure === 'dangling-project') { await unlink(path); await symlink('absent', path); }
    }
    const gate = await f.gate();
    assert.equal((await gate.call(request('read', 'safe.txt'), context(f.cwd)))?.block, true);
  });
}
test('indeterminate request failure is blocked without leaking exceptions', async t => {
  const f = await fixture(); t.after(f.cleanup); const diagnostics: unknown[] = [];
  const gate = createGate(f.globalPath, e => diagnostics.push(e)); await gate.start(f.cwd);
  const bad = { ...request('read', 'safe.txt'), get input(): never { throw new Error('FAKE_SECRET'); } };
  const result = await gate.call(bad, context(f.cwd));
  assert.equal(result?.block, true); assert.ok(!JSON.stringify([result, diagnostics]).includes('FAKE_SECRET'));
});
test('evaluator exception at the evaluation seam blocks without approval or exception leakage', async t => {
  const f = await fixture(); t.after(f.cleanup); let prompts = 0;
  const gate = createGate(f.globalPath, undefined, () => { throw new Error('FAKE_EVALUATOR_SECRET'); });
  await gate.start(f.cwd);
  const result = await gate.call(request('read', 'safe.txt'), context(f.cwd, async () => { prompts++; return true; }));
  assert.equal(result?.block, true); assert.equal(prompts, 0); assert.ok(!JSON.stringify(result).includes('FAKE_EVALUATOR_SECRET'));
});
