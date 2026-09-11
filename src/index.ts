import { createHash } from 'node:crypto';
import { dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { loadSnapshot } from './config.ts';
import type { Snapshot } from './config.ts';
import { compose, evaluate } from './policy.ts';
import type { Action, Result } from './policy.ts';
import { inside, resolveTarget } from './paths.ts';
import { UnsupportedOperation, unsupportedMessages } from './bash.ts';
import { inspectTargets } from './inspection.ts';
import { describe } from './requests.ts';
import type { Request } from './requests.ts';

type Context = Pick<ExtensionContext, 'cwd' | 'mode' | 'hasUI'> & { ui: Pick<ExtensionContext['ui'], 'select'> };
export interface Diagnostic { tool: string; decision: string; code: string; layer: string; approvalRequested: boolean; approvalResult?: 'granted' | 'declined' }
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const blocked = (code: string) => ({ block: true as const, reason: `Permission blocked: ${code}${code in unsupportedMessages ? '. ' + unsupportedMessages[code as keyof typeof unsupportedMessages] : ''}` });
const sourceRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/** The gate owns only a session snapshot and pending one-shot approvals. */
export function createGate(globalPath: string | undefined, diagnostics?: (event: Diagnostic) => void, evaluateLayer = evaluate) {
  let snapshot: Snapshot | undefined;
  let policyIdentity = '';
  let canonicalSourceRoot = '';
  let epoch = 0;
  let pending = Promise.resolve();
  let abort = new AbortController();
  const receipts = new Map<string, string>();
  const emit = (request: Request, result: Result, approvalRequested: boolean, approvalResult?: Diagnostic['approvalResult']) => {
    if (!diagnostics) return;
    for (const reason of result.reasons.length ? result.reasons : [{ code: 'ALLOW', layer: 'global' }]) {
      diagnostics({ tool: ['read', 'write', 'edit', 'grep', 'bash'].includes(request?.toolName) ? request.toolName : 'unsupported',
        decision: result.decision, code: reason.code, layer: reason.layer, approvalRequested,
        ...(approvalResult ? { approvalResult } : {}) });
    }
  };
  async function identities(s: Snapshot) {
    return Promise.all(s.policyFiles.map(async path => {
      const t = await resolveTarget(path, s.cwd, true);
      return { canonical: t.canonical, exists: t.exists, identity: t.identity, revision: t.exists ? t.revision : t.identity };
    }));
  }
  async function check(request: Request, ctx: Context) {
    const s = snapshot;
    if (!s || (await resolveTarget(ctx.cwd, ctx.cwd)).canonical !== s.cwd) throw new Error('POLICY_UNAVAILABLE');
    const policyTargets = await identities(s);
    if (digest(policyTargets) !== policyIdentity) throw new Error('POLICY_CHANGED');
    // Match Pi's actual cwd spelling before lexical normalization, particularly for ../.
    const action = await describe(request, ctx.cwd);
    for (const { target, operations } of action.targets) {
      if (operations.some(op => op !== 'read') && (
        inside(sourceRoot, target.lexical) || inside(canonicalSourceRoot, target.canonical)
        || s.policyFiles.some(path => path === target.lexical || path === target.canonical)
        || policyTargets.some(p => p.canonical === target.canonical || (p.exists && target.exists && p.identity === target.identity)))) throw new Error('POLICY_SELF_PROTECTION');
    }
    const decide = (a: Action) => compose(evaluateLayer(s.global, a, 'global'), s.project ? evaluateLayer(s.project, a, 'project') : undefined);
    await inspectTargets(action, ctx.cwd, decide);
    return { action, result: decide(action) };
  }
  return {
    async start(cwd: string) {
      epoch++; abort.abort(); abort = new AbortController(); snapshot = undefined; receipts.clear();
      const current = epoch;
      try {
        if (!globalPath || !isAbsolute(globalPath)) return;
        const loaded = await loadSnapshot(globalPath, cwd);
        const identity = digest(await identities(loaded));
        const source = await resolveTarget(sourceRoot, cwd);
        if (epoch === current) { snapshot = loaded; policyIdentity = identity; canonicalSourceRoot = source.canonical; }
      } catch { /* Keep the registered gate alive and blocking. Never discard it. */ }
    },
    profile() { return snapshot?.global.profile ?? (snapshot ? 'legacy' : 'unavailable'); },
    shutdown() { epoch++; snapshot = undefined; abort.abort(); receipts.clear(); },
    takeReceipt(toolCallId: string) { const receipt = receipts.get(toolCallId); receipts.delete(toolCallId); return receipt; },
    clearReceipts() { receipts.clear(); },
    async call(request: Request, ctx: Context) {
      const current = epoch;
      let approvalRequested = false;
      try {
        receipts.delete(request.toolCallId);
        const original = digest(request);
        const first = await check(request, ctx);
        if (epoch !== current) return blocked('SESSION_CHANGED');
        if (first.result.decision === 'DENY') { emit(request, first.result, false); return blocked('POLICY_DENY'); }
        if (first.result.decision === 'ALLOW') { emit(request, first.result, false); return undefined; }
        if (!ctx.hasUI || ctx.mode !== 'tui') { emit(request, first.result, false); return blocked('APPROVAL_UNAVAILABLE'); }
        let release!: () => void;
        const previous = pending;
        pending = new Promise<void>(resolve => { release = resolve; });
        await previous;
        try {
          if (epoch !== current || digest(request) !== original) return blocked('REQUEST_CHANGED');
          const message = approvalMessage(request, ctx.cwd, first.action, first.result);
          if (!message) return blocked('PROPOSAL_TOO_LARGE');
          approvalRequested = true;
          const choice = await ctx.ui.select(message, ['Cancel', 'Allow once'], { signal: abort.signal, timeout: 120000 });
          const ok = choice === 'Allow once';
          if (!ok) { emit(request, first.result, true, 'declined'); return blocked('APPROVAL_DECLINED'); }
          if (epoch !== current || digest(request) !== original) return blocked('REQUEST_CHANGED');
          const second = await check(request, ctx);
          if (second.result.decision !== 'ASK' || digest(second) !== digest(first) || epoch !== current) return blocked('ACTION_CHANGED');
          emit(request, second.result, true, 'granted');
          receipts.set(request.toolCallId, 'Permission receipt: ASK; approval=granted; scope=one-shot; reason=' +
            [...new Set(second.result.reasons.filter(r => r.decision === 'ASK').map(r => `${r.layer}:${r.code}`))].join(','));
          return undefined;
        } finally { release(); }
      } catch (error) {
        const code = error instanceof UnsupportedOperation ? error.code : 'EVALUATION_FAILED';
        emit(request, { decision: 'DENY', reasons: [{ decision: 'DENY', layer: 'enforcement', code }] }, approvalRequested);
        return blocked(code);
      }
    }
  };
}

function approvalMessage(request: Request, cwd: string, action: Action, result: Result): string | undefined {
  // ASCII JSON escaping prevents terminal controls, bidi tricks and ambiguous display widths.
  // No payload is silently truncated. Oversize proposals block before displaying approval.
  const literal = (value: unknown) => JSON.stringify(value).replace(/[\u007f-\uffff]/g,
    c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  const lines = ['Permission required: ' + request.toolName.toUpperCase()];
  if (request.toolName === 'bash') lines.push('Command: ' + literal(request.input.command));
  else {
    const target = action.targets[0].target;
    lines.push('Target: ' + literal(target.requested));
    if (target.lexical !== target.canonical) lines.push('Canonical: ' + literal(target.canonical));
  }
  lines.push('Cwd: ' + literal(cwd));
  const labels: Record<string, string> = { TOOL: 'tool requires approval', PATH_INSIDE: 'project path requires approval',
    PATH_OUTSIDE: 'external path requires approval', PROTECTED: 'protected path requires approval',
    PROFILE_GUARDED: 'guarded profile requires approval', BASH_UNKNOWN: 'unknown literal command', BASH_ORDINARY: 'exact command requires approval' };
  lines.push('Reason: ' + [...new Set(result.reasons.filter(r => r.decision === 'ASK')
    .map(r => r.layer + ': ' + (labels[r.code] ?? r.code)))].join('; '));
  if (request.toolName === 'edit') {
    for (const edit of request.input.edits as { oldText: string; newText: string }[]) {
      lines.push('Replace: ' + literal(edit.oldText), 'With: ' + literal(edit.newText));
    }
  } else if (request.toolName === 'write') lines.push('Write full content: ' + literal(request.input.content));
  lines.push('Allow this operation once?');
  // Budget for Pi selector borders, choices, help, countdown and footer at 80x24.
  // Explicit continuations preserve every character instead of concealing long targets.
  const wrapped = lines.flatMap(line => {
    const rows: string[] = [];
    while (line.length > 68) { rows.push(line.slice(0, 68)); line = '  ' + line.slice(68); }
    return [...rows, line];
  });
  return wrapped.length <= 10 ? wrapped.join('\n') : undefined;
}

export default function piMonotonicPermissions(pi: ExtensionAPI) {
  const gate = createGate(process.env.PI_MONOTONIC_PERMISSIONS_POLICY);
  pi.on('session_start', async (_event, ctx) => { await gate.start(ctx.cwd); ctx.ui.setStatus('pi-monotonic-permissions', `permissions: ${gate.profile()}`); });
  pi.on('session_shutdown', () => { gate.shutdown(); });
  pi.on('tool_call', (event, ctx) => gate.call(event as Request, ctx));
  // Public result transformation: retain the native result and append a factual receipt.
  // No instructions, payloads, commands, hidden user input or persistent grant state.
  pi.on('tool_result', event => {
    const receipt = gate.takeReceipt(event.toolCallId);
    if (receipt) return { content: [...event.content, { type: 'text' as const, text: receipt }] };
  });
  pi.on('turn_end', () => gate.clearReceipts());
}
