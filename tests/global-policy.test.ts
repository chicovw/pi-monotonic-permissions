import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, context, request } from './fixtures.ts';

const daily = JSON.parse(await readFile(new URL('./fixtures/daily-policy.json', import.meta.url), 'utf8'));
// Preserve the V1.1 guarded-posture regressions alongside trusted profile tests.
daily.profile = 'guarded';

test('daily policy: reads, one-shot edits, canonical secrets and external floor', async t => {
  const f = await fixture(); t.after(f.cleanup); await f.setGlobal(daily);
  await symlink('.env', join(f.cwd, 'alias')); await symlink('alias', join(f.cwd, 'chain'));
  await symlink(join(f.external, 'outside.txt'), join(f.cwd, 'external-alias'));
  const gate = await f.gate(); let prompts = 0;
  const ctx = context(f.cwd, async () => { prompts++; return false; });
  assert.equal(await gate.call(request('read', 'safe.txt'), ctx), undefined);
  for (const path of ['.env', 'alias', 'chain', 'external-alias', join(f.external, 'outside.txt')]) {
    for (const tool of ['read', 'write', 'edit']) {
      assert.match((await gate.call(request(tool, path), ctx))!.reason, /POLICY_DENY/);
    }
  }
  assert.equal(prompts, 0);
  for (const tool of ['write', 'edit']) assert.match((await gate.call(request(tool, 'safe.txt'), ctx))!.reason, /APPROVAL_DECLINED/);
  assert.equal(prompts, 2);
  for (const tool of ['write', 'edit']) assert.equal(await gate.call(request(tool, 'safe.txt'), context(f.cwd, async () => true)), undefined);
});

test('daily policy: every protected component blocks native access as declared', async t => {
  const f = await fixture(); t.after(f.cleanup); await f.setGlobal(daily); const gate = await f.gate();
  for (const rule of daily.paths.protected.filter((r: any) => r.component && r.component !== '.restricted')) {
    // Never enumerate or access .restricted; its selector is verified structurally below.
    await writeFile(join(f.cwd, rule.component), 'SYNTHETIC_ONLY');
    for (const tool of ['read', 'write', 'edit']) {
      const result = await gate.call(request(tool, rule.component), context(f.cwd));
      if (rule[tool] === 'DENY') assert.match(result!.reason, /POLICY_DENY/);
      else assert.equal(result, undefined);
    }
  }
  assert.deepEqual(daily.paths.protected.find((r: any) => r.component === '.restricted'),
    { component: '.restricted', read: 'DENY', write: 'DENY', edit: 'DENY' });
});

test('daily policy: validation is frictionless, publication denied, other Git mutations blocked', async t => {
  const f = await fixture(); t.after(f.cleanup); await f.setGlobal(daily); const gate = await f.gate();
  const call = (command: string) => gate.call({ toolName: 'bash', toolCallId: 'daily', input: { command } }, context(f.cwd));
  for (const command of ['pwd', 'ls', 'ls -la', 'rg --files', 'npm test', 'npm run lint', 'npm run typecheck', 'npm run build',
    'git status', 'git status --short', 'git diff', 'git diff --check', 'git log', 'git show']) assert.equal(await call(command), undefined, command);
  for (const command of ['git push', 'git push --force', 'git reset --hard', 'git clean -fd', 'git branch -D old', 'git tag -d old',
    'git rebase HEAD', 'npm publish']) assert.match((await call(command))!.reason, /POLICY_DENY/, command);
  for (const command of ['git add .', 'git commit -m x', 'git checkout main', 'git switch main']) assert.match((await call(command))!.reason, /UNSUPPORTED_GIT_FORM/);
  assert.match((await call('npm run deploy'))!.reason, /APPROVAL_DECLINED/);
  assert.match((await call('npm test -- extra'))!.reason, /APPROVAL_DECLINED/);
});

test('daily global denies survive an explicitly permissive project policy', async t => {
  const f = await fixture(); t.after(f.cleanup); await f.setGlobal(daily);
  await f.setProject({ version: 1, tools: { read: 'ALLOW', write: 'ALLOW', edit: 'ALLOW' },
    paths: { roots: [{ base: 'absolute', path: '/' }], inside: { read: 'ALLOW', write: 'ALLOW', edit: 'ALLOW' },
      outside: { read: 'ALLOW', write: 'ALLOW', edit: 'ALLOW' }, protected: [{ component: '.env', read: 'ALLOW', write: 'ALLOW', edit: 'ALLOW' }] },
    publication: { gitPush: 'ALLOW' } });
  const gate = await f.gate();
  for (const path of ['.env', join(f.external, 'outside.txt')]) assert.match((await gate.call(request('read', path), context(f.cwd)))!.reason, /POLICY_DENY/);
  assert.match((await gate.call(request('edit', 'safe.txt'), context(f.cwd)))!.reason, /APPROVAL_DECLINED/);
  assert.match((await gate.call({ toolName: 'bash', toolCallId: 'push', input: { command: 'git push' } }, context(f.cwd)))!.reason, /POLICY_DENY/);
});
