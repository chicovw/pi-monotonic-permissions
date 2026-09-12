import test from 'node:test';
import assert from 'node:assert/strict';
import { AdapterRegistry, schemaFingerprint } from '../src/adapters.ts';

test('operator adapter registry requires reviewed bounded descriptors', () => {
  const registry = new AdapterRegistry();
  registry.register({ id: 'native.ls', contract: 'pi-0.85.1/ls-v1', toolNames: ['ls'], operation: 'filesystem.list_directory', reviewed: true });
  assert.equal(registry.get('native.ls')?.operation, 'filesystem.list_directory');
  assert.throws(() => registry.register({ id: 'bad', contract: 'x', toolNames: ['ls'], operation: 'filesystem.list_directory', reviewed: false }));
  assert.throws(() => registry.register({ id: 'native.ls', contract: 'x', toolNames: ['ls'], operation: 'filesystem.list_directory', reviewed: true }));
});

test('schema fingerprints ignore descriptions but detect contract changes', () => {
  const a = { type: 'object', description: 'one', properties: { path: { type: 'string', description: 'p' } } };
  const b = { properties: { path: { description: 'changed', type: 'string' } }, type: 'object' };
  assert.equal(schemaFingerprint(a), schemaFingerprint(b));
  assert.notEqual(schemaFingerprint(a), schemaFingerprint({ ...a, properties: { path: { type: 'number' } } }));
});
