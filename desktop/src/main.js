import { app, BrowserWindow, ipcMain, shell, Menu } from 'electron';
import express from 'express';
import { createServer } from 'node:http';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '@mailman/server/src/db.js';
import { createApp } from '@mailman/server/src/app.js';

const here = dirname(fileURLToPath(import.meta.url));
const isDev = !!process.env.MAILMAN_DEV_URL;

// ---- settings ----------------------------------------------------------------
const DEFAULT_SETTINGS = { mode: 'local', serverUrl: '', password: '' };
let settings = DEFAULT_SETTINGS;
const settingsPath = () => join(app.getPath('userData'), 'settings.json');
function loadSettings() {
  try { settings = { ...DEFAULT_SETTINGS, ...JSON.parse(readFileSync(settingsPath(), 'utf8')) }; } catch { settings = { ...DEFAULT_SETTINGS }; }
}
function saveSettings(next) {
  settings = { ...DEFAULT_SETTINGS, ...next };
  mkdirSync(dirname(settingsPath()), { recursive: true });
  writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
}
const normalizeUrl = (u) => String(u ?? '').trim().replace(/\/+$/, '');
const authHeader = (s) => (s.password ? { Authorization: `Basic ${Buffer.from(`mailman:${s.password}`).toString('base64')}` } : {});

// ---- embedded server ---------------------------------------------------------
// The window always talks to this local server. In "remote" mode it forwards
// /api/* to the team server (adding the team password), which keeps credentials
// out of the renderer and avoids CORS entirely.
let store;
async function startEmbeddedServer() {
  const dbPath = process.env.MAILMAN_DB || join(app.getPath('userData'), 'mailman.db');
  store = openDatabase(dbPath);
  const staticDir = resolveStaticDir();
  const local = createApp(store, { staticDir });

  const outer = express();
  outer.use('/api', async (req, res, next) => {
    if (settings.mode !== 'remote' || !settings.serverUrl) return next();
    try {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const upstream = await fetch(normalizeUrl(settings.serverUrl) + req.originalUrl, {
        method: req.method,
        headers: { ...(req.headers['content-type'] ? { 'Content-Type': req.headers['content-type'] } : {}), ...authHeader(settings) },
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : body,
        redirect: 'manual',
      });
      res.status(upstream.status);
      for (const h of ['content-type', 'content-disposition']) { const v = upstream.headers.get(h); if (v) res.set(h, v); }
      res.send(Buffer.from(await upstream.arrayBuffer()));
    } catch (err) {
      res.status(502).json({ error: `Team server unreachable: ${err?.cause?.message || err.message}` });
    }
  });
  outer.use(local);

  const server = createServer(outer);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

function resolveStaticDir() {
  const candidates = [
    join(process.resourcesPath ?? '', 'client'),  // packaged (extraResources)
    join(here, '../../client/dist'),               // repo checkout
  ];
  return candidates.find((p) => existsSync(join(p, 'index.html')));
}

async function testConnection(s) {
  const url = normalizeUrl(s.serverUrl);
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: 'Server URL must start with http:// or https://' };
  try {
    const res = await fetch(url + '/api/health', { headers: authHeader(s), signal: AbortSignal.timeout(8000) });
    if (res.status === 401) return { ok: false, error: 'The server rejected the password.' };
    if (!res.ok) return { ok: false, error: `Server answered ${res.status} ${res.statusText}` };
    const json = await res.json().catch(() => null);
    if (!json?.ok) return { ok: false, error: 'That URL does not look like a mailman server.' };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.cause?.message || err.message };
  }
}

// ---- window ------------------------------------------------------------------
let win;
function createWindow(url) {
  win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 900,
    minHeight: 560,
    backgroundColor: '#1e1f22',
    title: 'mailman',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadURL(url);
  // Headless smoke test hook: MAILMAN_SMOKE_SHOT=/path.png captures the window after load, then quits.
  if (process.env.MAILMAN_SMOKE_SHOT) {
    win.webContents.once('did-finish-load', async () => {
      await new Promise((r) => setTimeout(r, 1500));
      const image = await win.webContents.capturePage();
      writeFileSync(process.env.MAILMAN_SMOKE_SHOT, image.toPNG());
      const title = await win.webContents.executeJavaScript('document.querySelector(".brand")?.textContent + " | bridge:" + typeof window.mailman + " | ws:" + document.querySelector(".workspace")?.textContent');
      console.log('SMOKE', title);
      if (process.env.MAILMAN_SMOKE_REMOTE) {
        // exercise the team-server path: switch settings over IPC, then hit the proxied API
        const out = await win.webContents.executeJavaScript(`(async () => {
          const s = { mode: 'remote', serverUrl: ${JSON.stringify(process.env.MAILMAN_SMOKE_REMOTE)}, password: '' };
          const test = await window.mailman.testConnection(s);
          const set = await window.mailman.setSettings(s);
          const cols = await fetch('/api/collections').then((r) => r.json());
          await window.mailman.setSettings({ mode: 'local', serverUrl: '', password: '' });
          return JSON.stringify({ test, set, names: cols.map((c) => c.name) });
        })()`);
        console.log('SMOKE-REMOTE', out);
      }
      app.quit();
    });
  }
  win.webContents.setWindowOpenHandler(({ url: target }) => { shell.openExternal(target); return { action: 'deny' }; });
  win.on('closed', () => { win = null; });
}

function buildMenu() {
  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(async () => {
  loadSettings();
  buildMenu();
  ipcMain.handle('settings:get', () => ({ ...settings }));
  ipcMain.handle('settings:set', (_e, next) => {
    const s = { mode: next?.mode === 'remote' ? 'remote' : 'local', serverUrl: normalizeUrl(next?.serverUrl), password: String(next?.password ?? '') };
    if (s.mode === 'remote' && !/^https?:\/\//i.test(s.serverUrl)) return { ok: false, error: 'Server URL must start with http:// or https://' };
    saveSettings(s);
    return { ok: true };
  });
  ipcMain.handle('settings:test', (_e, s) => testConnection({ ...DEFAULT_SETTINGS, ...s }));

  const local = await startEmbeddedServer();
  createWindow(isDev ? process.env.MAILMAN_DEV_URL : local);
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(isDev ? process.env.MAILMAN_DEV_URL : local); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('will-quit', () => { try { store?.close(); } catch { /* ignore */ } });
