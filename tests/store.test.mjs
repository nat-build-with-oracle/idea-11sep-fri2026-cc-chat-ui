import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { JsonStore, validateProjectPath } from '../server/store.mjs';

test('store seeds only the current working directory and writes valid JSON', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'cc-chat-store-'));
  const store = await new JsonStore({ dataDir, cwd: process.cwd() }).init();
  const state = store.snapshot();
  assert.equal(state.projects.length, 1);
  assert.equal(state.projects[0].path, process.cwd());
  assert.deepEqual(state.chats, []);
  await store.update((draft) => { draft.projects[0].name = 'Renamed'; });
  assert.equal(JSON.parse(await readFile(path.join(dataDir, 'state.json'), 'utf8')).projects[0].name, 'Renamed');
});

test('store recovers interrupted runs on restart', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'cc-chat-store-'));
  const store = await new JsonStore({ dataDir }).init();
  await store.update((state) => state.chats.push({ id: 'c', status: 'running', messages: [{ id: 'm', status: 'streaming', tools: [{ id: 't', status: 'running' }] }] }));
  const recovered = await new JsonStore({ dataDir }).init();
  assert.equal(recovered.snapshot().chats[0].status, 'idle');
  assert.equal(recovered.snapshot().chats[0].messages[0].status, 'interrupted');
  assert.equal(recovered.snapshot().chats[0].messages[0].tools[0].status, 'complete');
});

test('project path validation requires an absolute existing directory', async () => {
  await assert.rejects(validateProjectPath('.'), /absolute/);
  await assert.rejects(validateProjectPath(path.join(os.tmpdir(), 'does-not-exist-cc-chat')), /existing/);
  assert.equal(await validateProjectPath(process.cwd()), process.cwd());
});

test('failed mutations do not leak into the in-memory state', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'cc-chat-store-'));
  const store = await new JsonStore({ dataDir }).init();
  const original = store.snapshot().projects[0].name;
  await assert.rejects(store.update((state) => { state.projects[0].name = 'Leaked'; throw new Error('no'); }), /no/);
  assert.equal(store.snapshot().projects[0].name, original);
});
