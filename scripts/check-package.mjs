import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const packed = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { encoding: 'utf8' }))[0];
const expected = [
  'package.json', 'README.md', 'LICENSE', 'SECURITY.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'OPERATIONS.md', 'policy.example.json',
  ...['index', 'config', 'requests', 'paths', 'policy', 'bash', 'inspection', 'grants', 'custom-tools', 'eligibility', 'pi-runtime'].map(n => `src/${n}.ts`),
  ...['architecture', 'threat-model', 'policy-reference', 'evaluation', 'claims-review', 'blackhole-source-review', 'pi-eligibility-seam-review'].map(n => `docs/${n}.md`)
].sort();
assert.deepEqual(packed.files.map(f => f.path).sort(), expected, 'Unexpected or missing npm files');
for (const path of expected) {
  const text = await readFile(path, 'utf8');
  assert.ok(!/\/Users\/|\/nix\/store\/|PI_SDK|\.dotfiles\//i.test(text), `Private/machine reference in ${path}`);
}
const manifest = JSON.parse(await readFile('package.json', 'utf8'));
assert.equal(manifest.name, 'pi-monotonic-permissions');
assert.equal(manifest.version, '0.1.0');
assert.deepEqual(manifest.pi.extensions, ['./src/index.ts']);
assert.ok(manifest.keywords.includes('pi-package'));
assert.deepEqual(manifest.dependencies ?? {}, {});
console.log(`Package content PASS: ${packed.files.length} files, ${packed.size} compressed bytes`);
