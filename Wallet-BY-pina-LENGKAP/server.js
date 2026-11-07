const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const nodemailer = require('nodemailer');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIRECTORY = process.env.WALLET_DATA_DIRECTORY || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIRECTORY, 'wallet-data.json');
const SESSION_COOKIE = 'wallet_session';
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const PASSWORD_RESET_DURATION_MS = 60 * 60 * 1000;
const MAX_BODY_BYTES = 64 * 1024;
const PAYMENT_METHODS = new Set(['qris', 'transfer', 'cash', 'debit', 'other']);
const loginAttempts = new Map();
const passwordResetAttempts = new Map();
let mailTransport;

function passwordResetEmailConfigured() {
  const hasCredentials = Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);
  const hasPartialCredentials = Boolean(process.env.SMTP_USER) !== Boolean(process.env.SMTP_PASS);
  let hasBaseUrl = false;
  try {
    const baseUrl = new URL(process.env.APP_BASE_URL);
    hasBaseUrl = !baseUrl.username &&
      !baseUrl.password &&
      baseUrl.pathname === '/' &&
      !baseUrl.search &&
      !baseUrl.hash &&
      (baseUrl.protocol === 'https:' || (process.env.NODE_ENV !== 'production' && baseUrl.protocol === 'http:'));
  } catch {}
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM) &&
    !hasPartialCredentials &&
    hasBaseUrl;
}

function passwordResetBaseUrl() {
  const parsed = new URL(process.env.APP_BASE_URL);
  if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
    throw new Error('APP_BASE_URL harus menggunakan HTTPS di production.');
  }
  return parsed.origin;
}

async function sendPasswordResetEmail({ to, url }) {
  if (!mailTransport) {
    const port = Number(process.env.SMTP_PORT) || 587;
    const hasCredentials = Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);
    mailTransport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: process.env.SMTP_SECURE === undefined ? port === 465 : process.env.SMTP_SECURE === 'true',
      ...(hasCredentials ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } } : {})
    });
  }
  await mailTransport.sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject: 'Atur ulang kata sandi Wallet BY pina',
    text: `Gunakan tautan berikut untuk mengatur ulang kata sandi Wallet BY pina. Tautan berlaku selama 1 jam dan hanya dapat digunakan sekali:\n\n${url}\n\nJika Anda tidak meminta pengaturan ulang kata sandi, abaikan email ini.`,
    html: `<p>Gunakan tautan berikut untuk mengatur ulang kata sandi Wallet BY pina. Tautan berlaku selama 1 jam dan hanya dapat digunakan sekali.</p><p><a href="${url}">Atur ulang kata sandi</a></p><p>Jika Anda tidak meminta pengaturan ulang kata sandi, abaikan email ini.</p>`
  });
}

function readStore() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { users: [], sessions: [], transactions: [] };
  }
}

function writeStore(store) {
  fs.mkdirSync(DATA_DIRECTORY, { recursive: true });
  const temporaryFile = `${DATA_FILE}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify(store, null, 2), { mode: 0o600 });
  fs.renameSync(temporaryFile, DATA_FILE);
}

function send(response, status, payload, headers = {}) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers
  });
  response.end(JSON.stringify(payload));
}

function getClientIp(request) {
  if (process.env.TRUST_PROXY === 'true') {
    const forwardedAddress = request.headers['x-forwarded-for']?.split(',')[0].trim();
    if (forwardedAddress && net.isIP(forwardedAddress)) return forwardedAddress;
  }
  const address = request.socket.remoteAddress || 'unknown';
  return address.startsWith('::ffff:') ? address.slice(7) : address;
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', chunk => {
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Ukuran permintaan terlalu besar.'), { status: 413 }));
        request.destroy();
      }
    });
    request.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(Object.assign(new Error('Format data tidak valid.'), { status: 400 }));
      }
    });
    request.on('error', reject);
  });
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return {
    salt,
    hash: crypto.scryptSync(password, salt, 64).toString('hex')
  };
}

function passwordMatches(password, user) {
  const candidate = crypto.scryptSync(password, user.passwordSalt, 64);
  const saved = Buffer.from(user.passwordHash, 'hex');
  return candidate.length === saved.length && crypto.timingSafeEqual(candidate, saved);
}

function newSession(store, userId, response) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + SESSION_DURATION_MS;
  store.sessions = store.sessions.filter(session => session.expiresAt > Date.now());
  store.sessions.push({ tokenHash: crypto.createHash('sha256').update(token).digest('hex'), userId, expiresAt });
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  response.setHeader('Set-Cookie', `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(SESSION_DURATION_MS / 1000)}${secure}`);
}

function clearSessionCookie(response) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  response.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`);
}

function getSession(request, store) {
  const cookie = request.headers.cookie || '';
  const token = cookie.split(';').map(part => part.trim()).find(part => part.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
  if (!token) return null;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const session = store.sessions.find(item => item.tokenHash === tokenHash && item.expiresAt > Date.now());
  if (!session) return null;
  return { session, user: store.users.find(item => item.id === session.userId) };
}

function accountBalances(store, userId, throughDate = '9999-12-31') {
  const balances = new Map();
  const accountKey = account => account.trim().toLocaleLowerCase('id-ID');
  const add = (account, amount) => {
    const key = accountKey(account);
    balances.set(key, (balances.get(key) || 0) + amount);
  };
  const transactions = store.transactions
    .filter(item => item.userId === userId && item.date <= throughDate)
    .sort((left, right) => left.date.localeCompare(right.date) || left.createdAt - right.createdAt);
  for (const transaction of transactions) {
    if (transaction.type === 'income') add(transaction.account, transaction.amount);
    if (transaction.type === 'expense') add(transaction.account, -transaction.amount);
    if (transaction.type === 'transfer') {
      add(transaction.account, -transaction.amount);
      add(transaction.destination, transaction.amount);
    }
  }
  return balances;
}

function transfersRemainFunded(transactions, userId) {
  const balances = new Map();
  const keyFor = account => account.trim().toLocaleLowerCase('id-ID');
  const balanceOf = account => balances.get(keyFor(account)) || 0;
  const add = (account, amount) => {
    const key = keyFor(account);
    balances.set(key, balanceOf(account) + amount);
  };
  const ordered = transactions
    .filter(item => item.userId === userId)
    .sort((left, right) => left.date.localeCompare(right.date) || left.createdAt - right.createdAt);
  for (const transaction of ordered) {
    if (transaction.type === 'income') add(transaction.account, transaction.amount);
    if (transaction.type === 'expense') add(transaction.account, -transaction.amount);
    if (transaction.type === 'transfer') {
      if (balanceOf(transaction.account) < transaction.amount) return false;
      add(transaction.account, -transaction.amount);
      add(transaction.destination, transaction.amount);
    }
  }
  return true;
}

function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isValidAccount(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 40;
}

function isValidTransaction(input) {
  return input &&
    typeof input.name === 'string' && input.name.trim().length > 0 && input.name.trim().length <= 50 &&
    Number.isSafeInteger(input.amount) && input.amount > 0 &&
    isValidDate(input.date) && isValidAccount(input.account) &&
    ['income', 'expense', 'transfer'].includes(input.type) &&
    (input.paymentMethod === undefined ||
      (input.type === 'expense' && PAYMENT_METHODS.has(input.paymentMethod))) &&
    (input.type !== 'transfer' || isValidAccount(input.destination));
}

function createServer({ sendPasswordResetEmail: sendResetEmail = sendPasswordResetEmail } = {}) {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    const ip = getClientIp(request);

    if (request.method === 'GET' && url.pathname === '/health') {
      send(response, 200, { status: 'ok' });
      return;
    }

    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
      response.end(fs.readFileSync(path.join(__dirname, 'index.html')));
      return;
    }

    if (request.method === 'GET' && url.pathname === '/app.js') {
      response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
      response.end(fs.readFileSync(path.join(__dirname, 'app.js')));
      return;
    }

    const staticFiles = {
      '/sw.js': { file: 'sw.js', type: 'text/javascript; charset=utf-8' },
      '/manifest.webmanifest': { file: 'manifest.webmanifest', type: 'application/manifest+json; charset=utf-8' },
      '/icon.svg': { file: 'icon.svg', type: 'image/svg+xml' },
      '/icon-192.png': { file: 'icon-192.png', type: 'image/png' },
      '/icon-512.png': { file: 'icon-512.png', type: 'image/png' },
      '/apple-touch-icon.png': { file: 'apple-touch-icon.png', type: 'image/png' }
    };
    const staticFile = staticFiles[url.pathname];
    if (request.method === 'GET' && staticFile) {
      let asset = fs.readFileSync(path.join(__dirname, staticFile.file));
      if (url.pathname === '/sw.js') {
        const releaseFiles = ['index.html', 'app.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];
        const releaseHash = crypto.createHash('sha256')
          .update(Buffer.concat(releaseFiles.map(file => fs.readFileSync(path.join(__dirname, file)))))
          .digest('hex');
        asset = Buffer.from(asset.toString('utf8').replace('__RELEASE_HASH__', releaseHash));
      }
      response.writeHead(200, {
        'Content-Type': staticFile.type,
        'Cache-Control': url.pathname === '/sw.js' ? 'no-cache' : 'public, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
        ...(url.pathname === '/sw.js' ? { 'Service-Worker-Allowed': '/' } : {})
      });
      response.end(asset);
      return;
    }

    if (!url.pathname.startsWith('/api/')) {
      send(response, 404, { error: 'Halaman tidak ditemukan.' });
      return;
    }

    let store;
    try {
      store = readStore();
    } catch {
      send(response, 500, { error: 'Data aplikasi tidak dapat dibaca.' });
      return;
    }

    try {
      if (request.method === 'POST' && url.pathname === '/api/password-reset/request') {
        const body = await readBody(request);
        const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
          send(response, 400, { error: 'Masukkan alamat email yang valid.' });
          return;
        }
        const rateLimit = passwordResetAttempts.get(ip) || { count: 0, startedAt: Date.now() };
        if (Date.now() - rateLimit.startedAt > 15 * 60 * 1000) {
          rateLimit.count = 0;
          rateLimit.startedAt = Date.now();
        }
        if (rateLimit.count >= 5) {
          send(response, 429, { error: 'Terlalu banyak permintaan. Coba lagi dalam 15 menit.' });
          return;
        }
        rateLimit.count++;
        passwordResetAttempts.set(ip, rateLimit);
        if (!passwordResetEmailConfigured() && sendResetEmail === sendPasswordResetEmail) {
          send(response, 503, { error: 'Email pemulihan belum dikonfigurasi. Administrator perlu mengatur SMTP_HOST, SMTP_FROM, dan APP_BASE_URL.' });
          return;
        }
        const user = store.users.find(item => item.email === email);
        if (user) {
          const token = crypto.randomBytes(32).toString('base64url');
          const resetToken = {
            tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
            userId: user.id,
            expiresAt: Date.now() + PASSWORD_RESET_DURATION_MS
          };
          store.passwordResetTokens = (store.passwordResetTokens || [])
            .filter(item => item.expiresAt > Date.now() && item.userId !== user.id);
          store.passwordResetTokens.push(resetToken);
          writeStore(store);
          const resetUrl = new URL('/', passwordResetBaseUrl());
          resetUrl.hash = new URLSearchParams({ reset: token }).toString();
          try {
            await sendResetEmail({ to: user.email, url: resetUrl.toString() });
          } catch (error) {
            store.passwordResetTokens = store.passwordResetTokens.filter(item => item !== resetToken);
            writeStore(store);
            console.error('Password reset email delivery failed:', error);
            send(response, 502, { error: 'Email pemulihan gagal dikirim. Coba lagi atau hubungi administrator.' });
            return;
          }
        }
        send(response, 200, { message: 'Jika email terdaftar, tautan untuk mengatur ulang kata sandi akan dikirim.' });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/password-reset/confirm') {
        const body = await readBody(request);
        const token = typeof body.token === 'string' ? body.token : '';
        const password = typeof body.password === 'string' ? body.password : '';
        if (password.length < 8 || password.length > 256) {
          send(response, 400, { error: 'Kata sandi harus terdiri dari 8 hingga 256 karakter.' });
          return;
        }
        if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
          send(response, 400, { error: 'Tautan reset tidak valid atau sudah kedaluwarsa. Minta tautan baru.' });
          return;
        }
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const resetTokens = store.passwordResetTokens || [];
        const resetToken = resetTokens.find(item =>
          item.expiresAt > Date.now() &&
          typeof item.tokenHash === 'string' &&
          /^[a-f0-9]{64}$/.test(item.tokenHash) &&
          crypto.timingSafeEqual(Buffer.from(item.tokenHash, 'hex'), Buffer.from(tokenHash, 'hex'))
        );
        const user = resetToken && store.users.find(item => item.id === resetToken.userId);
        if (!resetToken || !user) {
          send(response, 400, { error: 'Tautan reset tidak valid atau sudah kedaluwarsa. Minta tautan baru.' });
          return;
        }
        const passwordData = hashPassword(password);
        user.passwordSalt = passwordData.salt;
        user.passwordHash = passwordData.hash;
        store.passwordResetTokens = resetTokens.filter(item => item.userId !== user.id);
        store.sessions = store.sessions.filter(item => item.userId !== user.id);
        writeStore(store);
        clearSessionCookie(response);
        send(response, 200, { message: 'Kata sandi berhasil diubah. Silakan masuk dengan kata sandi baru.' });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/register') {
        const body = await readBody(request);
        const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        const password = typeof body.password === 'string' ? body.password : '';
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
          send(response, 400, { error: 'Masukkan alamat email yang valid.' });
          return;
        }
        if (!name || name.length > 60) {
          send(response, 400, { error: 'Nama harus diisi dan maksimal 60 karakter.' });
          return;
        }
        if (password.length < 8 || password.length > 256) {
          send(response, 400, { error: 'Kata sandi harus terdiri dari 8 hingga 256 karakter.' });
          return;
        }
        if (store.users.some(user => user.email === email)) {
          send(response, 409, { error: 'Email sudah terdaftar. Silakan masuk.' });
          return;
        }
        const passwordData = hashPassword(password);
        const user = { id: crypto.randomUUID(), email, name, ...{ passwordSalt: passwordData.salt, passwordHash: passwordData.hash }, lastLoginIp: ip, budget: 0 };
        store.users.push(user);
        newSession(store, user.id, response);
        writeStore(store);
        send(response, 201, { user: { email: user.email, name: user.name }, newIpDetected: false });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/login') {
        const body = await readBody(request);
        const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
        const password = typeof body.password === 'string' ? body.password : '';
        const attemptKey = `${ip}:${email}`;
        const attempt = loginAttempts.get(attemptKey) || { count: 0, startedAt: Date.now() };
        if (Date.now() - attempt.startedAt > 15 * 60 * 1000) {
          attempt.count = 0;
          attempt.startedAt = Date.now();
        }
        if (attempt.count >= 10) {
          send(response, 429, { error: 'Terlalu banyak percobaan. Coba lagi dalam 15 menit.' });
          return;
        }
        const user = store.users.find(item => item.email === email);
        if (!user || !password || !passwordMatches(password, user)) {
          attempt.count++;
          loginAttempts.set(attemptKey, attempt);
          send(response, 401, { error: 'Email atau kata sandi tidak cocok.' });
          return;
        }
        loginAttempts.delete(attemptKey);
        const newIpDetected = Boolean(user.lastLoginIp && user.lastLoginIp !== ip);
        user.lastLoginIp = ip;
        newSession(store, user.id, response);
        writeStore(store);
        send(response, 200, { user: { email: user.email, name: user.name }, newIpDetected });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/logout') {
        const auth = getSession(request, store);
        if (auth) store.sessions = store.sessions.filter(session => session !== auth.session);
        writeStore(store);
        clearSessionCookie(response);
        send(response, 200, { ok: true });
        return;
      }

      const auth = getSession(request, store);
      if (request.method === 'GET' && url.pathname === '/api/me' && !auth?.user) {
        send(response, 200, { user: null });
        return;
      }
      if (!auth?.user) {
        send(response, 401, { error: 'Silakan masuk terlebih dahulu.' });
        return;
      }
      const { user } = auth;

      if (request.method === 'GET' && url.pathname === '/api/me') {
        send(response, 200, { user: { email: user.email, name: user.name } });
        return;
      }

      if (request.method === 'PATCH' && url.pathname === '/api/profile') {
        const body = await readBody(request);
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        if (!name || name.length > 60) {
          send(response, 400, { error: 'Nama harus diisi dan maksimal 60 karakter.' });
          return;
        }
        user.name = name;
        writeStore(store);
        send(response, 200, { user: { email: user.email, name: user.name } });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/transactions') {
        const transactions = store.transactions.filter(item => item.userId === user.id).sort((left, right) => right.date.localeCompare(left.date) || right.createdAt - left.createdAt);
        send(response, 200, { transactions });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/transactions') {
        const body = await readBody(request);
        if (!isValidTransaction(body)) {
          send(response, 400, { error: 'Data transaksi tidak valid.' });
          return;
        }
        const account = body.account.trim();
        const destination = body.type === 'transfer' ? body.destination.trim() : '';
        if (body.type === 'transfer') {
          if (account.toLocaleLowerCase('id-ID') === destination.toLocaleLowerCase('id-ID')) {
            send(response, 400, { error: 'Rekening asal dan tujuan harus berbeda.' });
            return;
          }
          const balance = accountBalances(store, user.id, body.date).get(account.toLocaleLowerCase('id-ID')) || 0;
          if (balance < body.amount) {
            send(response, 409, { error: `Saldo ${account} tidak cukup. Saldo tersedia ${new Intl.NumberFormat('id-ID').format(Math.max(0, balance))}.` });
            return;
          }
        }
        const transaction = {
          id: crypto.randomUUID(), userId: user.id,
          name: body.name.trim(), category: body.type === 'transfer' ? 'Transfer' : String(body.category || 'Lainnya').slice(0, 40),
          account, destination, amount: body.amount, date: body.date, type: body.type,
          ...(body.type === 'expense' ? { paymentMethod: body.paymentMethod || 'other' } : {}),
          icon: body.type === 'income' ? '↗' : body.type === 'transfer' ? '⇄' : '•', createdAt: Date.now()
        };
        store.transactions.push(transaction);
        writeStore(store);
        send(response, 201, { transaction });
        return;
      }

      const deleteMatch = url.pathname.match(/^\/api\/transactions\/([0-9a-f-]+)$/i);
      if (request.method === 'DELETE' && deleteMatch) {
        const index = store.transactions.findIndex(item => item.id === deleteMatch[1] && item.userId === user.id);
        if (index < 0) {
          send(response, 404, { error: 'Transaksi tidak ditemukan.' });
          return;
        }
        const [deleted] = store.transactions.splice(index, 1);
        if (!transfersRemainFunded(store.transactions, user.id)) {
          store.transactions.splice(index, 0, deleted);
          send(response, 409, { error: 'Transaksi ini tidak dapat dihapus karena akan membuat transfer lain kekurangan saldo.' });
          return;
        }
        writeStore(store);
        send(response, 200, { ok: true });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/budget') {
        send(response, 200, { budget: user.budget || 0 });
        return;
      }

      if (request.method === 'PUT' && url.pathname === '/api/budget') {
        const body = await readBody(request);
        if (!Number.isSafeInteger(body.budget) || body.budget <= 0) {
          send(response, 400, { error: 'Anggaran harus berupa angka lebih dari 0.' });
          return;
        }
        user.budget = body.budget;
        writeStore(store);
        send(response, 200, { budget: user.budget });
        return;
      }

      send(response, 404, { error: 'API tidak ditemukan.' });
    } catch (error) {
      if (error.status) {
        send(response, error.status, { error: error.message });
        return;
      }
      console.error(error);
      send(response, 500, { error: 'Terjadi kesalahan pada server.' });
    }
  });
}

if (require.main === module) {
  const server = createServer();
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Wallet BY pina berjalan di http://localhost:${PORT}`);
  });
}

module.exports = { accountBalances, createServer, isValidDate, isValidTransaction };
