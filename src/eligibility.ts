/** Execution-environment eligibility. This is deliberately independent of tool policy. */
import type { Target } from './paths.ts';
export type Classification = 'PUBLIC' | 'INTERNAL' | 'PRIVATE' | 'SECRET';
export type Ceiling = 'PUBLIC' | 'INTERNAL' | 'PRIVATE';
export interface ResolvedRoute {
  provider: string; api: string; baseUrl: string; runtime: string;
  environment: 'LOCAL_TRUSTED' | 'HOSTED_CONTROLLED'; ceiling: Ceiling;
}
export interface ExecutionConfig {
  /** V1 compatibility fields are immutable floors, not V2 defaults. */
  legacy?: true;
  defaultClassification?: Classification;
  minimumClassification?: Classification;
  opaqueTools?: Record<string, Classification>; routes: ResolvedRoute[];
  /** Deprecated V1 fields. Parsed V1 policy preserves their floor semantics. */
  context: Classification; history: Classification; tools: Record<string, Classification>;
  protected?: { component: string; classification: Classification }[];
  ceiling?: Ceiling;
  projects?: { path: string; classification: Classification }[];
  resources?: ResourceRule[];
}
export interface ResourceRule {
  component?: string;
  base?: 'project' | 'home' | 'absolute';
  path?: string;
  kind?: 'file' | 'tree';
  /** Bound only while loading operator/project policy. Never accepted from JSON. */
  target?: Target;
  classification: Classification;
}
export interface ProjectExecutionConfig { ceiling?: Ceiling; minimumClassification?: Classification; resources?: ResourceRule[] }

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
const startupClassification = (v: unknown): Classification => {
  const value = classification(v);
  if (value === 'SECRET') throw new Error('EXECUTION_STARTUP_CLASSIFICATION');
  return value;
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
    exact(r, ['ceiling', 'context', 'history', 'minimumClassification', 'resources']);
    const project: ProjectExecutionConfig = {};
    if (r.ceiling !== undefined) project.ceiling = ceiling(r.ceiling);
    // V1 project context/history were documented high-water inputs. Retain that
    // meaning as a floor rather than silently reinterpreting them as defaults.
    if (r.minimumClassification !== undefined && (r.context !== undefined || r.history !== undefined)) throw new Error('EXECUTION_MIGRATION');
    if (r.minimumClassification !== undefined) project.minimumClassification = classification(r.minimumClassification);
    else if (r.context !== undefined || r.history !== undefined) project.minimumClassification = maxClassification(
      ...(r.context === undefined ? [] : [classification(r.context)]),
      ...(r.history === undefined ? [] : [classification(r.history)]));
    if (r.resources !== undefined) project.resources = resources(r.resources);
    return Object.freeze(project);
  }
  exact(r, ['context', 'history', 'tools', 'protected', 'defaultClassification', 'minimumClassification', 'opaqueTools', 'routes', 'ceiling', 'projects', 'resources']);
  const legacy = 'context' in r || 'history' in r || 'tools' in r || 'protected' in r;
  if (legacy && ['defaultClassification', 'minimumClassification', 'opaqueTools', 'projects', 'resources'].some(k => k in r)) throw new Error('EXECUTION_MIGRATION');
  if (legacy && ['context', 'history', 'tools', 'routes'].some(k => !(k in r))) throw new Error('EXECUTION_REQUIRED');
  if (!legacy && ['defaultClassification', 'opaqueTools', 'routes'].some(k => !(k in r))) throw new Error('EXECUTION_REQUIRED');
  const toolsObj = obj(legacy ? r.tools : r.opaqueTools);
  const opaqueTools: Record<string, Classification> = Object.create(null);
  if (Object.keys(toolsObj).length > 128) throw new Error('EXECUTION_SIZE');
  for (const [key, value] of Object.entries(toolsObj)) {
    if (!id(key)) throw new Error('EXECUTION_TOOL');
    opaqueTools[key] = classification(value);
  }
  if (!Array.isArray(r.routes) || r.routes.length > 32) throw new Error('EXECUTION_ROUTES');
  const routes = r.routes.map(route);
  const seen = new Set<string>();
  for (const item of routes) {
    const key = JSON.stringify([item.provider, item.api, item.baseUrl]);
    if (seen.has(key)) throw new Error('EXECUTION_ROUTE_DUPLICATE');
    seen.add(key);
  }
  const out: ExecutionConfig = legacy
    ? { legacy: true, defaultClassification: 'PUBLIC', minimumClassification: maxClassification(classification(r.context), classification(r.history)), opaqueTools, routes,
      context: classification(r.context), history: classification(r.history), tools: opaqueTools }
    : { defaultClassification: startupClassification(r.defaultClassification), ...(r.minimumClassification === undefined ? {} : { minimumClassification: classification(r.minimumClassification) }), opaqueTools, routes,
      context: 'PUBLIC', history: 'PUBLIC', tools: opaqueTools };
  if (r.ceiling !== undefined) out.ceiling = ceiling(r.ceiling);
  if (legacy && r.protected !== undefined) { out.resources = resources(r.protected, true); out.protected = out.resources.map(rule => ({ component: rule.component!, classification: rule.classification })); }
  if (!legacy && r.resources !== undefined) out.resources = resources(r.resources);
  if (!legacy && r.projects !== undefined) {
    if (!Array.isArray(r.projects) || r.projects.length > 128) throw new Error('EXECUTION_PROJECTS');
    const seen = new Set<string>();
    out.projects = r.projects.map(value => {
      const project = obj(value); exact(project, ['path', 'classification']);
      if (!id(project.path) || !project.path.startsWith('/')) throw new Error('EXECUTION_PROJECT');
      if (seen.has(project.path)) throw new Error('EXECUTION_PROJECT_DUPLICATE');
      seen.add(project.path);
      return { path: project.path, classification: classification(project.classification) };
    });
  }
  return freeze(out);
}

function resources(value: unknown, legacy = false): ResourceRule[] {
  if (!Array.isArray(value) || value.length > 128) throw new Error('EXECUTION_RESOURCE');
  return value.map(value => {
    const rule = obj(value);
    exact(rule, legacy ? ['component', 'classification'] : ['component', 'base', 'path', 'kind', 'classification']);
    if (typeof rule.component === 'string') {
      if (!id(rule.component) || ['.', '..'].includes(rule.component) || /[/\\\x00-\x1f\x7f]/.test(rule.component)
        || ['base', 'path', 'kind'].some(k => k in rule)) throw new Error('EXECUTION_RESOURCE');
      return { component: rule.component, classification: classification(rule.classification) };
    }
    if (legacy || !['project', 'home', 'absolute'].includes(rule.base as string) || typeof rule.path !== 'string'
      || (rule.kind !== 'file' && rule.kind !== 'tree')) throw new Error('EXECUTION_RESOURCE');
    if (rule.base === 'absolute' ? !rule.path.startsWith('/') : rule.path.startsWith('/') || rule.path.startsWith('~')) throw new Error('EXECUTION_RESOURCE');
    return { base: rule.base as ResourceRule['base'], path: rule.path, kind: rule.kind as ResourceRule['kind'], classification: classification(rule.classification) };
  });
}
