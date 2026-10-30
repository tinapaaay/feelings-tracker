import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { Script } from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { createApplication } from '../server/app.mjs';

const directory = mkdtempSync(join(tmpdir(), 'feelings-backend-'));
const dbPath = join(directory, 'test.sqlite');
const origin = 'http://localhost:3000';
let app, base, alice, bob, memory;
const photo = { name: 'tiny.png', data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP1sAAAAASUVORK5CYII=' };
const entry = changes => ({ date: '2026-01-15T12:00:00.000Z', feelings: ['Joy'], note: 'A private happy moment.', images: [photo], ...changes });
async function start() {
  app = createApplication({ dbPath, origin }); app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  base = `http://127.0.0.1:${app.server.address().port}`;
}
async function stop() { await new Promise(resolve => app.server.close(resolve)); app.close(); }
async function call(path, { method = 'GET', value, actor, headers = {} } = {}) {
  const response = await fetch(base + path, { method, headers: { Origin: origin, ...(value !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(actor ? { Cookie: actor.cookie, 'X-CSRF-Token': actor.csrfToken } : {}), ...headers }, ...(value !== undefined ? { body: JSON.stringify(value) } : {}) });
  return { response, data: (response.headers.get('content-type') || '').includes('json') ? await response.json() : Buffer.from(await response.arrayBuffer()) };
}
async function register(email) {
  const result = await call('/api/auth/register', { method: 'POST', value: { email, password: 'twelve-plus-secret-words' } });
  assert.equal(result.response.status, 201, JSON.stringify(result.data));
  return { ...result.data, cookie: result.response.headers.get('set-cookie').split(';')[0] };
}
before(async () => { await start(); alice = await register('alice@example.test'); bob = await register('bob@example.test'); });
after(async () => { await stop(); rmSync(directory, { recursive: true, force: true }); });

test('frontend and backend scripts parse; static routes hide project internals', async () => {
  new Script(readFileSync(new URL('../index.html', import.meta.url), 'utf8').split('<script>')[1].split('</script>')[0]);
  new Script(readFileSync(new URL('../backend.js', import.meta.url), 'utf8'));
  assert.equal((await call('/')).response.status, 200);
  assert.equal((await call('/backend.js')).response.status, 200);
  for (const path of ['/server/app.mjs', '/.env', '/data/feelings.sqlite', '/assets/../server/app.mjs']) assert.equal((await call(path)).response.status, 404);
});
test('anonymous users cannot read or write account memories', async () => {
  assert.equal((await call('/api/auth/me')).data.user, null);
  assert.equal((await call('/api/memories')).response.status, 401);
  assert.equal((await call('/api/memories', { method: 'POST', value: entry() })).response.status, 401);
});
test('session cookie is HTTP-only and same-site; login rejects wrong passwords', async () => {
  const bad = await call('/api/auth/login', { method: 'POST', value: { email: 'alice@example.test', password: 'incorrect' } });
  assert.equal(bad.response.status, 401);
  const good = await call('/api/auth/login', { method: 'POST', value: { email: ' ALICE@example.test ', password: 'twelve-plus-secret-words' } });
  assert.equal(good.response.status, 200); assert.match(good.response.headers.get('set-cookie'), /HttpOnly/); assert.match(good.response.headers.get('set-cookie'), /SameSite=Strict/);
  assert.equal((await call('/api/auth/me', { actor: alice })).data.user.email, 'alice@example.test');
});
test('memory and photo are saved atomically with a private image URL', async () => {
  const created = await call('/api/memories', { method: 'POST', actor: alice, value: entry() });
  assert.equal(created.response.status, 201, JSON.stringify(created.data)); memory = created.data;
  assert.equal(memory.note, entry().note); assert.equal(memory.images.length, 1); assert.match(memory.images[0].data, /^\/api\/memories\//);
  const picture = await call(memory.images[0].data, { actor: alice });
  assert.equal(picture.response.status, 200); assert.equal(picture.response.headers.get('content-type'), 'image/png'); assert.match(picture.response.headers.get('cache-control'), /no-store/);
  assert.deepEqual(picture.data, Buffer.from(photo.data.split(',')[1], 'base64'));
});
test('another account cannot read, edit, delete, or download someone else’s memory', async () => {
  assert.deepEqual((await call('/api/memories', { actor: bob })).data.memories, []);
  for (const method of ['GET', 'PATCH', 'DELETE']) assert.equal((await call(`/api/memories/${memory.id}`, { method, actor: bob, ...(method === 'PATCH' ? { value: entry() } : {}) })).response.status, 404);
  assert.equal((await call(memory.images[0].data, { actor: bob })).response.status, 404);
  assert.equal((await call(memory.images[0].data)).response.status, 401);
});
test('emotion insights respect account ownership, date ranges and local time zones', async()=>{
  const query='/api/insights?from=2026-01-01T00:00:00Z&to=2026-02-01T00:00:00Z&timeZone=Asia%2FManila';
  const summary=await call(query,{actor:alice});assert.equal(summary.response.status,200);assert.equal(summary.data.totalMemories,1);assert.equal(summary.data.emotions.Joy,1);assert.equal(summary.data.days[0].date,'2026-01-15');
  assert.equal((await call(query,{actor:bob})).data.totalMemories,0);
  assert.equal((await call(query)).response.status,401);
  assert.equal((await call('/api/insights?timeZone=invalid',{actor:alice})).response.status,400);
});
test('cross-site requests and missing CSRF tokens cannot modify data', async () => {
  assert.equal((await call('/api/memories', { method: 'POST', actor: alice, value: entry(), headers: { Origin: 'https://attacker.invalid' } })).response.status, 403);
  assert.equal((await call('/api/memories', { method: 'POST', actor: alice, value: entry(), headers: { 'X-CSRF-Token': '' } })).response.status, 403);
  assert.equal((await call('/api/auth/login', { method: 'POST', value: {}, headers: { Origin: 'null' } })).response.status, 403);
});
test('input validation rejects bad emotions, oversized notes and disguised images', async () => {
  for (const value of [entry({ feelings: ['Unknown'] }), entry({ feelings: ['Joy', 'Anger'] }), entry({ note: 'x'.repeat(4001) }), entry({ date: 'not-a-date' }), entry({ images: [{ name: 'fake.png', data: 'data:image/png;base64,PHNjcmlwdD4=' }] }), entry({ images: Array(5).fill(photo) })]) {
    assert.equal((await call('/api/memories', { method: 'POST', actor: alice, value })).response.status, 400);
  }
  const response = await fetch(base + '/api/memories', { method: 'POST', headers: { Origin: origin, Cookie: alice.cookie, 'X-CSRF-Token': alice.csrfToken, 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(response.status, 400);
  assert.equal((await call('/api/memories', { method: 'POST', actor: alice, value: entry(), headers: { 'Content-Type': 'text/plain' } })).response.status, 415);
});
test('editing preserves date and retained photos; photos cannot be attached across memories', async () => {
  const edited = await call(`/api/memories/${memory.id}`, { method: 'PATCH', actor: alice, value: entry({ note: 'Updated reflection.', images: memory.images, feelings: ['Fear'], date: '2025-01-01' }) });
  assert.equal(edited.response.status, 200, JSON.stringify(edited.data));
  assert.equal(edited.data.memory.date, memory.date); assert.equal(edited.data.memory.images[0].id, memory.images[0].id);
  const other = await call('/api/memories', { method: 'POST', actor: alice, value: entry({ images: [] }) });
  assert.equal((await call(`/api/memories/${other.data.id}`, { method: 'PATCH', actor: alice, value: entry({ images: memory.images }) })).response.status, 400);
});
test('legacy imports are idempotent, support mixed emotions, and roll back invalid batches', async () => {
  const legacy = entry({ id: 123456, feelings: ['Anxiety', 'Ennui'], note: 'Old browser memory.' });
  const imported = await call('/api/memories/import', { method: 'POST', actor: alice, value: { memories: [legacy] } });
  assert.deepEqual(imported.data, { imported: 1, skipped: 0 });
  assert.deepEqual((await call('/api/memories/import', { method: 'POST', actor: alice, value: { memories: [legacy] } })).data, { imported: 0, skipped: 1 });
  const before = (await call('/api/memories', { actor: alice })).data.memories.length;
  assert.equal((await call('/api/memories/import', { method: 'POST', actor: alice, value: { memories: [entry({ note: 'must roll back' }), entry({ feelings: ['bad'] })] } })).response.status, 400);
  assert.equal((await call('/api/memories', { actor: alice })).data.memories.length, before);
});
test('pagination is bounded, stable and rejects invalid cursors', async () => {
  const first=await call('/api/memories?limit=1',{actor:alice});
  assert.equal(first.response.status,200);assert.equal(first.data.memories.length,1);assert(first.data.nextCursor);
  const next=await call('/api/memories?limit=1&cursor='+encodeURIComponent(first.data.nextCursor),{actor:alice});
  assert.equal(next.response.status,200);assert.notEqual(next.data.memories[0].id,first.data.memories[0].id);
  assert.equal((await call('/api/memories?limit=201',{actor:alice})).response.status,400);
  assert.equal((await call('/api/memories?cursor=invalid',{actor:alice})).response.status,400);
});
test('export includes original image bytes and can be restored into another account', async () => {
  const backup = await call('/api/memories/export', { actor: alice });
  assert.equal(backup.data.version, 1); assert(backup.data.memories.some(m => m.images[0]?.data === photo.data));
  const restored = await call('/api/memories/import', { method: 'POST', actor: bob, value: { memories: backup.data.memories } });
  assert.equal(restored.response.status, 200, JSON.stringify(restored.data)); assert.equal(restored.data.imported, backup.data.memories.length);
});
test('memories, photos and login sessions survive a server restart', async () => {
  await stop(); await start();
  assert.equal((await call(`/api/memories/${memory.id}`, { actor: alice })).response.status, 200);
  assert.equal((await call(memory.images[0].data, { actor: alice })).response.status, 200);
});
test('passwords and session tokens are hashed, and expired sessions stop working', async () => {
  const login=await call('/api/auth/login',{method:'POST',value:{email:'alice@example.test',password:'twelve-plus-secret-words'}});
  const cookie=login.response.headers.get('set-cookie').split(';')[0],token=cookie.split('=')[1];
  const actor={cookie,csrfToken:login.data.csrfToken};
  assert.equal((await call('/api/memories',{actor})).response.status,200);
  const inspect=new DatabaseSync(dbPath);
  try{
    const row=inspect.prepare('SELECT password_hash FROM users WHERE id=?').get(alice.user.id);
    assert(!row.password_hash.includes('twelve-plus-secret-words'));assert.match(row.password_hash,/^[a-f0-9]{32}:[a-f0-9]{128}$/);
    const digest=createHash('sha256').update(token).digest('hex');
    assert(inspect.prepare('SELECT token_hash FROM sessions WHERE token_hash=?').get(digest));
    assert(!inspect.prepare('SELECT token_hash FROM sessions WHERE token_hash=?').get(token));
    inspect.prepare('UPDATE sessions SET expires_at=0 WHERE token_hash=?').run(digest);
  }finally{inspect.close()}
  assert.equal((await call('/api/memories',{actor})).response.status,401);
});
test('deleting a memory also removes its attachments', async () => {
  assert.equal((await call(`/api/memories/${memory.id}`, { method: 'DELETE', actor: alice })).response.status, 200);
  assert.equal((await call(memory.images[0].data, { actor: alice })).response.status, 404);
});
test('logout invalidates the session on the server', async () => {
  assert.equal((await call('/api/auth/logout', { method: 'POST', actor: bob })).response.status, 200);
  assert.equal((await call('/api/memories', { actor: bob })).response.status, 401);
});
test('account deletion removes all account resources', async () => {
  const remaining = (await call('/api/memories', { actor: alice })).data.memories;
  assert.equal((await call('/api/account', { method: 'DELETE', actor: alice })).response.status, 200);
  assert.equal((await call('/api/memories', { actor: alice })).response.status, 401);
  const login = await call('/api/auth/login', { method: 'POST', value: { email: 'alice@example.test', password: 'twelve-plus-secret-words' } });
  assert.equal(login.response.status, 401);
  assert(remaining.length > 0);
});
test('invalid credentials are rate limited', async () => {
  let status;
  for (let i = 0; i < 20; i++) status = (await call('/api/auth/login', { method: 'POST', value: { email: 'nobody@example.test', password: 'incorrect' } })).response.status;
  assert.equal(status, 429);
});
