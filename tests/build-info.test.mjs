import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { loadConfigFromFile } from 'vite'
import { createBuildInfo, readGitRevision } from '../scripts/build-info.ts'

test('CalVer uses the Asia/Bangkok wall clock across a UTC date rollover', () => {
  const info = createBuildInfo({
    now: new Date('2026-09-11T18:30:00.123Z'),
    revision: 'abc1234',
    mode: 'production',
  })

  assert.equal(info.version, 'v26.9.12-alpha.130')
  assert.equal(info.builtAt, '2026-09-11T18:30:00.123Z')
  assert.equal(info.mode, 'production')
})

test('CalVer HMM is decimal wall-clock time without leading zeroes', () => {
  assert.equal(createBuildInfo({ now: new Date('2026-09-11T17:00:00.000Z'), revision: 'a', mode: 'development' }).version, 'v26.9.12-alpha.0')
  assert.equal(createBuildInfo({ now: new Date('2026-09-11T17:09:00.000Z'), revision: 'a', mode: 'development' }).version, 'v26.9.12-alpha.9')
  assert.equal(createBuildInfo({ now: new Date('2026-09-11T17:37:00.000Z'), revision: 'a', mode: 'development' }).version, 'v26.9.12-alpha.37')
})

test('build ids remain unique within the same minute by including milliseconds', () => {
  const first = createBuildInfo({ now: new Date('2026-09-12T04:05:06.007Z'), revision: 'abc1234-dirty', mode: 'production' })
  const second = createBuildInfo({ now: new Date('2026-09-12T04:05:06.008Z'), revision: 'abc1234-dirty', mode: 'production' })

  assert.equal(first.id, '20260912T040506007Z-abc1234-dirty')
  assert.equal(second.id, '20260912T040506008Z-abc1234-dirty')
  assert.notEqual(first.id, second.id)
})

test('an explicit release version overrides only the clock-derived version', () => {
  const info = createBuildInfo({
    now: new Date('2026-09-13T06:15:16.017Z'),
    revision: 'def5678',
    mode: 'production',
    version: 'v26.9.13-alpha.1251',
  })

  assert.deepEqual(info, {
    version: 'v26.9.13-alpha.1251',
    builtAt: '2026-09-13T06:15:16.017Z',
    revision: 'def5678',
    id: '20260913T061516017Z-def5678',
    mode: 'production',
  })
})

test('an explicit release version must use the existing Bangkok alpha CalVer shape', () => {
  for (const version of [
    '',
    '26.9.13-alpha.1315',
    'v2026.9.13-alpha.1315',
    'v26.09.13-alpha.1315',
    'v26.9.13-alpha.0960',
    'v26.9.13-alpha.2400',
    'v26.9.13-beta.1315',
  ]) {
    assert.throws(
      () => createBuildInfo({ now: new Date('2026-09-13T06:15:16.017Z'), revision: 'a', version }),
      /CC_CHAT_BUILD_VERSION/,
      version,
    )
  }
})

test('Vite reads the explicit release version from CC_CHAT_BUILD_VERSION', async t => {
  const previous = process.env.CC_CHAT_BUILD_VERSION
  process.env.CC_CHAT_BUILD_VERSION = 'v26.9.13-alpha.1251'
  t.after(() => {
    if (previous === undefined) delete process.env.CC_CHAT_BUILD_VERSION
    else process.env.CC_CHAT_BUILD_VERSION = previous
  })

  const loaded = await loadConfigFromFile(
    { command: 'build', mode: 'production', isSsrBuild: false, isPreview: false },
    fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
  )
  assert.ok(loaded)
  const buildInfo = JSON.parse(loaded.config.define.__BUILD_INFO__)
  assert.equal(buildInfo.version, 'v26.9.13-alpha.1251')
  assert.equal(buildInfo.mode, 'production')
  assert.match(buildInfo.builtAt, /^\d{4}-\d{2}-\d{2}T/)
  assert.match(buildInfo.id, /^\d{8}T\d{9}Z-/)
  assert.equal(typeof buildInfo.revision, 'string')
})

test('revision discovery marks dirty trees and degrades to unknown without git', () => {
  const calls = []
  const execute = (_command, args) => {
    calls.push(args)
    return args[0] === 'rev-parse' ? 'abc1234\n' : ' M src/App.tsx\n'
  }

  assert.equal(readGitRevision({ execute }), 'abc1234-dirty')
  assert.deepEqual(calls, [['rev-parse', '--short', 'HEAD'], ['status', '--porcelain']])
  assert.equal(readGitRevision({ execute: () => { throw new Error('git unavailable') } }), 'unknown')
})

test('browser build info has a stable unbuilt fallback in Node tests', async () => {
  const { buildInfo } = await import(`../src/build-info.ts?test=${Date.now()}`)
  assert.deepEqual(buildInfo, {
    version: 'unbuilt',
    builtAt: '',
    revision: 'unknown',
    id: 'unbuilt',
    mode: 'development',
  })
})
