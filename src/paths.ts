import { access, lstat, realpath, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export interface Target {
  requested: string;
  lexical: string;
  canonical: string;
  exists: boolean;
  directory: boolean;
  identity: string;
  revision: string;
  parents: Target[];
}

export function normalize(requested: string, cwd: string): string {
  if (typeof requested !== 'string' || !requested || /[\x00-\x1f\x7f\u00a0\u2000-\u200a\u202f\u205f\u3000]/u.test(requested)
      || requested.startsWith('@') || /^[a-z]+:\/\//i.test(requested)
      || (requested.startsWith('~') && requested !== '~' && !requested.startsWith('~/'))) {
    throw new Error('PATH_SYNTAX');
  }
  const expanded = requested === '~' ? homedir() : requested.startsWith('~/') ? join(homedir(), requested.slice(2)) : requested;
  return resolve(cwd, expanded);
}

export function inside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
}

export function componentMatch(path: string, component: string): boolean {
  // Deliberately conservative even on case-sensitive Darwin volumes.
  const fold = (s: string) => process.platform === 'darwin' ? s.normalize('NFC').toLowerCase() : s;
  return path.split(sep).some(part => fold(part) === fold(component));
}

async function existing(requested: string, lexical: string): Promise<Target> {
  const canonical = await realpath(lexical);
  const s = await stat(canonical, { bigint: true });
  if (!s.isFile() && !s.isDirectory()) throw new Error('PATH_TYPE');
  return { requested, lexical, canonical, exists: true, directory: s.isDirectory(),
    identity: `${s.dev}:${s.ino}`, revision: `${s.dev}:${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`, parents: [] };
}

export async function resolveTarget(requested: string, cwd: string, allowMissing = false): Promise<Target> {
  const lexical = normalize(requested, cwd);
  let cursor = lexical;
  const missing: string[] = [];
  while (true) {
    try { await lstat(cursor); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || !allowMissing) throw new Error('PATH_RESOLUTION');
      const parent = dirname(cursor);
      if (parent === cursor) throw new Error('PATH_RESOLUTION');
      missing.unshift(relative(parent, cursor));
      cursor = parent;
    }
  }
  // A dangling symlink is existing according to lstat, then realpath fails here.
  const ancestor = await existing(requested, cursor);
  if (missing.length === 0) return ancestor;
  if (!ancestor.directory) throw new Error('PATH_PARENT_TYPE');
  const parents: Target[] = [];
  for (let i = 1; i < missing.length; i++) {
    parents.push({ ...ancestor, requested, lexical: join(cursor, ...missing.slice(0, i)),
      canonical: join(ancestor.canonical, ...missing.slice(0, i)), exists: false, parents: [] });
  }
  return { ...ancestor, requested, lexical, canonical: join(ancestor.canonical, ...missing),
    exists: false, directory: false, parents };
}

export async function requireReadable(target: Target): Promise<void> {
  if (!target.exists || target.directory) throw new Error('REGULAR_FILE_REQUIRED');
  // Prevent Pi read's fallback spelling lookup from selecting an unchecked file.
  await access(target.lexical, constants.R_OK);
}
