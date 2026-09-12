import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createServer } from '../server/app.mjs';
import { buildMentionCandidates, expandMentionContext } from '../src/mentions.ts';

class FakeRunner {
  constructor() {
    this.calls = [];
  }

  health() {
    return Promise.resolve({ claudeAvailable: true, claudeVersion: 'test' });
  }

  run(options) {
    this.calls.push(options);
    return Promise.resolve({
      ok: true,
      interrupted: false,
      sessionId: options.sessionId,
      text: 'done',
      tools: [],
    });
  }

  stop() {
    return Promise.resolve(false);
  }

  stopAll() {
    return Promise.resolve();
  }
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, options);
  return { response, value: await response.json() };
}

async function waitForIdle(origin, chatId) {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    const state = (await jsonRequest(`${origin}/api/state`)).value;
    const chat = state.chats.find((candidate) => candidate.id === chatId);
    if (chat?.status === 'idle') return chat;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for mentioned prompt to persist');
}

test('expanded repository and session mentions add metadata without changing execution identity', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cc-chat-mentions-api-'));
  const dataDir = path.join(root, 'data');
  const currentPath = path.join(root, 'current-session-worktree');
  const mentionedRepositoryPath = path.join(root, 'mentioned-repository');
  const mentionedSessionPath = path.join(root, 'mentioned-session-worktree');
  await Promise.all([mkdir(currentPath), mkdir(mentionedRepositoryPath), mkdir(mentionedSessionPath)]);
  const currentSessionId = 'current-native-session';
  const mentionedSessionId = 'mentioned-native-session';
  const currentNative = {
    id: 'current-native-record',
    cwd: currentPath,
    kind: 'saved',
    name: 'Current conversation',
    sessionId: currentSessionId,
    startedAt: 1,
    action: 'resume',
  };
  const nativeSessions = {
    async list() { return [currentNative]; },
    async messages() { return { messages: [], nextOffset: null }; },
    async rename() { return currentNative; },
    async resumable(sessionId) {
      assert.equal(sessionId, currentSessionId);
      return currentNative;
    },
  };
  const repositories = {
    async list() {
      return { repositories: [{ id: 'mentioned-repo', name: 'Mentioned repository', path: mentionedRepositoryPath }], warnings: [] };
    },
  };
  const runner = new FakeRunner();
  const server = await createServer({ dataDir, cwd: currentPath, nativeSessions, repositories, runner });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });

  const imported = await jsonRequest(`${origin}/api/native-sessions/${currentSessionId}/import`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(imported.response.status, 201);

  const candidates = buildMentionCandidates({
    projects: [],
    repositories: [{ id: 'mentioned-repo', name: 'Mentioned repository', path: mentionedRepositoryPath, modifiedAt: 1 }],
    chats: [{
      id: 'app-chat-for-mentioned-session',
      title: 'Mentioned conversation',
      projectId: null,
      sessionId: mentionedSessionId,
      model: 'sonnet',
      permissionMode: 'default',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      messages: [],
      status: 'idle',
    }],
    nativeSessions: [{
      id: 'mentioned-native-record',
      cwd: mentionedSessionPath,
      kind: 'saved',
      name: 'Mentioned conversation',
      sessionId: mentionedSessionId,
      startedAt: 2,
      action: 'resume',
    }],
    cwd: currentPath,
  });
  const repositoryMention = candidates.find((candidate) => candidate.kind === 'repository' && candidate.path === mentionedRepositoryPath);
  const sessionMention = candidates.find((candidate) => candidate.kind === 'session' && candidate.sessionId === mentionedSessionId);
  assert.ok(repositoryMention);
  assert.ok(sessionMention);
  const deletedMention = {
    key: 'session:deleted-native-session',
    kind: 'session',
    name: 'Deleted mention',
    path: '/private/deleted-mention',
    sessionId: 'deleted-native-session',
    token: '@session:deleted-mention',
  };
  const visibleText = `Compare ${repositoryMention.token} with ${sessionMention.token}`;
  const expanded = expandMentionContext(visibleText, [repositoryMention, sessionMention, deletedMention]);

  const sent = await jsonRequest(`${origin}/api/chats/${imported.value.id}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: expanded }),
  });
  assert.equal(sent.response.status, 202);
  const persisted = await waitForIdle(origin, imported.value.id);

  assert.equal(runner.calls.length, 1);
  assert.equal(runner.calls[0].prompt, expanded);
  assert.equal(persisted.messages.find((message) => message.role === 'user').content, runner.calls[0].prompt);
  assert.equal(expanded.includes(`"path": ${JSON.stringify(mentionedRepositoryPath)}`), true);
  assert.match(expanded, /"name": "Mentioned repository"/);
  assert.match(expanded, /"sessionId": "mentioned-native-session"/);
  assert.match(expanded, /"name": "Mentioned conversation"/);
  assert.equal(expanded.includes('deleted-native-session'), false);
  assert.equal(expanded.includes('/private/deleted-mention'), false);
  assert.equal(runner.calls[0].cwd, currentPath);
  assert.equal(runner.calls[0].sessionId, currentSessionId);
});
