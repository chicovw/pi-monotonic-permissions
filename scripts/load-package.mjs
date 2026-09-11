import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DefaultResourceLoader, SettingsManager } from '@earendil-works/pi-coding-agent';

const packageDir = resolve(process.argv[2] ?? '.');
const root = await mkdtemp(join(tmpdir(), 'pi-local-load-'));
try {
  const cwd = join(root, 'project'), agentDir = join(root, 'agent');
  await mkdir(cwd); await mkdir(agentDir);
  const policy = join(agentDir, 'global.json');
  await copyFile(join(packageDir, 'policy.example.json'), policy);
  process.env.PI_MONOTONIC_PERMISSIONS_POLICY = policy;
  const loader = new DefaultResourceLoader({ cwd, agentDir,
    settingsManager: SettingsManager.inMemory({ defaultProjectTrust: 'never' }),
    additionalExtensionPaths: [packageDir], noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
  await loader.reload();
  const result = loader.getExtensions();
  assert.deepEqual(result.errors, []);
  assert.equal(result.extensions.length, 1);
  assert.equal(resolve(result.extensions[0].resolvedPath), join(packageDir, 'src/index.ts'));
  assert.ok(result.extensions[0].handlers.has('tool_call'));
  console.log('Pi 0.85.1 public resource loader: standalone package directory loaded with tool_call handler');
} finally { await rm(root, { recursive: true, force: true }); }
