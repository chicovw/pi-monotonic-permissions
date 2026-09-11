import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { ToolInfo } from '@earendil-works/pi-coding-agent';
import { fingerprint, stableJson } from './grants.ts';
import type { Action } from './policy.ts';
import type { Request } from './requests.ts';

// Reviewed against the pi-blackhole 0.5.3 published tool schema. Annotations are
// excluded only for adapter recognition; the complete schema still keys grants.
export const recallSchema = { type: 'object', properties: {
  query: { type: 'string' }, expand: { type: 'array', items: { type: 'number' } },
  page: { type: 'number' }, scope: { type: 'string', enum: ['lineage', 'all'] },
  mode: { type: 'string', enum: ['hybrid', 'file', 'touched'] }
} };
function contractShape(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(contractShape);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([k]) => k !== 'description').map(([k, v]) => [k, contractShape(v)]));
  return value;
}
function recall(input: Record<string, unknown>): string {
  if (Object.keys(input).some(k => !['query', 'expand', 'page', 'scope', 'mode'].includes(k))
    || ('query' in input && typeof input.query !== 'string')
    || ('scope' in input && (typeof input.scope !== 'string' || !['lineage', 'all'].includes(input.scope)))
    || ('mode' in input && (typeof input.mode !== 'string' || !['hybrid', 'file', 'touched'].includes(input.mode)))
    || ('page' in input && (!Number.isSafeInteger(input.page) || Number(input.page) < 1))
    || ('expand' in input && (!Array.isArray(input.expand) || input.expand.length > 128
      || input.expand.some(n => !Number.isSafeInteger(n) || n < 0)))) throw new Error('CUSTOM_SHAPE');
  return input.scope === 'all' ? 'recall.allLineages' : 'recall.activeLineage';
}
const adapters = new Map([['recall', { schema: recallSchema, version: 'pi-blackhole@0.5.3/recall-v1', describe: recall }]]);

export async function describeCustom(request: Request, info?: ToolInfo): Promise<Action> {
  if (typeof request.toolName !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(request.toolName)
    || !request.input || typeof request.input !== 'object' || Array.isArray(request.input)) throw new Error('CUSTOM_SHAPE');
  // Reject cycles, accessors, non-JSON values and oversized/unrenderable inputs.
  stableJson(request.input);
  const adapter = adapters.get(request.toolName);
  const reviewedOperation = adapter?.describe(request.input);
  // Unit seams may omit metadata. Real Pi supplies it for every configured tool.
  const reviewed = !!adapter && !!info && fingerprint(contractShape(info.parameters)) === fingerprint(adapter.schema);
  const operation = reviewed ? reviewedOperation! : 'unknown.exactRequest';
  let source: string | null = null;
  if (info?.sourceInfo?.path) {
    const body = await readFile(info.sourceInfo.path);
    if (body.length > 8 * 1024 * 1024) throw new Error('CUSTOM_SOURCE_SIZE');
    source = createHash('sha256').update(body).digest('hex');
  }
  const contract = fingerprint({ adapter: reviewed ? adapter!.version : null,
    metadata: info ? JSON.parse(JSON.stringify(info)) : null, source });
  return { tool: request.toolName, targets: [], custom: { reviewed, operation, contract, persistent: reviewed && source !== null } };
}
