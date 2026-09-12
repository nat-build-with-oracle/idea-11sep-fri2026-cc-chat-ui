import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, '.local', 'tauri-runtime');
const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
const sdkVersion = lock.packages?.['node_modules/@anthropic-ai/claude-agent-sdk']?.version;
if (!sdkVersion) throw new Error('Claude Agent SDK version is missing from package-lock.json');

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await Promise.all([
  cp(path.join(root, 'server'), path.join(output, 'server'), { recursive: true }),
  cp(path.join(root, 'dist'), path.join(output, 'dist'), { recursive: true }),
]);
await writeFile(path.join(output, 'package.json'), `${JSON.stringify({
  name: 'arra-claude-code-runtime',
  private: true,
  type: 'module',
  dependencies: { '@anthropic-ai/claude-agent-sdk': sdkVersion },
}, null, 2)}\n`);

await new Promise((resolve, reject) => {
  const child = spawn('npm', ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: output,
    stdio: 'inherit',
  });
  child.once('error', reject);
  child.once('exit', (code, signal) => {
    if (code === 0) resolve();
    else reject(new Error(`npm install for Tauri runtime failed (${signal || code})`));
  });
});

console.log(`Prepared Tauri runtime with Claude Agent SDK ${sdkVersion}`);
