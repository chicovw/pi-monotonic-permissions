import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGate, execution } from './gate-fixture.ts';

export function policy() {
  return {
    version: 1, execution: execution(), tools: { read: 'ALLOW', write: 'ALLOW', edit: 'ALLOW', bash: 'ALLOW' },
    paths: { roots: [{ base: 'project', path: '.' }],
      inside: { read: 'ALLOW', write: 'ALLOW', edit: 'ALLOW' },
      outside: { read: 'DENY', write: 'DENY', edit: 'DENY' },
      protected: [{ component: '.env', read: 'DENY', write: 'DENY', edit: 'DENY' }] },
    bash: { unknown: 'ASK', ordinary: [{ argv: ['npm', 'test'], decision: 'ALLOW' }],
      destructive: { gitResetHard: 'DENY', gitClean: 'ASK', gitDeleteRef: 'ASK', recursiveDelete: 'DENY', systemDestructive: 'DENY' } },
    publication: { gitPush: 'ASK', gitForcePush: 'DENY', gitDeletePush: 'DENY', packagePublish: 'ASK' }
  };
}
export async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pi-monotonic-permissions-test-')));
  const cwd = join(root, 'project'); const external = join(root, 'external'); const agentDir = join(root, 'agent');
  for (const p of [cwd, external, agentDir]) await mkdir(p);
  await writeFile(join(cwd, 'safe.txt'), 'safe\n');
  await writeFile(join(cwd, '.env'), 'SYNTHETIC_PROTECTED_MARKER\n');
  await writeFile(join(external, 'outside.txt'), 'external\n');
  const globalPath = join(agentDir, 'pi-monotonic-permissions-global.json');
  await writeFile(globalPath, JSON.stringify(policy()));
  return { root, cwd, external, agentDir, globalPath,
    async setGlobal(p: unknown) { await writeFile(globalPath, JSON.stringify(p)); },
    async setProject(p: unknown) { await mkdir(join(cwd, '.pi'), { recursive: true }); await writeFile(join(cwd, '.pi', 'pi-monotonic-permissions.json'), JSON.stringify(p)); },
    async gate() { const gate = createGate(globalPath); await gate.start(cwd); return gate; },
    async cleanup() { await rm(root, { recursive: true, force: true }); }
  };
}
export function request(toolName: string, path: string) {
  const input = toolName === 'write' ? { path, content: 'new\n' } : toolName === 'edit' ? { path, edits: [{ oldText: 'safe', newText: 'new' }] } : { path };
  return { toolName, toolCallId: 'fixture-call', input };
}
export function context(cwd: string, confirm: (...args: any[]) => Promise<boolean> = async () => false) {
  return { cwd, mode: 'tui' as const, hasUI: true, ui: { select: async (title: string, choices: string[], opts?: unknown) =>
    await confirm(title, choices, opts) ? 'Allow once' : 'Cancel' } };
}
