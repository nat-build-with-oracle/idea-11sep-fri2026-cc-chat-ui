import { execFile, spawn } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { resolveDmgPath } from './finalize-dmg.mjs';

const execFileAsync = promisify(execFile);
const DEFAULT_CONFIG = new URL('../src-tauri/tauri.conf.json', import.meta.url);

async function run(command, args) {
  return execFileAsync(command, args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
}

async function runWithInput(command, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      const result = {
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      };
      if (code === 0) resolve(result);
      else reject(new Error(`${command} exited with code ${code}: ${result.stderr.trim()}`));
    });
    child.stdin.end(input);
  });
}

async function productName(configPath = DEFAULT_CONFIG) {
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  if (typeof config.productName !== 'string' || !config.productName.trim()) {
    throw new Error(`Missing productName in ${configPath}`);
  }
  return config.productName;
}

export async function mountedPathsForDmg(dmgPath, {
  runCommand = run,
  runCommandWithInput = runWithInput,
} = {}) {
  const info = await runCommand('hdiutil', ['info', '-plist']);
  const converted = await runCommandWithInput(
    'plutil',
    ['-convert', 'json', '-o', '-', '-'],
    info.stdout,
  );
  const images = JSON.parse(converted.stdout);
  if (!Array.isArray(images.images)) throw new Error('Unexpected hdiutil info plist structure');

  return images.images
    .filter((image) => image['image-path'] === dmgPath)
    .flatMap((image) => Array.isArray(image['system-entities']) ? image['system-entities'] : [])
    .map((entity) => entity['mount-point'])
    .filter((mountPoint) => typeof mountPoint === 'string' && mountPoint.length > 0);
}

export async function unmountExistingDmg(dmgPath, options = {}) {
  const runCommand = options.runCommand || run;
  const mountPoints = await mountedPathsForDmg(dmgPath, { ...options, runCommand });
  for (const mountPoint of mountPoints) {
    await runCommand('hdiutil', ['detach', mountPoint]);
  }
  return mountPoints;
}

export async function verifyDmg(dmgPath, {
  runCommand = run,
  platform = process.platform,
  configPath = DEFAULT_CONFIG,
  makeTemporaryDirectory = (prefix) => mkdtemp(prefix),
} = {}) {
  if (platform !== 'darwin') throw new Error('DMG verification is supported only on macOS');
  const resolvedDmg = path.resolve(dmgPath);
  const expectedApp = `${await productName(configPath)}.app`;
  const temporary = await makeTemporaryDirectory(path.join(os.tmpdir(), 'verify-dmg-'));
  const mount = path.join(temporary, 'mount');
  let attached = false;
  let operationError = null;

  try {
    await runCommand('hdiutil', ['verify', resolvedDmg]);
    await mkdir(mount);
    await runCommand('hdiutil', [
      'attach', resolvedDmg,
      '-readonly', '-mountpoint', mount,
      '-nobrowse', '-noautoopen', '-private',
    ]);
    attached = true;

    const entries = await readdir(mount);
    if (entries.includes('.VolumeIcon.icns')) {
      throw new Error('DMG contains forbidden .VolumeIcon.icns');
    }
    const visibleEntries = entries.filter((entry) => !entry.startsWith('.')).sort();
    const expectedEntries = ['Applications', expectedApp].sort();
    if (JSON.stringify(visibleEntries) !== JSON.stringify(expectedEntries)) {
      throw new Error(`Expected exactly ${expectedApp} and Applications, found: ${visibleEntries.join(', ') || '(none)'}`);
    }
    const appInfo = await lstat(path.join(mount, expectedApp));
    if (!appInfo.isDirectory()) throw new Error(`${expectedApp} is not a directory`);
    const applicationsPath = path.join(mount, 'Applications');
    const applicationsInfo = await lstat(applicationsPath);
    if (!applicationsInfo.isSymbolicLink()) throw new Error('Applications is not a symbolic link');
    const target = await readlink(applicationsPath);
    if (target !== '/Applications') {
      throw new Error(`Applications symlink points to ${target}, expected /Applications`);
    }
  } catch (error) {
    operationError = error;
  } finally {
    let safeToRemove = true;
    if (attached) {
      try {
        await runCommand('hdiutil', ['detach', mount]);
        attached = false;
      } catch (detachError) {
        safeToRemove = false;
        const detail = `failed to detach ${mount}; temporary mount retained at ${temporary}: ${detachError.message}`;
        if (operationError) operationError.message = `${operationError.message}; ${detail}`;
        else operationError = new Error(detail, { cause: detachError });
      }
    }
    if (safeToRemove) await rm(temporary, { recursive: true, force: true });
  }

  if (operationError) throw operationError;
  return resolvedDmg;
}

function isMissingDefaultDmg(error) {
  return /DMG output directory does not exist:|found 0$/.test(error.message);
}

export async function runCli(argv, {
  resolvePath = resolveDmgPath,
  verify = verifyDmg,
  unmount = unmountExistingDmg,
  runCommand = run,
} = {}) {
  const flags = new Set(argv.filter((argument) => argument.startsWith('--')));
  const positional = argv.filter((argument) => !argument.startsWith('--'));
  for (const flag of flags) {
    if (flag !== '--unmount-existing' && flag !== '--open') throw new Error(`Unknown option: ${flag}`);
  }
  if (positional.length > 1) {
    throw new Error('Usage: node scripts/verify-dmg.mjs [--unmount-existing | --open] [path/to/file.dmg]');
  }
  if (flags.has('--unmount-existing') && flags.has('--open')) {
    throw new Error('--unmount-existing and --open cannot be used together');
  }

  let dmg;
  try {
    dmg = await resolvePath({ argument: positional[0] });
  } catch (error) {
    if (flags.has('--unmount-existing') && !positional[0] && isMissingDefaultDmg(error)) {
      return { action: 'unmount', dmg: null, mountPoints: [] };
    }
    throw error;
  }

  if (flags.has('--unmount-existing')) {
    return { action: 'unmount', dmg, mountPoints: await unmount(dmg) };
  }

  await verify(dmg);
  if (flags.has('--open')) {
    const mountPoints = await unmount(dmg);
    await runCommand('open', [dmg]);
    return { action: 'open', dmg, mountPoints };
  }
  return { action: 'verify', dmg };
}

async function main() {
  const result = await runCli(process.argv.slice(2));
  if (!result.dmg) console.log('No existing DMG to unmount');
  else if (result.action === 'unmount') console.log(`Unmounted existing DMG mounts: ${result.dmg}`);
  else if (result.action === 'open') console.log(`Verified and opened DMG: ${result.dmg}`);
  else console.log(`Verified DMG: ${result.dmg}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
