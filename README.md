# Wallet BY pina

Wallet BY pina is a Node.js web app with an installable Progressive Web App shell.

## Run locally

Requires Node.js 22.9 or newer.

For local password-recovery emails, copy `.env.example` to `.env` and fill in the SMTP values. The start and dev scripts load `.env` automatically. Keep `.env` private; it is ignored by Git.

```powershell
npm start
```

Open `http://localhost:3000`. To run the API checks:

```powershell
npm test
```

In VS Code, select **Wallet: server + Chrome** in the Run and Debug panel to start the server and open the app together. The server uses port `3000` by default; set `PORT` to use another available port.

## Password recovery

Open the password recovery screen directly at `https://your-site.example/#forgot-password`, or choose **Lupa kata sandi?** on the sign-in screen. Password recovery sends a single-use link that expires after one hour. It will not send email until SMTP is configured in the hosting provider's environment settings:

- `SMTP_HOST`: SMTP server hostname.
- `SMTP_PORT`: SMTP port (defaults to `587`; use `465` for implicit TLS).
- `SMTP_SECURE`: set to `true` for implicit TLS; otherwise defaults to `true` only on port `465`.
- `SMTP_USER` and `SMTP_PASS`: SMTP credentials; set both or neither.
- `SMTP_FROM`: verified sender address, for example `Wallet BY pina <wallet@example.com>`.
- `APP_BASE_URL`: the app's public origin, for example `http://localhost:3000` locally or `https://wallet.example.com` in production. Production requires HTTPS; configure this explicitly so reset links cannot be influenced by a request's `Host` header.

For Gmail SMTP, enable 2-Step Verification and create a Google App Password; do not use your regular Gmail password. The free Render demo does not configure password-recovery email. For a hosted deployment with email recovery, set `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, and `APP_BASE_URL` in the hosting provider's environment settings. `APP_BASE_URL` must be the exact public HTTPS address. Keep passwords and app passwords in hosting secrets only; never commit them to GitHub. For local testing, use `http://localhost:3000` for `APP_BASE_URL` in `.env`. Reset requests return the same confirmation for registered and unregistered email addresses; email delivery runs in the background so the response does not reveal whether an account exists. If delivery fails, the server logs the failure and removes that unusable link without overwriting newer account data. Up to five active reset links are kept per account; using any valid link invalidates all of them. Changing a password expires all existing sessions for that account.

## QRIS transaction tracking

When recording an expense, choose **QRIS** under **Metode pembayaran**, select the source account, then choose **Pindai QRIS dengan kamera**. Allow camera access when prompted. The scanner reads valid Indonesian QRIS codes, fills in the merchant name, and fills in the amount when it is present in the code. Static QRIS codes do not contain an amount, so enter it manually. Check the merchant, amount, and source account before saving. Scanning only prepares an expense record; it does not pay the merchant or connect to a bank.

Camera access requires HTTPS in production (or `localhost` during local development) and permission from the browser. Account balances are calculated from transactions recorded in this app; bank balances are not synchronized. Real bank connections require an Open Banking provider, its API documentation, and server-side credentials configured outside the source code.

## Upload to GitHub

Install Git and create an empty repository on GitHub. From this project folder, run:

```powershell
git init
git add .
git status --short
```

Check the staged files before continuing. The local `data/` directory contains account and transaction data and is excluded by `.gitignore`; do not force-add or upload it. Then commit and push the project:

```powershell
git commit -m "Prepare Wallet BY pina for GitHub"
git branch -M main
git remote add origin https://github.com/<username>/<repository>.git
git push -u origin main
```

## Deploy a demo to Render

The included `render.yaml` creates a free Node web service with HTTPS and a health check. It stores demo accounts and transactions under `/tmp/wallet-by-pina-data`, which is temporary storage: data may disappear when the service restarts, sleeps, or is redeployed. Do not use this free demo for real financial records. Password-recovery email is not configured in the demo.

1. Push this project to a GitHub repository. Keep it private if it contains real financial data.
2. In Render, choose **New → Blueprint** and connect that repository.
3. Review the Blueprint and confirm the free service. Render builds the app and provides an HTTPS address when deployment completes.
4. Open that HTTPS address on your phone and install the PWA from Chrome or Safari using the steps below.

Render will redeploy when changes are pushed to the connected branch. The app detects changed shell assets and prompts users to apply the update.

## Install on a phone

To install from a phone, deploy the app to a server with HTTPS. Service workers and browser installation are blocked on ordinary HTTP network addresses. Keep the Node.js server running behind the HTTPS hosting provider or reverse proxy.

- Android: open the HTTPS address in Chrome and choose **Pasang di perangkat**. If the browser does not show its install prompt, use the browser menu and choose **Install app** or **Add to Home screen**.
- iPhone: open the HTTPS address in Safari, tap **Bagikan**, then **Tambahkan ke Layar Utama**.

## Updates and stored data

The server hashes the installable app assets into the service-worker response. When any of those assets change on deployment, browsers detect a new version; the app shows a **Perbarui** button. Confirming it activates the new app version and reloads the page. Keep `sw.js` available at the site root and preserve the app's origin and URL paths.

User accounts and transactions are stored in `data/wallet-data.json` locally. The free Render demo uses temporary storage and can lose its data. For real use, deploy with a persistent disk/volume and configure `WALLET_DATA_DIRECTORY` to point to it; do not change that directory after users have created accounts. Set `NODE_ENV=production` when served over HTTPS. Set `TRUST_PROXY=true` only when the app is behind a trusted proxy that replaces incoming `X-Forwarded-For` headers.

The app requires a connection to its Node.js server for sign-in and financial API actions. The service worker only caches the app shell for offline opening; it does not queue money transactions while offline.
