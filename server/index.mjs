import { resolve } from 'node:path';
import { createApplication } from './app.mjs';

const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be 1–65535.');
const origin = process.env.PUBLIC_ORIGIN || `http://localhost:${port}`;
if (process.env.NODE_ENV === 'production' && !process.env.PUBLIC_ORIGIN?.startsWith('https://')) {
  throw new Error('Production requires PUBLIC_ORIGIN with HTTPS.');
}
const app = createApplication({ dbPath: resolve(process.env.DATA_DIR || 'data', 'feelings.sqlite'), origin,
  secureCookies: process.env.NODE_ENV === 'production' });
app.server.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`Little feelings: ${origin}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  app.server.close(() => { app.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 10000).unref();
});
