import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ToolInfo } from '@earendil-works/pi-coding-agent';
import { createGate } from '../src/index.ts';
import { describeCustom, delegateRoleSchema } from '../src/custom-tools.ts';
import { fixture, policy, context } from './fixtures.ts';
import { fixtureIdentity } from './gate-fixture.ts';

const request = (input: Record<string, unknown>) => ({ toolName: 'delegate_role', toolCallId: 'delegate', input });

test('reviewed immutable role delegation receives operation-scoped policy and schema drift falls back', async t => {
  const f = await fixture(); t.after(f.cleanup);
  const source = join(f.root, 'governed-role-router.ts'); await writeFile(source, 'operator-owned router v1');
  const info = { name: 'delegate_role', description: 'Operator-owned role delegation', parameters: structuredClone(delegateRoleSchema), sourceInfo: { path: source, source: 'fixture:router-v1', scope: 'temporary', origin: 'top-level' } } as ToolInfo;
  await f.setGlobal({ ...policy(), profile: 'trusted', customTools: { operations: { 'delegate.scout': 'ALLOW', 'delegate.implementer': 'ASK' } } });
  const gate = createGate(f.globalPath, undefined, undefined, { toolInfo: name => name === 'delegate_role' ? info : undefined, resolveExecution: async () => fixtureIdentity }); await gate.start(f.cwd);
  const scout = request({ role: 'scout', task: 'inspect the synthetic workspace' });
  assert.equal((await describeCustom(scout, info)).custom?.operation, 'delegate.scout');
  assert.equal(await gate.call(scout, context(f.cwd)), undefined);
  const implementer = request({ role: 'implementer', task: 'change the synthetic workspace' });
  assert.equal((await gate.call(implementer, context(f.cwd)))?.block, true);
  (info.parameters as Record<string, unknown>).additionalProperties = false;
  assert.equal((await gate.call(scout, context(f.cwd)))?.block, true);
  assert.equal((await gate.call(request({ role: 'unknown', task: 'x' }), context(f.cwd)))?.block, true);
});
