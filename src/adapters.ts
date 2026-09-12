import { createHash } from 'node:crypto';

/** Small semantic vocabulary shared by native and extension adapters. */
export type SemanticOperation =
  | 'filesystem.read_file' | 'filesystem.list_directory' | 'filesystem.find_paths'
  | 'filesystem.search_file_contents' | 'filesystem.write_file' | 'filesystem.edit_file'
  | 'process.execute' | 'delegation.spawn' | 'context.release' | 'history.recall'
  | 'memory.persist' | 'memory.retrieve' | 'network.request' | 'observability.read_status';

export interface AdapterDescriptor {
  readonly id: string;
  readonly contract: string;
  readonly toolNames: readonly string[];
  readonly operation: SemanticOperation;
  readonly reviewed: boolean;
}

/** Canonical schema identity for a reviewed adapter. Descriptions are intentionally non-authoritative. */
export function schemaFingerprint(schema: unknown): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== 'description').sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
    return value;
  };
  return createHash('sha256').update(JSON.stringify(canonical(schema))).digest('hex');
}

/** Operator-owned registry. Project content cannot register authoritative adapters. */
export class AdapterRegistry {
  #entries = new Map<string, AdapterDescriptor>();
  register(descriptor: AdapterDescriptor): void {
    if (!descriptor.reviewed || !/^[a-zA-Z0-9._:-]{1,128}$/.test(descriptor.id) || !descriptor.contract) throw new Error('ADAPTER_INVALID');
    for (const name of descriptor.toolNames) if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name)) throw new Error('ADAPTER_INVALID');
    if (this.#entries.has(descriptor.id)) throw new Error('ADAPTER_DUPLICATE');
    this.#entries.set(descriptor.id, Object.freeze({ ...descriptor, toolNames: Object.freeze([...descriptor.toolNames]) }));
  }
  get(id: string): AdapterDescriptor | undefined { return this.#entries.get(id); }
  values(): readonly AdapterDescriptor[] { return Object.freeze([...this.#entries.values()]); }
}
