import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, words } from '../src/bash.ts';
import { fixture, policy } from './fixtures.ts';
import { parsePolicy } from '../src/config.ts';
import { evaluate } from '../src/policy.ts';
import { context } from './fixtures.ts';

for (const [command, code] of [
  ['pwd | cat', 'UNSUPPORTED_PIPELINE'], ['echo x > file', 'UNSUPPORTED_REDIRECTION'],
  ['pwd && pwd', 'UNSUPPORTED_COMMAND_CHAIN'], ['pwd; pwd', 'UNSUPPORTED_COMMAND_CHAIN'],
  ['echo $(pwd)', 'UNSUPPORTED_SUBSTITUTION'], ['echo `pwd`', 'UNSUPPORTED_SUBSTITUTION'],
  ['pwd &', 'UNSUPPORTED_BACKGROUND_EXECUTION'], ['git diff --foo', 'UNSUPPORTED_GIT_FORM'],
  ['echo *', 'UNSUPPORTED_SHELL_SYNTAX'], ['env pwd', 'UNSUPPORTED_SHELL_WRAPPER'],
  ['npm --prefix x publish', 'UNSUPPORTED_PACKAGE_FORM'], ['rm --mystery x', 'UNSUPPORTED_RM_FORM'],
  ['f() { pwd; }', 'UNSUPPORTED_SHELL_SYNTAX']
]) test(`sanitized block reason ${code}: ${command}`, async t => {
  const f = await fixture(); t.after(f.cleanup); const gate = await f.gate();
  const result = await gate.call({ toolName: 'bash', toolCallId: 'reason', input: { command } }, context(f.cwd));
  assert.equal(result?.block, true); assert.ok(result?.reason.includes(code));
  assert.ok(!result?.reason.includes(command));
});

test('diff check requires its exact allowance and does not authorize nearby forms', async t => {
  const f = await fixture(); t.after(f.cleanup); const p = policy();
  const decision = async (command: string) => evaluate(await parsePolicy(p, f.cwd, true),
    { tool: 'bash', targets: [], commands: classify(command) }, 'global').decision;
  assert.equal(await decision('git diff'), 'ALLOW');
  assert.equal(await decision('git diff --check'), 'ASK');
  p.bash.ordinary.push({ argv: ['git', 'diff', '--check'], decision: 'ALLOW' });
  assert.equal(await decision('git diff --check'), 'ALLOW');
  for (const command of ['git diff --cached', 'git diff --check -- safe.txt', 'git diff --foo']) {
    assert.throws(() => classify(command));
  }
});

const cases: [string, string[]][] = [
  ['git status --short', []], ['git diff --stat', []], ['git log --oneline', []], ['git show --no-patch', []],
  ['git push origin main', ['gitPush']], ['git push --force origin main', ['gitPush', 'gitForcePush']],
  ['git push origin main -f', ['gitPush', 'gitForcePush']], ['git push -fu origin main', ['gitPush', 'gitForcePush']],
  ['git push --force-with-lease origin main', ['gitPush', 'gitForcePush']],
  ['git push --force-with-lease=main:abc origin main', ['gitPush', 'gitForcePush']],
  ['git push origin +main:main', ['gitPush', 'gitForcePush']],
  ['git push origin :main', ['gitPush', 'gitDeletePush']], ['git push --delete origin main', ['gitPush', 'gitDeletePush']],
  ['git push --mirror origin', ['gitPush', 'gitForcePush', 'gitDeletePush']],
  ['git push -- origin +main:main', ['gitPush', 'gitForcePush']],
  ['git reset --hard HEAD', ['gitResetHard']], ['git clean -fdx', ['gitClean']],
  ['git branch -D old', ['gitDeleteRef']], ['git tag -d old', ['gitDeleteRef']],
  ['git rebase HEAD', ['gitRewrite']], ['npm publish', ['packagePublish']],
  ['yarn npm publish', ['packagePublish']], ['cargo publish', ['packagePublish']],
  ['rm -rf local', ['recursiveDelete']], ['sudo reboot', ['systemDestructive']]
];
for (const [command, categories] of cases) test(`classify ${command}`, () => {
  assert.deepEqual(classify(command)[0].categories, categories);
});
for (const command of [
  'git -C /tmp push', 'git -c alias.x=push x', 'git x', 'git push --mystery origin', 'git push --repo=x',
  'git diff --output=file', 'npm --prefix elsewhere publish', 'pwd; git push', 'pwd && git push',
  'pwd | cat', 'echo x > file', 'echo $(pwd)', 'echo `pwd`', 'echo $HOME', 'echo *', 'pwd &',
  'f() { pwd; }', 'X=y git push', 'env git push', "echo 'unterminated", "sh -c 'pwd; git push'"
]) test(`unsupported command blocks: ${command}`, () => assert.throws(() => classify(command)));
test('literal quoting, one wrapper level and no executable-wide ordinary grants', async t => {
  assert.deepEqual(words("rg 'a|b' 'space name.txt'"), ['rg', 'a|b', 'space name.txt']);
  assert.ok(classify("sh -c 'git push --force origin main'").flatMap(c => c.categories).includes('gitForcePush'));
  assert.throws(() => classify("sh -c \"sh -c 'pwd'\""));
  const f = await fixture(); t.after(f.cleanup); const p = policy();
  p.bash.ordinary.push({ argv: ['git', 'push', '--force'], decision: 'ALLOW' });
  const compiled = await parsePolicy(p, f.cwd, true);
  const decision = (command: string) => evaluate(compiled, { tool: 'bash', targets: [], commands: classify(command) }, 'global').decision;
  assert.equal(decision('npm test'), 'ALLOW'); assert.equal(decision('npm test -- extra'), 'ASK');
  assert.equal(decision('git push'), 'ASK'); assert.equal(decision('git push --force'), 'DENY');
  assert.equal(decision("python3 -c 'print(1)'"), 'ASK');
});
