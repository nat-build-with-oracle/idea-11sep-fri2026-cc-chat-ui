import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { finalizeDmg, resolveDmgPath } from '../scripts/finalize-dmg.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');

test('Tauri DMG layout keeps both icons balanced on one row with room for the product title', async () => {
  const config = JSON.parse(await readFile(path.join(repoRoot, 'src-tauri', 'tauri.conf.json'), 'utf8'));
  const dmg = config.bundle.macOS.dmg;

  assert.equal(dmg.appPosition.y, dmg.applicationFolderPosition.y);
  assert.equal(dmg.appPosition.x, dmg.windowSize.width - dmg.applicationFolderPosition.x);
  assert.ok(dmg.windowSize.width >= 800);
  assert.ok(dmg.applicationFolderPosition.x - dmg.appPosition.x >= 350);
});

test('DMG discovery uses productName and rejects ambiguous build artifacts', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cc-chat-dmg-discovery-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const configPath = path.join(root, 'tauri.conf.json');
  const output = path.join(root, 'target', 'release', 'bundle', 'dmg');
  await mkdir(output, { recursive: true });
  await writeFile(configPath, JSON.stringify({ productName: 'Long Product Name', version: '1.0.0' }));
  const expected = path.join(output, 'Long Product Name_1.0.0_aarch64.dmg');
  await writeFile(expected, 'first');
  await writeFile(path.join(output, 'Unrelated_1.0.0_aarch64.dmg'), 'ignored');
  await writeFile(path.join(output, 'Long Product Name_0.9.0_aarch64.dmg'), 'stale');

  assert.equal(await resolveDmgPath({ configPath }), expected);
  assert.equal(await resolveDmgPath({ argument: expected }), expected);
  await writeFile(path.join(output, 'Long_Product_Name_1.0.0_x64.dmg'), 'second');
  await assert.rejects(resolveDmgPath({ configPath }), /exactly one DMG.*found 2/);
});

test('DMG discovery fails closed when config version cannot identify the current artifact', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cc-chat-dmg-version-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const configPath = path.join(root, 'tauri.conf.json');
  const explicit = path.join(root, 'Product_1.0.0_aarch64.dmg');
  await writeFile(explicit, 'image');

  await writeFile(configPath, JSON.stringify({ productName: 'Product' }));
  await assert.rejects(resolveDmgPath({ configPath }), /Missing or unsupported version.*explicit DMG path/);
  await writeFile(configPath, JSON.stringify({ productName: 'Product', version: '../VERSION' }));
  await assert.rejects(resolveDmgPath({ configPath }), /Missing or unsupported version.*explicit DMG path/);
  await writeFile(configPath, JSON.stringify({ productName: 'Product', version: 'latest' }));
  await assert.rejects(resolveDmgPath({ configPath }), /Missing or unsupported version.*explicit DMG path/);
  assert.equal(await resolveDmgPath({ argument: explicit, configPath }), explicit);
});

test('DMG finalization removes only the generated volume icon and atomically replaces a verified image', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cc-chat-dmg-finalize-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const original = path.join(root, 'Product.dmg');
  await writeFile(original, 'original image');
  const calls = [];
  const runCommand = async (command, args) => {
    calls.push([command, ...args]);
    if (command === 'xcrun') return { stdout: '/usr/bin/SetFile\n' };
    if (command === '/usr/bin/SetFile') {
      assert.equal(await readFile(path.join(args.at(-1), 'keep.txt'), 'utf8'), 'keep');
      await assert.rejects(readFile(path.join(args.at(-1), '.VolumeIcon.icns')), { code: 'ENOENT' });
    }
    if (command === 'hdiutil' && args[0] === 'convert') {
      await copyFile(args[1], args.at(-1));
      if (args.includes('UDZO')) await writeFile(args.at(-1), 'verified replacement');
    }
    if (command === 'hdiutil' && args[0] === 'attach') {
      const mount = args[args.indexOf('-mountpoint') + 1];
      await mkdir(mount, { recursive: true });
      await writeFile(path.join(mount, '.VolumeIcon.icns'), 'generated icon');
      await writeFile(path.join(mount, 'keep.txt'), 'keep');
    }
    return { stdout: '' };
  };

  await finalizeDmg(original, { runCommand, platform: 'darwin' });

  assert.equal(await readFile(original, 'utf8'), 'verified replacement');
  assert.deepEqual(calls.map((call) => call.slice(0, 2)), [
    ['hdiutil', 'convert'],
    ['hdiutil', 'attach'],
    ['xcrun', '--find'],
    ['/usr/bin/SetFile', '-a'],
    ['hdiutil', 'detach'],
    ['hdiutil', 'convert'],
    ['hdiutil', 'verify'],
  ]);
  assert.ok(calls.find((call) => call[0] === 'hdiutil' && call[1] === 'attach').includes('-private'));
});

test('DMG finalization preserves the original and detaches the private mount after failure', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cc-chat-dmg-failure-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const original = path.join(root, 'Product.dmg');
  await writeFile(original, 'original image');
  const calls = [];
  const runCommand = async (command, args) => {
    calls.push([command, ...args]);
    if (command === 'hdiutil' && args[0] === 'convert') await copyFile(args[1], args.at(-1));
    if (command === 'xcrun') throw new Error('SetFile lookup failed');
    return { stdout: '' };
  };

  await assert.rejects(finalizeDmg(original, { runCommand, platform: 'darwin' }), /SetFile lookup failed/);
  assert.equal(await readFile(original, 'utf8'), 'original image');
  assert.equal(calls.some((call) => call[0] === 'hdiutil' && call[1] === 'detach' && call.includes('-force')), true);
});

test('DMG finalization retains and reports a temporary mount when forced detach fails', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cc-chat-dmg-detach-failure-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const original = path.join(root, 'Product.dmg');
  await writeFile(original, 'original image');
  const runCommand = async (command, args) => {
    if (command === 'hdiutil' && args[0] === 'convert') await copyFile(args[1], args.at(-1));
    if (command === 'xcrun') throw new Error('SetFile lookup failed');
    if (command === 'hdiutil' && args[0] === 'detach') throw new Error('device is busy');
    return { stdout: '' };
  };

  let failure;
  try {
    await finalizeDmg(original, { runCommand, platform: 'darwin' });
  } catch (error) {
    failure = error;
  }
  assert.match(failure?.message || '', /SetFile lookup failed; failed to detach .*temporary files retained at .*device is busy/);
  assert.equal(await readFile(original, 'utf8'), 'original image');
  const retained = (await readdir(root)).filter((name) => name.startsWith('.finalize-dmg-'));
  assert.equal(retained.length, 1);
  assert.match(failure.message, new RegExp(retained[0]));
});

test('DMG finalization retains temporary files when attach fails with unknown mount state', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cc-chat-dmg-partial-attach-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const original = path.join(root, 'Product.dmg');
  await writeFile(original, 'original image');
  const runCommand = async (command, args) => {
    if (command === 'hdiutil' && args[0] === 'convert') await copyFile(args[1], args.at(-1));
    if (command === 'hdiutil' && args[0] === 'attach') {
      await writeFile(path.join(args[args.indexOf('-mountpoint') + 1], 'partial'), 'possibly mounted');
      throw new Error('attach returned nonzero');
    }
    return { stdout: '' };
  };

  await assert.rejects(finalizeDmg(original, { runCommand, platform: 'darwin' }),
    /attach returned nonzero; attach did not complete; temporary files retained at .*mount state is unknown/);
  const retained = (await readdir(root)).filter((name) => name.startsWith('.finalize-dmg-'));
  assert.equal(retained.length, 1);
  assert.equal(await readFile(path.join(root, retained[0], 'mount', 'partial'), 'utf8'), 'possibly mounted');
});
