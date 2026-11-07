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

For Gmail SMTP, enable 2-Step Verification and create a Google App Password; do not use your regular Gmail password. The Render Blueprint preconfigures `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, and `SMTP_SECURE=false`; set `SMTP_USER` to the Gmail address, `SMTP_PASS` to the App Password, and `SMTP_FROM` to that verified address. In Render, set these under **Dashboard → wallet-by-pina → Environment**. After the first deployment, set `APP_BASE_URL` to the exact public `https://...onrender.com` service URL and redeploy. Keep passwords and app passwords in hosting secrets only; never commit them to GitHub. `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, and `APP_BASE_URL` must be entered in the dashboard. For local testing, use `http://localhost:3000` for `APP_BASE_URL` in `.env`. Reset requests return the same confirmation for registered and unregistered email addresses. If delivery fails, the request now reports an error instead of showing a false success, and the unused reset token is removed. Changing a password expires all existing sessions for that account.

## QRIS transaction tracking

When recording an expense, choose **QRIS** under **Metode pembayaran** and select the bank or wallet account used as its source. This records the payment method only; it does not generate a merchant QR code or process a payment.

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

## Deploy to Render

The included `render.yaml` creates a Node web service with HTTPS, a health check, and a 1 GB persistent disk mounted at `/var/data`. Render's persistent disk is a paid resource; review the current plan and disk price in Render before confirming deployment. Do not remove the disk or change `WALLET_DATA_DIRECTORY` after users have created accounts, or the service will no longer see that data.

1. Push this project to a GitHub repository. Keep it private if it contains real financial data.
2. In Render, choose **New → Blueprint**, connect that repository, and review the resources and price.
3. Confirm the Blueprint. Render builds the app and provides an HTTPS address when deployment completes.
4. Open that HTTPS address on your phone and install the PWA from Chrome or Safari using the steps below.

Render will redeploy when changes are pushed to the connected branch. The app detects changed shell assets and prompts users to apply the update.

## Install on a phone

To install from a phone, deploy the app to a server with HTTPS. Service workers and browser installation are blocked on ordinary HTTP network addresses. Keep the Node.js server running behind the HTTPS hosting provider or reverse proxy.

- Android: open the HTTPS address in Chrome and choose **Pasang di perangkat**. If the browser does not show its install prompt, use the browser menu and choose **Install app** or **Add to Home screen**.
- iPhone: open the HTTPS address in Safari, tap **Bagikan**, then **Tambahkan ke Layar Utama**.

## Updates and stored data

The server hashes the installable app assets into the service-worker response. When any of those assets change on deployment, browsers detect a new version; the app shows a **Perbarui** button. Confirming it activates the new app version and reloads the page. Keep `sw.js` available at the site root and preserve the app's origin and URL paths.

User accounts and transactions are stored in `data/wallet-data.json`. Configure a persistent disk/volume for the `data` directory on hosted deployments so data survives restarts and redeployments. Set `NODE_ENV=production` when served over HTTPS. Set `TRUST_PROXY=true` only when the app is behind a trusted proxy that replaces incoming `X-Forwarded-For` headers.

The app requires a connection to its Node.js server for sign-in and financial API actions. The service worker only caches the app shell for offline opening; it does not queue money transactions while offline.
