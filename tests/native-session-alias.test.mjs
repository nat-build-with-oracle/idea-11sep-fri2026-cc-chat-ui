import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createServer } from '../server/app.mjs'

function nativeService() {
  const original = {
    id: 'active-job', sessionId: 'native-session-id', cwd: process.cwd(), kind: 'background',
    name: 'Native original', action: 'openTerminal', state: 'working', status: null, waitingFor: null,
    pid: 42, startedAt: 1000, terminalCommand: null,
  }
  let active = true
  let renameCalls = 0
  let messageCalls = 0
  return {
    original,
    setActive(value) { active = value },
    service: {
      async list() { return [{ ...original, action: active ? 'openTerminal' : 'resume' }] },
      async resumable(id) {
        assert.equal(id, original.sessionId)
        if (active) throw Object.assign(new Error('Native Claude session is active'), { statusCode: 409 })
        return { ...original, action: 'resume' }
      },
      async rename() { renameCalls += 1; throw new Error('Native rename must not run for a display alias') },
      async messages(id) {
        messageCalls += 1
        assert.equal(id, original.sessionId)
        return { messages: [], nextOffset: null }
      },
    },
    calls: () => ({ renameCalls, messageCalls }),
  }
}

async function start(dataDir, nativeSessions) {
  const runner = { health: async () => ({ claudeAvailable: true, claudeVersion: 'test' }), stopAll: async () => {} }
  const server = await createServer({ dataDir, cwd: process.cwd(), runner, nativeSessions, devOrigin: 'http://127.0.0.1:5173' })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => server.listening ? new Promise(resolve => server.close(resolve)) : Promise.resolve(),
  }
}

async function request(origin, url, options) {
  const response = await fetch(`${origin}${url}`, options)
  return { response, value: await response.json() }
}

test('active native sessions use persistent display aliases without mutating Claude session data', async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'cc-native-display-alias-'))
  const native = nativeService()
  const first = await start(dataDir, native.service)
  t.after(() => first.close())

  const renamed = await request(first.origin, '/api/native-sessions/native-session-id', {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'My active alias' }),
  })
  assert.equal(renamed.response.status, 200)
  assert.equal(renamed.value.session.name, 'My active alias')
  assert.equal(renamed.value.session.sessionId, native.original.sessionId)
  assert.equal(renamed.value.session.action, 'openTerminal')
  assert.equal(renamed.value.chat, null)
  assert.deepEqual(native.calls(), { renameCalls: 0, messageCalls: 0 })
  assert.equal(native.original.name, 'Native original')

  const listed = await request(first.origin, '/api/native-sessions')
  assert.equal(listed.value.sessions[0].name, 'My active alias')
  assert.equal(listed.value.sessions[0].sessionId, native.original.sessionId)
  assert.deepEqual(native.calls(), { renameCalls: 0, messageCalls: 0 })

  const persisted = JSON.parse(await readFile(path.join(dataDir, 'state.json'), 'utf8'))
  assert.deepEqual(persisted.nativeSessionAliases.map(({ sessionId, title }) => ({ sessionId, title })), [
    { sessionId: 'native-session-id', title: 'My active alias' },
  ])

  await first.close()
  const restarted = await start(dataDir, native.service)
  t.after(() => restarted.close())
  const afterRestart = await request(restarted.origin, '/api/native-sessions')
  assert.equal(afterRestart.value.sessions[0].name, 'My active alias')
  assert.equal(native.original.name, 'Native original')

  native.setActive(false)
  const imported = await request(restarted.origin, '/api/native-sessions/native-session-id/import', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  })
  assert.equal(imported.response.status, 201)
  assert.equal(imported.value.title, 'My active alias')
  assert.equal(imported.value.sessionId, native.original.sessionId)
  assert.equal(imported.value.messages.length, 0)
  assert.equal(native.original.name, 'Native original')
  assert.deepEqual(native.calls(), { renameCalls: 0, messageCalls: 1 })
})
