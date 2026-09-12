import assert from 'node:assert/strict'
import test from 'node:test'
import { api, request, subscribe } from '../src/api.ts'

test('REST and SSE use the selected backend without version-sensitive address-space options', async t => {
  const original={window:globalThis.window,fetch:globalThis.fetch,EventSource:globalThis.EventSource}
  t.after(()=>Object.assign(globalThis,original))
  globalThis.window={location:{href:'https://chat.example/?host=http://127.0.0.1:4318'}}
  let invocation
  globalThis.fetch=async(url,options)=>{
    // Older typed PNA dictionaries reject the newer loopback enum before I/O.
    if(options.targetAddressSpace==='loopback') throw new TypeError("'loopback' is not a valid IPAddressSpace value")
    invocation={url,options}
    return new Response('{"ok":true}',{headers:{'content-type':'application/json'}})
  }
  assert.deepEqual(await request('/health'),{ok:true})
  assert.equal(invocation.url,'http://127.0.0.1:4318/api/health')
  assert.equal(invocation.options.credentials,'omit')
  assert.equal(invocation.options.redirect,'error')
  assert.equal('targetAddressSpace' in invocation.options,false)
  const sources=[]
  globalThis.EventSource=class {
    constructor(url){this.url=url;sources.push(this)}
    addEventListener(){}
    close(){this.closed=true}
  }
  const close=subscribe(()=>{},()=>{})
  assert.equal(sources[0].url,'http://127.0.0.1:4318/api/events')
  close();assert.equal(sources[0].closed,true)
})

test('connection errors retain the browser reason instead of masking it', async t=>{
  const original={window:globalThis.window,fetch:globalThis.fetch}
  t.after(()=>Object.assign(globalThis,original))
  globalThis.window={location:{href:'https://chat.example/?host=http://127.0.0.1:4318'}}
  globalThis.fetch=async()=>{throw new TypeError('Blocked by local network policy')}
  await assert.rejects(request('/health'),/Blocked by local network policy/)
})

test('a static website or wrong port is reported as a non-API backend, not loaded as state', async t=>{
  const original={window:globalThis.window,fetch:globalThis.fetch}
  t.after(()=>Object.assign(globalThis,original))
  globalThis.window={location:{href:'https://chat.example/?host=https://wrong-backend.example'}}
  globalThis.fetch=async()=>new Response('<!doctype html><title>Not an API</title>',{headers:{'content-type':'text/html'}})
  await assert.rejects(request('/state'),/did not return JSON/)
})

test('manual transcript sync posts to the encoded chat endpoint', async t => {
  const original = { window: globalThis.window, fetch: globalThis.fetch }
  t.after(() => Object.assign(globalThis, original))
  globalThis.window = { location: { href: 'https://chat.example/?host=http://127.0.0.1:4318' } }
  let invocation
  globalThis.fetch = async (url, options) => {
    invocation = { url, options }
    return new Response('{"id":"chat/one"}', { headers: { 'content-type': 'application/json' } })
  }
  assert.deepEqual(await api.syncChat('chat/one'), { id: 'chat/one' })
  assert.equal(invocation.url, 'http://127.0.0.1:4318/api/chats/chat%2Fone/sync')
  assert.equal(invocation.options.method, 'POST')
  assert.equal(invocation.options.body, '{}')
})

test('history requests pass cancellation signals through without reporting a connection failure on Stop', async t => {
  const original = { window: globalThis.window, fetch: globalThis.fetch }
  t.after(() => Object.assign(globalThis, original))
  globalThis.window = { location: { href: 'https://chat.example/?host=http://127.0.0.1:4318' } }
  const controller = new AbortController()
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    assert.equal(options.signal, controller.signal)
    if (options.signal.aborted) throw options.signal.reason
    return new Response('{"messages":[],"nextOffset":null}', { headers: { 'content-type': 'application/json' } })
  }
  await api.nativeHistory('native/id', 200, controller.signal)
  await api.loadChatHistory('chat-id', controller.signal)
  assert.equal(calls[0].url, 'http://127.0.0.1:4318/api/native-sessions/native%2Fid/messages?offset=200&limit=100')
  assert.equal(calls[1].options.method, 'POST')
  controller.abort()
  await assert.rejects(api.nativeHistory('native/id', 300, controller.signal), error => error === controller.signal.reason)
})
