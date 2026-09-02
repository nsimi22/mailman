import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { openDatabase } from './db.js';
import { createApp } from './app.js';

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT) || 4000;
const host = process.env.HOST || '0.0.0.0';
const dbPath = process.env.MAILMAN_DB || resolve(here, '../../data/mailman.db');
const staticDir = process.env.MAILMAN_STATIC || resolve(here, '../../client/dist');
const password = process.env.MAILMAN_PASSWORD || '';
const requestTimeoutMs = Number(process.env.MAILMAN_TIMEOUT_MS) || 30_000;

const store = openDatabase(dbPath);
const app = createApp(store, { password, staticDir, requestTimeoutMs });

const server = app.listen(port, host, () => {
  console.log(`mailman listening on http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
  console.log(`database: ${dbPath}`);
  console.log(password ? 'auth: shared password enabled' : 'auth: OFF (set MAILMAN_PASSWORD to require a password)');
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close(() => { store.close(); process.exit(0); });
  });
}
