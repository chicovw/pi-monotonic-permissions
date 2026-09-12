import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture, policy, request, context } from './fixtures.ts';
import { createGate } from './gate-fixture.ts';

test('strict native read-only includes Markdown, source, JSON and configuration', async t => {
  const f = await fixture(); t.after(f.cleanup); const p = policy(); p.tools.write = 'DENY'; p.tools.edit = 'DENY'; await f.setGlobal(p);
  const gate = await f.gate();
  for (const path of ['README.md', 'code.ts', 'config.json', 'settings.toml']) {
    await writeFile(join(f.cwd, path), 'safe');
    assert.equal(await gate.call(request('read', path), context(f.cwd)), undefined);
    for (const tool of ['write', 'edit']) assert.equal((await gate.call(request(tool, path), context(f.cwd)))?.block, true);
  }
});
test('native discovery is bounded; directory grep and protected traversal stay blocked', async t => {
  const f = await fixture(); t.after(f.cleanup); const gate = await f.gate();
  const grep = (path: string) => ({ toolName: 'grep', toolCallId: 'grep', input: { path, pattern: 'safe' } });
  assert.equal(await gate.call(grep('safe.txt'), context(f.cwd)), undefined);
  for (const path of ['.', '.env']) assert.equal((await gate.call(grep(path), context(f.cwd)))?.block, true);
  await mkdir(join(f.cwd, 'srcdir')); await writeFile(join(f.cwd, 'srcdir', 'src.ts'), 'safe');
  assert.equal((await gate.call({ toolName: 'find', toolCallId: 'find', input: { pattern: '*.ts', path: 'srcdir' } }, context(f.cwd)))?.block, undefined);
  // Directory listing is denied when it would reveal a protected entry; names are treated as sensitive metadata.
  assert.equal((await gate.call(request('ls', '.'), context(f.cwd)))?.block, true);
  for (const tool of ['powershell', 'custom']) assert.equal((await gate.call(request(tool, '.'), context(f.cwd)))?.block, true);
});
test('unsupported shapes and Pi fallback shorthand cannot reach execution', async t => {
  const f = await fixture(); t.after(f.cleanup); const gate = await f.gate();
  assert.equal((await gate.call(null as any, context(f.cwd)))?.block, true);
  for (const path of ['@safe.txt', 'file:///tmp/x', 'safe\u00a0.txt', 'missing', '\u0000']) assert.equal((await gate.call(request('read', path), context(f.cwd)))?.block, true);
  assert.equal((await gate.call({ ...request('read', 'safe.txt'), input: { path: 'safe.txt', surprise: true } }, context(f.cwd)))?.block, true);
  assert.equal((await gate.call({ ...request('edit', 'safe.txt'), input: { path: 'safe.txt', oldText: 'safe', newText: 'new' } }, context(f.cwd)))?.block, true);
});
test('optional diagnostics have fixed fields and omit payload/commands', async t => {
  const f = await fixture(); t.after(f.cleanup); const events: unknown[] = [];
  const gate = createGate(f.globalPath, e => events.push(e)); await gate.start(f.cwd);
  await gate.call({ toolName: 'bash', toolCallId: 'x', input: { command: "node -e 'FAKE_SECRET'" } }, context(f.cwd));
  assert.ok(events.length); assert.ok(!JSON.stringify(events).includes('FAKE_SECRET'));
  assert.deepEqual(Object.keys(events[0] as object).sort(), ['approvalRequested', 'approvalResult', 'code', 'decision', 'layer', 'tool']);
  assert.equal((events[0] as { approvalResult: string }).approvalResult, 'declined');
});
test('source and policy mutation are denied even when an explicit root allows them', async t => {
  const f = await fixture(); t.after(f.cleanup); const p = policy();
  p.paths.roots.push({ base: 'absolute', path: '/' }); await f.setGlobal(p);
  const gate = await f.gate(); let prompts = 0;
  for (const path of [f.globalPath, fileURLToPath(new URL('../src/index.ts', import.meta.url))]) {
    assert.equal((await gate.call(request('write', path), context(f.cwd, async () => { prompts++; return true; })))?.block, true);
  }
  assert.equal(prompts, 0);
});
