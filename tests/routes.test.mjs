import assert from 'node:assert/strict'
import test from 'node:test'
import { parseRoute, routeHash } from '../src/routes.ts'

test('parses empty, unknown, and malformed hashes as a new conversation', () => {
  const fallback = { view: 'new', projectId: null }
  assert.deepEqual(parseRoute(''), fallback)
  assert.deepEqual(parseRoute('#/unknown'), fallback)
  assert.deepEqual(parseRoute('#/chats/%E0%A4%A'), fallback)
  assert.deepEqual(parseRoute('#/chats/a%2Fb'), fallback)
  assert.deepEqual(parseRoute(`#/chats/${'a'.repeat(201)}`), fallback)
})

test('builds and parses canonical new and chat hashes', () => {
  assert.equal(routeHash({ view: 'new', projectId: null }), '#/new')
  assert.equal(routeHash({ view: 'new', projectId: 'project one' }), '#/new?project=project+one')
  assert.deepEqual(parseRoute('#/new?project=project+one'), { view: 'new', projectId: 'project one' })

  const chat = { view: 'chat', chatId: 'ไทย ?#% chat' }
  const hash = routeHash(chat)
  assert.equal(hash, '#/chats/%E0%B9%84%E0%B8%97%E0%B8%A2%20%3F%23%25%20chat')
  assert.deepEqual(parseRoute(hash), chat)
})

test('canonicalizes session list tabs and search without throwing', () => {
  assert.deepEqual(parseRoute('#/sessions'), { view: 'agents', tab: 'agents', search: '' })
  assert.deepEqual(parseRoute('#/sessions?tab=bogus&q=hello'), { view: 'agents', tab: 'agents', search: 'hello' })
  assert.equal(routeHash({ view: 'agents', tab: 'agents', search: '' }), '#/sessions')
  assert.equal(routeHash({ view: 'agents', tab: 'saved', search: 'two words' }), '#/sessions?tab=saved&q=two+words')
  assert.equal(parseRoute(`#/sessions?q=${'x'.repeat(501)}`).search.length, 500)
})

test('round trips native sessions with tabs, unicode search, and encoded identifiers', () => {
  const route = { view: 'native', sessionId: 'Claude ?#% 你好', tab: 'terminals', search: 'งาน cool' }
  const hash = routeHash(route)
  assert.equal(hash, '#/sessions/Claude%20%3F%23%25%20%E4%BD%A0%E5%A5%BD?tab=terminals&q=%E0%B8%87%E0%B8%B2%E0%B8%99+cool')
  assert.deepEqual(parseRoute(hash), route)
})

test('rejects control characters and decoded slashes in identifiers and invalid project values', () => {
  const fallback = { view: 'new', projectId: null }
  assert.deepEqual(parseRoute('#/chats/bad%0Aid'), fallback)
  assert.deepEqual(parseRoute('#/sessions/bad%2Fid'), fallback)
  assert.deepEqual(parseRoute('#/new?project=bad%00project'), fallback)
  assert.equal(routeHash({ view: 'chat', chatId: 'bad/id' }), '#/new')
})
