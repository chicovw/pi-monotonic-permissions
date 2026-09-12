import test from 'node:test';
import assert from 'node:assert/strict';
import { createGate } from '../src/index.ts';
import { fixture, policy } from './fixtures.ts';
import { fixtureIdentity } from './gate-fixture.ts';

const hosted = { provider: 'hosted-fixture', api: 'openai-completions', baseUrl: 'https://example.invalid/v1', runtime: 'synthetic', environment: 'HOSTED_CONTROLLED' as const, ceiling: 'PUBLIC' as const };
const local = { ...fixtureIdentity, runtime: 'offline-synthetic-fixture', environment: 'LOCAL_TRUSTED' as const, ceiling: 'PRIVATE' as const };

test('gate broker exposes only current classification and policy-approved route eligibility', async t => {
  const f = await fixture(); t.after(f.cleanup);
  const p = policy(); p.execution.routes.push(hosted); await f.setGlobal(p);
  const gate = createGate(f.globalPath, undefined, undefined, { startupClassification: 'PRIVATE', resolveExecution: async () => fixtureIdentity });
  await gate.start(f.cwd);
  const broker = gate.broker();
  assert.deepEqual(await broker.currentClassification(), { available: true, classification: 'PRIVATE' });
  assert.deepEqual(await broker.evaluateRoute(local), { allowed: true, reason: 'ELIGIBLE', classification: 'PRIVATE', ceiling: 'PRIVATE' });
  assert.deepEqual(await broker.evaluateRoute(hosted), { allowed: false, reason: 'CLASSIFICATION_EXCEEDS_CEILING', classification: 'PRIVATE', ceiling: 'PUBLIC' });
  assert.deepEqual(await broker.evaluateRoute({ ...local, model: 'not-a-route-field' }), { allowed: false, reason: 'ELIGIBILITY_INVALID' });
  gate.shutdown();
  assert.deepEqual(await broker.currentClassification(), { available: false, reason: 'POLICY_UNAVAILABLE' });
});
