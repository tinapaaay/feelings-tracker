# Development and maintenance

## Run locally

Requires Node.js 22.13+. From the repository root, run `npm start`, then open [localhost:3000](http://localhost:3000). See the [README](../README.md) for environment variables and production setup.

## Implementation and boundaries

The HTML guest journal and `backend.js` account UI use the Node server in `server/`. Account memories, images, users, and sessions persist in SQLite. Guest data stays in browser storage until explicitly imported. The existing README describes configuration, API limits, deployment, backup, and security boundaries; keep it authoritative. GitHub Pages serves only guest mode.

## Make changes

Edit journal presentation in `index.html`, account requests in `backend.js`, HTTP/authentication/storage behavior in `server/app.mjs`, startup in `server/index.mjs`, and consistent database snapshots in `server/backup.mjs`. Never commit .env, live databases, or journal exports.

## Source map

- [`.dockerignore`](../.dockerignore)
- [`.env.example`](../.env.example)
- [`Dockerfile`](../Dockerfile)
- [`PRODUCT.md`](../PRODUCT.md)
- [`backend.js`](../backend.js)
- [`index.html`](../index.html)
- [`package-lock.json`](../package-lock.json)
- [`package.json`](../package.json)

## Verification

Run `npm run check` and `npm test` with the supported Node version. The tests exercise the backend with test databases.

1. Run the documented syntax and integration checks before server changes.
2. With disposable accounts, verify register/login, memory create/edit/delete, photo access, sign-out isolation, export/import, and restart persistence.
3. For deployment, verify the HTTPS origin, persistent disk, health endpoint, and a restore rehearsal using a copy of the database.
4. Inspect the browser console and Network panel for missing assets or script errors; check keyboard access, phone width, and 200% zoom.

## Deployment

Use the Node/SQLite deployment and backup instructions in the [README](../README.md). Account features need a persistent writable disk and an HTTPS reverse proxy. A static-only host cannot provide the account API.

## Keep documentation current

Update the README and this guide when entry points, dependencies, behavior, or deployment steps change. Record commands actually run and distinguish them from pending manual checks.
