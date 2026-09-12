import { VERSION as runningPiVersion } from '@earendil-works/pi-coding-agent';

export interface RuntimeIdentity { provider: string; api: string; baseUrl: string }
type Model = RuntimeIdentity & { [key: string]: unknown };
type Prepared = { model: Model; provider: unknown; options: Record<string, unknown> };
const boundaryKey = Symbol.for('pi-monotonic-permissions.runtime-boundary.v1');
type Runtime = { prepareRequest(model: Model, options?: unknown): Promise<Prepared> };
const codexBaseUrl = 'https://chatgpt.com/backend-api';
const codexSseUrl = `${codexBaseUrl}/codex/responses`;

function codexFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  // Pi 0.85.1 calls this seam with the exact URL string plus RequestInit. A
  // Request or URL object is a transport-contract change, not an equivalent
  // representation: it could hide a body, headers, or redirect semantics.
  if (typeof input !== 'string' || input !== codexSseUrl || init?.method !== 'POST') {
    return Promise.reject(new Error('EXECUTION_TRANSPORT_UNSUPPORTED'));
  }
  // The reviewed SSE route must not follow a provider redirect to another host.
  return globalThis.fetch(codexSseUrl, { ...init, method: 'POST', redirect: 'error' });
}

/** Pi 0.85.1 compatibility seam. Private API, deliberately pinned and tested.
 * Auth values remain inside Pi. Only the post-auth endpoint identity leaves here.
 * This governs this runtime's provider calls, not arbitrary extension JavaScript.
 */
export function installRuntimeEligibility(registry: unknown, authorize: (identity: RuntimeIdentity) => Promise<void>, runtimeVersion: unknown = runningPiVersion) {
  const runtime = (registry as { runtime?: Runtime } | undefined)?.runtime;
  if (!runtime || typeof runtime.prepareRequest !== 'function') throw new Error('EXECUTION_RUNTIME_UNSUPPORTED');
  const previous = (runtime.prepareRequest as unknown as Record<symbol, { original: Runtime['prepareRequest']; shutdown(): void }>)[boundaryKey];
  const original = previous?.original ?? runtime.prepareRequest;
  previous?.shutdown();
  let active = true;
  // Pi's public version value survives bundled virtual-module loading. It does
  // not replace the independent private runtime-structure check above.
  const compatible = runtimeVersion === '0.85.1';
  const identity = (prepared: Prepared): RuntimeIdentity => {
    const m = prepared?.model;
    if (!m || typeof m.provider !== 'string' || typeof m.api !== 'string' || typeof m.baseUrl !== 'string') throw new Error('EXECUTION_ROUTE_UNRESOLVED');
    if (m.provider === 'openai-codex' && m.api !== 'openai-codex-responses') throw new Error('EXECUTION_API_UNSUPPORTED');
    if (m.api === 'openai-codex-responses') {
      // Pi 0.85.1 otherwise defaults to WebSocket auto transport with an SSE
      // fallback. PMP supports only this exact, forced-SSE backend contract.
      if (m.provider !== 'openai-codex' || m.baseUrl !== codexBaseUrl || !prepared.options || typeof prepared.options !== 'object') throw new Error('EXECUTION_API_UNSUPPORTED');
      prepared.options.transport = 'sse';
      prepared.options.fetch = codexFetch;
      return { provider: m.provider, api: m.api, baseUrl: m.baseUrl };
    }
    // Only reviewed endpoint-based adapters are qualified. Other transports
    // need their own review; environment values, headers, and credentials are
    // not evidence of eligibility.
    if (m.api !== 'openai-completions') throw new Error('EXECUTION_API_UNSUPPORTED');
    return { provider: m.provider, api: m.api, baseUrl: m.baseUrl };
  };
  const prepare = async (model: Model, options?: unknown) => {
    if (!active || !compatible || runtime.prepareRequest !== wrapped) throw new Error('EXECUTION_RUNTIME_UNAVAILABLE');
    const prepared = await original.call(runtime, model, options);
    if (!active || runtime.prepareRequest !== wrapped) throw new Error('EXECUTION_RUNTIME_CHANGED');
    return prepared;
  };
  const wrapped = async (model: Model, options?: unknown) => {
    const prepared = await prepare(model, options);
    await authorize(identity(prepared));
    if (!active || runtime.prepareRequest !== wrapped) throw new Error('EXECUTION_RUNTIME_CHANGED');
    return prepared;
  };
  Object.defineProperty(wrapped, boundaryKey, { value: { original, shutdown() { active = false; } } });
  runtime.prepareRequest = wrapped;
  return {
    async resolve(model: unknown) { return identity(await prepare(model as Model)); },
    // Keep a rejecting wrapper installed between sessions. Never restore an unguarded runtime.
    shutdown() { active = false; }
  };
}
