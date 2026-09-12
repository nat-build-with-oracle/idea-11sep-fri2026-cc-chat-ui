import assert from 'node:assert/strict'
import test from 'node:test'
import { request, subscribe } from '../src/api.ts'

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
