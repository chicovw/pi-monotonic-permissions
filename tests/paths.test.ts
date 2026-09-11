import test from 'node:test';
import assert from 'node:assert/strict';
import { symlink, mkdir, writeFile, link } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, context, request, policy } from './fixtures.ts';
import { inside, resolveTarget } from '../src/paths.ts';

for (const tool of ['read', 'write', 'edit']) test(`${tool}: direct, chained and normalized protected aliases denied`, async t => {
  const f = await fixture(); t.after(f.cleanup);
  await symlink('.env', join(f.cwd, 'alias')); await symlink('alias', join(f.cwd, 'chain'));
  await mkdir(join(f.cwd, 'sub'));
  const gate = await f.gate(); let prompts = 0;
  for (const path of ['.env', './.env', 'sub/../.env', 'alias', 'chain', 'sub/../chain']) {
    assert.equal((await gate.call(request(tool, path), context(f.cwd, async () => { prompts++; return true; })))?.block, true, path);
  }
  assert.equal(prompts, 0);
});
test('allowed aliases work; external aliases and sibling prefixes do not', async t => {
  const f = await fixture(); t.after(f.cleanup);
  await symlink('safe.txt', join(f.cwd, 'safe-link'));
  await symlink(join(f.external, 'outside.txt'), join(f.cwd, 'external-link'));
  await symlink('external-link', join(f.cwd, 'external-chain'));
  const gate = await f.gate();
  assert.equal(await gate.call(request('read', 'safe-link'), context(f.cwd)), undefined);
  for (const path of [join(f.external, 'outside.txt'), 'external-link', 'external-chain']) for (const tool of ['read', 'write', 'edit']) {
    assert.equal((await gate.call(request(tool, path), context(f.cwd)))?.block, true);
  }
  assert.equal(inside('/project', '/project-other/file'), false);
});
test('prospective files, nested parents, protected and external symlinked parents', async t => {
  const f = await fixture(); t.after(f.cleanup);
  await mkdir(join(f.cwd, 'allowed')); await mkdir(join(f.cwd, '.ssh'));
  await symlink('allowed', join(f.cwd, 'allowed-parent'));
  await symlink('.ssh', join(f.cwd, 'protected-parent'));
  await symlink(f.external, join(f.cwd, 'external-parent'));
  const p = policy(); p.paths.protected.push({ component: '.ssh', read: 'DENY', write: 'DENY', edit: 'DENY' }); await f.setGlobal(p);
  const gate = await f.gate();
  for (const path of ['new.txt', 'new/nested/file', 'allowed-parent/new/nested']) assert.equal(await gate.call(request('write', path), context(f.cwd)), undefined, path);
  for (const path of ['protected-parent/new/nested', 'external-parent/new/nested']) assert.equal((await gate.call(request('write', path), context(f.cwd)))?.block, true, path);
  const target = await resolveTarget('allowed-parent/new/nested/file', f.cwd, true);
  assert.equal(target.parents.length, 2); assert.equal(target.canonical, join(f.cwd, 'allowed/new/nested/file'));
});
test('dangling links, loops, non-directory ancestors, missing reads fail closed', async t => {
  const f = await fixture(); t.after(f.cleanup);
  await symlink('missing', join(f.cwd, 'dangling')); await symlink('loop', join(f.cwd, 'loop'));
  const gate = await f.gate();
  for (const path of ['dangling', 'dangling/child', 'loop', 'safe.txt/child']) assert.equal((await gate.call(request('write', path), context(f.cwd)))?.block, true, path);
  assert.equal((await gate.call(request('read', 'missing'), context(f.cwd)))?.block, true);
});
test('Darwin case/Unicode spellings and exact protected file identity', async t => {
  const f = await fixture(); t.after(f.cleanup);
  await writeFile(join(f.cwd, 'café.txt'), 'unicode');
  const p = policy() as any;
  p.paths.protected.push({ base: 'project', path: 'café.txt', kind: 'file', read: 'DENY', write: 'DENY', edit: 'DENY' });
  await link(join(f.cwd, 'café.txt'), join(f.cwd, 'hard-link')); await f.setGlobal(p);
  const gate = await f.gate();
  for (const path of ['hard-link', 'café.txt']) assert.equal((await gate.call(request('read', path), context(f.cwd)))?.block, true);
  if (process.platform === 'darwin') {
    for (const path of ['.ENV', 'cafe\u0301.txt']) {
      const target = await resolveTarget(path, f.cwd); assert.equal(target.exists, true);
      assert.equal((await gate.call(request('read', path), context(f.cwd)))?.block, true);
    }
  }
});
test('cwd symlink plus ../ uses Pi lexical cwd semantics, never a different checked file', async t => {
  const f = await fixture(); t.after(f.cleanup);
  await symlink(f.cwd, join(f.external, 'project-alias'));
  await writeFile(join(f.root, 'outside.txt'), 'different file');
  const gate = await f.gate();
  assert.equal((await gate.call(request('read', '../outside.txt'), context(join(f.external, 'project-alias'))))?.block, true);
});
