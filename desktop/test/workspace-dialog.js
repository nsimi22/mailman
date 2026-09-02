/**
 * Runs inside the renderer (see MAILMAN_SMOKE_EVAL in src/main.js) and drives the real
 * Workspace dialog the way a person does.
 *
 * Regression cover for: the dialog passed Vue reactive refs (Proxies) straight to
 * `ipcRenderer.invoke`, which throws "An object could not be cloned." Both calls rejected,
 * `busy` was never cleared, and every button in the dialog stayed disabled forever.
 *
 * Returns a JSON summary; test/smoke.mjs asserts on it.
 */
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const q = (sel) => document.querySelector(sel);
  const byText = (sel, text) => [...document.querySelectorAll(sel)].find((el) => el.textContent.includes(text));
  const statusText = () => q('.workspace-status')?.textContent?.trim() ?? null;
  const out = {};

  q('.workspace').click();
  await sleep(300);
  out.opened = !!q('.modal');

  // switch to "Team server" (v-model on a radio listens for `change`)
  const remote = [...document.querySelectorAll('.radio-stack input[type=radio]')][1];
  remote.checked = true;
  remote.dispatchEvent(new Event('change'));
  await sleep(200);
  out.remoteFieldsShown = !!q('.modal input[placeholder^="https://mailman"]');

  const setUrl = async (value) => {
    const url = q('.modal input[placeholder^="https://mailman"]');
    url.value = value;
    url.dispatchEvent(new Event('input'));
    await sleep(150);
  };
  // Click "Test connection" and wait for the status to settle on something new.
  const clickTest = async () => {
    const before = statusText();
    byText('.modal button', 'Test connection').click();
    for (let i = 0; i < 100; i++) {
      await sleep(100);
      const now = statusText();
      if (now && now !== before && now !== 'Connecting…') return now;
    }
    return statusText() ?? '(no status after 10s)';
  };

  // 1. a server that is not listening: a real error, and the dialog stays usable
  // (a high port, not a low one — undici rejects blocked ports before it ever connects)
  await setUrl('http://127.0.0.1:45999');
  out.deadStatus = await clickTest();
  out.deadTestEnabled = !byText('.modal button', 'Test connection').disabled;
  out.deadSaveEnabled = !byText('.modal button', 'Save & reload').disabled;

  // 2. a real mailman server: this page is served by the app's own embedded one
  await setUrl(window.location.origin);
  out.liveStatus = await clickTest();
  out.liveSaveEnabled = !byText('.modal button', 'Save & reload').disabled;

  // Both statuses above came from passing the dialog's own reactive settings across the
  // context bridge, which is exactly what used to fail — so they cover the write path too
  // (setSettings snapshots the same object the same way). Saving is not exercised here
  // because it reloads the window out from under this script.
  return JSON.stringify(out);
})()
