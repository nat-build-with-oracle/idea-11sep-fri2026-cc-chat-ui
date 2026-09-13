import { spawn } from 'node:child_process'
import { createDevEnvironments } from './dev-environment.mjs'

const { backendEnv, clientEnv } = createDevEnvironments()
const children = [
  spawn(process.execPath, ['--watch', 'server/index.mjs'], { stdio: 'inherit', env: backendEnv }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1'], { stdio: 'inherit', env: clientEnv }),
]
let stopping = false
function stop(code = 0) {
  if (stopping) return
  stopping = true
  for (const child of children) child.kill('SIGTERM')
  process.exitCode = code
}
for (const child of children) {
  child.on('error', (error) => { console.error(error); stop(1) })
  child.on('exit', (code) => stop(code ?? 0))
}
process.on('SIGINT', () => stop())
process.on('SIGTERM', () => stop())
