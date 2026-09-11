import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { parseJson } from './config.ts';

/** Canonical JSON for request/contract identity, never a serialization fallback. */
export function stableJson(value: unknown): string {
  let nodes = 0;
  function visit(v: unknown, depth: number): unknown {
    if (++nodes > 8192 || depth > 32) throw new Error('IDENTITY_SIZE');
    if (v === null || typeof v === 'boolean' || typeof v === 'string') return v;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (!v || typeof v !== 'object') throw new Error('IDENTITY_SHAPE');
    if (Array.isArray(v)) return v.map(x => visit(x, depth + 1));
    if (![Object.prototype, null].includes(Object.getPrototypeOf(v))) throw new Error('IDENTITY_SHAPE');
    return Object.fromEntries(Object.keys(v).sort().map(key => {
      const d = Object.getOwnPropertyDescriptor(v, key)!;
      if (!('value' in d)) throw new Error('IDENTITY_SHAPE');
      return [key, visit(d.value, depth + 1)];
    }));
  }
  const result = JSON.stringify(visit(value, 0));
  if (result.length > 65536) throw new Error('IDENTITY_SIZE');
  return result;
}
export const fingerprint = (value: unknown) => createHash('sha256').update(stableJson(value)).digest('hex');
export interface Grant { tool: string; operation: string; contract: string; context: string }
const hex = /^[a-f0-9]{64}$/;
function validate(value: unknown): Grant[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('GRANTS_STRUCTURE');
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).sort().join(',') !== 'grants,version' || raw.version !== 1 || !Array.isArray(raw.grants) || raw.grants.length > 128) throw new Error('GRANTS_STRUCTURE');
  return raw.grants.map(g => {
    if (!g || typeof g !== 'object' || Object.keys(g).sort().join(',') !== 'context,contract,operation,tool'
      || typeof g.tool !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(g.tool)
      || typeof g.operation !== 'string' || !/^[a-zA-Z0-9_.-]{1,96}$/.test(g.operation)
      || typeof g.contract !== 'string' || !hex.test(g.contract)
      || typeof g.context !== 'string' || !hex.test(g.context)) throw new Error('GRANTS_STRUCTURE');
    return g as Grant;
  });
}

/** Mutable operator state. No policy writes, payloads, results, or implicit broadening. */
export class GrantStore {
  readonly path: string;
  constructor(path: string) {
    if (!isAbsolute(path)) throw new Error('GRANTS_PATH');
    this.path = path;
  }
  private async directory(create: boolean): Promise<boolean> {
    const dir = dirname(this.path);
    if (create) await mkdir(dir, { recursive: true, mode: 0o700 });
    let s;
    try { s = await lstat(dir); } catch (e) { if (!create && (e as NodeJS.ErrnoException).code === 'ENOENT') return false; throw e; }
    if (!s.isDirectory() || (s.mode & 0o077) !== 0 || s.uid !== process.getuid?.() || await realpath(dir) !== dir) throw new Error('GRANTS_PERMISSIONS');
    return true;
  }
  async read(): Promise<Grant[]> {
    if (!await this.directory(false)) return [];
    let file;
    try { file = await open(this.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []; throw e; }
    try {
      const s = await file.stat();
      if (!s.isFile() || s.nlink !== 1 || s.size > 65536 || (s.mode & 0o077) !== 0 || s.uid !== process.getuid?.()) throw new Error('GRANTS_PERMISSIONS');
      return validate(parseJson(await file.readFile('utf8')));
    } finally { await file.close(); }
  }
  async has(grant: Grant): Promise<boolean> { return (await this.read()).some(g => fingerprint(g) === fingerprint(grant)); }
  async add(grant: Grant): Promise<void> {
    validate({ version: 1, grants: [grant] });
    await this.directory(true);
    const grants = await this.read();
    if (grants.some(g => fingerprint(g) === fingerprint(grant))) return;
    if (grants.length >= 128) throw new Error('GRANTS_FULL');
    const temp = join(dirname(this.path), `.grants-${randomUUID()}.tmp`);
    try {
      const file = await open(temp, 'wx', 0o600);
      try { await file.writeFile(JSON.stringify({ version: 1, grants: [...grants, grant] }, null, 2) + '\n'); await file.sync(); }
      finally { await file.close(); }
      await rename(temp, this.path);
    } finally { await unlink(temp).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
  }
}
