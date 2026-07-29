Deploying Creative-Solutions to Render (always-on login server)
=========================

This guide walks through deploying the backend to Render so the login server is always online.

Prerequisites
- A GitHub repository containing this project (push your branch)
- A Render account (https://render.com)

Steps
1. Push your branch to GitHub

```bash
git add .
git commit -m "Prepare for Render deployment"
git push origin YOUR_BRANCH
```

2. Create a new Web Service on Render
- In Render dashboard: New -> Web Service -> Connect GitHub -> select the repository and branch.
- Name: `creative-solutions` (or as you prefer)
- Branch: choose the branch you pushed
- Root Directory: `.`
- Runtime: `Node`
- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/health`
- Set Auto-Deploy: on (optional)
- Add a Disk: size 1GB, mount at `/var/data` (matches `render.yaml`)

3. Configure Environment Variables
- In Render service settings -> Environment -> Add the following variables (mark secrets as secure):
  - `SUPPORT_PORTAL_PASSWORD` (required)
  - `CUSTOMER_STORE_PATH` = `/var/data/customer-accounts.json`
  - `CORS_ALLOWED_ORIGINS` = `https://yourdomain.com` (or leave blank for testing)
  - (Optional) `STRIPE_SECRET_KEY`, `STRIPE_PUBLIC_KEY`, `STRIPE_WEBHOOK_SECRET` if using Stripe

4. Deploy and verify
- Click Deploy. Wait for build logs to finish and the service to become healthy.
- Verify:

```bash
curl https://your-service.onrender.com/health
curl https://your-service.onrender.com/api/auth/meta
```

5. Update CORS and production settings
- Set `CORS_ALLOWED_ORIGINS` to include any frontends that will call the API.
- If serving the frontend separately (e.g., GitHub Pages), set `window.CWS_API_BASE` to your Render service URL.

Notes and troubleshooting
- render.yaml is included in the repo and matches these settings; you can let Render auto-configure if you connect the repo.
- If the service fails to start, view the deploy logs for missing env vars or port conflicts. The app will try `PORT` from env; otherwise it defaults to `4000` and will auto-increment on conflict.
- The backend serves static assets by default, so you can open `https://your-service.onrender.com/login.html` to test the login flow.

Automation (optional)
- If you want CI to trigger deploys or manage secrets automatically, use Render's GitHub integration or the Render API.

Want me to continue?
- I can: (A) open a PR with minor deployment docs/CI, (B) guide you through the Render UI interactively, or (C) prepare a GitHub Action to call the Render API (you'll need to add a Render API key to GitHub Secrets). Which do you want next?
