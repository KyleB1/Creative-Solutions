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
- Sessions are persisted to the configured session store file (`SESSION_STORE_PATH`, default `data/sessions.json`) with expiration cleanup.
- Active sessions can still be invalidated by restarts if the session file is not persisted between deployments.
- GitHub Pages alone will not support the current login flow because `/api/auth/*` must be served by the backend.
- The production URL should be the hosted Node app itself, for example `https://your-service.onrender.com`.

## Local run

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env` and fill in the required values.
3. Ensure support login is enabled locally by setting `SUPPORT_PORTAL_PASSWORD` in `.env`.
   - The system admin account `kyle.creativesolutions@gmail.com` is configured as `System Administrator` and can access the admin console via `support-login.html` once support login is configured.
   - If you forget the support password, use the "Forgot password?" link on `support-login.html` to reset it locally.
4. Start the server:
	- Standard: `npm start`
	- Windows PowerShell (execution-policy safe): `./start-local.cmd`
5. Open `http://localhost:3000`.

> Note: the default local port is `3000`. You can override it with `PORT`, but if the selected port is already in use the server exits with an error instead of auto-switching ports.

## Support login smoke test

To verify the local support login flow and admin access, run the built-in smoke test:

```bash
node test-admin-setup.js
```

This script assumes the backend is available on port `3000` and that
`SUPPORT_PORTAL_PASSWORD` is set in your `.env` file.

If the backend starts on a different port, set `PORT=3000` before starting
or modify the script's `PORT` constant.

## Support role configuration

Support account roles are defined on the server in `auth-routes.js` (`SUPPORT_ROLES`).
The `/api/auth/meta` endpoint exposes this mapping as `supportRoles`, and the frontend
hydrates its support role list from that response.

You can override the built-in defaults by setting `SUPPORT_ROLES` in `.env`.
Format:

- `SUPPORT_ROLES=email1@example.com:Role One,email2@example.com:Role Two`

Current built-in roles:

- `support@creativewebsolutions.com` -> `Support Agent`
- `helpdesk@creativewebsolutions.com` -> `Help Desk Agent`
- `admin@creativewebsolutions.com` -> `System Administrator`
- `kyle.creativesolutions@gmail.com` -> `System Administrator`

## CI test workflow (non-Stripe)

The repository includes `.github/workflows/test.yml` for local-auth and site behavior checks.
It intentionally excludes Stripe integration tests while payment setup is still in progress.
