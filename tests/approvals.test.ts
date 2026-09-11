import test from 'node:test';
import assert from 'node:assert/strict';
import { realpath, symlink, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, policy, context, request } from './fixtures.ts';

test('compact approval selector defaults to Cancel and contains the complete small edit', async t => {
  const f = await fixture(); t.after(f.cleanup); const p = policy(); p.tools.edit = 'ASK'; await f.setGlobal(p);
  const gate = await f.gate(); let title = '', choices: string[] = [];
  const ctx = { ...context(f.cwd), ui: { select: async (message: string, options: string[]) => {
    title = message; choices = options; return options[0];
  } } };
  const result = await gate.call(request('edit', 'safe.txt'), ctx as any);
  assert.equal(result?.block, true); assert.match(result!.reason, /APPROVAL_DECLINED/);
  assert.deepEqual(choices, ['Cancel', 'Allow once']);
  for (const field of ['EDIT', 'safe.txt', 'Cwd:', 'Reason:', 'global', 'safe', 'new']) assert.ok(title.includes(field));
  assert.ok(title.split('\n').length <= 10); assert.ok(title.split('\n').every(line => line.length <= 68));
});
test('approval shows canonical aliases and exact Bash; oversize payload blocks without UI', async t => {
  const f = await fixture(); t.after(f.cleanup); const p = policy(); p.tools.edit = 'ASK'; p.tools.write = 'ASK'; await f.setGlobal(p);
  await symlink('safe.txt', join(f.cwd, 'alias')); const gate = await f.gate();
  const titles: string[] = [];
  const ctx = context(f.cwd, async title => { titles.push(title); return false; });
  await gate.call(request('edit', 'alias'), ctx);
  assert.equal(titles.length, 1); assert.match(titles[0], /Canonical:/);
  const canonicalField = titles[0].match(/Canonical: "((?:[^"\n]|\n  )*)"/);
  assert.ok(canonicalField);
  assert.equal(JSON.parse(`"${canonicalField[1]}"`.replace(/\n  /g, '')), await realpath(join(f.cwd, 'safe.txt')));
  await gate.call({ toolName: 'bash', toolCallId: 'b', input: { command: 'git push origin main' } }, ctx);
  assert.match(titles[1], /Command: "git push origin main"/); assert.match(titles[1], /gitPush/);
  const oversized = { toolName: 'write', toolCallId: 'large', input: { path: 'safe.txt', content: 'x'.repeat(1000) } };
  assert.match((await gate.call(oversized, ctx))!.reason, /PROPOSAL_TOO_LARGE/);
  assert.equal(titles.length, 2);
});
test('approval escapes display controls and grants only the exact affirmative choice', async t => {
  const f = await fixture(); t.after(f.cleanup); const p = policy(); p.tools.write = 'ASK'; await f.setGlobal(p);
  const gate = await f.gate();
  const req = { toolName: 'write', toolCallId: 'control', input: { path: 'safe.txt', content: '\u001b[31m\u202e' } };
  for (const response of [undefined, 'Yes', 'allow once', 'Cancel', 'Allow once']) {
    const ctx = { ...context(f.cwd), ui: { select: async (title: string) => {
      assert.ok(!title.includes('\u001b')); assert.ok(!title.includes('\u202e'));
      assert.match(title, /\\u001b/); assert.match(title, /\\u202e/); return response;
    } } };
    const result = await gate.call(req, ctx);
    assert.equal(result?.block, response === 'Allow once' ? undefined : true);
  }
});

test('decline prevents execution; allow once is never reused; no UI blocks', async t => {
  const f = await fixture(); t.after(f.cleanup); const p = policy(); p.tools.write = 'ASK'; await f.setGlobal(p);
  const gate = await f.gate(); let prompts = 0, executions = 0;
  const req = request('write', 'safe.txt');
  const invoke = async (allow: boolean) => {
    const result = await gate.call(req, context(f.cwd, async () => { prompts++; return allow; }));
    if (!result?.block) executions++;
  };
  await invoke(false); assert.equal(executions, 0);
  await invoke(true); assert.equal(executions, 1);
  await invoke(true); assert.equal(executions, 2); assert.equal(prompts, 3);
  for (const mode of ['print', 'rpc']) {
    assert.equal((await gate.call(req, { ...context(f.cwd), hasUI: mode === 'rpc', mode: mode as 'tui' }))?.block, true);
  }
});
for (const change of ['target', 'input', 'policy', 'shutdown']) test(`ASK invalidated by ${change} change`, async t => {
  const f = await fixture(); t.after(f.cleanup); const p = policy(); p.tools.write = 'ASK'; await f.setGlobal(p);
  await symlink('safe.txt', join(f.cwd, 'alias')); const gate = await f.gate(); const req = request('write', 'alias');
  const result = await gate.call(req, context(f.cwd, async () => {
    if (change === 'target') { await unlink(join(f.cwd, 'alias')); await symlink('.env', join(f.cwd, 'alias')); }
    if (change === 'input') req.input.content = 'changed';
    if (change === 'policy') await writeFile(f.globalPath, JSON.stringify({ ...p, version: 2 }));
    if (change === 'shutdown') gate.shutdown();
    return true;
  }));
  assert.equal(result?.block, true);
});
test('DENY has no approval path; UI failures block; confirmations serialize', async t => {
  const f = await fixture(); t.after(f.cleanup); const p = policy(); p.tools.write = 'ASK'; await f.setGlobal(p);
  const gate = await f.gate(); let prompts = 0;
  const ui = context(f.cwd, async () => { prompts++; throw new Error('FAKE_SENSITIVE_ERROR'); });
  assert.equal((await gate.call(request('write', '.env'), ui))?.block, true); assert.equal(prompts, 0);
  assert.equal((await gate.call(request('write', 'safe.txt'), ui))?.block, true); assert.equal(prompts, 1);
  let active = 0, peak = 0;
  const serial = context(f.cwd, async () => { active++; peak = Math.max(active, peak); await new Promise(r => setTimeout(r, 5)); active--; return true; });
  const results = await Promise.all([gate.call(request('write', 'safe.txt'), serial), gate.call({ ...request('write', 'safe.txt'), toolCallId: 'second' }, serial)]);
  assert.deepEqual(results, [undefined, undefined]); assert.equal(peak, 1);
});
