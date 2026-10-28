# Secure admin deployment

This adds a Node/Express backend and SQLite-backed admin portal. GitHub Pages alone cannot run server-side code; deploy the repository as a Node web service (the included `render.yaml` is a starting point) and use that service's URL for both the public app and `/admin/`.

## Features
- bcrypt password verification on the server; no password or hash in browser JavaScript
- server-side sessions stored in SQLite, with HttpOnly, SameSite=Strict cookies and Secure cookies in production
- session ID rotation after successful login, login rate limiting, Helmet security headers, same-origin checks for state-changing requests
- SQLite persistence for custom players, settings, and prediction logs
- authenticated/authorized admin API routes for all writes and reads

## Deploy
1. Create a Node web service from this repository; use Node 20 or newer. The included `render.yaml` configures a persistent disk for SQLite. Do not use an ephemeral filesystem for production data.
2. Set environment variables in the hosting dashboard:
   - `ADMIN_USERNAME`: your desired admin username
   - `ADMIN_PASSWORD_HASH`: generate a bcrypt hash locally after `npm install`: `node -e "require('bcryptjs').hash('YOUR_LONG_UNIQUE_PASSWORD',12).then(console.log)"`
   - `SESSION_SECRET`: generate a random value: `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"`
   - `NODE_ENV=production`, `DATA_DIR=/var/data`, `TRUST_PROXY=1` when behind the hosting provider's trusted HTTPS proxy.
3. Deploy and verify `/api/health` returns `{"ok":true,"service":"fc26-admin-api","adminBackend":true}`.
4. Open `/admin/` and sign in with the username and original password used to generate the hash.
5. Keep secrets out of Git. Rotate the session secret if exposed. Back up the persistent disk/database.

## Important migration notes
- The static GitHub Pages app is still a public demo. Do not use its old client-side `#admin` panel to manage private data. The server's protected portal is at `/admin/`.
- The public app reads the custom player list and site settings from safe read-only API endpoints when the backend is available. Prediction events are also written to the server log; offline/static use remains browser-local.
- Configure a proper HTTPS domain. Session cookies are secure in production and will not work over plain HTTP.
