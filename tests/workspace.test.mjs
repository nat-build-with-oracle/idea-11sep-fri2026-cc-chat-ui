import assert from 'node:assert/strict'
import test from 'node:test'
import { buildWorkspaceRepositories } from '../src/workspace-model.ts'
import { initialRoute, recoverChatRoute } from '../src/route-recovery.ts'

const repo = (id, path, modifiedAt = 0) => ({ id, path, name: path.split('/').pop(), modifiedAt })
const project = { id: 'saved-repo', name: 'My repo', path: '/Code/org/repo', createdAt: '' }
const session = (sessionId, cwd, startedAt = 0) => ({ sessionId, cwd, startedAt, action: 'resume', name: sessionId })

test('sidebar merges discovered repositories with saved projects, not just manually added folders', () => {
  const rows = buildWorkspaceRepositories([project], [repo('discovered', project.path, 5), repo('other', '/Code/org/other', 10)], [], [])
  assert.equal(rows.length, 2)
  assert.deepEqual(rows.map(row => row.id), ['other', 'saved-repo'])
  assert.equal(rows[1].name, 'My repo')
  assert.equal(rows[1].projectId, 'saved-repo')
})

test('native threads belong to nearest repository with path boundaries, imported threads appear once', () => {
  const chat = { id: 'chat', projectId: project.id, sessionId: 'imported', updatedAt: '2026-01-01' }
  const rows = buildWorkspaceRepositories([project], [repo('nested', '/Code/org/repo/inner'), repo('different', '/Code/org/repo-two')], [session('parent','/Code/org/repo/src',30), session('child','/Code/org/repo/inner/src',20), session('imported',project.path,50),session('unowned','/Code/org/repo-three',60)], [chat])
  assert.deepEqual(rows.find(row=>row.id===project.id).sessions.map(s=>s.sessionId), ['parent'])
  assert.deepEqual(rows.find(row=>row.id==='nested').sessions.map(s=>s.sessionId), ['child'])
  assert.equal(rows.find(row=>row.id==='different').sessions.length, 0)
  assert.deepEqual(rows.find(row=>row.id===project.id).chats, [chat])
})

test('repository ordering uses filesystem mtime, threads are newest first with deterministic ties', () => {
  const rows=buildWorkspaceRepositories([], [repo('b','/Code/b',2),repo('a','/Code/a',2)], [session('older','/Code/a',5),session('newer','/Code/a',10)], [])
  assert.deepEqual(rows.map(row=>row.id),['a','b'])
  assert.deepEqual(rows[0].sessions.map(item=>item.sessionId),['newer','older'])
})

test('preview IDs do not become a live initial selection', () => {
  assert.deepEqual(initialRoute(false,'preview-0','mother-oracle'), {view:'new',projectId:null})
  assert.deepEqual(initialRoute(true,'real-chat','real-repo'), {view:'chat',chatId:'preview-0'})
  assert.deepEqual(initialRoute(false,'real-chat','real-repo'), {view:'chat',chatId:'real-chat'})
})

test('missing preview and stale remembered routes recover, explicit unknown IDs remain honest', () => {
  assert.deepEqual(recoverChatRoute({view:'chat',chatId:'preview-0'},[],[],false), {view:'new',projectId:null})
  assert.deepEqual(recoverChatRoute({view:'chat',chatId:'gone'},[],[],true), {view:'new',projectId:null})
  assert.equal(recoverChatRoute({view:'chat',chatId:'gone'},[],[],false), null)
  assert.equal(recoverChatRoute({view:'chat',chatId:'existing'},[{id:'existing'}],[],true), null)
})

test('old chat links using a native session UUID recover to the matching real thread', () => {
  assert.deepEqual(recoverChatRoute({view:'chat',chatId:'native-id'},[],[session('native-id','/Code/repo')],false), {view:'native',sessionId:'native-id',tab:'saved',search:''})
  assert.deepEqual(recoverChatRoute({view:'chat',chatId:'native-id'},[{id:'app-id',sessionId:'native-id'}],[],false), {view:'chat',chatId:'app-id'})
})

test('discovered IDs and duplicate saved IDs remain valid aliases after registration', () => {
  const duplicate = { ...project, id:'older-alias', name:'Older name' }
  const rows=buildWorkspaceRepositories([project,duplicate],[repo('discovered-id',project.path,5)],[],[{id:'old-chat',projectId:duplicate.id}])
  assert.equal(rows.length,1)
  assert.deepEqual(rows[0].aliases,['discovered-id',project.id,duplicate.id])
  assert.equal(rows[0].chats[0].id,'old-chat')
})

test('hidden repository preferences survive IDs changing and reject corrupt storage', async () => {
  const { parseHiddenRepositories, changeRepositoryVisibility } = await import('../src/repository-visibility.ts')
  assert.equal(parseHiddenRepositories('{broken').size,0)
  assert.equal(parseHiddenRepositories('{"path":"/Code/repo"}').size,0)
  assert.deepEqual([...parseHiddenRepositories('["/Code/repo/", "relative", null, "/Code/repo"]')],['/Code/repo'])
  const original=new Set()
  const hidden=changeRepositoryVisibility(original,'/Code/repo/',true)
  assert.equal(original.size,0)
  assert.deepEqual([...parseHiddenRepositories(JSON.stringify([...hidden]))],['/Code/repo'])
  assert.equal(changeRepositoryVisibility(hidden,'/Code/repo',false).size,0)
})


test('canonical path groups legacy project and native symlink aliases without changing IDs', () => {
  const alias = { ...project, path:'/alias', canonicalPath:project.path }
  const native = { ...session('native','/other-alias'), canonicalPath:project.path }
  const rows=buildWorkspaceRepositories([alias],[repo('discovered',project.path)],[native],[{id:'chat',projectId:alias.id}])
  assert.equal(rows.length,1)
  assert.equal(rows[0].path,project.path)
  assert.equal(rows[0].sessions[0].sessionId,'native')
  assert.equal(rows[0].chats[0].id,'chat')
})
