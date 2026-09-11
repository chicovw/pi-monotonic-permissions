#!/usr/bin/env node
// Optional pinned-package qualification. No Blackhole dependency or normal Pi state.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as sdk from '@earendil-works/pi-coding-agent';

const runLocal = process.env.BLACKHOLE_LOCAL_OMLX === '1';
const originalFetch = globalThis.fetch;
const supplied = process.argv[2] ?? process.env.BLACKHOLE_SOURCE;
assert(supplied, 'Pass the exact unpacked pi-blackhole@0.5.3 package path');
const source = resolve(supplied);
assert.equal(JSON.parse(await readFile(join(source, 'package.json'), 'utf8')).version, '0.5.3');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const runtimePaths = ['index.ts'];
async function collect(relative) {
  for (const entry of await readdir(join(source, relative), { withFileTypes: true })) {
    const path = `${relative}/${entry.name}`;
    if (entry.isDirectory()) await collect(path);
    else if (entry.isFile()) runtimePaths.push(path);
    else throw new Error('Unexpected runtime source alias');
  }
}
await collect('src'); await collect('dist');
const manifest = await Promise.all(runtimePaths.sort().map(async path => `${path}:${sha256(await readFile(join(source, path)))}`));
assert.equal(manifest.length, 119);
assert.equal(sha256(manifest.join('\n')), '9b7a29ee773eff1782d7ffe40e09090989801482e6184a44058b1b7bff411fde',
  'Runtime source must match the inspected npm 0.5.3 artifact');
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
assert.equal(JSON.parse(await readFile(join(repo, 'node_modules/@earendil-works/pi-coding-agent/package.json'), 'utf8')).version, '0.85.1');
const root = await realpath(await mkdtemp(join(tmpdir(), 'pi-blackhole-qualification-')));
const blackhole = join(root, 'blackhole');
await cp(source, blackhole, { recursive: true, filter: path => !path.split('/').includes('node_modules') });
await symlink(join(repo, 'node_modules'), join(blackhole, 'node_modules'));
const cwd = join(root, 'project'), agentDir = join(root, 'agent');
await mkdir(cwd); await mkdir(join(agentDir, 'pi-blackhole'), { recursive: true });
process.env.PI_CODING_AGENT_DIR = agentDir;
process.env.PI_MONOTONIC_PERMISSIONS_PROFILE = 'trusted';
const config = { memory: false, compaction: 'manual', compactionEngine: 'blackhole', tailBehavior: 'minimal',
  debugLog: true, observeAfterTokens: 1, reflectAfterTokens: 1, sessionFallback: false };
await writeFile(join(agentDir, 'pi-blackhole/pi-blackhole-config.json'), JSON.stringify(config));
const policy = JSON.parse(await readFile(join(repo, 'policy.example.json'), 'utf8'));
policy.profile = 'trusted'; policy.customTools = { unknown: 'ASK', operations: { 'recall.activeLineage': 'ALLOW', 'recall.allLineages': 'ASK' } }; policy.tools.write = 'ALLOW'; policy.tools.edit = 'ALLOW';
policy.paths.inside.write = 'ALLOW'; policy.paths.inside.edit = 'ALLOW';
policy.execution = { context: 'PRIVATE', history: 'PRIVATE', tools: { '*': 'PRIVATE' }, routes: [{ provider: 'fixture-provider', api: 'openai-completions', baseUrl: 'http://127.0.0.1:9/v1', runtime: 'offline-synthetic-fixture', environment: 'LOCAL_TRUSTED', ceiling: 'PRIVATE' }] };
if (runLocal) policy.execution.routes.push({ provider: 'omlx', api: 'openai-completions', baseUrl: 'http://127.0.0.1:8000/v1', runtime: 'operator-approved-omlx', environment: 'LOCAL_TRUSTED', ceiling: 'PRIVATE' });
const policyPath = join(agentDir, 'policy.json'); await writeFile(policyPath, JSON.stringify(policy));
process.env.PI_MONOTONIC_PERMISSIONS_POLICY = policyPath;
const settingsManager = sdk.SettingsManager.inMemory({ defaultProjectTrust: 'never', compaction: { enabled: false, keepRecentTokens: 1024 }, retry: { enabled: false } });
const loader = new sdk.DefaultResourceLoader({ cwd, agentDir, settingsManager,
  additionalExtensionPaths: [join(repo, 'src/index.ts'), join(blackhole, 'index.ts')],
  noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
await loader.reload();
const model = { id: 'fixture-model', name: 'deterministic fixture', api: 'openai-completions', provider: 'fixture-provider',
  baseUrl: 'http://127.0.0.1:9/v1', reasoning: false, input: ['text'], contextWindow: 1000000,
  maxTokens: 8192, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
const modelRuntime = await sdk.ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null,
  modelsStorePath: join(agentDir, 'models-cache.json'), allowModelNetwork: false, refreshOnCreate: false });
modelRuntime.registerProvider(model.provider, { api: model.api, baseUrl: model.baseUrl, apiKey: 'synthetic-test-only', models: [model] });
const manager = sdk.SessionManager.create(cwd, join(agentDir, 'sessions'));
let { session, extensionsResult } = await sdk.createAgentSession({ cwd, agentDir, settingsManager, modelRuntime, model,
  tools: ['read', 'write', 'edit', 'bash', 'recall'], resourceLoader: loader, sessionManager: manager });
assert.deepEqual(extensionsResult.errors, []);
let prompts = 0, choice = 'Cancel', streams = 0, networkCalls = 0;
const notices = [], statuses = [];
const bindings = { mode: 'tui', uiContext: {
  select: async () => { prompts++; return choice; }, notify: m => notices.push(m), setStatus: (k, v) => statuses.push([k, v]),
  setWidget() {}, setWorkingMessage() {}, setEditorText() {}, getEditorText() { return ''; }
} };
await session.bindExtensions(bindings);
async function restart() {
  session.dispose(); await loader.reload();
  const result = await sdk.createAgentSession({ cwd, agentDir, settingsManager, modelRuntime, model, tools: ['read', 'write', 'edit', 'bash', 'recall'], resourceLoader: loader, sessionManager: manager });
  assert.deepEqual(result.extensionsResult.errors, []); session = result.session; await session.bindExtensions(bindings);
}
assert.ok(session.getAllTools().some(t => t.name === 'recall'), 'recall must be a configured tool');
assert.ok(statuses.some(([k,v]) => k === 'pi-monotonic-permissions' && v === 'permissions: trusted'));
// There is no provider service in this test. Any accidental network use fails.
globalThis.fetch = async () => { networkCalls++; throw new Error('Unexpected network request in offline fixture'); };
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const assistant = content => ({ role: 'assistant', api: model.api, provider: model.provider, model: model.id, content,
  stopReason: content.some(c => c.type === 'toolCall') ? 'toolUse' : 'stop', timestamp: Date.now(), usage });
const addUser = content => manager.appendMessage({ role: 'user', content, timestamp: Date.now() });
const addResult = (id, name, text) => manager.appendMessage({ role: 'toolResult', toolCallId: id, toolName: name, content: [{ type: 'text', text }], isError: false, timestamp: Date.now() });
const sync = () => (session.agent.state.messages = manager.buildSessionContext().messages);
async function invoke(args, finalAnswer = 'fixture complete') {
  let step = 0;
  session.agent.streamFunction = () => {
    streams++;
    const message = assistant(step++ === 0 ? [{ type: 'toolCall', id: `fixture-${streams}`, name: 'recall', arguments: args }] : [{ type: 'text', text: finalAnswer }]);
    return { async *[Symbol.asyncIterator]() { yield { type: 'done', reason: message.stopReason, message }; }, result: async () => message };
  };
  await session.agent.prompt('Recover the requested exact historical evidence using recall.');
  return session.state.messages.filter(m => m.role === 'toolResult').at(-1);
}
const essentials = ['Objective: repair canonical paths.', 'Acceptance: aliases stay denied.',
  'Governance: no publication or policy edits.', 'Decision: resolve existing parents.',
  'TODO: nested destinations.', 'Evidence: src/paths.ts; tests/paths.test.ts.'];
addUser(essentials.join('\n'));
const anchor = manager.getLeafId();
manager.appendMessage(assistant([{ type: 'toolCall', id: 'abandoned-write', name: 'write', arguments: { path: 'abandoned.ts', content: 'ABANDONED_BRANCH_MARKER' } }]));
addResult('abandoned-write', 'write', 'ABANDONED_BRANCH_MARKER');
const abandonedMessages = manager.getEntries().filter(e => e.type === 'message');
const abandonedIndex = abandonedMessages.length - 1;
manager.branch(anchor);
for (let i = 0; i < 45; i++) {
  addUser(`Iteration ${i}: inspect source fixture-${i}.ts and validate prospective paths. Record the result and keep remaining work explicit.`);
  manager.appendMessage(assistant([{ type: 'text', text: `Completed inspection ${i}. Earlier lexical-only attempt failed; canonical parent resolution remains the accepted approach.` },
    { type: 'toolCall', id: `read-${i}`, name: 'read', arguments: { path: `fixture-${i}.ts` } }]));
  const lines = Array.from({ length: 180 }, (_, n) => `line ${n}: synthetic source ${i}; const target_${n} = canonicalParent.join(destination_${n});`);
  if (i === 8) lines[91] = 'EXACT ERROR: E_PARENT_ALIAS_7F3C at src/paths.ts:143; attempt lexical-fallback rejected';
  addResult(`read-${i}`, 'read', lines.join('\n'));
}
addUser('Continue the remaining nested-destination TODO after manual compaction. Preserve the original objective, acceptance, governance, decision and evidence pointers.');
sync();
const beforeText = JSON.stringify(session.state.messages);
assert.ok(beforeText.includes('E_PARENT_ALIAS_7F3C'));
const before = { bytes: Buffer.byteLength(beforeText), estimatedTokens: session.state.messages.reduce((n,m) => n + sdk.estimateTokens(m), 0) };
const streamsBefore = streams;
await session.compact('__pi_vcc__');
const compactedLeaf = manager.getLeafId();
assert.equal(manager.getEntries().at(-1).fromHook, true, 'Blackhole must supply the real compaction');
const afterText = JSON.stringify(session.state.messages);
const after = { bytes: Buffer.byteLength(afterText), estimatedTokens: session.state.messages.reduce((n,m) => n + sdk.estimateTokens(m), 0) };
assert.equal(streams, streamsBefore, 'compaction must not call fixture model');
assert.equal(networkCalls, 0, 'compaction must not call a provider');
assert.ok(after.bytes < before.bytes / 2, 'this long fixture should achieve useful reduction; not a universal threshold');
await writeFile(join(root, 'live-context-after.json'), afterText);
for (const text of essentials) assert.ok(afterText.includes(text), `lost structural requirement: ${text}`);
assert.ok(!afterText.includes('E_PARENT_ALIAS_7F3C'), 'exact detail should be omitted from structural context');
const recovered = await invoke({ query: 'PARENT_ALIAS' }, 'The exact error was E_PARENT_ALIAS_7F3C at src/paths.ts:143.');
assert.equal(recovered.isError, false); assert.match(JSON.stringify(recovered.content), /E_PARENT_ALIAS_7F3C at src\/paths.ts:143/); assert.equal(prompts, 0);
assert.match(JSON.stringify(session.state.messages.at(-1)), /E_PARENT_ALIAS_7F3C/);
for (const input of [{ query: '#0' }, { expand: [0] }]) assert.match(JSON.stringify((await invoke(input)).content), /Objective: repair canonical paths/);
assert.equal(prompts, 0);
const defaultSearch = await invoke({ query: 'ABANDONED_BRANCH' });
assert.ok(!JSON.stringify(defaultSearch.content).includes('ABANDONED_BRANCH_MARKER'), 'default search must exclude abandoned lineage');
for (const query of [`#${abandonedIndex}`, `#${abandonedIndex - 1}:abandoned.ts`, `#${abandonedIndex}:text`]) {
  const result = await invoke({ query }); assert.ok(!JSON.stringify(result.content).includes('ABANDONED_BRANCH_MARKER'), `lineage leak for ${query}`);
}
const broad = { query: 'ABANDONED_BRANCH', scope: 'all' };
assert.match(JSON.stringify((await invoke(broad)).content), /APPROVAL_DECLINED/); assert.equal(prompts, 1);
choice = 'Allow once'; const allowed = await invoke(broad); assert.equal(allowed.isError, false); assert.match(JSON.stringify(allowed.content), /ABANDONED_BRANCH_MARKER/);
choice = 'Cancel'; assert.match(JSON.stringify((await invoke(broad)).content), /APPROVAL_DECLINED/); assert.equal(prompts, 3);
choice = 'Allow for session'; assert.equal((await invoke(broad)).isError, false); assert.equal((await invoke(broad)).isError, false); assert.equal(prompts, 4);
assert.match(JSON.stringify((await invoke({ expand: [abandonedIndex], scope: 'all' })).content), /ABANDONED_BRANCH_MARKER/);
assert.match(JSON.stringify((await invoke({ query: `#${abandonedIndex - 1}:abandoned.ts`, scope: 'all' })).content), /ABANDONED_BRANCH_MARKER/);
await restart(); choice = 'Always allow';
assert.equal((await invoke(broad)).isError, false); assert.equal(prompts, 5);
const policyUnchanged = await readFile(policyPath, 'utf8');
await restart(); choice = 'Cancel'; assert.equal((await invoke(broad)).isError, false); assert.equal(prompts, 5);
assert.equal(await readFile(policyPath, 'utf8'), policyUnchanged);
const savedGrants = JSON.parse(await readFile(join(agentDir, 'pi-monotonic-permissions/grants.json'), 'utf8'));
assert.equal(savedGrants.grants[0].operation, 'recall.allLineages');
let localEvidence;
if (runLocal) {
  session.dispose(); manager.branch(compactedLeaf);
  assert.ok(!JSON.stringify(manager.buildSessionContext().messages).includes('E_PARENT_ALIAS_7F3C'));
  const localModel = { ...model, id: 'Qwen3.8-27B-oQ4e-mtp', name: 'operator-selected local fixture', provider: 'omlx', baseUrl: 'http://127.0.0.1:8000/v1', contextWindow: 98304, maxTokens: 4096 };
  const localRuntime = await sdk.ModelRuntime.create({ authPath: join(agentDir, 'local-auth.json'), modelsPath: null,
    modelsStorePath: join(agentDir, 'local-models-cache.json'), allowModelNetwork: false, refreshOnCreate: false });
  localRuntime.registerProvider('omlx', { api: localModel.api, baseUrl: localModel.baseUrl, apiKey: 'local-placeholder-not-a-credential', models: [localModel] });
  let localRequests = 0;
  globalThis.fetch = (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    assert.equal(url.origin, 'http://127.0.0.1:8000', 'Local fixture must never route elsewhere');
    localRequests++;
    return originalFetch(input, { ...init, redirect: 'error' });
  };
  await loader.reload();
  const fresh = await sdk.createAgentSession({ cwd, agentDir, settingsManager, modelRuntime: localRuntime, model: localModel,
    tools: ['recall'], resourceLoader: loader, sessionManager: manager });
  assert.deepEqual(fresh.extensionsResult.errors, []); session = fresh.session; await session.bindExtensions(bindings);
  const promptsBefore = prompts; const startMessages = session.state.messages.length;
  let toolCalls = 0;
  session.subscribe(event => { if (event.type === 'tool_execution_start' && ++toolCalls > 6) void session.abort(); });
  const timeout = setTimeout(() => { void session.abort(); }, 120000);
  try {
    await session.prompt('An earlier lexical-fallback attempt failed with an exact error code and source file location. Those details are missing from the compacted context. Use session-history recall to recover the exact error code and source location, and answer with the evidence. Search for lexical-fallback if needed. Use only current lineage. Do not guess.');
  } finally { clearTimeout(timeout); }
  const added = session.state.messages.slice(startMessages);
  const recalled = added.filter(m => m.role === 'toolResult' && m.toolName === 'recall' && !m.isError);
  const answer = added.filter(m => m.role === 'assistant').at(-1);
  assert.ok(recalled.some(m => JSON.stringify(m.content).includes('E_PARENT_ALIAS_7F3C')), 'Local model must recover the omitted detail through recall');
  assert.match(JSON.stringify(answer?.content), /E_PARENT_ALIAS_7F3C/);
  assert.match(JSON.stringify(answer?.content), /src\/paths\.ts:143/);
  assert.equal(prompts, promptsBefore, 'Normal trusted/local recall must not ask');
  assert.ok(localRequests > 0);
  localEvidence = { provider: 'omlx', model: localModel.id, endpoint: localModel.baseUrl, classification: 'PRIVATE', environment: 'LOCAL_TRUSTED', ceiling: 'PRIVATE', localRequests, recallCalls: recalled.length, approvalPrompts: 0, exactDetailRecovered: true };
}
// Memory triggers have seen high-volume history and real agent/turn events.
await new Promise(r => setTimeout(r, 1200));
const configAfter = JSON.parse(await readFile(join(agentDir, 'pi-blackhole/pi-blackhole-config.json'), 'utf8'));
assert.equal(configAfter.memory, false);
assert.ok(!manager.getEntries().some(e => ['om.observations.recorded', 'om.reflections.recorded', 'om.observations.dropped'].includes(e.customType)), 'memory worker ledger entries must remain absent');
const files = await readdir(join(agentDir, 'pi-blackhole'), { recursive: true });
let logs = '';
for (const file of files.filter(f => /\.(?:ndjson|log)$/.test(f))) logs += await readFile(join(agentDir, 'pi-blackhole', file), 'utf8');
assert.ok(!/"event":"(?:observer|reflector|dropper)\.(?:start|error|model_unavailable)"/.test(logs), 'memory workers must not launch');
assert.equal(networkCalls, 0);
assert.ok(!notices.some(n => /Observational memory:.*(?:failed|running)/.test(n)));
const evidence = { pi: '0.85.1', blackhole: '0.5.3', before, after, reductionPercent: +(100 * (1 - after.bytes / before.bytes)).toFixed(2),
  exactDetailRecovered: true, structuralRequirements: essentials.length, activeRecallPrompts: 0, scopeAllChoices: ['decline', 'once', 'session', 'persistent', 'restart'],
  networkCalls, ...(localEvidence ? { local: localEvidence } : {}), compactionModelCalls: 0, memory: false, memoryWorkerEvents: 0,
  note: localEvidence ? 'Offline fixture plus an actual approved local-model recall-after-compaction run; all history is synthetic.' : 'Deterministic stream proves hook execution and evidence recovery, not autonomous model recall selection.', fixture: root };
await writeFile(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence, null, 2));
session.dispose();
