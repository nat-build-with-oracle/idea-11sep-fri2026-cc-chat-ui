import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { resolveDmgPath } from '../scripts/finalize-dmg.mjs';
import { mountedPathsForDmg, runCli, unmountExistingDmg, verifyDmg } from '../scripts/verify-dmg.mjs';

async function fixture(t, name) {
  const root = await mkdtemp(path.join(os.tmpdir(), `verify-dmg-${name}-`));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dmg = path.join(root, 'Product.dmg');
  const configPath = path.join(root, 'tauri.conf.json');
  await writeFile(dmg, 'image');
  await writeFile(configPath, JSON.stringify({ productName: 'Product' }));
  return { root, dmg, configPath };
}

test('mounted path lookup parses plist as JSON and selects only exact image-path matches', async () => {
  const target = '/tmp/Product.dmg';
  const plist = Buffer.from('binary plist bytes');
  let plutilInput;
  const mounts = await mountedPathsForDmg(target, {
    runCommand: async (command, args) => {
      assert.deepEqual([command, ...args], ['hdiutil', 'info', '-plist']);
      return { stdout: plist };
    },
    runCommandWithInput: async (command, args, input) => {
      assert.deepEqual([command, ...args], ['plutil', '-convert', 'json', '-o', '-', '-']);
      plutilInput = input;
      return { stdout: JSON.stringify({ images: [
        { 'image-path': target, 'system-entities': [{ 'mount-point': '/Volumes/Product' }, { 'dev-entry': '/dev/disk4' }] },
        { 'image-path': `${target}.old`, 'system-entities': [{ 'mount-point': '/Volumes/Unrelated' }] },
      ] }) };
    },
  });

  assert.equal(plutilInput, plist);
  assert.deepEqual(mounts, ['/Volumes/Product']);
});

test('unmount detaches only mount points belonging to the exact DMG artifact', async () => {
  const calls = [];
  const target = '/tmp/Product.dmg';
  const runCommand = async (command, args) => {
    calls.push([command, ...args]);
    if (args[0] === 'info') return { stdout: 'plist' };
    return { stdout: '' };
  };
  await unmountExistingDmg(target, {
    runCommand,
    runCommandWithInput: async () => ({ stdout: JSON.stringify({ images: [
      { 'image-path': '/tmp/Other.dmg', 'system-entities': [{ 'mount-point': '/Volumes/Other' }] },
      { 'image-path': target, 'system-entities': [{ 'mount-point': '/Volumes/Product' }] },
    ] }) }),
  });
  assert.deepEqual(calls, [
    ['hdiutil', 'info', '-plist'],
    ['hdiutil', 'detach', '/Volumes/Product'],
  ]);
});

test('verification checks a read-only private mount and accepts only the expected layout', async (t) => {
  const { dmg, configPath } = await fixture(t, 'success');
  const calls = [];
  const runCommand = async (command, args) => {
    calls.push([command, ...args]);
    if (command === 'hdiutil' && args[0] === 'attach') {
      const mount = args[args.indexOf('-mountpoint') + 1];
      await mkdir(path.join(mount, 'Product.app'));
      await symlink('/Applications', path.join(mount, 'Applications'));
      await writeFile(path.join(mount, '.DS_Store'), 'allowed hidden metadata');
    }
    return { stdout: '' };
  };

  assert.equal(await verifyDmg(dmg, { runCommand, platform: 'darwin', configPath }), dmg);
  assert.deepEqual(calls.map((call) => call.slice(0, 2)), [
    ['hdiutil', 'verify'],
    ['hdiutil', 'attach'],
    ['hdiutil', 'detach'],
  ]);
  const attach = calls[1];
  for (const option of ['-readonly', '-nobrowse', '-noautoopen', '-private']) assert.ok(attach.includes(option));
});

test('verification rejects a volume icon and retains the mounted tree when detach fails', async (t) => {
  const { dmg, configPath } = await fixture(t, 'unsafe-cleanup');
  let temporary;
  const runCommand = async (command, args) => {
    if (command === 'hdiutil' && args[0] === 'attach') {
      const mount = args[args.indexOf('-mountpoint') + 1];
      await mkdir(path.join(mount, 'Product.app'));
      await symlink('/Applications', path.join(mount, 'Applications'));
      await writeFile(path.join(mount, '.VolumeIcon.icns'), 'forbidden');
    }
    if (command === 'hdiutil' && args[0] === 'detach') throw new Error('device busy');
    return { stdout: '' };
  };

  await assert.rejects(verifyDmg(dmg, {
    runCommand,
    platform: 'darwin',
    configPath,
    makeTemporaryDirectory: async (prefix) => {
      temporary = await mkdtemp(prefix);
      return temporary;
    },
  }), /forbidden \.VolumeIcon\.icns; failed to detach .*temporary mount retained.*device busy/);
  assert.ok((await readdir(temporary)).includes('mount'));
  await rm(temporary, { recursive: true, force: true });
});

test('verification retains the temporary tree when attach fails with unknown mount state', async (t) => {
  const { dmg, configPath } = await fixture(t, 'partial-attach');
  let temporary;
  await assert.rejects(verifyDmg(dmg, {
    platform: 'darwin',
    configPath,
    makeTemporaryDirectory: async (prefix) => {
      temporary = await mkdtemp(prefix);
      return temporary;
    },
    runCommand: async (command, args) => {
      if (command === 'hdiutil' && args[0] === 'attach') {
        const mount = args[args.indexOf('-mountpoint') + 1];
        await writeFile(path.join(mount, 'partial'), 'possibly mounted');
        throw new Error('attach returned nonzero');
      }
      return { stdout: '' };
    },
  }), /attach returned nonzero; attach did not complete; temporary mount retained at .*mount state is unknown/);
  assert.equal(await readFile(path.join(temporary, 'mount', 'partial'), 'utf8'), 'possibly mounted');
  await rm(temporary, { recursive: true, force: true });
});

test('verification rejects extra visible items', async (t) => {
  const { dmg, configPath } = await fixture(t, 'bad-layout');
  const populate = async (mount) => {
    await mkdir(path.join(mount, 'Product.app'));
    await symlink('/tmp/Applications', path.join(mount, 'Applications'));
    await writeFile(path.join(mount, 'README.txt'), 'extra');
  };
  await assert.rejects(verifyDmg(dmg, {
    platform: 'darwin',
    configPath,
    runCommand: async (command, args) => {
      if (command === 'hdiutil' && args[0] === 'attach') await populate(args[args.indexOf('-mountpoint') + 1]);
      return { stdout: '' };
    },
  }), /Expected exactly Product\.app and Applications.*README\.txt/);
});

test('verification requires an app directory and Applications symlink to /Applications', async (t) => {
  const { dmg, configPath } = await fixture(t, 'bad-types');
  const verifyWithLayout = (populate) => verifyDmg(dmg, {
    platform: 'darwin',
    configPath,
    runCommand: async (command, args) => {
      if (command === 'hdiutil' && args[0] === 'attach') await populate(args[args.indexOf('-mountpoint') + 1]);
      return { stdout: '' };
    },
  });

  await assert.rejects(verifyWithLayout(async (mount) => {
    await writeFile(path.join(mount, 'Product.app'), 'not a directory');
    await symlink('/Applications', path.join(mount, 'Applications'));
  }), /Product\.app is not a directory/);

  await assert.rejects(verifyWithLayout(async (mount) => {
    await mkdir(path.join(mount, 'Product.app'));
    await symlink('/tmp/Applications', path.join(mount, 'Applications'));
  }), /Applications symlink points to \/tmp\/Applications, expected \/Applications/);
});

test('CLI unmount mode is a no-op for a clean build without an output DMG', async () => {
  let unmounted = false;
  const result = await runCli(['--unmount-existing'], {
    resolvePath: async () => { throw new Error('DMG output directory does not exist: /tmp/output'); },
    unmount: async () => { unmounted = true; },
  });
  assert.deepEqual(result, { action: 'unmount', dmg: null, mountPoints: [] });
  assert.equal(unmounted, false);
});

test('CLI unmount mode leaves stale old-version artifacts untouched when no current DMG exists', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'verify-dmg-stale-output-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const configPath = path.join(root, 'tauri.conf.json');
  const output = path.join(root, 'target', 'release', 'bundle', 'dmg');
  const stale = path.join(output, 'Product_0.9.0_aarch64.dmg');
  await mkdir(output, { recursive: true });
  await writeFile(configPath, JSON.stringify({ productName: 'Product', version: '1.0.0' }));
  await writeFile(stale, 'stale image');
  let unmounted = false;
  const result = await runCli(['--unmount-existing'], {
    resolvePath: ({ argument }) => resolveDmgPath({ argument, configPath }),
    unmount: async () => { unmounted = true; },
  });
  assert.deepEqual(result, { action: 'unmount', dmg: null, mountPoints: [] });
  assert.equal(unmounted, false);
  assert.equal((await readdir(output)).includes(path.basename(stale)), true);
});

test('CLI open verifies before unmounting the same artifact and opening it', async () => {
  const dmg = '/tmp/Product.dmg';
  const events = [];
  const result = await runCli(['--open', dmg], {
    resolvePath: async ({ argument }) => {
      assert.equal(argument, dmg);
      return dmg;
    },
    verify: async (artifact) => events.push(['verify', artifact]),
    unmount: async (artifact) => {
      events.push(['unmount', artifact]);
      return ['/Volumes/Product'];
    },
    runCommand: async (command, args) => events.push([command, ...args]),
  });
  assert.deepEqual(events, [
    ['verify', dmg],
    ['unmount', dmg],
    ['open', dmg],
  ]);
  assert.deepEqual(result, { action: 'open', dmg, mountPoints: ['/Volumes/Product'] });
});
