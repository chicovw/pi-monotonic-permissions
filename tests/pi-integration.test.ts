import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, symlink, writeFile, readdir, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { fixture, policy } from './fixtures.ts';

// Pinned development SDK; deterministic streams never call a provider.
const sdk = await import('@earendil-works/pi-coding-agent');
const metadata = JSON.parse(await readFile(new URL('../node_modules/@earendil-works/pi-coding-agent/package.json', import.meta.url), 'utf8'));
assert.equal(metadata.version, '0.85.1');
const entry = fileURLToPath(new URL('../src/index.ts', import.meta.url));
const model = { id: 'fixture-model', name: 'deterministic fixture, no inference', api: 'openai-completions',
  provider: 'fixture-provider', baseUrl: 'http://127.0.0.1:9/v1', reasoning: false, input: ['text'] as ('text' | 'image')[], contextWindow: 73728,
  maxTokens: 8192, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };

async function sessionFor(f: Awaited<ReturnType<typeof fixture>>, tools: string[], confirm: () => Promise<boolean | string> = async () => false, extension: string | string[] = entry, statuses: string[] = [], manager?: ReturnType<typeof sdk.SessionManager.create>) {
  process.env.PI_MONOTONIC_PERMISSIONS_POLICY = f.globalPath;
  process.env.PI_CODING_AGENT_DIR = f.agentDir;
  const settingsManager = sdk.SettingsManager.inMemory({ defaultProjectTrust: 'never', compaction: { enabled: false }, retry: { enabled: false } });
  const loader = new sdk.DefaultResourceLoader({ cwd: f.cwd, agentDir: f.agentDir, settingsManager,
    additionalExtensionPaths: typeof extension === 'string' ? [extension] : extension, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
  await loader.reload();
  const modelRuntime = await sdk.ModelRuntime.create({ authPath: join(f.agentDir, 'auth.json'), modelsPath: null,
    modelsStorePath: join(f.agentDir, 'models-cache.json'), allowModelNetwork: false, refreshOnCreate: false });
  modelRuntime.registerProvider(model.provider, { api: model.api, baseUrl: model.baseUrl, apiKey: 'synthetic-test-only', models: [model] });
  const result = await sdk.createAgentSession({ cwd: f.cwd, agentDir: f.agentDir, settingsManager, modelRuntime, model,
    tools, resourceLoader: loader, sessionManager: manager ?? sdk.SessionManager.create(f.cwd, join(f.agentDir, 'sessions')) });
  await result.session.bindExtensions({ mode: 'tui', uiContext: { select: async () => { const v = await confirm(); return typeof v === 'string' ? v : v ? 'Allow once' : 'Cancel'; }, notify() {}, setStatus(_key: string, value: string) { statuses.push(value); } } as any });
  return { ...result, loader, modelRuntime };
}

async function call(session: any, name: string, args: Record<string, unknown>) {
  let step = 0;
  session.agent.streamFunction = () => {
    const first = step++ === 0;
    const message = { role: 'assistant', api: model.api, provider: model.provider, model: model.id,
      content: first ? [{ type: 'toolCall', id: `call-${Date.now()}`, name, arguments: args }] : [{ type: 'text', text: 'fixture complete' }],
      stopReason: first ? 'toolUse' : 'stop', timestamp: Date.now(),
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    return { async *[Symbol.asyncIterator]() { yield { type: 'done', reason: message.stopReason, message }; }, result: async () => message };
  };
  // Public Agent entry point: deterministic stream, real Pi tool preparation/hooks/execution.
  await session.agent.prompt('Execute the next synthetic fixture call.');
  const results = session.state.messages.filter((m: any) => m.role === 'toolResult');
  assert.ok(results.length, JSON.stringify(session.state.messages));
  return results.at(-1);
}

test('actual Pi: ALLOW executes, DENY does not, ASK executes once, protected aliases remain unread', async t => {
  const f = await fixture(); t.after(f.cleanup);
  await symlink('.env', join(f.cwd, 'alias')); await symlink('alias', join(f.cwd, 'chain'));
  const p = policy(); p.tools.write = 'ASK'; await f.setGlobal(p);
  let prompts = 0;
  const { session, extensionsResult } = await sessionFor(f, ['read', 'write', 'edit', 'bash', 'grep'], async () => { prompts++; return true; });
  t.after(() => session.dispose()); assert.deepEqual(extensionsResult.errors, []);
  assert.equal((await call(session, 'read', { path: 'safe.txt' })).isError, false);
  for (const path of ['.env', 'alias', 'chain']) {
    const r = await call(session, 'read', { path }); assert.equal(r.isError, true); assert.ok(!JSON.stringify(r).includes('SYNTHETIC_PROTECTED_MARKER'));
  }
  assert.equal((await call(session, 'write', { path: 'alias', content: 'overwrite' })).isError, true);
  const deniedEdit = await call(session, 'edit', { path: 'chain', edits: [{ oldText: 'SYNTHETIC_PROTECTED_MARKER', newText: 'overwritten' }] });
  assert.equal(deniedEdit.isError, true); assert.match(JSON.stringify(deniedEdit.content), /Permission blocked: POLICY_DENY/);
  assert.equal(prompts, 0); assert.equal(await readFile(join(f.cwd, '.env'), 'utf8'), 'SYNTHETIC_PROTECTED_MARKER\n');
  assert.equal((await call(session, 'write', { path: 'created.txt', content: 'one' })).isError, false);
  assert.match(JSON.stringify(session.state.messages.at(-2)), /Permission receipt: ASK; approval=granted; scope=one-shot/);
  assert.equal(prompts, 1); assert.equal(await readFile(join(f.cwd, 'created.txt'), 'utf8'), 'one');
  assert.equal((await call(session, 'write', { path: 'created.txt', content: 'two' })).isError, false);
  assert.equal(prompts, 2); assert.equal(await readFile(join(f.cwd, 'created.txt'), 'utf8'), 'two');
  assert.equal((await call(session, 'edit', { path: 'created.txt', edits: [{ oldText: 'two', newText: 'three' }] })).isError, false);
  assert.equal(await readFile(join(f.cwd, 'created.txt'), 'utf8'), 'three');
  assert.equal((await call(session, 'grep', { path: '.', pattern: 'FAKE' })).isError, true);
  assert.equal((await call(session, 'bash', { command: 'pwd' })).isError, false);
  const sessions = await readdir(join(f.agentDir, 'sessions')); assert.ok(sessions.length);
});

test('actual Pi: project ALLOW cannot defeat global DENY, malformed policy remains loaded', async t => {
  const f = await fixture(); t.after(f.cleanup);
  await f.setProject({ version: 1, tools: { write: 'ALLOW' }, paths: { protected: [{ component: '.env', read: 'ALLOW', write: 'ALLOW' }] } });
  const { session, extensionsResult } = await sessionFor(f, ['read', 'write']); t.after(() => session.dispose());
  assert.deepEqual(extensionsResult.errors, []);
  assert.equal((await call(session, 'read', { path: '.env' })).isError, true);
  assert.equal((await call(session, 'write', { path: '.env', content: 'bad' })).isError, true);
  await writeFile(f.globalPath, '{');
  const bad = await sessionFor(f, ['read']); t.after(() => bad.session.dispose());
  assert.deepEqual(bad.extensionsResult.errors, []); assert.ok(bad.session.hasExtensionHandlers('tool_call'));
  assert.equal((await call(bad.session, 'read', { path: 'safe.txt' })).isError, true);
});

for (const tools of [['read'], ['read', 'grep'], ['read', 'bash']]) test(`actual Pi: explicit tools preserved ${tools.join(',')}`, async t => {
  const f = await fixture(); t.after(f.cleanup); const { session } = await sessionFor(f, tools); t.after(() => session.dispose());
  assert.deepEqual(session.getActiveToolNames().sort(), [...tools].sort());
  const excluded = tools.includes('bash') ? 'write' : 'bash';
  const r = await call(session, excluded, excluded === 'write' ? { path: 'excluded.txt', content: 'bad' } : { command: 'pwd' });
  assert.equal(r.isError, true); assert.deepEqual(session.getActiveToolNames().sort(), [...tools].sort());
  await assert.rejects(access(join(f.cwd, 'excluded.txt')));
  const sources = await Promise.all(['index', 'config', 'requests', 'paths', 'policy', 'bash'].map(n => readFile(resolve(entry, '..', `${n}.ts`), 'utf8')));
  assert.ok(!sources.join('').includes('setActiveTools'));
});

test('actual Pi: failed module load is visibly different from blocking initialization', async t => {
  const f = await fixture(); t.after(f.cleanup);
  const { session, extensionsResult } = await sessionFor(f, ['read'], async () => false, join(f.root, 'missing-extension.ts'));
  t.after(() => session.dispose()); assert.ok(extensionsResult.errors.length); assert.equal(session.hasExtensionHandlers('tool_call'), false);
  assert.equal((await call(session, 'read', { path: 'safe.txt' })).isError, false);
});

test('actual Pi: Git inspection executes; denied push/reset and declined clean do not', async t => {
  const f = await fixture(); t.after(f.cleanup);
  execFileSync('git', ['init', '--quiet'], { cwd: f.cwd });
  const p = policy(); p.bash.ordinary.push({ argv: ['git', 'diff', '--check'], decision: 'ALLOW' }); await f.setGlobal(p);
  // No commit, branch creation, or external remote. Rejected commands never execute.
  const { session } = await sessionFor(f, ['bash']); t.after(() => session.dispose());
  assert.equal((await call(session, 'bash', { command: 'git status --short' })).isError, false);
  assert.equal((await call(session, 'bash', { command: 'git diff --check' })).isError, false);
  assert.match(JSON.stringify((await call(session, 'bash', { command: 'pwd | cat' })).content), /UNSUPPORTED_PIPELINE/);
  for (const command of ['git push origin main', 'git push --force origin main', 'git reset --hard HEAD', 'git clean -fd']) {
    const result = await call(session, 'bash', { command });
    assert.equal(result.isError, true);
    // A Git failure (for example no remote/HEAD) is not evidence of policy interception.
    assert.match(JSON.stringify(result.content), /Permission blocked:/);
  }
  assert.equal(await readFile(join(f.cwd, 'safe.txt'), 'utf8'), 'safe\n');
});

test('actual Pi trusted: zero-prompt source edit, scoped search and validation; one-shot unknown and hard denies', async t => {
  const f = await fixture(); t.after(f.cleanup);
  const daily = JSON.parse(await readFile(new URL('./fixtures/daily-policy.json', import.meta.url), 'utf8')); await f.setGlobal(daily);
  await symlink('.env', join(f.cwd, 'alias')); await symlink('alias', join(f.cwd, 'chain'));
  execFileSync('git', ['init', '--quiet'], { cwd: f.cwd });
  await writeFile(join(f.cwd, 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }));
  let prompts = 0;
  const { session, extensionsResult } = await sessionFor(f, ['read', 'write', 'edit', 'bash'], async () => { prompts++; return false; });
  t.after(() => session.dispose()); assert.deepEqual(extensionsResult.errors, []);
  assert.equal((await call(session, 'read', { path: join(f.cwd, 'safe.txt') })).isError, false);
  assert.equal((await call(session, 'edit', { path: 'safe.txt', edits: [{ oldText: 'safe', newText: 'updated' }] })).isError, false);
  assert.equal(await readFile(join(f.cwd, 'safe.txt'), 'utf8'), 'updated\n');
  for (const command of ['npm test', 'rg updated safe.txt', `ls -la ${f.cwd}`, 'git status --short', 'git diff --check', 'git rev-parse --show-toplevel']) {
    assert.equal((await call(session, 'bash', { command })).isError, false, command);
  }
  assert.equal(prompts, 0);
  for (const path of ['.env', 'alias', 'chain']) {
    const result = await call(session, 'read', { path }); assert.equal(result.isError, true);
    assert.ok(!JSON.stringify(result).includes('SYNTHETIC_PROTECTED_MARKER'));
  }
  for (const command of ['rg FAKE .env', 'rg FAKE alias', 'git push', 'git push --force']) {
    assert.match(JSON.stringify((await call(session, 'bash', { command })).content), /POLICY_DENY/);
  }
  assert.equal(prompts, 0);
  for (let i = 0; i < 2; i++) assert.match(JSON.stringify((await call(session, 'bash', { command: 'printf probe' })).content), /APPROVAL_DECLINED/);
  assert.equal(prompts, 2);
});

test('actual Pi trusted: project edit ASK is one-shot and profile injection fails closed', async t => {
  const f = await fixture(); t.after(f.cleanup);
  const daily = JSON.parse(await readFile(new URL('./fixtures/daily-policy.json', import.meta.url), 'utf8')); await f.setGlobal(daily);
  await f.setProject({ version: 1, tools: { write: 'ASK' } });
  let prompts = 0;
  const { session } = await sessionFor(f, ['write'], async () => { prompts++; return true; }); t.after(() => session.dispose());
  for (const content of ['one', 'two']) assert.equal((await call(session, 'write', { path: 'safe.txt', content })).isError, false);
  assert.equal(prompts, 2); assert.equal(await readFile(join(f.cwd, 'safe.txt'), 'utf8'), 'two');
  await f.setProject({ version: 1, profile: 'yolo' });
  const invalid = await sessionFor(f, ['read']); t.after(() => invalid.session.dispose());
  assert.deepEqual(invalid.extensionsResult.errors, []);
  assert.match(JSON.stringify((await call(invalid.session, 'read', { path: 'safe.txt' })).content), /EVALUATION_FAILED/);
});

for (const reversed of [false, true]) test(`actual Pi custom tools and grants, extension order reversed=${reversed}`, async t => {
  const f = await fixture(); t.after(f.cleanup); await f.setGlobal({ ...policy(), profile: 'trusted' });
  const custom = join(f.root, 'custom.ts');
  const { recallSchema } = await import('../src/custom-tools.ts');
  await writeFile(custom, `export default function(pi) {
    let executions = 0;
    for (const name of ['recall', 'unreviewed']) pi.registerTool({name, label: name, description: 'Synthetic reviewed schema fixture',
      parameters: name === 'recall' ? ${JSON.stringify(recallSchema)} : {type:'object',properties:{value:{type:'string'}}},
      async execute() { return {content:[{type:'text',text:'executed '+(++executions)}],details:{}}; }
    });
  }`);
  let prompts = 0, choice = 'Cancel'; const statuses: string[] = [];
  const paths = reversed ? [custom, entry] : [entry, custom];
  const make = () => sessionFor(f, ['read', 'recall', 'unreviewed'], async () => { prompts++; return choice; }, paths, statuses);
  let { session, extensionsResult } = await make(); t.after(() => session.dispose()); assert.deepEqual(extensionsResult.errors, []);
  assert.ok(statuses.includes('permissions: trusted'));
  assert.equal((await call(session, 'recall', {})).isError, false); assert.equal(prompts, 0);
  const broad = { scope: 'all' };
  assert.match(JSON.stringify((await call(session, 'recall', broad)).content), /APPROVAL_DECLINED/);
  choice = 'Allow once';
  for (let i = 0; i < 2; i++) assert.equal((await call(session, 'recall', broad)).isError, false);
  assert.equal(prompts, 3);
  choice = 'Allow for session'; assert.equal((await call(session, 'recall', broad)).isError, false);
  assert.equal((await call(session, 'recall', { ...broad, query: 'different' })).isError, false); assert.equal(prompts, 4);
  session.dispose(); ({ session } = await make()); choice = 'Always allow';
  assert.equal((await call(session, 'recall', broad)).isError, false); assert.equal(prompts, 5);
  session.dispose(); ({ session } = await make()); choice = 'Cancel';
  assert.equal((await call(session, 'recall', broad)).isError, false); assert.equal(prompts, 5);
  assert.match(JSON.stringify((await call(session, 'unreviewed', { value: 'probe' })).content), /APPROVAL_DECLINED/); assert.equal(prompts, 6);
  await f.setProject({ version: 1, customTools: { recall: 'DENY' } }); session.dispose(); ({ session } = await make());
  assert.match(JSON.stringify((await call(session, 'recall', broad)).content), /POLICY_DENY/); assert.equal(prompts, 6);
});

test('actual Pi guarded unknown denial and startup YOLO visibility/bypass in synthetic state', async t => {
  const f = await fixture(); t.after(f.cleanup); await f.setGlobal({ ...policy(), profile: 'guarded' });
  const custom = join(f.root, 'unknown.ts'); await writeFile(custom, `export default pi => pi.registerTool({ name:'probe',label:'probe',description:'Harmless probe',parameters:{type:'object',properties:{}},async execute(){return {content:[{type:'text',text:'probe executed'}],details:{}}} });`);
  const paths = [entry, custom]; const statuses: string[] = []; let prompts = 0;
  const make = () => sessionFor(f, ['read', 'probe'], async () => { prompts++; return false; }, paths, statuses);
  let { session } = await make(); t.after(() => session.dispose());
  assert.match(JSON.stringify((await call(session, 'probe', {})).content), /POLICY_DENY/);
  assert.ok(statuses.includes('permissions: guarded')); session.dispose();
  process.env.PI_MONOTONIC_PERMISSIONS_PROFILE = 'yolo';
  try { ({ session } = await make()); } finally { delete process.env.PI_MONOTONIC_PERMISSIONS_PROFILE; }
  assert.ok(statuses.includes('permissions: YOLO ⚠'));
  assert.equal((await call(session, 'probe', {})).isError, false);
  assert.match(JSON.stringify((await call(session, 'read', { path: '.env' })).content), /SYNTHETIC_PROTECTED_MARKER/);
  assert.equal(prompts, 0);
});

test('actual Pi persists admission classification and denies hosted release after resume', async t => {
  const f = await fixture(); t.after(f.cleanup);
  const p = policy(); p.execution.tools.read = 'PRIVATE';
  p.execution.routes.push({ provider:'hosted-fixture',api:'openai-completions',baseUrl:'https://example.invalid/v1',runtime:'synthetic',environment:'HOSTED_CONTROLLED',ceiling:'PUBLIC' });
  await f.setGlobal(p);
  const first = await sessionFor(f,['read']);
  assert.equal((await call(first.session,'read',{path:'safe.txt'})).isError,false);
  const records = first.session.sessionManager.getEntries().filter((e:any)=>e.customType==='pi-monotonic-permissions.classification');
  assert.equal(records.length,1); assert.deepEqual((records[0] as any).data,{classification:'PRIVATE'});
  const file = first.session.sessionFile!; first.session.dispose();
  const resumed = await sessionFor(f,['read'],async()=>false,entry,[],sdk.SessionManager.open(file)); t.after(()=>resumed.session.dispose());
  let providerCalls=0;
  const hostedModel={...model,provider:'hosted-fixture',baseUrl:'https://example.invalid/v1'};
  resumed.modelRuntime.registerProvider(hostedModel.provider,{api:hostedModel.api,baseUrl:hostedModel.baseUrl,apiKey:'synthetic',models:[hostedModel],streamSimple:()=>{providerCalls++;throw new Error('must not run');}});
  const result = await resumed.modelRuntime.completeSimple(hostedModel,{messages:[{role:'user',content:'synthetic',timestamp:Date.now()}]});
  assert.equal(result.stopReason,'error'); assert.match(result.errorMessage!,/CLASSIFICATION_DENY/); assert.equal(providerCalls,0);
});

test('actual Pi V2 captures direct fresh PUBLIC selection separately from its PRIVATE default', async t => {
  const f = await fixture(); t.after(f.cleanup);
  const p = policy(); p.version = 2; p.execution = {
    defaultClassification: 'PRIVATE', opaqueTools: { bash: 'PRIVATE', recall: 'PRIVATE' },
    routes: [{ provider: model.provider, api: model.api, baseUrl: model.baseUrl, runtime: 'offline-synthetic-fixture', environment: 'LOCAL_TRUSTED', ceiling: 'PRIVATE' }]
  } as any;
  await f.setGlobal(p);
  const prior = process.env.PI_MONOTONIC_PERMISSIONS_SESSION_CLASSIFICATION;
  try {
    process.env.PI_MONOTONIC_PERMISSIONS_SESSION_CLASSIFICATION = 'PUBLIC';
    const publicSession = await sessionFor(f, ['read']); t.after(() => publicSession.session.dispose());
    const publicLabels = publicSession.session.sessionManager.getEntries().filter((e: any) => e.customType === 'pi-monotonic-permissions.classification');
    assert.deepEqual((publicLabels.at(-1) as any).data, { classification: 'PUBLIC' });
    publicSession.session.dispose();
    delete process.env.PI_MONOTONIC_PERMISSIONS_SESSION_CLASSIFICATION;
    const defaultSession = await sessionFor(f, ['read']); t.after(() => defaultSession.session.dispose());
    const defaultLabels = defaultSession.session.sessionManager.getEntries().filter((e: any) => e.customType === 'pi-monotonic-permissions.classification');
    assert.deepEqual((defaultLabels.at(-1) as any).data, { classification: 'PRIVATE' });
  } finally {
    if (prior === undefined) delete process.env.PI_MONOTONIC_PERMISSIONS_SESSION_CLASSIFICATION;
    else process.env.PI_MONOTONIC_PERMISSIONS_SESSION_CLASSIFICATION = prior;
  }
});
