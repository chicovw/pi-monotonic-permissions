import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import type { ExtensionAPI, ExtensionContext, ToolInfo } from '@earendil-works/pi-coding-agent';
import { loadSnapshot } from './config.ts';
import type { Snapshot } from './config.ts';
import { compose, evaluate } from './policy.ts';
import type { Action, Result, Policy } from './policy.ts';
import { inside, componentMatch, resolveTarget } from './paths.ts';
import { UnsupportedOperation, unsupportedMessages } from './bash.ts';
import { inspectTargets } from './inspection.ts';
import { describe } from './requests.ts';
import type { Request } from './requests.ts';
import { fingerprint, GrantStore } from './grants.ts';
import type { Grant } from './grants.ts';
import { mayReleaseContext, maxClassification } from './eligibility.ts';
import type { Classification } from './eligibility.ts';
import { installRuntimeEligibility } from './pi-runtime.ts';
import type { RuntimeIdentity } from './pi-runtime.ts';

/**
 * Stable, side-effect-free integration seam for delegated execution controllers.
 *
 * This answers only whether already-classified context may be released to an already-resolved
 * execution route. It does not select a model, launch a process, change policy, or mutate grants.
 */
export { mayReleaseContext, maxClassification, minCeiling } from './eligibility.ts';
export type { Classification, Ceiling, ResolvedRoute, ExecutionConfig, ProjectExecutionConfig } from './eligibility.ts';

type Context = Pick<ExtensionContext, 'cwd' | 'mode' | 'hasUI'> & {
  ui: Pick<ExtensionContext['ui'], 'select'>;
  model?: ExtensionContext['model'];
  sessionManager?: Pick<ExtensionContext['sessionManager'], 'getBranch'> & Partial<Pick<ExtensionContext['sessionManager'], 'getSessionFile'>>;
};
export interface GateOptions { mode?: string; grantsPath?: string; toolInfo?: (name: string) => ToolInfo | undefined; resolveExecution?: (ctx: Context) => Promise<RuntimeIdentity>; recordClassification?: (value: Classification) => void }
export interface Diagnostic { tool: string; decision: string; code: string; layer: string; approvalRequested: boolean; approvalResult?: 'granted' | 'declined' }
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const eligibilityErrors = new Set(['CLASSIFICATION_DENY', 'CLASSIFICATION_UNAVAILABLE', 'EXECUTION_ROUTE_UNRESOLVED', 'EXECUTION_RUNTIME_UNAVAILABLE', 'EXECUTION_RUNTIME_CHANGED', 'EXECUTION_API_UNSUPPORTED']);
const blocked = (code: string) => ({ block: true as const, reason: `Permission blocked: ${code}${code in unsupportedMessages ? '. ' + unsupportedMessages[code as keyof typeof unsupportedMessages] : ''}` });
const sourceRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/** Startup mode is captured once. No tool, command, or per-call mode setter exists. */
export function createGate(globalPath: string | undefined, diagnostics?: (event: Diagnostic) => void, evaluateLayer = evaluate, options: GateOptions = {}) {
  const selectedMode = options.mode;
  const toolInfo = options.toolInfo;
  const grantStore = options.grantsPath ? new GrantStore(options.grantsPath) : undefined;
  const sessionGrants = new Set<string>();
  let contextClassification: Classification = 'SECRET';
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
  async function currentSnapshot(cwd?: string) {
    const s = snapshot;
    if (!s || (cwd && (await resolveTarget(cwd, cwd)).canonical !== s.cwd)) throw new Error('POLICY_UNAVAILABLE');
    const policyTargets = await identities(s);
    if (digest(policyTargets) !== policyIdentity) throw new Error('POLICY_CHANGED');
    if (!s.global.execution?.routes) throw new Error('CLASSIFICATION_UNAVAILABLE');
    return { s, policyTargets };
  }
  function eligible(s: Snapshot, identity: RuntimeIdentity, classification: Classification) {
    const routes = s.global.execution!.routes!;
    const route = routes.find(r => r.provider === identity.provider && r.api === identity.api && r.baseUrl === identity.baseUrl);
    const decision = mayReleaseContext(classification, route, s.project?.execution?.ceiling ?? s.global.execution?.ceiling);
    // A global ceiling is independent of a project ceiling and can never be raised by it.
    const globalDecision = mayReleaseContext(classification, route, s.global.execution?.ceiling);
    if (!decision.allowed || !globalDecision.allowed) throw new Error('CLASSIFICATION_DENY');
    return digest({ route, classification, globalCeiling: s.global.execution?.ceiling, projectCeiling: s.project?.execution?.ceiling });
  }
  function classifyAction(s: Snapshot, action: Action) {
    const config = s.global.execution!;
    const exposure = config.tools?.[action.tool] ?? config.tools?.['*'];
    if (!exposure) throw new Error('CLASSIFICATION_UNAVAILABLE');
    let classification = maxClassification(contextClassification, exposure);
    if (action.tool === 'recall') classification = maxClassification(classification, config.history!, s.project?.execution?.history ?? 'PUBLIC');
    for (const { target } of action.targets) for (const rule of config.protected ?? []) {
      if (componentMatch(target.lexical, rule.component) || componentMatch(target.canonical, rule.component)) classification = maxClassification(classification, rule.classification);
    }
    return classification;
  }
  function admit(classification: Classification) {
    const next = maxClassification(contextClassification, classification);
    if (next !== contextClassification) {
      // Record only a label, before releasing information. A failed write blocks admission.
      options.recordClassification?.(next);
      contextClassification = next;
    }
  }
  async function check(request: Request, ctx: Context) {
    const { s, policyTargets } = await currentSnapshot(ctx.cwd);
    // Match Pi's actual cwd spelling before lexical normalization, particularly for ../.
    const action = await describe(request, ctx.cwd, toolInfo?.(request.toolName));
    if (action.custom?.operation === 'recall.activeLineage') {
      // Blackhole 0.5.3 falls back to ALL entries when branch lookup is empty or
      // fails. Do not label that indeterminate state active-lineage permission.
      const branch = ctx.sessionManager?.getBranch();
      if (!branch?.length || branch.some(e => typeof e.id !== 'string' || !e.id)) throw new Error('CUSTOM_LINEAGE_UNAVAILABLE');
      action.custom.lineage = fingerprint(branch.map(e => e.id));
    }
    const global: Policy = selectedMode === 'guarded' || selectedMode === 'trusted' ? { ...s.global, profile: selectedMode } : s.global;
    const decide = (a: Action) => compose(evaluateLayer(global, a, 'global'), s.project ? evaluateLayer(s.project, a, 'project') : undefined);
    await inspectTargets(action, ctx.cwd, a => classifyAction(s, a) === 'SECRET' ? { decision: 'DENY', reasons: [] }
      : selectedMode === 'yolo' ? { decision: 'ALLOW', reasons: [] } : decide(a));
    const classification = classifyAction(s, action);
    if (!options.resolveExecution) throw new Error('EXECUTION_ROUTE_UNRESOLVED');
    const execution = eligible(s, await options.resolveExecution(ctx), classification);
    await currentSnapshot(ctx.cwd);
    const sessionFile = ctx.sessionManager?.getSessionFile?.();
    const sessionTarget = sessionFile ? await resolveTarget(sessionFile, ctx.cwd, true) : undefined;
    const grantTarget = grantStore ? await resolveTarget(dirname(grantStore.path), ctx.cwd, true) : undefined;
    for (const { target, operations } of action.targets) {
      if (operations.some(op => op !== 'read') && (
        inside(sourceRoot, target.lexical) || inside(canonicalSourceRoot, target.canonical)
        || (sessionTarget && (target.lexical === sessionTarget.lexical || target.canonical === sessionTarget.canonical || (target.exists && sessionTarget.exists && target.identity === sessionTarget.identity)))
        || (target.directory && [canonicalSourceRoot, ...policyTargets.map(p => p.canonical), ...(sessionTarget ? [sessionTarget.canonical] : [])].some(p => inside(target.canonical, p)))
        || (grantTarget && (inside(grantTarget.lexical, target.lexical) || inside(grantTarget.canonical, target.canonical)))
        || s.policyFiles.some(path => path === target.lexical || path === target.canonical)
        || policyTargets.some(p => p.canonical === target.canonical || (p.exists && target.exists && p.identity === target.identity)))) throw new Error('POLICY_SELF_PROTECTION');
    }
    if (selectedMode === 'yolo') return { action, result: { decision: 'ALLOW' as const, reasons: [] }, classification, execution };
    return { action, result: decide(action), classification, execution };
  }
  function grantFor(request: Request, action: Action): Grant | undefined {
    if (!action.custom) return;
    return { tool: request.toolName, operation: action.custom.operation, contract: action.custom.contract,
      context: fingerprint({ cwd: snapshot!.cwd, policy: policyIdentity, mode: selectedMode ?? snapshot!.global.profile ?? 'legacy',
        arguments: action.custom.reviewed ? null : fingerprint(request.input) }) };
  }
  return {
    async start(cwd: string, previousClassifications: Classification[] = []) {
      epoch++; abort.abort(); abort = new AbortController(); snapshot = undefined; receipts.clear(); sessionGrants.clear();
      contextClassification = 'SECRET';
      const current = epoch;
      try {
        if (selectedMode !== undefined && selectedMode !== 'guarded' && selectedMode !== 'trusted' && selectedMode !== 'yolo') return;
        if (!globalPath || !isAbsolute(globalPath)) return;
        const loaded = await loadSnapshot(globalPath, cwd);
        if (!loaded.global.execution?.context || !loaded.global.execution.history) return;
        const classification = maxClassification(loaded.global.execution.context, loaded.global.execution.history, loaded.project?.execution?.context ?? 'PUBLIC', loaded.project?.execution?.history ?? 'PUBLIC', ...previousClassifications);
        const identity = digest(await identities(loaded));
        const source = await resolveTarget(sourceRoot, cwd);
        if (epoch === current) {
          if (classification !== maxClassification('PUBLIC', ...previousClassifications)) options.recordClassification?.(classification);
          snapshot = loaded; contextClassification = classification; policyIdentity = identity; canonicalSourceRoot = source.canonical;
        }
      } catch { /* Keep the registered gate alive and blocking. Never discard it. */ }
    },
    profile() { return snapshot && selectedMode === 'yolo' ? 'YOLO ⚠' : snapshot ? selectedMode ?? snapshot.global.profile ?? 'legacy' : 'unavailable'; },
    async release(identity: RuntimeIdentity) {
      const current = epoch; const { s } = await currentSnapshot();
      if (epoch !== current) throw new Error('EXECUTION_RUNTIME_CHANGED');
      eligible(s, identity, contextClassification);
    },
    shutdown() { epoch++; snapshot = undefined; abort.abort(); receipts.clear(); sessionGrants.clear(); },
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
        if (first.result.decision === 'ALLOW') { admit(first.classification); emit(request, first.result, false); return undefined; }
        const grant = grantFor(request, first.action);
        const matchesGrant = async () => grant && (sessionGrants.has(fingerprint(grant)) ? 'session'
          : first.action.custom?.persistent && await grantStore?.has(grant) ? 'persistent' : undefined);
        const recheck = async () => {
          if (epoch !== current || digest(request) !== original) throw new Error('REQUEST_CHANGED');
          const next = await check(request, ctx);
          if (epoch !== current || digest(request) !== original || digest(next) !== digest(first)) throw new Error('ACTION_CHANGED');
        };
        const matched = await matchesGrant();
        if (matched) {
          await recheck(); admit(first.classification); emit(request, first.result, false);
          receipts.set(request.toolCallId, `Permission receipt: ASK; grant=matched; scope=${matched}; operation=${grant!.operation}`);
          return undefined;
        }
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
          // An earlier serialized approval may already have granted this operation.
          const queuedMatch = await matchesGrant();
          if (queuedMatch) {
            await recheck(); admit(first.classification);
            receipts.set(request.toolCallId, `Permission receipt: ASK; grant=matched; scope=${queuedMatch}; operation=${grant!.operation}`);
            return undefined;
          }
          const choices = ['Cancel', 'Allow once', ...(grant ? ['Allow for session'] : []),
            ...(grant && first.action.custom?.persistent && grantStore ? ['Always allow'] : [])];
          const choice = await ctx.ui.select(message, choices, { signal: abort.signal, timeout: 120000 });
          const ok = choice !== undefined && choice !== 'Cancel' && choices.includes(choice);
          if (!ok) { emit(request, first.result, true, 'declined'); return blocked('APPROVAL_DECLINED'); }
          if (epoch !== current || digest(request) !== original) return blocked('REQUEST_CHANGED');
          const second = await check(request, ctx);
          if (second.result.decision !== 'ASK' || digest(second) !== digest(first) || epoch !== current) return blocked('ACTION_CHANGED');
          if (choice === 'Always allow') {
            await grantStore!.add(grant!);
            // Disk IO is an await boundary; recheck before authorizing execution.
            const third = await check(request, ctx);
            if (digest(request) !== original || digest(third) !== digest(second) || epoch !== current) return blocked('ACTION_CHANGED');
          }
          if (choice === 'Allow for session') sessionGrants.add(fingerprint(grant!));
          admit(second.classification);
          emit(request, second.result, true, 'granted');
          const scope = choice === 'Always allow' ? 'persistent' : choice === 'Allow for session' ? 'session' : 'one-shot';
          receipts.set(request.toolCallId, `Permission receipt: ASK; approval=granted; scope=${scope}; reason=` +
            [...new Set(second.result.reasons.filter(r => r.decision === 'ASK').map(r => `${r.layer}:${r.code}`))].join(','));
          return undefined;
        } finally { release(); }
      } catch (error) {
        const code = error instanceof UnsupportedOperation ? error.code : error instanceof Error && eligibilityErrors.has(error.message) ? error.message : 'EVALUATION_FAILED';
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
  const lines = ['Permission required: ' + literal(request.toolName.toUpperCase())];
  if (action.custom) {
    lines.push('Adapter: ' + (action.custom.reviewed ? 'reviewed' : 'UNKNOWN / unreviewed'));
    lines.push('Operation: ' + action.custom.operation, 'Arguments: ' + literal(request.input));
  } else if (request.toolName === 'bash') lines.push('Command: ' + literal(request.input.command));
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
  lines.push(action.custom ? 'Grant scope: ' + (action.custom.reviewed ? action.custom.operation : 'exact arguments') : 'Allow this operation once?');
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
  // Pi 0.85.1 getAgentDir convention, without a runtime SDK dependency.
  const rawAgentDir = process.env.PI_CODING_AGENT_DIR;
  const agentDir = rawAgentDir ? resolve(rawAgentDir.replace(/^~(?=\/|$)/, homedir())) : join(homedir(), '.pi', 'agent');
  let runtimeGate: ReturnType<typeof installRuntimeEligibility> | undefined;
  const gate = createGate(process.env.PI_MONOTONIC_PERMISSIONS_POLICY, undefined, evaluate, {
    mode: process.env.PI_MONOTONIC_PERMISSIONS_PROFILE,
    grantsPath: join(agentDir, 'pi-monotonic-permissions', 'grants.json'),
    toolInfo: name => pi.getAllTools().find(t => t.name === name),
    resolveExecution: async ctx => { if (!runtimeGate) throw new Error('EXECUTION_RUNTIME_UNAVAILABLE'); return runtimeGate.resolve(ctx.model); },
    recordClassification: value => pi.appendEntry('pi-monotonic-permissions.classification', { classification: value })
  });
  pi.on('session_start', async (_event, ctx) => {
    try {
      const labels = ctx.sessionManager.getEntries().filter(e => e.type === 'custom' && e.customType === 'pi-monotonic-permissions.classification')
        .map(e => (e as { data: { classification: Classification } }).data.classification);
      await gate.start(ctx.cwd, labels);
      runtimeGate?.shutdown();
      runtimeGate = installRuntimeEligibility(ctx.modelRegistry, identity => gate.release(identity));
    } catch {
      gate.shutdown(); ctx.abort();
      ctx.ui.notify('Permissions execution eligibility unavailable. This runtime must not process context.', 'error');
    }
    ctx.ui.setStatus('pi-monotonic-permissions', `permissions: ${gate.profile()}`);
  });
  pi.on('session_shutdown', () => { gate.shutdown(); runtimeGate?.shutdown(); });
  pi.on('tool_call', (event, ctx) => gate.call(event as Request, ctx));
  // Public result transformation: retain the native result and append a factual receipt.
  // No instructions, payloads, commands, hidden user input or persistent grant state.
  pi.on('tool_result', event => {
    const receipt = gate.takeReceipt(event.toolCallId);
    if (receipt) return { content: [...event.content, { type: 'text' as const, text: receipt }] };
  });
  pi.on('turn_end', () => gate.clearReceipts());
}
