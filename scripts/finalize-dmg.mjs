import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_CONFIG = path.join(REPO_ROOT, 'src-tauri', 'tauri.conf.json');

async function regularDmg(candidate) {
  if (path.extname(candidate).toLowerCase() !== '.dmg') throw new Error(`Expected a .dmg file: ${candidate}`);
  let info;
  try { info = await stat(candidate); } catch { throw new Error(`DMG does not exist: ${candidate}`); }
  if (!info.isFile()) throw new Error(`DMG is not a regular file: ${candidate}`);
  return candidate;
}

export async function resolveDmgPath({ argument, configPath = DEFAULT_CONFIG } = {}) {
  if (argument) return regularDmg(path.resolve(argument));

  const config = JSON.parse(await readFile(configPath, 'utf8'));
  if (typeof config.productName !== 'string' || !config.productName.trim()) {
    throw new Error(`Missing productName in ${configPath}`);
  }
  const directory = path.join(path.dirname(configPath), 'target', 'release', 'bundle', 'dmg');
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch { throw new Error(`DMG output directory does not exist: ${directory}`); }
  const prefixes = [config.productName, config.productName.replaceAll(' ', '_')];
  const candidates = entries
    .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === '.dmg')
    .filter((entry) => prefixes.some((prefix) => entry.name.startsWith(`${prefix}_`)))
    .map((entry) => path.join(directory, entry.name));
  if (candidates.length !== 1) {
    throw new Error(`Expected exactly one DMG for ${config.productName} in ${directory}, found ${candidates.length}`);
  }
  return candidates[0];
}

async function run(command, args) {
  return execFileAsync(command, args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
}

export async function finalizeDmg(dmgPath, { runCommand = run, platform = process.platform } = {}) {
  if (platform !== 'darwin') throw new Error('DMG finalization is supported only on macOS');
  const original = await regularDmg(path.resolve(dmgPath));
  const temporary = await mkdtemp(path.join(path.dirname(original), '.finalize-dmg-'));
  const writable = path.join(temporary, 'writable.dmg');
  const replacement = path.join(temporary, 'replacement.dmg');
  const mount = path.join(temporary, 'mount');
  let attached = false;
  let operationError = null;
  try {
    await runCommand('hdiutil', ['convert', original, '-format', 'UDRW', '-o', writable]);
    await mkdir(mount);
    await runCommand('hdiutil', ['attach', writable, '-mountpoint', mount, '-nobrowse', '-noautoopen', '-owners', 'on', '-private']);
    attached = true;
    await rm(path.join(mount, '.VolumeIcon.icns'), { force: true });
    const located = await runCommand('xcrun', ['--find', 'SetFile']);
    const setFile = String(located.stdout || '').trim();
    if (!path.isAbsolute(setFile)) throw new Error('xcrun did not return an absolute SetFile path');
    await runCommand(setFile, ['-a', 'c', mount]);
    await runCommand('hdiutil', ['detach', mount]);
    attached = false;
    await runCommand('hdiutil', ['convert', writable, '-format', 'UDZO', '-o', replacement]);
    await runCommand('hdiutil', ['verify', replacement]);
    await regularDmg(replacement);
    await rename(replacement, original);
  } catch (error) {
    operationError = error;
  } finally {
    let safeToRemove = true;
    if (attached) {
      try {
        await runCommand('hdiutil', ['detach', mount, '-force']);
      } catch (detachError) {
        safeToRemove = false;
        const detail = `failed to detach ${mount}; temporary files retained at ${temporary}: ${detachError.message}`;
        if (operationError) operationError.message = `${operationError.message}; ${detail}`;
        else operationError = new Error(detail, { cause: detachError });
      }
    }
    if (safeToRemove) await rm(temporary, { recursive: true, force: true });
  }
  if (operationError) throw operationError;
  return original;
}

async function main() {
  if (process.argv.length > 3) throw new Error('Usage: node scripts/finalize-dmg.mjs [path/to/file.dmg]');
  const dmg = await resolveDmgPath({ argument: process.argv[2] });
  await finalizeDmg(dmg);
  console.log(`Finalized DMG: ${dmg}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
