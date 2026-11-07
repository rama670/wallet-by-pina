const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');

const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'wallet-by-pina-test-'));
process.env.WALLET_DATA_DIRECTORY = dataDirectory;
process.env.TRUST_PROXY = 'true';
process.env.APP_BASE_URL = 'http://wallet.test';
const { createServer } = require('./server.js');
let server;
let baseUrl;
let sessionCookie;
let incomeId;
let resetUrl;
let failPasswordResetEmail = false;
const transactionDate = new Date().toISOString().slice(0, 10);

async function request(route, { method = 'GET', body, cookie = sessionCookie, ip = '198.51.100.10' } = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      'X-Forwarded-For': ip,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  return { response, data: await response.json() };
}

before(async () => {
  server = createServer({
    sendPasswordResetEmail: async ({ to, url }) => {
      if (failPasswordResetEmail) throw new Error('SMTP unavailable');
      assert.equal(to, 'pina@example.com');
      resetUrl = url;
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server?.listening) {
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections?.();
    });
  }
  fs.rmSync(dataDirectory, { recursive: true, force: true });
  delete process.env.WALLET_DATA_DIRECTORY;
  delete process.env.TRUST_PROXY;
  delete process.env.APP_BASE_URL;
});

test('anonymous session lookup returns an empty user without an auth error', async () => {
  const { response, data } = await request('/api/me', { cookie: undefined });
  assert.equal(response.status, 200);
  assert.equal(data.user, null);
});

test('health endpoint responds without authentication', async () => {
  const { response, data } = await request('/health', { cookie: undefined });
  assert.equal(response.status, 200);
  assert.equal(data.status, 'ok');
});

test('register creates a zero-balance account and a secure session', async () => {
  const { response, data } = await request('/api/register', {
    method: 'POST',
    body: { name: 'Pina', email: 'pina@example.com', password: 'aman12345' },
    cookie: undefined,
    ip: '198.51.100.10'
  });
  assert.equal(response.status, 201);
  assert.equal(data.newIpDetected, false);
  sessionCookie = response.headers.get('set-cookie').split(';')[0];
  assert.ok(sessionCookie.startsWith('wallet_session='));
  const transactions = await request('/api/transactions');
  const budget = await request('/api/budget');
  assert.deepEqual(transactions.data.transactions, []);
  assert.equal(budget.data.budget, 0);
});

test('income funds its account and transfers cannot exceed that balance', async () => {
  const income = await request('/api/transactions', {
    method: 'POST',
    body: { name: 'Gaji', type: 'income', category: 'Gaji', account: 'BCA', amount: 10000, date: transactionDate }
  });
  assert.equal(income.response.status, 201);
  incomeId = income.data.transaction.id;

  const qrisExpense = await request('/api/transactions', {
    method: 'POST',
    body: { name: 'Makan siang', type: 'expense', category: 'Makanan', account: 'BCA', paymentMethod: 'qris', amount: 1000, date: transactionDate }
  });
  assert.equal(qrisExpense.response.status, 201);
  assert.equal(qrisExpense.data.transaction.paymentMethod, 'qris');

  const invalidPaymentMethod = await request('/api/transactions', {
    method: 'POST',
    body: { name: 'Pembayaran tidak valid', type: 'expense', category: 'Lainnya', account: 'BCA', paymentMethod: 'unknown', amount: 1000, date: transactionDate }
  });
  assert.equal(invalidPaymentMethod.response.status, 400);

  const transfer = await request('/api/transactions', {
    method: 'POST',
    body: { name: 'Pindah dana', type: 'transfer', account: 'bca', destination: 'DANA', amount: 6000, date: transactionDate }
  });
  assert.equal(transfer.response.status, 201);

  const overdrawn = await request('/api/transactions', {
    method: 'POST',
    body: { name: 'Transfer berlebih', type: 'transfer', account: 'BCA', destination: 'OVO', amount: 5000, date: transactionDate }
  });
  assert.equal(overdrawn.response.status, 409);
});

test('login from a different IP raises a warning and deleting funding is rejected', async () => {
  const login = await request('/api/login', {
    method: 'POST',
    body: { email: 'pina@example.com', password: 'aman12345' },
    cookie: undefined,
    ip: '203.0.113.20'
  });
  assert.equal(login.response.status, 200);
  assert.equal(login.data.newIpDetected, true);
  sessionCookie = login.response.headers.get('set-cookie').split(';')[0];

  const deletion = await request(`/api/transactions/${incomeId}`, { method: 'DELETE' });
  assert.equal(deletion.response.status, 409);

  const transactions = await request('/api/transactions');
  assert.equal(transactions.data.transactions.length, 3);
});

test('password reset uses one-time expiring links and invalidates existing sessions', async () => {
  const resetRequest = await request('/api/password-reset/request', {
    method: 'POST',
    body: { email: 'pina@example.com' },
    cookie: undefined,
    ip: '192.0.2.51'
  });
  assert.equal(resetRequest.response.status, 200);
  assert.equal(resetRequest.data.message, 'Jika email terdaftar, tautan untuk mengatur ulang kata sandi akan dikirim.');

  const unknownEmail = await request('/api/password-reset/request', {
    method: 'POST',
    body: { email: 'tidak-terdaftar@example.com' },
    cookie: undefined,
    ip: '192.0.2.52'
  });
  assert.deepEqual(unknownEmail.data, resetRequest.data);

  const parsedResetUrl = new URL(resetUrl);
  assert.equal(parsedResetUrl.origin, 'http://wallet.test');
  assert.equal(parsedResetUrl.search, '');
  const resetToken = new URLSearchParams(parsedResetUrl.hash.slice(1)).get('reset');
  assert.match(resetToken, /^[A-Za-z0-9_-]{43}$/);
  const storedReset = JSON.parse(fs.readFileSync(path.join(dataDirectory, 'wallet-data.json'), 'utf8')).passwordResetTokens[0];
  assert.equal(storedReset.tokenHash.length, 64);
  assert.notEqual(storedReset.tokenHash, resetToken);
  const confirm = await request('/api/password-reset/confirm', {
    method: 'POST',
    body: { token: resetToken, password: 'kataSandiBaru123' },
    cookie: undefined
  });
  assert.equal(confirm.response.status, 200);
  assert.match(confirm.response.headers.get('set-cookie'), /Max-Age=0/);

  const oldSession = await request('/api/me');
  assert.equal(oldSession.data.user, null);

  const oldPasswordLogin = await request('/api/login', {
    method: 'POST',
    body: { email: 'pina@example.com', password: 'aman12345' },
    cookie: undefined
  });
  assert.equal(oldPasswordLogin.response.status, 401);

  const newPasswordLogin = await request('/api/login', {
    method: 'POST',
    body: { email: 'pina@example.com', password: 'kataSandiBaru123' },
    cookie: undefined
  });
  assert.equal(newPasswordLogin.response.status, 200);

  const reusedToken = await request('/api/password-reset/confirm', {
    method: 'POST',
    body: { token: resetToken, password: 'kataSandiLain123' },
    cookie: undefined
  });
  assert.equal(reusedToken.response.status, 400);

  const expiredReset = await request('/api/password-reset/request', {
    method: 'POST',
    body: { email: 'pina@example.com' },
    cookie: undefined,
    ip: '192.0.2.53'
  });
  assert.equal(expiredReset.response.status, 200);
  const storePath = path.join(dataDirectory, 'wallet-data.json');
  const store = JSON.parse(fs.readFileSync(storePath, 'utf8'));
  store.passwordResetTokens[0].expiresAt = Date.now() - 1;
  fs.writeFileSync(storePath, JSON.stringify(store));

  const expiredToken = new URLSearchParams(new URL(resetUrl).hash.slice(1)).get('reset');
  const expiredConfirm = await request('/api/password-reset/confirm', {
    method: 'POST',
    body: { token: expiredToken, password: 'kataSandiLain123' },
    cookie: undefined
  });
  assert.equal(expiredConfirm.response.status, 400);
});

test('password reset reports email delivery failures and removes the unusable token', async () => {
  failPasswordResetEmail = true;
  const { response, data } = await request('/api/password-reset/request', {
    method: 'POST',
    body: { email: 'pina@example.com' },
    ip: '192.0.2.54'
  });
  failPasswordResetEmail = false;

  assert.equal(response.status, 502);
  assert.equal(data.error, 'Email pemulihan gagal dikirim. Coba lagi atau hubungi administrator.');
  const store = JSON.parse(fs.readFileSync(path.join(dataDirectory, 'wallet-data.json'), 'utf8'));
  assert.equal(store.passwordResetTokens.some(token => token.userId === store.users[0].id), false);
});

test('PWA assets are served with install metadata and a release-specific worker', async () => {
  const manifestResponse = await fetch(`${baseUrl}/manifest.webmanifest`);
  assert.equal(manifestResponse.status, 200);
  const manifest = await manifestResponse.json();
  assert.equal(manifest.name, 'Wallet BY pina');
  assert.ok(manifest.icons.some(icon => icon.sizes === '192x192'));
  assert.ok(manifest.icons.some(icon => icon.sizes === '512x512'));

  for (const [route, contentType] of [
    ['/icon.svg', /image\/svg\+xml/],
    ['/icon-192.png', /image\/png/],
    ['/icon-512.png', /image\/png/],
    ['/apple-touch-icon.png', /image\/png/]
  ]) {
    const response = await fetch(`${baseUrl}${route}`);
    assert.equal(response.status, 200, `${route} should be available`);
    assert.match(response.headers.get('content-type'), contentType);
  }

  const workerResponse = await fetch(`${baseUrl}/sw.js`);
  const workerSource = await workerResponse.text();
  assert.equal(workerResponse.status, 200);
  assert.match(workerSource, /const CACHE_PREFIX = 'wallet-by-pina-shell-'/);
  assert.match(workerSource, /const RELEASE_HASH = '[a-f0-9]{64}'/);
  assert.doesNotMatch(workerSource, /__RELEASE_HASH__/);
});
