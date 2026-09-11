import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ModelRegistry, ModelRuntime } from '@earendil-works/pi-coding-agent';
import { installRuntimeEligibility } from '../src/pi-runtime.ts';

const model = {
  id: 'fixture-model', name: 'fixture', api: 'openai-completions', provider: 'fixture',
  baseUrl: 'http://127.0.0.1:8000/v1', reasoning: false, input: ['text'] as ('text' | 'image')[],
  contextWindow: 4096, maxTokens: 128,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};
const context = { messages: [] } as any;

async function runtimeFor(config: Record<string, unknown> = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'pi-runtime-eligibility-'));
  const runtime = await ModelRuntime.create({ authPath: join(dir, 'auth.json'), modelsPath: null,
    modelsStorePath: join(dir, 'models.json'), allowModelNetwork: false, refreshOnCreate: false });
  let calls = 0;
  runtime.registerProvider('fixture', {
    api: 'openai-completions', baseUrl: 'http://127.0.0.1:8123/v1', apiKey: 'fixture-secret',
    models: [model],
    streamSimple: () => { calls++; throw new Error('provider must not run'); },
    ...config,
  } as any);
  return { dir, runtime, registry: new ModelRegistry(runtime), calls: () => calls };
}

function resolvedAuth(f: Awaited<ReturnType<typeof runtimeFor>>, baseUrl = 'https://resolved.example.invalid/v1') {
  f.runtime.getAuth = (async () => ({ auth: { apiKey: 'fixture-secret', baseUrl }, env: { FIXTURE_AUTH: 'hidden' } })) as any;
}

test('denied eligibility stops streamSimple before the provider is called', async t => {
  const f = await runtimeFor(); t.after(() => rm(f.dir, { recursive: true, force: true }));
  const seen: unknown[] = [];
  installRuntimeEligibility(f.registry, async identity => { seen.push(identity); throw new Error('CLASSIFICATION_DENIED'); });
  const denied = await f.runtime.streamSimple(f.runtime.getModel('fixture', 'fixture-model') as any, context).result();
  assert.equal(denied.stopReason, 'error'); assert.equal(denied.errorMessage, 'CLASSIFICATION_DENIED');
  assert.equal(f.calls(), 0);
  assert.deepEqual(seen, [{ provider: 'fixture', api: 'openai-completions', baseUrl: 'http://127.0.0.1:8000/v1' }]);
});

test('authorization sees the effective resolved endpoint, independent of model name and baseUrl', async t => {
  const f = await runtimeFor(); t.after(() => rm(f.dir, { recursive: true, force: true }));
  resolvedAuth(f);
  const seen: unknown[] = [];
  const seam = installRuntimeEligibility(f.registry, async identity => { seen.push(identity); });
  const altered = { ...model, id: 'Qwen-27B', name: 'GPT local alias', baseUrl: 'https://attacker.invalid/v1' };
  assert.deepEqual(await seam.resolve({ ...f.runtime.getModel('fixture', 'fixture-model')!, ...altered }), { provider: 'fixture', api: 'openai-completions', baseUrl: 'https://resolved.example.invalid/v1' });
  assert.deepEqual(seen, []);
});

test('authorization never receives credentials or arbitrary model fields', async t => {
  const f = await runtimeFor(); t.after(() => rm(f.dir, { recursive: true, force: true }));
  resolvedAuth(f);
  let received: unknown;
  installRuntimeEligibility(f.registry, async identity => { received = identity; });
  await f.runtime.streamSimple({ ...f.runtime.getModel('fixture', 'fixture-model')!, secretModelField: 'do-not-release' } as any, context).result().catch(() => undefined);
  assert.deepEqual(received, { provider: 'fixture', api: 'openai-completions', baseUrl: 'https://resolved.example.invalid/v1' });
  assert.doesNotMatch(JSON.stringify(received), /fixture-secret|apiKey|headers|env/);
});

test('stream and complete both stop before a denied provider request', async t => {
  const f = await runtimeFor(); t.after(() => rm(f.dir, { recursive: true, force: true }));
  resolvedAuth(f);
  installRuntimeEligibility(f.registry, async () => { throw new Error('CLASSIFICATION_DENIED'); });
  const registered = f.runtime.getModel('fixture', 'fixture-model') as any;
  const streamResult = await f.runtime.stream(registered, context).result();
  assert.equal(streamResult.stopReason, 'error'); assert.equal(streamResult.errorMessage, 'CLASSIFICATION_DENIED');
  const completeResult = await f.runtime.complete(registered, context);
  assert.equal(completeResult.stopReason, 'error'); assert.equal(completeResult.errorMessage, 'CLASSIFICATION_DENIED');
  assert.equal(f.calls(), 0);
});

test('unsupported API is denied before provider invocation', async t => {
  const f = await runtimeFor({ api: 'responses', models: [{ ...model, api: 'responses' }] }); t.after(() => rm(f.dir, { recursive: true, force: true }));
  const authorize = async () => { throw new Error('must not authorize unsupported route'); };
  installRuntimeEligibility(f.registry, authorize);
  const denied = await f.runtime.streamSimple(f.runtime.getModel('fixture', 'fixture-model') as any, context).result();
  assert.equal(denied.stopReason, 'error'); assert.equal(denied.errorMessage, 'EXECUTION_API_UNSUPPORTED');
  assert.equal(f.calls(), 0);
});

test('missing runtime fails closed and shutdown keeps it denied', async () => {
  assert.throws(() => installRuntimeEligibility({} as any, async () => {}), /EXECUTION_RUNTIME_UNSUPPORTED/);
  const f = await runtimeFor();
  try {
    const seam = installRuntimeEligibility(f.registry, async () => { throw new Error('denied'); });
    seam.shutdown();
    const denied = await f.runtime.streamSimple(f.runtime.getModel('fixture', 'fixture-model') as any, context).result();
    assert.equal(denied.stopReason, 'error'); assert.equal(denied.errorMessage, 'EXECUTION_RUNTIME_UNAVAILABLE');
    assert.equal(f.calls(), 0);
    const replacement = installRuntimeEligibility(f.registry, async () => { throw new Error('replacement-denied'); });
    const replacementResult = await f.runtime.streamSimple(f.runtime.getModel('fixture', 'fixture-model') as any, context).result();
    assert.equal(replacementResult.stopReason, 'error');
    assert.equal(replacementResult.errorMessage, 'replacement-denied');
    assert.notEqual(replacement, seam);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test('shutdown during asynchronous authorization cannot release a prepared request', async t => {
  const f = await runtimeFor(); t.after(() => rm(f.dir, { recursive: true, force: true }));
  let entered!: () => void, proceed!: () => void;
  const waiting = new Promise<void>(r => { entered = r; });
  const held = new Promise<void>(r => { proceed = r; });
  const seam = installRuntimeEligibility(f.registry, async () => { entered(); await held; });
  const pending = f.runtime.completeSimple(model, context);
  await waiting; seam.shutdown(); proceed();
  const denied = await pending; assert.equal(denied.stopReason, 'error');
  assert.equal(denied.errorMessage, 'EXECUTION_RUNTIME_CHANGED'); assert.equal(f.calls(), 0);
});
