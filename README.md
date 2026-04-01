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

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env` and fill in the required values.
3. Start the server with `npm start`.
4. Open `http://localhost:3000`.
