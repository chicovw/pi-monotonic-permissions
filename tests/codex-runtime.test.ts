import test from 'node:test';
import assert from 'node:assert/strict';
import { installRuntimeEligibility } from '../src/pi-runtime.ts';
import { mayReleaseContext } from '../src/eligibility.ts';

const codex = { provider: 'openai-codex', api: 'openai-codex-responses', baseUrl: 'https://chatgpt.com/backend-api' };
const route = { ...codex, runtime: 'operator-approved-openai-codex', environment: 'HOSTED_CONTROLLED' as const, ceiling: 'PUBLIC' as const };

function fixture(model = codex, options: Record<string, unknown> = {}) {
  const prepared = { model, provider: {}, options };
  const registry = { runtime: { prepareRequest: async (_model: unknown) => prepared } };
  return { prepared, registry };
}

test('reviewed Codex identity is forced to the exact non-redirecting SSE backend before authorization', async () => {
  const f = fixture(); let seen: unknown;
  const seam = installRuntimeEligibility(f.registry, async identity => { seen = identity; }, '0.85.1');
  assert.deepEqual(await seam.resolve(codex), codex);
  assert.deepEqual(seen, undefined);
  await f.registry.runtime.prepareRequest(codex);
  assert.deepEqual(seen, codex);
  assert.equal(f.prepared.options.transport, 'sse');
  assert.equal(typeof f.prepared.options.fetch, 'function');
  const fetch = f.prepared.options.fetch as typeof globalThis.fetch;
  await assert.rejects(() => fetch('https://attacker.invalid/codex/responses', { method: 'POST' }), /EXECUTION_TRANSPORT_UNSUPPORTED/);
  await assert.rejects(() => fetch(new Request('https://chatgpt.com/backend-api/codex/responses', { method: 'POST' })), /EXECUTION_TRANSPORT_UNSUPPORTED/);
  const originalFetch = globalThis.fetch;
  let captured: { url: string; init?: RequestInit } | undefined;
  globalThis.fetch = async (input, init) => {
    captured = { url: String(input), init };
    return new Response(null, { status: 200 });
  };
  try {
    await fetch('https://chatgpt.com/backend-api/codex/responses', { method: 'POST' });
    assert.deepEqual(captured, {
      url: 'https://chatgpt.com/backend-api/codex/responses',
      init: { method: 'POST', redirect: 'error' },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  seam.shutdown();
});

test('Codex qualification rejects wrong provider, API, backend path, and malformed options before authorization', async () => {
  for (const model of [
    { ...codex, provider: 'openai' },
    { ...codex, api: 'openai-completions' },
    { ...codex, baseUrl: 'https://chatgpt.com' },
  ]) {
    const f = fixture(model); let authorized = false;
    const seam = installRuntimeEligibility(f.registry, async () => { authorized = true; }, '0.85.1');
    await assert.rejects(() => f.registry.runtime.prepareRequest(model), /EXECUTION_API_UNSUPPORTED/);
    assert.equal(authorized, false);
    seam.shutdown();
  }
  const malformed = fixture(codex, null as unknown as Record<string, unknown>);
  const seam = installRuntimeEligibility(malformed.registry, async () => {}, '0.85.1');
  await assert.rejects(() => malformed.registry.runtime.prepareRequest(codex), /EXECUTION_API_UNSUPPORTED/);
  seam.shutdown();
});

test('Codex route remains PUBLIC-only independently of grants, mode, or caller preferences', () => {
  assert.deepEqual(mayReleaseContext('PUBLIC', route), { allowed: true, reason: 'ELIGIBLE' });
  assert.deepEqual(mayReleaseContext('PRIVATE', route), { allowed: false, reason: 'CLASSIFICATION_EXCEEDS_CEILING' });
  assert.deepEqual(mayReleaseContext('SECRET', route), { allowed: false, reason: 'SECRET_INELIGIBLE' });
});
