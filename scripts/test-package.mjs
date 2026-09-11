import assert from 'node:assert/strict';
import { mkdtemp, cp, symlink, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = await mkdtemp(join(tmpdir(), 'pi-package-test-'));
try {
  const result = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', root], { encoding: 'utf8' }))[0];
  execFileSync('tar', ['-xzf', join(root, result.filename), '-C', root]);
  const unpacked = join(root, 'package');
  // Only development harness files are overlaid. Runtime modules come exclusively from the tarball.
  for (const path of ['tests', 'tsconfig.json']) await cp(path, join(unpacked, path), { recursive: true });
  await symlink(resolve('node_modules'), join(unpacked, 'node_modules'), 'dir');
  for (const name of ['index', 'config', 'requests', 'paths', 'policy', 'bash', 'inspection']) {
    assert.deepEqual(await readFile(join(unpacked, `src/${name}.ts`)), await readFile(`src/${name}.ts`));
  }
  execFileSync(process.execPath, [resolve('node_modules/typescript/bin/tsc'), '--noEmit'], { cwd: unpacked, stdio: 'inherit' });
  execFileSync('npm', ['test'], { cwd: unpacked, stdio: 'inherit' });
  // A package-directory -e resource resolves via the public Pi loader in this additional test.
  execFileSync(process.execPath, [resolve('scripts/load-package.mjs'), unpacked], { stdio: 'inherit' });
  console.log('Extracted tarball source, full suite and local package-directory load PASS');
} finally {
  await rm(root, { recursive: true, force: true });
}
