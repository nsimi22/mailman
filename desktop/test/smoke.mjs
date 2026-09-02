#!/usr/bin/env node
/**
 * Launches the packaged-equivalent Electron app headlessly and drives its UI, then asserts
 * on what the renderer reported. Needs a built client (npm run build) and, on Linux, a
 * virtual display — xvfb-run is used automatically when DISPLAY is unset.
 *
 * Usage: npm run smoke -w desktop
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(here, '..');
const clientIndex = resolve(desktopDir, '../client/dist/index.html');
if (!existsSync(clientIndex)) {
  console.error('client/dist not found — run `npm run build` first.');
  process.exit(1);
}

const electron = resolve(desktopDir, '../node_modules/.bin/electron');
const tmp = mkdtempSync(join(tmpdir(), 'mailman-smoke-'));
const args = [electron, '--no-sandbox', '--disable-gpu', desktopDir];
const useXvfb = process.platform === 'linux' && !process.env.DISPLAY;
const [cmd, cmdArgs] = useXvfb ? ['xvfb-run', ['-a', ...args]] : [args[0], args.slice(1)];

const run = spawnSync(cmd, cmdArgs, {
  encoding: 'utf8',
  timeout: 120_000,
  env: {
    ...process.env,
    MAILMAN_DB: join(tmp, 'smoke.db'),
    MAILMAN_NO_UPDATES: '1',
    MAILMAN_SMOKE_SHOT: join(tmp, 'shot.png'),
    MAILMAN_SMOKE_EVAL: join(here, 'workspace-dialog.js'),
  },
});
rmSync(tmp, { recursive: true, force: true });

const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
const failed = output.split('\n').find((l) => l.startsWith('SMOKE-EVAL-ERROR '));
if (failed) {
  console.error(`The app reported: ${failed.slice('SMOKE-EVAL-ERROR '.length)}`);
  process.exit(1);
}
const line = output.split('\n').find((l) => l.startsWith('SMOKE-EVAL '));
if (!line) {
  console.error(output);
  console.error('\nThe renderer script did not report a result.');
  process.exit(1);
}

const result = JSON.parse(line.slice('SMOKE-EVAL '.length));
const failures = [];
const check = (name, ok, detail) => { if (!ok) failures.push(`${name}: ${detail}`); };

check('dialog opens', result.opened === true, 'the Workspace dialog did not render');
check('team-server fields appear', result.remoteFieldsShown === true, 'no Server URL field after selecting Team server');
check(
  'unreachable server reports an error',
  !!result.deadStatus && result.deadStatus !== 'Connecting…' && !/Connected/i.test(result.deadStatus),
  `status was ${JSON.stringify(result.deadStatus)} (it must settle on an error, not hang on "Connecting…")`,
);
check('Test button re-enables after a failure', result.deadTestEnabled === true, 'still disabled — the dialog is stuck');
check('Save button re-enables after a failure', result.deadSaveEnabled === true, 'still disabled — the dialog is stuck');
check('reachable server reports success', /Connected/i.test(result.liveStatus ?? ''), `status was ${JSON.stringify(result.liveStatus)}`);
check('Save button usable after a success', result.liveSaveEnabled === true, 'still disabled');
// The dialog hands its own Vue reactive settings to the bridge; unsnapshotted they blow up here.
check(
  'reactive settings survive the context bridge',
  !/could not be cloned/i.test(`${result.deadStatus} ${result.liveStatus}`),
  'the settings object reached the bridge as a Proxy',
);

if (failures.length) {
  console.error('Desktop smoke test FAILED:');
  for (const f of failures) console.error(`  ✗ ${f}`);
  console.error(`\nrenderer reported: ${JSON.stringify(result, null, 2)}`);
  process.exit(1);
}
console.log('Desktop smoke test passed:', JSON.stringify(result));
