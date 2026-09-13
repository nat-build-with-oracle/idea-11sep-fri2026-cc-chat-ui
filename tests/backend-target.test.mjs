import assert from 'node:assert/strict'
import test from 'node:test'
import { backendTarget, backendApiUrl, workspaceStorageKey, workspaceLink, timelineLink } from '../src/backend-target.ts'

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
test('host rejects credentials, paths, and unsafe schemes', () => {
  for(const host of ['', 'ftp://localhost', 'http://user:secret@localhost', 'http://localhost/api','http://localhost/?token=secret','http://localhost/#foo','localhost:abc','localhost\\@evil.example']) {
    assert.throws(()=>backendTarget(`${cloud}?host=${encodeURIComponent(host)}`),host)
  }
  assert.throws(()=>backendApiUrl(cloud,'//evil.example'))
})
test('host accepts explicit LAN, VPN, and public HTTP(S) backend origins', () => {
  for(const host of ['192.168.1.2:4318','100.64.1.2:4318','https://my-backend.example','http://dev-machine.local:4318']) {
    const url=`${cloud}?host=${encodeURIComponent(host)}`
    assert.equal(backendTarget(url).origin, new URL(host.includes('://')?host:`http://${host}`).origin)
  }
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

test('Timeline follows the selected remote backend and preserves the full return URL', () => {
  const href = 'http://workstation.example:4318/sessions?host=http%3A%2F%2Fworkstation.example%3A4318#/sessions/11111111-2222-4333-8444-555555555555'
  const link = new URL(timelineLink(href, new URL(href).hash))
  assert.equal(link.origin, 'http://workstation.example:47882')
  assert.equal(link.searchParams.get('view'), 'timeline')
  assert.equal(link.searchParams.get('returnTo'), href)
})

test('Timeline return route updates with selection without losing backend query or filters', () => {
  const href = `${cloud}?host=https%3A%2F%2Fbackend.example#/sessions/old`
  const hash = '#/sessions/new?tab=saved&q=hello+world'
  const link = new URL(timelineLink(href, hash))
  assert.equal(link.origin, 'https://backend.example:47882')
  const back = new URL(link.searchParams.get('returnTo'))
  assert.equal(back.origin, new URL(cloud).origin)
  assert.equal(back.searchParams.get('host'), 'https://backend.example')
  assert.equal(back.hash, hash)
})

test('local Timeline keeps the existing local service without needing a VPN listener', () => {
  const href = 'http://127.0.0.1:4318/#/sessions/local'
  const link = new URL(timelineLink(href, '#/sessions/local'))
  assert.equal(link.origin, 'http://127.0.0.1:47881')
  assert.equal(link.searchParams.get('returnTo'), href)
})
