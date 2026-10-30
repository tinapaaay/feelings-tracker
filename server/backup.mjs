import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, chmodSync } from 'node:fs';
import { resolve, join } from 'node:path';

const directory = resolve(process.env.DATA_DIR || 'data');
const database = join(directory, 'feelings.sqlite');
if (!existsSync(database)) throw new Error('No database exists yet. Start the server first.');
const backups = join(directory, 'backups');
mkdirSync(backups, { recursive: true, mode: 0o700 });
const destination = join(backups, `feelings-${new Date().toISOString().replaceAll(':', '-')}.sqlite`);
const db = new DatabaseSync(database);
try { db.exec(`VACUUM INTO '${destination.replaceAll("'", "''")}'`); chmodSync(destination, 0o600); console.log(`Backup saved: ${destination}`); }
finally { db.close(); }
