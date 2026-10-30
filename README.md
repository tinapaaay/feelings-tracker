# Little feelings

A private feelings journal inspired by Inside Out. Pick an emotion, write a reflection, attach photos, and watch the page become a memory orb on your shelves.

## Run locally

Requires **Node.js 22.13 or newer** (Node 24 is also supported). There are no third-party runtime dependencies.

```sh
npm start
```

Open **http://localhost:3000**. The SQLite database is created automatically in `data/feelings.sqlite`. Account memories, images, and sessions survive server restarts.

Opening `index.html` directly still supports a separate browser-only guest journal. Account features require the server; GitHub Pages alone cannot run this backend.

## Use your journal

- Choose **Sign in → Create an account** with an email and a password of at least 12 characters.
- Pick a character, write a note, optionally attach up to four PNG/JPEG/WebP/GIF images (2 MB combined), and save. The animation runs after the memory is safely stored.
- Open an orb to revisit it. **Edit memory** preserves its original date and retained photos; **Delete memory** removes the memory and photos after confirmation.
- **Download my memories** includes the notes and original photo data, so the file is a complete portable backup.
- In **Your account**, import memories from this browser or restore a JSON backup. Both the original array format and the versioned export format work. Imports skip identical entries when retried, and keep the source backup.
- Guest and account journals are separate. Sign-out clears the account view and returns to the guest journal. Account data is not copied into browser storage.
- **Delete my account and memories** removes the account, all its memories/photos, and active sessions. Export first if you want a copy.

Browser storage belongs to its original website address. To migrate from the old `file://` or port-4175 prototype, export there first, then restore that file from your new account.

## Configuration

Copy `.env.example` to `.env` if you want different defaults. `.env` and databases are ignored by Git.

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Listening address; use `0.0.0.0` in a container |
| `PORT` | `3000` | HTTP port |
| `DATA_DIR` | `./data` | Persistent database directory |
| `PUBLIC_ORIGIN` | `http://localhost:PORT` | Exact browser origin, including scheme and port |
| `NODE_ENV` | unset | Use `production` to require HTTPS and enable secure cookies |

Use the configured origin in the browser. For example, `http://127.0.0.1:3000` and `http://localhost:3000` are different origins. Requests that modify data must come from `PUBLIC_ORIGIN`.

## Deploy

Run one Node process behind an HTTPS reverse proxy, with a persistent writable directory for `DATA_DIR`. Set `PUBLIC_ORIGIN` to the site's exact HTTPS origin and `NODE_ENV=production`. Terminate TLS at the proxy; the Node process serves HTTP internally. The server does not trust client-supplied forwarding headers.

A container is included:

```sh
docker build -t little-feelings .
docker run -d --name little-feelings \
  -p 127.0.0.1:3000:3000 \
  -e PUBLIC_ORIGIN=https://feelings.example.com \
  -v feelings-data:/data \
  little-feelings
```

Replace the example origin and put your HTTPS reverse proxy in front of port 3000. `GET /api/health` is the health endpoint. SQLite needs a persistent disk: do not put this on a platform that discards the filesystem between requests or deployments. Multiple independent replicas are not supported by this SQLite deployment.

## Back up the server

```sh
npm run backup
```

This creates a consistent SQLite snapshot in `DATA_DIR/backups/` using `VACUUM INTO`, including image data and accounts even while the server is running. The database and backup files use owner-only permissions. Store backups on a separate protected disk or service as part of your deployment.

To restore a database snapshot: stop the app, preserve the current database as a fallback, replace `feelings.sqlite` with the snapshot, remove the old `-wal` and `-shm` sidecar files while the app is stopped, and restart. Each user's in-app JSON backup is an alternative that restores only their journal into an account.

## API

Requests use JSON. Authentication creates an HTTP-only, SameSite=Strict session cookie (Secure in production). `GET /api/auth/me` returns a CSRF token for the current session; send it as `X-CSRF-Token` with authenticated modifying requests. Every modifying API request must include the configured `Origin`.

| Method | Endpoint | Result |
| --- | --- | --- |
| POST | `/api/auth/register` | Register with `{email,password}` and start a session |
| POST | `/api/auth/login` | Sign in with `{email,password}` |
| GET | `/api/auth/me` | Current user and CSRF token, or `{user:null}` |
| POST | `/api/auth/logout` | Revoke the current session |
| GET | `/api/memories?limit=100&cursor=…` | Own memories and an optional `nextCursor` (limit 1–200) |
| POST | `/api/memories` | Create a memory |
| GET/PATCH/DELETE | `/api/memories/:id` | Read, update, or delete an owned memory |
| GET | `/api/memories/:id/images/:imageId` | Download an owned image |
| GET | `/api/insights?from=…&to=…&timeZone=Asia/Manila` | Own emotion counts and daily summaries (default: last 30 days in UTC) |
| GET | `/api/memories/export` | Full portable JSON backup, including base64 image data |
| POST | `/api/memories/import` | Atomic import of `{memories:[…]}`, up to 25 per request |
| DELETE | `/api/account` | Delete the account and its associated data |

A new memory uses `{date,feelings:["Joy"],note,images:[]}`. Notes are limited to 4,000 characters. New images use `{name,data:"data:image/png;base64,…"}`; edits can retain existing images by their `id`. Original memory dates are retained on edits. Imports support legacy mixed-emotion entries. Insights accept a date range of up to 366 days, with an exclusive `to` boundary. They count only recorded memories; unrecorded days do not imply any emotion. A legacy mixed-emotion memory counts once toward total memories and once for each of its emotions.

Account limits are 10,000 memories and 100 MB of image bytes; requests are limited to 8 MB.

Passwords use salted scrypt hashes; only hashed session tokens are stored. Images are checked against allowed file signatures, stored as database blobs, and served through ownership-checked routes. Notes are rendered as text. Credential endpoints are rate-limited. API responses and private images are not publicly cached. Private access is enforced by the server; this is not end-to-end encryption.

Email delivery is not configured: this version has no email verification or password-recovery mail. It does not assume an email provider or make claims about verifying an email address. Keep your password and exports safe.

## Checks

```sh
npm run check
npm test
```

Integration tests cover authentication, private memory/photo access, CSRF/origin checks, image validation, editing, import rollback and duplicate handling, pagination, emotion insights, portable backups, restart persistence, deletion, logout, and rate limiting. CI runs on Node 22 and 24.

Character artwork belongs to Disney/Pixar and is used here for a personal, non-commercial prototype.
