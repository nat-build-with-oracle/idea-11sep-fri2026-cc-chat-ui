import assert from 'node:assert/strict'
import { access, chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'
import { tmuxResumeCommand, tmuxSessionName, tmuxWindowName } from '../src/tmux-command.ts'

const execFileAsync = promisify(execFile)

test('tmux names use repository basename and an ASCII-safe normalized title', () => {
  assert.equal(tmuxSessionName('12345678-abcd', '/Users/example/neo-oracle', 'ARRA memory one click'), 'neo-oracle-arra-memory-one-click')
  assert.equal(tmuxSessionName('12345678-abcd', '/repos/my.repo:dev', '  --Fix: Login.v2  '), 'my-repo-dev-fix-login-v2')
  const fallback = tmuxSessionName('abcdef12-rest', '/งาน/ผู้ช่วย', 'ความทรงจำ')
  assert.equal(fallback, 'claude-abcdef12')
  assert.doesNotMatch(fallback, /^[.-]|[.:]/)
  assert.ok(tmuxSessionName('abcdef12', '/repo', 'x'.repeat(300)).length <= 96)
})

test('tmux window names use the title, then short ID, then a safe fallback', () => {
  assert.equal(tmuxWindowName('12345678-abcd', 'ARRA memory one click'), 'arra-memory-one-click')
  assert.equal(tmuxWindowName('abcdef12-rest', 'ความทรงจำ'), 'abcdef12')
  assert.equal(tmuxWindowName('ความทรงจำ', 'ผู้ช่วย'), 'session')
  const long = tmuxWindowName('abcdef12', `${'long-title-'.repeat(20)}---`)
  assert.ok(long.length <= 96)
  assert.doesNotMatch(long, /-$/)
})

test('tmux resume command quotes every argument and omits cwd when unknown', () => {
  const withCwd = tmuxResumeCommand('session-id', '/work/neo-oracle', 'Memory')
  const withoutCwd = tmuxResumeCommand('session-id', undefined, 'Memory')
  assert.match(withCwd, /tmux new-session -d -s 'neo-oracle-memory' -n 'memory' -c '\/work\/neo-oracle'/)
  assert.ok(withCwd.includes("claude --resume"))
  assert.ok(withCwd.includes("'session-id'") || withCwd.includes('session-id'))
  assert.match(withCwd, /tmux set-option -t 'neo-oracle-memory' status-left-length 100/)
  assert.match(withCwd, /maw a 'neo-oracle-memory'/)
  assert.match(withoutCwd, /tmux new-session -d -s 'claude-memory' -n 'memory'/)
  assert.ok(withoutCwd.includes("claude --resume"))
  assert.ok(withoutCwd.includes("'session-id'") || withoutCwd.includes('session-id'))
  assert.match(withoutCwd, /maw a 'claude-memory'/)
  assert.doesNotMatch(withCwd, /ANTHROPIC_|ZAI_/ )
  assert.doesNotMatch(tmuxResumeCommand('session-id', '/repo', 'Memory'), /set-option -g/)
})


async function mockCommands(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cc-tmux-command-'))
  const log = path.join(directory, 'calls.jsonl')
  const mock = `#!/usr/bin/env node
import { appendFileSync } from 'node:fs'
appendFileSync(process.env.CALL_LOG, JSON.stringify({ command: process.argv[1].split('/').at(-1), args: process.argv.slice(2) }) + '\\n')
if (process.argv[1].endsWith('/tmux')) process.exit(Number(process.env.TMUX_EXIT || 0))
`
  for (const command of ['tmux', 'maw']) {
    const file = path.join(directory, command)
    await writeFile(file, mock)
    await chmod(file, 0o755)
  }
  t.after(() => rm(directory, { recursive: true, force: true }))
  return { directory, log }
}

async function runScript(script, mocks, extraEnv = {}) {
  try {
    await execFileAsync('/bin/sh', ['-c', script], {
      env: { ...process.env, ...extraEnv, CALL_LOG: mocks.log, PATH: `${mocks.directory}:${process.env.PATH}` },
    })
  } catch (error) {
    if (!extraEnv.TMUX_EXIT) throw error
  }
  try { return (await readFile(mocks.log, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) }
  catch (error) { if (error.code === 'ENOENT') return []; throw error }
}

test('generated script passes literal values to mocks and never evaluates injected text', async t => {
  const mocks = await mockCommands(t)
  const marker = path.join(mocks.directory, 'must-not-exist')
  const cwd = `/tmp/O'Brien; touch ${marker}`
  const sessionId = `id'; touch ${marker}; echo '
`
  const name = tmuxSessionName(sessionId, cwd, 'Fix; $(touch nope)')
  const calls = await runScript(tmuxResumeCommand(sessionId, cwd, 'Fix; $(touch nope)'), mocks)

  assert.equal(calls[0].args.at(0), 'new-session')
  assert.equal(calls[0].command, 'tmux')
  assert.equal(calls[0].args[calls[0].args.indexOf('-s') + 1], name)
  assert.equal(calls.length, 3)
  assert.equal(calls[0].args[calls[0].args.indexOf('-c') + 1], cwd)
  assert.equal(calls[0].args.at(-1), `claude --resume '${sessionId.replaceAll("'", "'\\''")}'`)
  assert.deepEqual(calls[2].args, ['a', name])
  assert.equal(calls[1].command, 'tmux')
  assert.equal(calls[1].args.at(0), 'set-option')
  assert.equal(calls[2].command, 'maw')
  await assert.rejects(access(marker))
})


test('tmux name collisions fail closed and do not attach maw to an existing session', async t => {
  const mocks = await mockCommands(t)
  const calls = await runScript(tmuxResumeCommand('session-id', '/repo', 'Task'), mocks, { TMUX_EXIT: '1' })
  assert.deepEqual(calls.map(call => call.command), ['tmux'])
})

test('full-access tmux places permission bypass inside the quoted Claude command only', async t => {
  const mocks = await mockCommands(t)
  const script = tmuxResumeCommand('session-id', '/work/neo-oracle', 'Memory', true)
  const calls = await runScript(script, mocks)
  assert.deepEqual(calls[1].args, ['set-option', '-t', 'neo-oracle-memory', 'status-left-length', '100'])
  assert.equal((script.match(/--dangerously-skip-permissions/g) || []).length, 1)
  assert.doesNotMatch(tmuxResumeCommand('session-id', '/work/neo-oracle', 'Memory'), /dangerously/)
})
