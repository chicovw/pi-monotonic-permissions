import type { Classification, Ceiling, ResolvedRoute } from './eligibility.ts';

/**
 * Read-only PMP authority available to trusted extensions in the same Pi process.
 *
 * This is an integration seam, not a sandbox boundary. It intentionally exposes no
 * mode, policy, grant, or classification mutation operation.
 */
export interface RouteEligibility {
  readonly allowed: boolean;
  readonly reason: 'ELIGIBLE' | 'BROKER_UNAVAILABLE' | 'POLICY_UNAVAILABLE' | 'ROUTE_UNAPPROVED' | 'SECRET_INELIGIBLE' | 'CLASSIFICATION_EXCEEDS_CEILING' | 'ELIGIBILITY_INVALID';
  readonly classification?: Classification;
  readonly ceiling?: Ceiling;
}

export interface RuntimeAuthorityBroker {
  readonly version: 1;
  currentClassification(): Promise<{ readonly available: true; readonly classification: Classification } | { readonly available: false; readonly reason: 'POLICY_UNAVAILABLE' }>;
  evaluateRoute(route: unknown): Promise<RouteEligibility>;
}

const brokerKey = Symbol.for('pi-monotonic-permissions.runtime-authority-broker.v1');
type BrokerState = { readonly api: RuntimeAuthorityBroker; active?: RuntimeAuthorityBroker };
type GlobalWithBroker = typeof globalThis & { [brokerKey]?: BrokerState };

/*
 * Extensions can be evaluated more than once by Pi's test and bundled loaders.
 * The process-wide facade therefore owns the active pointer. Each evaluated copy
 * contributes a session source to the same versioned seam instead of treating a
 * second module evaluation as a policy conflict. The facade itself stays frozen
 * and exposes no mutation to consumers.
 */
function state(): BrokerState {
  const global = globalThis as GlobalWithBroker;
  const existing = global[brokerKey];
  if (existing) {
    if (existing.api?.version !== 1) throw new Error('RUNTIME_BROKER_CONFLICT');
    return existing;
  }
  const created: BrokerState = {} as BrokerState;
  const api: RuntimeAuthorityBroker = Object.freeze({
    version: 1,
    async currentClassification() {
      return created.active ? created.active.currentClassification() : { available: false as const, reason: 'POLICY_UNAVAILABLE' as const };
    },
    async evaluateRoute(route: unknown) {
      return created.active ? created.active.evaluateRoute(route) : { allowed: false as const, reason: 'BROKER_UNAVAILABLE' as const };
    },
  });
  Object.defineProperty(created, 'api', { value: api, enumerable: true, configurable: false, writable: false });
  Object.defineProperty(global, brokerKey, { value: created, configurable: false, enumerable: false, writable: false });
  return created;
}

/** Publish the active PMP session behind a stable read-only versioned facade. */
export function publishRuntimeAuthorityBroker(broker: RuntimeAuthorityBroker): void {
  state().active = broker;
}

/** Returns undefined when PMP is unavailable. Callers must fail closed. */
export function getRuntimeAuthorityBroker(): RuntimeAuthorityBroker | undefined {
  try {
    const existing = (globalThis as GlobalWithBroker)[brokerKey];
    return existing?.api?.version === 1 ? existing.api : undefined;
  } catch { return undefined; }
}

export type { ResolvedRoute };
