import assert from 'node:assert/strict'
import test from 'node:test'
import { backendTarget, backendApiUrl, workspaceStorageKey, workspaceLink } from '../src/backend-target.ts'

const cloud = 'https://chat.example.workers.dev/'
test('local development stays same-origin; hosted default is the Mac loopback service', () => {
  assert.equal(backendApiUrl('http://127.0.0.1:5173/','/state'),'/api/state')
  assert.equal(backendTarget(cloud).origin,'http://127.0.0.1:4318')
  assert.equal(backendTarget(cloud).hosted,true)
})
test('host selects the same backend for REST and SSE, accepts bare hosts and trailing slash', () => {
  for(const host of ['127.0.0.1:4319','http://127.0.0.1:4319/']) {
    const url=`${cloud}?host=${encodeURIComponent(host)}#/sessions`
    assert.equal(backendApiUrl(url,'/state'),'http://127.0.0.1:4319/api/state')
    assert.equal(backendApiUrl(url,'/events'),'http://127.0.0.1:4319/api/events')
  }
  assert.equal(backendTarget(`${cloud}?host=http://[::1]:4318`).origin,'http://[::1]:4318')
})
test('host cannot route prompts to arbitrary servers, paths, credentials, or schemes', () => {
  for(const host of ['', 'evil.example', '127.0.0.1.evil.example', 'https://public.example', 'http://192.168.1.2:4318', 'ftp://localhost', 'http://user:secret@localhost', 'http://localhost/api','http://localhost/?token=secret','http://localhost/#foo','localhost:abc','localhost\\@evil.example']) {
    assert.throws(()=>backendTarget(`${cloud}?host=${encodeURIComponent(host)}`),host)
  }
  assert.throws(()=>backendApiUrl(cloud,'//evil.example'))
})
test('host-specific drafts never leak across backend origins; existing local keys are retained', () => {
  assert.equal(workspaceStorageKey('http://127.0.0.1:5173/','selected'),'cc:selected')
  assert.notEqual(workspaceStorageKey(`${cloud}?host=localhost:4318`,'draft:new:'),workspaceStorageKey(`${cloud}?host=localhost:4319`,'draft:new:'))
})
test('preview and live links retain host and reset only the preview flag and route', () => {
  const href=`${cloud}?host=localhost:4319#/sessions/abc`
  assert.equal(workspaceLink(href,true),'/?host=localhost%3A4319&preview=oracle')
  assert.equal(workspaceLink(`${cloud}?host=localhost:4319&preview=oracle`,false),'/?host=localhost%3A4319#/new')
})
