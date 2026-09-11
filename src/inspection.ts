import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveTarget } from './paths.ts';
import type { Action, Result } from './policy.ts';
import { UnsupportedOperation } from './bash.ts';

/** Preflight literal inspection, never read contents or enumerate a denied directory.
 * This is bounded interception, not containment: filesystem races remain possible.
 */
export async function inspectTargets(action: Action, cwd: string, decide: (a: Action) => Result): Promise<void> {
  const visited = new Set<string>();
  let count = 0;
  async function visit(path: string, recursive: boolean, depth: number): Promise<void> {
    if (++count > 2048 || depth > 32) throw new UnsupportedOperation('INSPECTION_LIMIT');
    const target = await resolveTarget(path, cwd);
    const item = { target, operations: ['read' as const] };
    action.targets.push(item);
    // Retain DENY for final composition. Do not enumerate protected contents.
    if (decide({ tool: 'read', targets: [item] }).decision === 'DENY') return;
    if (!recursive || !target.directory || visited.has(target.identity)) return;
    visited.add(target.identity);
    for (const entry of await readdir(target.lexical)) await visit(join(target.lexical, entry), true, depth + 1);
  }
  for (const command of action.commands ?? []) {
    if (command.scan) await visit(command.scan.path, command.scan.recursive, 0);
  }
}
