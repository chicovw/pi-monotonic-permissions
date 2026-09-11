import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, context, request, policy } from './fixtures.ts';
import { parsePolicy } from '../src/config.ts';
import { describe } from '../src/requests.ts';
import extension from '../src/index.ts';
import { createGate } from './gate-fixture.ts';

const daily = JSON.parse(await readFile(new URL('./fixtures/daily-policy.json', import.meta.url), 'utf8'));
const bash = (command: string) => ({ toolName: 'bash', toolCallId: 'catalogue', input: { command } });
for (const profile of ['guarded', 'trusted']) {
  test(`${profile}: ordinary edits, one-shot posture, canonical aliases and external floor`, async t => {
    const f = await fixture(); t.after(f.cleanup); await f.setGlobal({ ...daily, profile });
    await symlink('.env', join(f.cwd, 'alias')); await symlink('alias', join(f.cwd, 'chain'));
    await symlink(f.external, join(f.cwd, 'external-parent'));
    const gate = await f.gate(); let prompts = 0;
    const ctx = context(f.cwd, async () => { prompts++; return true; });
    assert.equal(gate.profile(), profile);
    for (const tool of ['write', 'edit']) {
      assert.equal(await gate.call(request(tool, 'safe.txt'), ctx), undefined);
      assert.equal(await gate.call(request(tool, 'safe.txt'), ctx), undefined);
    }
    assert.equal(prompts, profile === 'guarded' ? 4 : 0);
    const before = prompts;
    for (const path of ['.env', 'alias', 'chain', './alias', 'dir/../.env', 'external-parent/outside.txt']) {
      for (const tool of ['read', 'write', 'edit']) assert.match((await gate.call(request(tool, path), ctx))!.reason, /POLICY_DENY/);
    }
    assert.match((await gate.call(request('write', 'external-parent/new/sub/file'), ctx))!.reason, /POLICY_DENY/);
    assert.equal(prompts, before);
  });
  for (const decision of ['ALLOW', 'ASK', 'DENY']) test(`${profile}: project ${decision} cannot weaken global DENY`, async t => {
    const f = await fixture(); t.after(f.cleanup); await f.setGlobal({ ...daily, profile });
    await f.setProject({ version: 1, tools: { read: decision, write: decision, edit: decision }, publication: { gitPush: decision },
      paths: { protected: [{ component: '.env', read: decision, write: decision, edit: decision }] } });
    const gate = await f.gate(); let prompts = 0; const ctx = context(f.cwd, async () => { prompts++; return true; });
    for (const tool of ['read', 'write', 'edit']) assert.match((await gate.call(request(tool, '.env'), ctx))!.reason, /POLICY_DENY/);
    assert.match((await gate.call(bash('git push'), ctx))!.reason, /POLICY_DENY/); assert.equal(prompts, 0);
  });
}
for (const decision of ['ALLOW', 'ASK', 'DENY']) test(`trusted: project ${decision} tightens ordinary edit`, async t => {
  const f = await fixture(); t.after(f.cleanup); await f.setGlobal(daily);
  await f.setProject({ version: 1, tools: { edit: decision } });
  let prompts = 0; const result = await (await f.gate()).call(request('edit', 'safe.txt'), context(f.cwd, async () => { prompts++; return false; }));
  assert.equal(prompts, decision === 'ASK' ? 1 : 0);
  if (decision === 'ALLOW') assert.equal(result, undefined);
  else assert.match(result!.reason, decision === 'ASK' ? /APPROVAL_DECLINED/ : /POLICY_DENY/);
});
test('global tool ASK/DENY remain authoritative even in trusted profile', async t => {
  const f = await fixture(); t.after(f.cleanup);
  for (const decision of ['ASK', 'DENY']) {
    await f.setGlobal({ ...daily, tools: { ...daily.tools, edit: decision } });
    const result = await (await f.gate()).call(request('edit', 'safe.txt'), context(f.cwd));
    assert.match(result!.reason, decision === 'ASK' ? /APPROVAL_DECLINED/ : /POLICY_DENY/);
  }
});
for (const profile of ['guarded', 'trusted', 'yolo']) test(`project cannot select ${profile}`, async t => {
  const f = await fixture(); t.after(f.cleanup);
  await assert.rejects(parsePolicy({ version: 1, profile }, f.cwd, false));
  await f.setProject({ version: 1, profile });
  assert.match((await (await f.gate()).call(request('read', 'safe.txt'), context(f.cwd)))!.reason, /EVALUATION_FAILED/);
});
test('no runtime switch surface; declarative YOLO and invalid profile selection fail closed', async t => {
  const f = await fixture(); t.after(f.cleanup);
  for (const profile of ['yolo', 'invalid', null, {}]) await assert.rejects(parsePolicy({ ...daily, profile }, f.cwd, true));
  const handlers: string[] = [];
  extension({ on: (name: string) => { handlers.push(name); } } as any);
  assert.ok(handlers.includes('tool_call')); // registerTool/registerCommand are deliberately unavailable.
  const gate = await f.gate();
  assert.match((await gate.call({ toolName: 'permissions', toolCallId: 'escalate', input: { profile: 'yolo' } }, context(f.cwd)))!.reason, /POLICY_DENY/);
  assert.equal(gate.profile(), 'legacy');
});
test('loaded profile is an immutable snapshot; editing policy blocks instead of switching', async t => {
  const f = await fixture(); t.after(f.cleanup); await f.setGlobal({ ...daily, profile: 'guarded' });
  const gate = await f.gate(); await f.setGlobal(daily);
  assert.equal(gate.profile(), 'guarded');
  assert.match((await gate.call(request('edit', 'safe.txt'), context(f.cwd)))!.reason, /EVALUATION_FAILED/);
  await gate.start(f.cwd); assert.equal(gate.profile(), 'trusted');
});
test('relative and correct absolute reads agree; incorrect absolute path fails resolution', async t => {
  const f = await fixture(); t.after(f.cleanup); const gate = await f.gate();
  for (const path of ['safe.txt', './safe.txt', join(f.cwd, 'safe.txt')]) assert.equal(await gate.call(request('read', path), context(f.cwd)), undefined);
  await assert.rejects(describe(request('read', join(f.external, 'absent')), f.cwd), /PATH_RESOLUTION/);
  assert.match((await gate.call(request('read', join(f.external, 'absent')), context(f.cwd)))!.reason, /EVALUATION_FAILED/);
  await symlink(f.cwd, join(f.root, 'root-alias'));
  // V1.1's additional lexical boundary is intentionally preserved, not disguised as a resolution error.
  assert.match((await gate.call(request('read', join(f.root, 'root-alias/safe.txt')), context(f.cwd)))!.reason, /POLICY_DENY/);
});
if (process.platform === 'darwin') test('Darwin /tmp spelling resolves canonically, lexical boundary remains conservative', async t => {
  const f = await fixture(); t.after(f.cleanup);
  const cwd = await mkdtemp('/private/tmp/pi-v12-path-'); t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeFile(join(cwd, 'safe.txt'), 'safe');
  const alias = join(cwd.replace('/private/tmp/', '/tmp/'), 'safe.txt');
  const a = await describe(request('read', alias), cwd);
  assert.equal(a.targets[0].target.canonical, join(cwd, 'safe.txt'));
  const gate = createGate(f.globalPath); await gate.start(cwd);
  assert.equal(await gate.call(request('read', join(cwd, 'safe.txt')), context(cwd)), undefined);
  assert.match((await gate.call(request('read', alias), context(cwd)))!.reason, /POLICY_DENY/);
});
for (const command of ['ls', 'ls -la', 'ls -la .', 'git rev-parse --show-toplevel', 'git rev-parse HEAD',
  'npm run test', 'pytest', 'ruff check', 'ruff format --check', 'mypy .', 'basedpyright', 'nix flake check --no-build', 'nix build --no-link']) {
  test(`daily catalogue ALLOW: ${command}`, async t => {
    const f = await fixture(); t.after(f.cleanup); await f.setGlobal(daily);
    assert.equal(await (await f.gate()).call(bash(command), context(f.cwd)), undefined);
  });
}
for (const command of ['ls -R', 'npm test -- extra', 'npm run deploy', 'npx vitest', 'pytest --override-ini x=y', 'ruff format',
  'basedpyright --createstub foo', 'nix build', 'darwin-rebuild switch', 'git rev-parse --parseopt', 'git push', 'npm publish', 'git push --force']) {
  test(`daily catalogue does not auto-allow near neighbor: ${command}`, async t => {
    const f = await fixture(); t.after(f.cleanup); await f.setGlobal(daily);
    assert.equal((await (await f.gate()).call(bash(command), context(f.cwd)))?.block, true);
  });
}
test('bounded rg and ls inspect canonical scope before execution', async t => {
  const f = await fixture(); t.after(f.cleanup); await f.setGlobal(daily);
  await mkdir(join(f.cwd, 'src')); await writeFile(join(f.cwd, 'src/file.ts'), 'foo');
  const gate = await f.gate(); const ctx = context(f.cwd);
  for (const command of ['rg foo src/', 'rg -n -F foo src/file.ts', `ls -la ${f.cwd}`]) assert.equal(await gate.call(bash(command), ctx), undefined);
  for (const command of ['rg foo .env', 'rg foo .', `rg foo ${f.external}`, `ls -la ${f.external}`]) assert.match((await gate.call(bash(command), ctx))!.reason, /POLICY_DENY/);
  await symlink('../.env', join(f.cwd, 'src/alias'));
  assert.match((await gate.call(bash('rg foo src/'), ctx))!.reason, /POLICY_DENY/);
});
test('search aliases, project read restrictions, cycles and unsupported options stay bounded', async t => {
  const f = await fixture(); t.after(f.cleanup); await f.setGlobal(daily);
  await mkdir(join(f.cwd, 'src')); await symlink('.', join(f.cwd, 'src/cycle'));
  assert.equal(await (await f.gate()).call(bash('rg foo src/'), context(f.cwd)), undefined);
  await f.setProject({ version: 1, tools: { read: 'DENY' } });
  // Search is a Bash operation, but must honor the read tool floor too.
  assert.match((await (await f.gate()).call(bash('rg foo src/'), context(f.cwd)))!.reason, /POLICY_DENY/);
});

test('search depth limit, dangling aliases and special files fail closed', async t => {
  const f = await fixture(); t.after(f.cleanup); await f.setGlobal(daily);
  let deep = join(f.cwd, 'deep');
  for (let i = 0; i < 34; i++) { await mkdir(deep); deep = join(deep, 'd'); }
  const gate = await f.gate();
  assert.match((await gate.call(bash('rg foo deep'), context(f.cwd)))!.reason, /INSPECTION_LIMIT/);
  await mkdir(join(f.cwd, 'broken')); await symlink('missing', join(f.cwd, 'broken/alias'));
  assert.match((await gate.call(bash('rg foo broken'), context(f.cwd)))!.reason, /EVALUATION_FAILED/);
});

test('catalogue cannot override read/tool DENY or protected subtree; unsupported syntax unchanged', async t => {
  const f = await fixture(); t.after(f.cleanup); await f.setGlobal({ ...daily, tools: { ...daily.tools, read: 'DENY' } });
  const gate = await f.gate();
  for (const command of ['ls -la', 'rg safe safe.txt']) assert.match((await gate.call(bash(command), context(f.cwd)))!.reason, /POLICY_DENY/);
  for (const [command, code] of [['rg safe safe.txt | head', 'UNSUPPORTED_PIPELINE'], ['ls > out', 'UNSUPPORTED_REDIRECTION'],
    ['npm test && git diff', 'UNSUPPORTED_COMMAND_CHAIN'], ['ls $(pwd)', 'UNSUPPORTED_SUBSTITUTION']])
    assert.ok((await gate.call(bash(command), context(f.cwd)))!.reason.includes(code));
});
