import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync, statSync, createReadStream, chmodSync } from 'node:fs';
import { dirname, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const scrypt = promisify(scryptCallback);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EMOTIONS = new Set(['Joy', 'Sadness', 'Anger', 'Fear', 'Disgust', 'Anxiety', 'Envy', 'Embarrassment', 'Ennui']);
const MAX_IMAGES = 4, MAX_IMAGE_BYTES = 2 * 1024 * 1024, BODY_LIMIT = 8 * 1024 * 1024;
const MAX_ACCOUNT_BYTES = 100 * 1024 * 1024, MAX_MEMORIES = 10000, SESSION_MS = 7 * 86400000;
const hash = value => createHash('sha256').update(value).digest('hex');
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new HttpError(status, message); };
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const json = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };

async function body(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) fail(415, 'Send application/json.');
  if (Number(req.headers['content-length']) > BODY_LIMIT) fail(413, 'Request is too large.');
  const bytes = await new Promise((resolve, reject) => {
    const chunks = []; let size = 0, over = false;
    req.on('data', chunk => { size += chunk.length; if (size > BODY_LIMIT) { if (!over) reject(new HttpError(413, 'Request is too large.')); over = true; chunks.length = 0; } else if (!over) chunks.push(chunk); });
    req.on('end', () => { if (!over) resolve(Buffer.concat(chunks)); });
    req.on('error', reject); req.on('aborted', () => reject(new HttpError(400, 'Request interrupted.')));
  });
  let value; try { value = JSON.parse(bytes.toString('utf8')); } catch { fail(400, 'Invalid JSON.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'Expected a JSON object.');
  return value;
}
async function passwordHash(password, salt = randomBytes(16).toString('hex')) {
  const key = await scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `${salt}:${key.toString('hex')}`;
}
function credentials(input, registering) {
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Enter a valid email address.');
  if (typeof input.password !== 'string' || input.password.length < (registering ? 12 : 1) || input.password.length > 128) fail(400, registering ? 'Use a password with 12–128 characters.' : 'Invalid email or password.');
  return { email, password: input.password };
}
function imageData(photo) {
  if (!photo || typeof photo !== 'object' || typeof photo.data !== 'string') fail(400, 'Invalid image.');
  const match = photo.data.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match || match[2].length % 4 !== 0) fail(400, 'Images must be PNG, JPEG, WebP, or GIF.');
  const bytes = Buffer.from(match[2], 'base64'), type = match[1];
  const valid = type === 'image/png' ? bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) && bytes.toString('ascii', 12, 16) === 'IHDR'
    : type === 'image/jpeg' ? bytes.length > 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : type === 'image/webp' ? bytes.length > 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
    : bytes.length > 10 && ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6));
  if (!valid || !bytes.length || bytes.length > MAX_IMAGE_BYTES) fail(400, 'Image contents do not match its type, or the image exceeds 2 MB.');
  return { id: randomUUID(), name: typeof photo.name === 'string' ? photo.name.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 160) || 'Photo' : 'Photo', type, bytes, size: bytes.length };
}

export function createApplication({ dbPath = ':memory:', origin = 'http://localhost:3000', secureCookies = false, root = ROOT } = {}) {
  const expectedOrigin = new URL(origin).origin;
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(dbPath || ':memory:');
  if(dbPath !== ':memory:') chmodSync(dbPath, 0o600);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,csrf TEXT NOT NULL,expires_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
    CREATE TABLE IF NOT EXISTS memories(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,date TEXT NOT NULL,feelings TEXT NOT NULL,note TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,source_key TEXT,UNIQUE(user_id,source_key));
    CREATE INDEX IF NOT EXISTS memories_user_date ON memories(user_id,date DESC);
    CREATE TABLE IF NOT EXISTS images(id TEXT PRIMARY KEY,memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,name TEXT NOT NULL,type TEXT NOT NULL,bytes BLOB NOT NULL,size INTEGER NOT NULL,position INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS images_memory ON images(memory_id,position);
    CREATE TABLE IF NOT EXISTS rate_limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,expires_at INTEGER NOT NULL);
    PRAGMA user_version=1;`);
  const get = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const transaction = fn => { db.exec('BEGIN IMMEDIATE'); try { const value = fn(); db.exec('COMMIT'); return value; } catch (e) { db.exec('ROLLBACK'); throw e; } };
  function cleanup() { const now = Date.now(); run('DELETE FROM sessions WHERE expires_at<=?', now); run('DELETE FROM rate_limits WHERE expires_at<=?', now); }
  cleanup(); const cleanupTimer = setInterval(cleanup, 3600000); cleanupTimer.unref();
  function rate(key, max, period) {
    const now = Date.now(), row = get('SELECT * FROM rate_limits WHERE key=?', key);
    if (row && row.expires_at > now && row.count >= max) fail(429, 'Too many attempts. Please try again later.');
    run('INSERT INTO rate_limits VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET count=excluded.count,expires_at=excluded.expires_at', key, row && row.expires_at > now ? row.count + 1 : 1, row && row.expires_at > now ? row.expires_at : now + period);
  }
  function cookie(res, token, clear = false) {
    res.setHeader('Set-Cookie', `feelings_session=${clear ? '' : token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : SESSION_MS / 1000}${secureCookies ? '; Secure' : ''}`);
  }
  function session(req, required = true) {
    const token = (req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith('feelings_session='))?.slice(17);
    const row = token && /^[a-f0-9]{64}$/.test(token) ? get('SELECT s.*,u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?', hash(token), Date.now()) : null;
    if (!row && required) fail(401, 'Sign in to access your journal.');
    return row;
  }
  function authorize(req) {
    const s = session(req);
    if (!equal(req.headers['x-csrf-token'], s.csrf)) fail(403, 'Your session needs refreshing. Reload and try again.');
    return s;
  }
  function startSession(req, res, user) {
    const previous = session(req, false); if (previous) run('DELETE FROM sessions WHERE token_hash=?', previous.token_hash);
    const token = randomBytes(32).toString('hex'), csrf = randomBytes(32).toString('hex');
    run('INSERT INTO sessions VALUES(?,?,?,?)', hash(token), user.id, csrf, Date.now() + SESSION_MS); cookie(res, token);
    return { user: { id: user.id, email: user.email }, csrfToken: csrf };
  }
  const owned = (user, id) => get('SELECT * FROM memories WHERE id=? AND user_id=?', id, user) || fail(404, 'Memory not found.');
  function serialize(memory, fullImages = false) {
    return { id: memory.id, date: memory.date, feelings: JSON.parse(memory.feelings), note: memory.note,
      createdAt: memory.created_at, updatedAt: memory.updated_at,
      images: all(`SELECT ${fullImages ? '*' : 'id,name,type,size'} FROM images WHERE memory_id=? ORDER BY position`, memory.id).map(image => ({ id: image.id, name: image.name, type: image.type, size: image.size,
        data: fullImages ? `data:${image.type};base64,${Buffer.from(image.bytes).toString('base64')}` : `/api/memories/${memory.id}/images/${image.id}` })) };
  }
  function validateMemory(input, user, existing, importing = false) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, 'Invalid memory.');
    if (!Array.isArray(input.feelings) || input.feelings.length < 1 || input.feelings.length > (importing ? 9 : 1) || input.feelings.some(e => !EMOTIONS.has(e)) || new Set(input.feelings).size !== input.feelings.length) fail(400, 'Choose a valid emotion.');
    if (typeof input.note !== 'string' || input.note.length > 4000) fail(400, 'Notes must be at most 4,000 characters.');
    const date = existing?.date || input.date || new Date().toISOString();
    if (typeof date !== 'string' || !Number.isFinite(Date.parse(date)) || Date.parse(date) > Date.now() + 300000) fail(400, 'Enter a valid memory date.');
    if (!Array.isArray(input.images) || input.images.length > MAX_IMAGES) fail(400, 'Attach up to four images.');
    const retained = existing ? all('SELECT * FROM images WHERE memory_id=?', existing.id) : [];
    const images = input.images.map(photo => {
      if (photo?.id && existing) { const match = retained.find(image => image.id === photo.id); if (!match) fail(400, 'Image does not belong to this memory.'); return match; }
      return imageData(photo);
    });
    if (new Set(images.map(i => i.id)).size !== images.length) fail(400, 'Duplicate image.');
    const size = images.reduce((n, i) => n + i.size, 0);
    if (size > MAX_IMAGE_BYTES) fail(400, 'Images must total 2 MB or less.');
    const usage = get('SELECT COALESCE(SUM(i.size),0) size FROM images i JOIN memories m ON m.id=i.memory_id WHERE m.user_id=? AND m.id<>?', user, existing?.id || '').size;
    if (usage + size > MAX_ACCOUNT_BYTES) fail(413, 'Your photo storage is full. Export or remove older images.');
    if (!existing && get('SELECT COUNT(*) count FROM memories WHERE user_id=?', user).count >= MAX_MEMORIES) fail(413, 'Journal limit reached. Export or remove older memories.');
    return { date: new Date(date).toISOString(), feelings: input.feelings, note: input.note.trim(), images };
  }
  function writeMemory(user, value, existing, sourceKey = null) {
    const now = new Date().toISOString(), id = existing?.id || randomUUID();
    if (existing) { run('UPDATE memories SET feelings=?,note=?,updated_at=? WHERE id=?', JSON.stringify(value.feelings), value.note, now, id); run('DELETE FROM images WHERE memory_id=?', id); }
    else run('INSERT INTO memories VALUES(?,?,?,?,?,?,?,?)', id, user, value.date, JSON.stringify(value.feelings), value.note, now, now, sourceKey);
    value.images.forEach((image, position) => run('INSERT INTO images VALUES(?,?,?,?,?,?,?)', image.id, id, image.name, image.type, image.bytes, image.size, position));
    return serialize(owned(user, id));
  }
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin'); res.setHeader('Cross-Origin-Resource-Policy','same-origin'); res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    if (secureCookies) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    try {
      const url = new URL(req.url, expectedOrigin), path = url.pathname, method = req.method;
      if (path.startsWith('/api/')) {
        if (!['GET', 'HEAD'].includes(method) && req.headers.origin !== expectedOrigin) fail(403, 'Request origin is not allowed.');
        if (method === 'GET' && path === '/api/health') return json(res, 200, { ok: true });
        if (method === 'GET' && path === '/api/auth/me') { const s = session(req, false); return json(res, 200, s ? { user: { id: s.user_id, email: s.email }, csrfToken: s.csrf } : { user: null }); }
        if (method === 'POST' && ['/api/auth/register', '/api/auth/login'].includes(path)) {
          const register = path.endsWith('register'), ip = req.socket.remoteAddress || 'unknown';
          rate(`auth:${ip}`, 30, 900000); if (register) rate(`register:${ip}`, 8, 3600000);
          const input = credentials(await body(req), register);
          rate(`email:${hash(input.email)}`, 15, 900000);
          if (register) {
            const hashed = await passwordHash(input.password);
            const user = { id: randomUUID(), email: input.email };
            try { run('INSERT INTO users VALUES(?,?,?,?)', user.id, user.email, hashed, new Date().toISOString()); } catch (e) { if (String(e.message).includes('UNIQUE')) fail(409, 'An account with this email already exists.'); throw e; }
            return json(res, 201, startSession(req, res, user));
          }
          const user = get('SELECT * FROM users WHERE email=?', input.email);
          const saved = user?.password_hash || '00000000000000000000000000000000:' + '0'.repeat(128);
          const computed = await passwordHash(input.password, saved.split(':')[0]);
          if (!user || !equal(computed, saved)) fail(401, 'Invalid email or password.');
          return json(res, 200, startSession(req, res, user));
        }
        if (method === 'POST' && path === '/api/auth/logout') { const s = authorize(req); run('DELETE FROM sessions WHERE token_hash=?', s.token_hash); cookie(res, '', true); return json(res, 200, { ok: true }); }
        if (method === 'DELETE' && path === '/api/account') { const s = authorize(req); transaction(() => run('DELETE FROM users WHERE id=?', s.user_id)); cookie(res, '', true); return json(res, 200, { ok: true }); }
        if(method==='GET' && path==='/api/insights'){
          const s=session(req),to=url.searchParams.get('to')||new Date().toISOString(),from=url.searchParams.get('from')||new Date(Date.now()-30*86400000).toISOString(),timeZone=url.searchParams.get('timeZone')||'UTC';
          const start=Date.parse(from),end=Date.parse(to);
          if(!Number.isFinite(start)||!Number.isFinite(end)||start>=end||end-start>366*86400000)fail(400,'Choose a valid date range of up to 366 days.');
          let formatter;try{formatter=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'})}catch{fail(400,'Choose a valid time zone.');}
          const rows=all('SELECT date,feelings FROM memories WHERE user_id=? AND date>=? AND date<? ORDER BY date',s.user_id,new Date(start).toISOString(),new Date(end).toISOString());
          const counts=Object.fromEntries([...EMOTIONS].map(e=>[e,0])),days=new Map();
          for(const row of rows){const day=formatter.format(new Date(row.date));if(!days.has(day))days.set(day,{date:day,totalMemories:0,emotions:{...Object.fromEntries([...EMOTIONS].map(e=>[e,0]))}});const daily=days.get(day);daily.totalMemories++;for(const feeling of JSON.parse(row.feelings)){counts[feeling]++;daily.emotions[feeling]++;}}
          return json(res,200,{from:new Date(start).toISOString(),to:new Date(end).toISOString(),timeZone,totalMemories:rows.length,emotions:counts,days:[...days.values()]});
        }
        if (method === 'GET' && path === '/api/memories/export') {
          const s = session(req); res.setHeader('Content-Disposition', 'attachment; filename="little-feelings-backup.json"');
          return json(res, 200, { version: 1, exportedAt: new Date().toISOString(), memories: all('SELECT * FROM memories WHERE user_id=? ORDER BY date DESC,created_at DESC', s.user_id).map(m => serialize(m, true)) });
        }
        if (method === 'POST' && path === '/api/memories/import') {
          const s = authorize(req), input = await body(req);
          if (!Array.isArray(input.memories) || input.memories.length < 1 || input.memories.length > 25) fail(400, 'Import 1–25 memories at a time.');
          const result = transaction(() => {
            let imported = 0, skipped = 0;
            for (const memory of input.memories) {
              const key = hash(JSON.stringify(memory));
              if (get('SELECT id FROM memories WHERE user_id=? AND source_key=?', s.user_id, key)) { skipped++; continue; }
              writeMemory(s.user_id, validateMemory(memory, s.user_id, null, true), null, key); imported++;
            }
            return { imported, skipped };
          }); return json(res, 200, result);
        }
        if (path === '/api/memories') {
          if (method === 'GET') {
            const s = session(req), limit = Number(url.searchParams.get('limit') || 100);
            if(!Number.isInteger(limit) || limit < 1 || limit > 200) fail(400, 'Limit must be 1–200.');
            let cursor;
            if(url.searchParams.has('cursor')) {
              try { cursor=JSON.parse(Buffer.from(url.searchParams.get('cursor'),'base64url').toString()); } catch { fail(400,'Invalid cursor.'); }
              if(!cursor || typeof cursor.date!=='string' || !Number.isFinite(Date.parse(cursor.date)) || typeof cursor.id!=='string' || !/^[a-f0-9-]{36}$/.test(cursor.id)) fail(400,'Invalid cursor.');
            }
            const rows=cursor ? all('SELECT * FROM memories WHERE user_id=? AND (date<? OR (date=? AND id<?)) ORDER BY date DESC,id DESC LIMIT ?',s.user_id,cursor.date,cursor.date,cursor.id,limit+1)
              : all('SELECT * FROM memories WHERE user_id=? ORDER BY date DESC,id DESC LIMIT ?',s.user_id,limit+1);
            const hasMore=rows.length>limit, page=rows.slice(0,limit), last=page.at(-1);
            return json(res,200,{memories:page.map(m=>serialize(m)),nextCursor:hasMore?Buffer.from(JSON.stringify({date:last.date,id:last.id})).toString('base64url'):null});
          }
          if (method === 'POST') { const s = authorize(req), input = await body(req); return json(res, 201, transaction(() => writeMemory(s.user_id, validateMemory(input, s.user_id)))); }
        }
        const imageRoute = path.match(/^\/api\/memories\/([a-f0-9-]{36})\/images\/([a-f0-9-]{36})$/);
        if (imageRoute && method === 'GET') {
          const s = session(req); owned(s.user_id, imageRoute[1]);
          const image = get('SELECT * FROM images WHERE id=? AND memory_id=?', imageRoute[2], imageRoute[1]) || fail(404, 'Image not found.');
          res.writeHead(200, { 'Content-Type': image.type, 'Content-Length': image.size, 'Content-Disposition': 'inline', 'Content-Security-Policy': "default-src 'none'; sandbox" }); return res.end(Buffer.from(image.bytes));
        }
        const memoryRoute = path.match(/^\/api\/memories\/([a-f0-9-]{36})$/);
        if (memoryRoute) {
          const s = method === 'GET' ? session(req) : authorize(req), current = owned(s.user_id, memoryRoute[1]);
          if (method === 'GET') return json(res, 200, { memory: serialize(current) });
          if (method === 'PATCH') { const input = await body(req); return json(res, 200, { memory: transaction(() => writeMemory(s.user_id, validateMemory(input, s.user_id, current), current)) }); }
          if (method === 'DELETE') { run('DELETE FROM memories WHERE id=?', current.id); return json(res, 200, { ok: true }); }
        }
        fail(404, 'API endpoint not found.');
      }
      if (!['GET', 'HEAD'].includes(method)) fail(405, 'Method not allowed.');
      let name; try { name = decodeURIComponent(path); } catch { fail(400, 'Invalid path.'); }
      if (name === '/') name = '/index.html';
      if (!(name === '/index.html' || name === '/backend.js' || name.startsWith('/assets/')) || name.split('/').some(part => part.startsWith('.'))) fail(404, 'Not found.');
      const file = resolve(root, '.' + name); if (!file.startsWith(root + sep)) fail(404, 'Not found.');
      const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
      const type = types[extname(file)]; if (!type) fail(404, 'Not found.');
      let stat; try { stat = statSync(file); } catch { fail(404, 'Not found.'); } if (!stat.isFile()) fail(404, 'Not found.');
      if (name.startsWith('/assets/')) res.setHeader('Cache-Control', 'public, max-age=86400');
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': stat.size });
      if (method === 'HEAD') return res.end();
      createReadStream(file).on('error', () => res.destroy()).pipe(res);
    } catch (error) {
      if (res.headersSent) return res.destroy();
      if (!error.status) console.error('Request failed:', error.message);
      if (error.status === 429) res.setHeader('Retry-After', '900');
      json(res, error.status || 500, { error: error.status ? error.message : 'Something went wrong. Please try again.' });
    }
  });
  server.requestTimeout = 20000; server.headersTimeout = 10000;
  return { server, close() { clearInterval(cleanupTimer); db.close(); } };
}
