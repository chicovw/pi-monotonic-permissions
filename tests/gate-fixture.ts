import { createGate as realCreateGate } from '../src/index.ts';
import type { ExecutionConfig } from '../src/eligibility.ts';
export const fixtureIdentity = { provider: 'fixture-provider', api: 'openai-completions', baseUrl: 'http://127.0.0.1:9/v1' };
export function execution(): ExecutionConfig {
  return { context: 'PUBLIC', history: 'PUBLIC', tools: { '*': 'PUBLIC' },
    routes: [{ ...fixtureIdentity, runtime: 'offline-synthetic-fixture', environment: 'LOCAL_TRUSTED', ceiling: 'PRIVATE' }] };
}
/** Old permission regressions run in an explicitly eligible synthetic environment. */
export const createGate: typeof realCreateGate = (path, diagnostics, evaluator, options) => realCreateGate(path, diagnostics, evaluator,
  { resolveExecution: async () => fixtureIdentity, ...options });
