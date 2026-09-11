import test from 'node:test';
import assert from 'node:assert/strict';
import { maxClassification, mayReleaseContext, parseExecution } from '../src/eligibility.ts';

const local = { provider: 'omlx', api: 'openai-completions', baseUrl: 'http://127.0.0.1:8000/v1', runtime: 'omlx', environment: 'LOCAL_TRUSTED', ceiling: 'PRIVATE' } as const;
const hosted = { provider: 'cloud', api: 'responses', baseUrl: 'https://api.example.test/v1', runtime: 'remote', environment: 'HOSTED_CONTROLLED', ceiling: 'PUBLIC' } as const;
test('classification ceilings', () => { for (const [c, r, allowed] of [['PUBLIC', local, true], ['PRIVATE', local, true], ['PRIVATE', hosted, false], ['SECRET', local, false], ['SECRET', hosted, false]] as const) assert.equal(mayReleaseContext(c, r).allowed, allowed); });
test('project ceiling only tightens', () => { assert.equal(mayReleaseContext('PRIVATE', local, 'PUBLIC').allowed, false); assert.equal(mayReleaseContext('PUBLIC', local, 'PUBLIC').allowed, true); });
test('rejects spoofed names and unsafe URLs', () => { assert.equal(mayReleaseContext('PRIVATE', { ...local, provider: 'GPT', baseUrl: 'http://localhost:8000' }).allowed, false); assert.equal(mayReleaseContext('PUBLIC', { ...local, baseUrl: 'http://127.0.0.1:8000?x=1' }).allowed, false); assert.equal(mayReleaseContext('PUBLIC', { ...hosted, baseUrl: 'http://127.0.0.1:9' }).allowed, false); });
test('strict parser requires global declarations', () => { assert.doesNotThrow(() => parseExecution({ context: 'PUBLIC', history: 'PUBLIC', tools: {}, routes: [] }, true)); assert.throws(() => parseExecution({ context: 'PUBLIC' }, true)); assert.throws(() => parseExecution({ context: 'PUBLIC', history: 'PUBLIC', tools: {}, routes: [], extra: 1 }, true)); });
test('project parser has no global fields', () => { assert.doesNotThrow(() => parseExecution({ ceiling: 'PRIVATE', context: 'PRIVATE' }, false)); assert.throws(() => parseExecution({ routes: [] }, false)); });
test('variadic maximum and protected selectors are strict', () => { assert.equal(maxClassification('PUBLIC', 'PRIVATE', 'INTERNAL'), 'PRIVATE'); assert.throws(() => maxClassification()); assert.throws(() => parseExecution({ context: 'PUBLIC', history: 'PUBLIC', tools: {}, routes: [], protected: [{ component: '../secret', classification: 'PRIVATE' }] }, true)); });
test('accessor route metadata fails closed', () => { const r = { ...local } as Record<string, unknown>; Object.defineProperty(r, 'provider', { get() { throw new Error('getter executed'); } }); assert.equal(mayReleaseContext('PUBLIC', r).allowed, false); });

test('the same resolved endpoint cannot carry two conflicting runtime attestations', () => {
  const route = {provider:'omlx',api:'openai-completions',baseUrl:'http://127.0.0.1:8000/v1',runtime:'approved',environment:'LOCAL_TRUSTED',ceiling:'PRIVATE'};
  assert.throws(()=>parseExecution({context:'PUBLIC',history:'PUBLIC',tools:{},routes:[route,{...route,runtime:'different',ceiling:'PUBLIC'}]},true),/DUPLICATE/);
});
