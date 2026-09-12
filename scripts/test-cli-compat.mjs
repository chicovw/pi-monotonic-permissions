#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
const policy = args.get('--policy');
const unbundled = args.get('--unbundled');
assert.ok(policy && policy.startsWith('/'), '--policy must be an absolute operator-owned policy path');
assert.ok(unbundled && unbundled.startsWith('/'), '--unbundled must be the absolute Pi dist/cli.js path');

const bundled = args.get('--bundled') ?? 'pi';
const provider = args.get('--provider') ?? 'omlx';
const model = args.get('--model') ?? 'Qwen3.8-27B-oQ4e-mtp';
const source = resolve(args.get('--source') ?? dirname(dirname(fileURLToPath(import.meta.url))));
const extension = join(source, 'src', 'index.ts');
const root = mkdtempSync(join(tmpdir(), 'pi-cli-compat-'));
const cwd = join(root, 'project');
mkdirSync(cwd);

const common = [
  '--no-extensions', '-e', extension,
  '--provider', provider, '--model', model,
  '-p', 'Synthetic compatibility probe. Reply only OK. Do not use tools.',
];
const env = {
  ...process.env,
  PI_MONOTONIC_PERMISSIONS_POLICY: policy,
  PI_MONOTONIC_PERMISSIONS_PROFILE: 'trusted',
};

function run(name, command, cliArgs) {
  const result = spawnSync(command, cliArgs, { cwd, env, encoding: 'utf8', timeout: 120_000 });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  assert.equal(result.error, undefined, `${name} could not start: ${result.error?.message}`);
  assert.equal(result.status, 0, `${name} failed (${result.status}): ${output.trim()}`);
  assert.match(output, /\bOK\b/, `${name} did not return the synthetic OK response`);
  assert.doesNotMatch(output, /EXECUTION_RUNTIME_(?:UNAVAILABLE|UNSUPPORTED|CHANGED)/,
    `${name} failed runtime qualification`);
  return { name, status: result.status, response: 'OK' };
}

try {
  const bundledResult = run('bundled Pi CLI', bundled,
    ['--session-dir', join(root, 'bundled-sessions'), ...common]);
  const unbundledResult = run('unbundled Pi CLI', process.execPath,
    [unbundled, '--session-dir', join(root, 'unbundled-sessions'), ...common]);
  console.log(JSON.stringify({ provider, model, bundled: bundledResult, unbundled: unbundledResult }, null, 2));
} finally {
  rmSync(root, { recursive: true, force: true });
}
