/** Execution-environment eligibility. This is deliberately independent of tool policy. */
export type Classification = 'PUBLIC' | 'INTERNAL' | 'PRIVATE' | 'SECRET';
export type Ceiling = 'PUBLIC' | 'INTERNAL' | 'PRIVATE';
export interface ResolvedRoute {
  provider: string; api: string; baseUrl: string; runtime: string;
  environment: 'LOCAL_TRUSTED' | 'HOSTED_CONTROLLED'; ceiling: Ceiling;
}
export interface ExecutionConfig {
  context: Classification; history: Classification;
  tools: Record<string, Classification>; routes: ResolvedRoute[];
  ceiling?: Ceiling;
  protected?: { component: string; classification: Classification }[];
}
export interface ProjectExecutionConfig { ceiling?: Ceiling; context?: Classification; history?: Classification }

const levels: Classification[] = ['PUBLIC', 'INTERNAL', 'PRIVATE', 'SECRET'];
const ceilings: Ceiling[] = ['PUBLIC', 'INTERNAL', 'PRIVATE'];
function freeze<T>(v: T): T { if (v && typeof v === 'object') { for (const x of Object.values(v as object)) freeze(x); Object.freeze(v); } return v; }
const id = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 256 && !/[\x00-\x1f\x7f]/.test(v);
const obj = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.getPrototypeOf(v) !== Object.prototype) throw new Error('EXECUTION_STRUCTURE');
  return v as Record<string, unknown>;
};
function safe(v: unknown, depth = 0): void {
  if (depth > 32 || typeof v === 'function') throw new Error('EXECUTION_STRUCTURE');
  if (!v || typeof v !== 'object') return;
  if (Array.isArray(v)) { for (const x of v) safe(x, depth + 1); return; }
  if (Object.getPrototypeOf(v) !== Object.prototype) throw new Error('EXECUTION_STRUCTURE');
  for (const k of Object.keys(v)) { const d = Object.getOwnPropertyDescriptor(v, k); if (!d || !('value' in d)) throw new Error('EXECUTION_ACCESSOR'); safe(d.value, depth + 1); }
}
const exact = (v: Record<string, unknown>, keys: string[]) => {
  if (Object.keys(v).some(k => !keys.includes(k))) throw new Error('EXECUTION_FIELD');
};
const classification = (v: unknown): Classification => {
  if (!levels.includes(v as Classification)) throw new Error('EXECUTION_CLASSIFICATION');
  return v as Classification;
};
const ceiling = (v: unknown): Ceiling => {
  if (!ceilings.includes(v as Ceiling)) throw new Error('EXECUTION_CEILING');
  return v as Ceiling;
};
const url = (v: unknown, environment: ResolvedRoute['environment']): string => {
  if (!id(v)) throw new Error('EXECUTION_URL');
  let u: URL;
  try { u = new URL(v); } catch { throw new Error('EXECUTION_URL'); }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash) throw new Error('EXECUTION_URL');
  const loopback = u.hostname === '127.0.0.1' || u.hostname === '[::1]' || u.hostname === '::1';
  if (environment === 'LOCAL_TRUSTED' && !loopback) throw new Error('EXECUTION_ROUTE');
  if (environment === 'HOSTED_CONTROLLED' && (loopback || u.protocol !== 'https:')) throw new Error('EXECUTION_ROUTE');
  return v;
};
const route = (v: unknown): ResolvedRoute => {
  const r = obj(v); exact(r, ['provider', 'api', 'baseUrl', 'runtime', 'environment', 'ceiling']);
  if (!id(r.provider) || !id(r.api) || !id(r.runtime)) throw new Error('EXECUTION_ROUTE');
  if (r.environment !== 'LOCAL_TRUSTED' && r.environment !== 'HOSTED_CONTROLLED') throw new Error('EXECUTION_ROUTE');
  const c = ceiling(r.ceiling);
  if (r.environment === 'HOSTED_CONTROLLED' && c !== 'PUBLIC') throw new Error('EXECUTION_HOSTED_CEILING');
  return { provider: r.provider, api: r.api, baseUrl: url(r.baseUrl, r.environment), runtime: r.runtime, environment: r.environment, ceiling: c };
};

export function maxClassification(...values: Classification[]): Classification { if (!values.length) throw new Error('EXECUTION_CLASSIFICATION'); values.forEach(classification); return values.reduce((a, b) => levels.indexOf(a) >= levels.indexOf(b) ? a : b); }
export function minCeiling(a: Ceiling, b: Ceiling): Ceiling { ceiling(a); ceiling(b); return ceilings[Math.min(ceilings.indexOf(a), ceilings.indexOf(b))]; }

export function mayReleaseContext(value: unknown, candidate: unknown, projectCeiling?: unknown) {
  try {
    safe(value); safe(candidate); if (projectCeiling !== undefined) safe(projectCeiling);
    const c = classification(value); const r = route(candidate);
    if (c === 'SECRET') return { allowed: false, reason: 'SECRET_INELIGIBLE' };
    const effective = projectCeiling === undefined ? r.ceiling : minCeiling(r.ceiling, ceiling(projectCeiling));
    return levels.indexOf(c) <= ceilings.indexOf(effective)
      ? { allowed: true, reason: 'ELIGIBLE' }
      : { allowed: false, reason: 'CLASSIFICATION_EXCEEDS_CEILING' };
  } catch { return { allowed: false, reason: 'ELIGIBILITY_INVALID' }; }
}

export function parseExecution(value: unknown, global: true): ExecutionConfig;
export function parseExecution(value: unknown, global: false): ProjectExecutionConfig;
export function parseExecution(value: unknown, global: boolean): ExecutionConfig | ProjectExecutionConfig;
export function parseExecution(value: unknown, global: boolean): ExecutionConfig | ProjectExecutionConfig {
  safe(value);
  const r = obj(value);
  if (!global) {
    exact(r, ['ceiling', 'context', 'history']);
    const project: ProjectExecutionConfig = {};
    if (r.ceiling !== undefined) project.ceiling = ceiling(r.ceiling);
    if (r.context !== undefined) project.context = classification(r.context);
    if (r.history !== undefined) project.history = classification(r.history);
    return Object.freeze(project);
  }
  exact(r, ['context', 'history', 'tools', 'routes', 'ceiling', 'protected']);
  if (['context', 'history', 'tools', 'routes'].some(k => !(k in r))) throw new Error('EXECUTION_REQUIRED');
  const toolsObj = obj(r.tools);
  const tools: Record<string, Classification> = Object.create(null);
  if (Object.keys(toolsObj).length > 128) throw new Error('EXECUTION_SIZE');
  for (const [key, value] of Object.entries(toolsObj)) {
    if (!id(key)) throw new Error('EXECUTION_TOOL');
    tools[key] = classification(value);
  }
  if (!Array.isArray(r.routes) || r.routes.length > 32) throw new Error('EXECUTION_ROUTES');
  const routes = r.routes.map(route);
  const seen = new Set<string>();
  for (const item of routes) {
    const key = JSON.stringify([item.provider, item.api, item.baseUrl]);
    if (seen.has(key)) throw new Error('EXECUTION_ROUTE_DUPLICATE');
    seen.add(key);
  }
  const out: ExecutionConfig = { context: classification(r.context), history: classification(r.history), tools, routes };
  if (r.ceiling !== undefined) out.ceiling = ceiling(r.ceiling);
  if (r.protected !== undefined) {
    if (!Array.isArray(r.protected) || r.protected.length > 128) throw new Error('EXECUTION_PROTECTED');
    out.protected = r.protected.map(value => {
      const rule = obj(value);
      exact(rule, ['component', 'classification']);
      if (!id(rule.component) || ['.', '..'].includes(rule.component) || /[/\\\x00-\x1f\x7f]/.test(rule.component)) throw new Error('EXECUTION_PROTECTED');
      return { component: rule.component, classification: classification(rule.classification) };
    });
  }
  return freeze(out);
}
