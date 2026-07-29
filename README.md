# Creative-Solutions

Creative Solutions is a Node-hosted marketing site with customer login, support login, and billing APIs.

## Hosted deployment

The current auth system is server-backed and cookie-based. That means the recommended production deployment is to host the entire app from one HTTPS origin instead of serving the HTML separately on GitHub Pages.

This repo is now prepared for Render deployment with a persistent disk for account storage.

### Recommended platform

Use Render and deploy the repo as a single web service.

Files added for deployment:

- `render.yaml` provisions the web service and persistent disk.
- `.env.example` lists the production environment variables you need to set.

### Render setup

1. Push the repo to GitHub.
2. In Render, create a new Blueprint deployment from this repository.
3. Render will read `render.yaml` and create the web service plus a disk mounted at `/var/data`.
4. In the Render dashboard, set these required environment variables:
	- `SUPPORT_PORTAL_PASSWORD`
	- `STRIPE_SECRET_KEY`
	- `STRIPE_PUBLIC_KEY`
	- `STRIPE_WEBHOOK_SECRET`
5. Leave `CUSTOMER_STORE_PATH` as `/var/data/customer-accounts.json`.
6. If you attach a custom domain, set `CORS_ALLOWED_ORIGINS` to your production HTTPS origins, comma-separated.

### Important deployment notes

- Customer accounts are stored in a JSON file, so production needs persistent disk storage.
- Sessions are currently stored in server memory. Users will be signed out when the app restarts or redeploys.
- GitHub Pages alone will not support the current login flow because `/api/auth/*` must be served by the backend.
- The production URL should be the hosted Node app itself, for example `https://your-service.onrender.com`.

## Local run

1. Install dependencies:

```powershell
npm install
```

2. Copy `.env.example` to `.env` and fill in the required values (at minimum, set `SUPPORT_PORTAL_PASSWORD` for support login).

3. Start the backend server (defaults to port `4000`):

```powershell
node server.js
```

Or use the helper script on Windows:

```powershell
./start-local.cmd
```

4. Recommended: Serve the frontend from the same origin as the backend so API calls share cookies and origin. Open the site at `http://localhost:4000/login.html` (the backend serves static assets by default).

5. Alternate: If you run a separate frontend dev server (for example on port `3000`), set `window.CWS_API_BASE` (or `window.CWS_API_BASE_PORT`) before `auth.js` loads so the frontend directs `/api/*` calls to the backend on `http://localhost:4000`.

Notes:
- The server default port is `4000`. If you set `PORT` in your environment, the server will attempt to start on that port and will increment on conflicts.
- Serving frontend and backend from the same origin is the simplest setup for local testing because sessions and cookies work without additional CORS configuration.

## Support login smoke test

To verify the local support login flow and admin access, run the built-in smoke test:

```bash
node test-admin-setup.js
```

This script assumes the backend is available on port `4000` and that
`SUPPORT_PORTAL_PASSWORD` is set in your `.env` file.

If the backend starts on a different port, set `PORT` before starting
or modify the script's `PORT` constant.

## PM2 (run as a persistent service)

To run the app persistently on your machine, use `pm2`. Install it globally and start the ecosystem file included in the repo:

```powershell
npm install -g pm2
npm run pm2:start
pm2 save
pm2 startup
```

To stop or remove the process:

```powershell
npm run pm2:stop
pm2 delete creative-solutions
```

Notes for Windows: PM2 requires extra setup to run as a Windows service. Install `pm2-windows-service` or use `nssm` to register Node directly as a service if you prefer a native Windows service.

## CI / Render deploy secrets

If you enabled the GitHub Action `/.github/workflows/deploy-to-render.yml`, add these repository secrets so the workflow can trigger Render deploys:

- `RENDER_API_KEY` — your Render API key (create in Render dashboard → Account → API Keys).
- `RENDER_SERVICE_ID` — your Render service ID (find in your Render service Settings → General → API ID).

Add them in GitHub: Repository → Settings → Secrets → Actions → New repository secret.

After adding the secrets, push a branch or open a PR — the workflow will run and post the Render API response to PRs.
