(() => {
  const monthSelect = document.querySelector('#monthSelect');
  const rows = document.querySelector('#transactionRows');
  const emptyState = document.querySelector('#emptyState');
  const dialog = document.querySelector('#transactionDialog');
  const form = document.querySelector('#transactionForm');
  const authForm = document.querySelector('#authForm');
  const categorySelect = form.elements.category;
  const accountSelect = form.elements.account;
  const destinationSelect = form.elements.destination;
  const paymentMethodSelect = form.elements.paymentMethod;
  const amountInput = form.elements.amount;
  const amountField = document.querySelector('#amountField');
  const categoryField = document.querySelector('#categoryField');
  const destinationField = document.querySelector('#destinationField');
  const paymentMethodField = document.querySelector('#paymentMethodField');
  const customDestinationField = document.querySelector('#customDestinationField');
  const customAccountField = document.querySelector('#customAccountField');
  const customAccountInput = form.elements.customAccount;
  const customDestinationInput = form.elements.customDestination;
  const authMessage = document.querySelector('#authMessage');
  const authName = authForm.elements.name;
  const authEmail = authForm.elements.email;
  const authPassword = authForm.elements.password;
  const authConfirmPassword = authForm.elements.confirmPassword;
  const authSubmit = document.querySelector('#authSubmit');
  const authSwitch = document.querySelector('#authSwitch');
  const forgotPasswordButton = document.querySelector('#forgotPasswordButton');
  const rupiah = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
  const monthFormatter = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' });
  const dateFormatter = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  const categoryOptions = {
    expense: ['Makanan', 'Transportasi', 'Belanja', 'Tagihan', 'Kesehatan', 'Hiburan', 'Pendidikan', 'Lainnya'],
    income: ['Gaji', 'Freelance', 'Investasi', 'Hadiah', 'Lainnya']
  };
  const paymentMethodLabels = {
    qris: 'QRIS',
    transfer: 'Transfer bank',
    cash: 'Tunai',
    debit: 'Kartu debit',
    other: 'Lainnya'
  };
  let transactions = [];
  let budget = 0;
  let selectedType = 'expense';
  let profileName = 'Keuangan Saya';
  let authMode = 'login';
  let passwordResetRequested = false;
  const initialHash = new URLSearchParams(window.location.hash.slice(1));
  let resetToken = initialHash.get('reset') || '';
  const openPasswordRecovery = initialHash.has('forgot-password');

  function showWarning(message) {
    document.querySelector('#appNoticeText').textContent = message;
    document.querySelector('#appNotice').hidden = false;
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      credentials: 'same-origin',
      ...options,
      headers: { 'Content-Type': 'application/json', ...options.headers }
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Permintaan gagal. Coba lagi.');
    return result;
  }

  function showAuthMessage(message, isSuccess = false) {
    authMessage.textContent = message;
    authMessage.classList.toggle('success', isSuccess);
    authMessage.setAttribute('role', isSuccess ? 'status' : 'alert');
    authMessage.setAttribute('aria-live', isSuccess ? 'polite' : 'assertive');
    authMessage.hidden = false;
  }

  function authSubmitLabel() {
    if (authMode === 'register') return 'Buat akun';
    if (authMode === 'forgot') return passwordResetRequested ? 'Kirim ulang tautan' : 'Kirim tautan pemulihan';
    if (authMode === 'reset') return 'Simpan kata sandi baru';
    return 'Masuk';
  }

  function setAuthMode(mode) {
    if (mode !== 'forgot') passwordResetRequested = false;
    authMode = mode;
    const registering = mode === 'register';
    const requestingReset = mode === 'forgot';
    const resettingPassword = mode === 'reset';
    document.querySelector('#registerNameField').hidden = !registering;
    document.querySelector('#emailField').hidden = resettingPassword;
    document.querySelector('#passwordField').hidden = requestingReset;
    document.querySelector('#confirmPasswordField').hidden = !resettingPassword;
    document.querySelector('#forgotPasswordButton').hidden = mode !== 'login';
    authEmail.required = !resettingPassword;
    authName.required = registering;
    authPassword.required = !requestingReset;
    authConfirmPassword.required = resettingPassword;
    authPassword.autocomplete = registering || resettingPassword ? 'new-password' : 'current-password';
    authPassword.value = '';
    authConfirmPassword.value = '';
    document.querySelector('#passwordField span').textContent = resettingPassword ? 'Kata sandi baru' : 'Kata sandi';
    document.querySelector('#authEyebrow').textContent = registering ? 'Buat akun' : requestingReset || resettingPassword ? 'Pemulihan akun' : 'Akun pribadi';
    document.querySelector('#authTitle').textContent = registering ? 'Daftar Wallet BY pina' : requestingReset ? 'Lupa kata sandi?' : resettingPassword ? 'Atur kata sandi baru' : 'Masuk ke Wallet BY pina';
    document.querySelector('#authSubtitle').textContent = registering
      ? 'Akun baru dimulai dengan saldo Rp0.'
      : requestingReset
        ? 'Masukkan email akunmu untuk menerima tautan pemulihan.'
        : resettingPassword
          ? 'Buat kata sandi baru minimal 8 karakter.'
          : 'Masuk untuk melihat keuanganmu.';
    authSubmit.textContent = authSubmitLabel();
    document.querySelector('#authSwitchText').textContent = mode === 'login' ? 'Belum punya akun?' : registering ? 'Sudah punya akun?' : 'Kembali ke';
    authSwitch.textContent = mode === 'login' ? 'Daftar' : 'Masuk';
    authMessage.hidden = true;
    authConfirmPassword.setCustomValidity('');
    if (requestingReset) authEmail.focus();
    else if (resettingPassword) authPassword.focus();
    else if (mode === 'login' && authEmail.value) authPassword.focus();
    else if (mode === 'login' || registering) authEmail.focus();
  }

  function updateProfile(name) {
    profileName = name;
    document.querySelector('#profileName').textContent = name;
    const initials = name.trim().split(/\s+/).map(part => part[0]).join('').slice(0, 2).toLocaleUpperCase('id-ID');
    document.querySelector('#profileInitials').textContent = initials || 'KS';
  }

  function populateAccountOptions() {
    const options = '<option value="" selected disabled>Pilih rekening atau dompet</option><optgroup label="Bank"><option>BCA</option><option>Bank Mandiri</option><option>BRI</option><option>BNI</option><option>BSI</option><option>Jago</option><option>SeaBank</option><option value="__custom">Bank lainnya</option></optgroup><optgroup label="Dompet digital"><option>GoPay</option><option>OVO</option><option>DANA</option><option>ShopeePay</option><option>LinkAja</option><option>iSaku</option><option>Sakuku</option><option>AstraPay</option><option value="__custom">Dompet digital lainnya</option></optgroup><option>Tunai</option>';
    accountSelect.innerHTML = options;
    destinationSelect.innerHTML = options;
  }

  function selectedMonth() { return monthSelect.value; }
  function monthTransactions() { return transactions.filter(item => item.date.slice(0, 7) === selectedMonth()); }
  function formatMoney(value) { return rupiah.format(value).replace(/\u00a0/g, ' '); }
  function localDateString(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  }

  function buildMonthOptions() {
    const available = new Set(transactions.map(item => item.date.slice(0, 7)));
    const now = new Date();
    for (let offset = -5; offset <= 0; offset++) {
      const date = new Date(now.getFullYear(), now.getMonth() + offset, 1);
      available.add(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`);
    }
    const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    monthSelect.innerHTML = [...available].sort().reverse().map(value => {
      const [year, month] = value.split('-').map(Number);
      return `<option value="${value}">${monthFormatter.format(new Date(year, month - 1, 1))}</option>`;
    }).join('');
    monthSelect.value = available.has(current) ? current : [...available].sort().reverse()[0];
  }

  function render() {
    const current = monthTransactions();
    const income = current.filter(item => item.type === 'income').reduce((total, item) => total + Number(item.amount), 0);
    const expenses = current.filter(item => item.type === 'expense').reduce((total, item) => total + Number(item.amount), 0);
    const totalIncome = transactions.filter(item => item.type === 'income').reduce((total, item) => total + Number(item.amount), 0);
    const totalExpenses = transactions.filter(item => item.type === 'expense').reduce((total, item) => total + Number(item.amount), 0);
    document.querySelector('#balance').textContent = formatMoney(totalIncome - totalExpenses);
    document.querySelector('#incomeTotal').textContent = formatMoney(income);
    document.querySelector('#expenseTotal').textContent = formatMoney(expenses);
    document.querySelector('#balanceNote').textContent = 'Akumulasi seluruh transaksi';
    const spent = Math.round(expenses);
    const percentage = budget > 0 ? Math.min(100, Math.round(spent / budget * 100)) : 0;
    document.querySelector('#budgetAmount').innerHTML = `${formatMoney(spent)} <span>/ ${formatMoney(budget)}</span>`;
    document.querySelector('#budgetProgress').style.width = `${percentage}%`;
    document.querySelector('#budgetProgress').style.background = percentage >= 100 ? 'var(--coral)' : 'var(--yellow)';
    document.querySelector('#budgetPercent').textContent = `${percentage}% terpakai`;
    document.querySelector('#budgetRemaining').textContent = `Sisa ${formatMoney(Math.max(0, budget - spent))}`;
    document.querySelector('.progress').setAttribute('aria-valuenow', String(percentage));

    const query = document.querySelector('#searchInput').value.trim().toLocaleLowerCase('id-ID');
    const type = document.querySelector('#typeFilter').value;
    const visible = current.filter(item => (type === 'all' || item.type === type) && `${item.name} ${item.category} ${item.account || ''} ${item.destination || ''} ${paymentMethodLabels[item.paymentMethod] || ''}`.toLocaleLowerCase('id-ID').includes(query)).sort((a, b) => b.date.localeCompare(a.date));
    rows.innerHTML = visible.map(item => {
      const accountLabel = item.type === 'transfer' ? `${item.account} → ${item.destination}` : item.account || 'Belum diisi';
      const amountSign = item.type === 'income' ? '+' : item.type === 'expense' ? '−' : '↔';
      const methodLabel = paymentMethodLabels[item.paymentMethod] || '—';
      return `<tr><td><div class="tx-name"><span class="tx-icon">${escapeHTML(item.icon || (item.type === 'income' ? '↗' : '•'))}</span>${escapeHTML(item.name)}</div></td><td><span class="category">${escapeHTML(item.category)}</span></td><td>${escapeHTML(accountLabel)}</td><td>${escapeHTML(methodLabel)}</td><td>${dateFormatter.format(new Date(`${item.date}T12:00:00`))}</td><td class="amount ${item.type}">${amountSign} ${formatMoney(Number(item.amount))}</td><td><button class="delete" data-delete="${escapeHTML(item.id)}" aria-label="Hapus ${escapeHTML(item.name)}" title="Hapus transaksi">×</button></td></tr>`;
    }).join('');
    emptyState.hidden = visible.length > 0;
    drawChart(current);
  }

  function drawChart(items) {
    const canvas = document.querySelector('#cashflowChart');
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);
    const context = canvas.getContext('2d');
    context.scale(ratio, ratio);
    const width = rect.width;
    const height = rect.height;
    const padding = { top: 12, right: 10, bottom: 25, left: 42 };
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const [year, month] = selectedMonth().split('-').map(Number);
    const days = new Date(year, month, 0).getDate();
    const incoming = Array(days).fill(0);
    const outgoing = Array(days).fill(0);
    items.forEach(item => {
      const day = Number(item.date.slice(8, 10)) - 1;
      if (item.type === 'income') incoming[day] += Number(item.amount);
      if (item.type === 'expense') outgoing[day] += Number(item.amount);
    });
    const max = Math.max(1, ...incoming, ...outgoing);
    const top = Math.pow(10, Math.floor(Math.log10(max)));
    const ceiling = Math.ceil(max / top) * top;
    context.font = '10px DM Sans, sans-serif';
    context.textBaseline = 'middle';
    for (let tick = 0; tick <= 3; tick++) {
      const y = padding.top + plotHeight * tick / 3;
      context.strokeStyle = '#eff0ec';
      context.lineWidth = 1;
      context.beginPath(); context.moveTo(padding.left, y); context.lineTo(width - padding.right, y); context.stroke();
      context.fillStyle = '#9a9d95';
      const value = ceiling * (1 - tick / 3);
      const label = value >= 1000000 ? `${(value / 1000000).toLocaleString('id-ID')} jt` : value >= 1000 ? `${Math.round(value / 1000)} rb` : `${Math.round(value)}`;
      context.fillText(label, 0, y);
    }
    const groupWidth = plotWidth / days;
    const barWidth = Math.max(2, Math.min(9, groupWidth * .29));
    for (let index = 0; index < days; index++) {
      const center = padding.left + groupWidth * (index + .5);
      const incomingHeight = incoming[index] / ceiling * plotHeight;
      const outgoingHeight = outgoing[index] / ceiling * plotHeight;
      context.fillStyle = '#1c765a';
      context.beginPath(); context.roundRect(center - barWidth - 1, padding.top + plotHeight - incomingHeight, barWidth, incomingHeight, [3, 3, 0, 0]); context.fill();
      context.fillStyle = '#d87359';
      context.beginPath(); context.roundRect(center + 1, padding.top + plotHeight - outgoingHeight, barWidth, outgoingHeight, [3, 3, 0, 0]); context.fill();
    }
    const labels = days <= 20 ? [1, 5, 10, 15, 20, days] : [1, 5, 10, 15, 20, 25, days];
    context.fillStyle = '#9a9d95';
    context.textAlign = 'center';
    labels.forEach(day => context.fillText(String(day), padding.left + groupWidth * (day - .5), height - 10));
  }

  function updateCategories() {
    const isTransfer = selectedType === 'transfer';
    const isExpense = selectedType === 'expense';
    if (!isTransfer) categorySelect.innerHTML = categoryOptions[selectedType].map(value => `<option>${value}</option>`).join('');
    categoryField.hidden = isTransfer;
    categorySelect.required = !isTransfer;
    paymentMethodField.hidden = !isExpense;
    paymentMethodSelect.required = isExpense;
    if (!isExpense) paymentMethodSelect.value = '';
    amountField.style.gridColumn = isTransfer ? '1 / -1' : '';
    document.querySelector('#accountLabel').textContent = isTransfer ? 'Dari rekening' : 'Sumber / rekening';
    destinationField.hidden = !isTransfer;
    destinationSelect.required = isTransfer;
    if (!isTransfer) {
      destinationSelect.value = '';
      customDestinationField.hidden = true;
      customDestinationInput.required = false;
    }
    document.querySelector('#transactionForm [name="name"]').placeholder = isTransfer ? 'Contoh: Pindah dana ke tabungan' : 'Contoh: Belanja mingguan';
    document.querySelectorAll('.type-switch button').forEach(button => {
      button.classList.toggle('active', button.dataset.type === selectedType);
      button.setAttribute('aria-pressed', String(button.dataset.type === selectedType));
    });
  }

  async function loadDashboard() {
    const [transactionData, budgetData] = await Promise.all([api('/api/transactions'), api('/api/budget')]);
    transactions = transactionData.transactions;
    budget = budgetData.budget;
    buildMonthOptions();
  }

  async function enterApp(user, newIpDetected = false) {
    await loadDashboard();
    profileName = user.name;
    updateProfile(profileName);
    document.querySelector('#authScreen').hidden = true;
    document.querySelector('#app').hidden = false;
    render();
    if (newIpDetected) showWarning('Login terdeteksi dari alamat IP yang berbeda. Jika ini bukan Anda, segera keluar dan amankan akun.');
  }

  function showTransactionError(error) {
    showWarning(error.message);
  }

  document.querySelector('#closeAppNotice').addEventListener('click', () => {
    document.querySelector('#appNotice').hidden = true;
  });

  authConfirmPassword.addEventListener('input', () => authConfirmPassword.setCustomValidity(''));
  authSwitch.addEventListener('click', () => {
    if (authMode === 'reset' || authMode === 'forgot') {
      resetToken = '';
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    }
    setAuthMode(authMode === 'login' ? 'register' : 'login');
  });
  forgotPasswordButton.addEventListener('click', () => {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#forgot-password`);
    setAuthMode('forgot');
  });
  authForm.addEventListener('submit', async event => {
    event.preventDefault();
    authSubmit.disabled = true;
    authSubmit.textContent = authMode === 'forgot' ? 'Mengirim tautan…' : authMode === 'reset' ? 'Menyimpan…' : 'Memproses…';
    authSwitch.disabled = true;
    forgotPasswordButton.disabled = true;
    try {
      if (authMode === 'forgot') {
        const result = await api('/api/password-reset/request', {
          method: 'POST',
          body: JSON.stringify({ email: authEmail.value })
        });
        passwordResetRequested = true;
        authSubmit.textContent = 'Kirim ulang tautan';
        showAuthMessage(`${result.message} Periksa juga folder spam.`, true);
        return;
      }
      if (authMode === 'reset') {
        if (authPassword.value !== authConfirmPassword.value) {
          authConfirmPassword.setCustomValidity('Kata sandi baru tidak cocok.');
          authConfirmPassword.reportValidity();
          return;
        }
        const result = await api('/api/password-reset/confirm', {
          method: 'POST',
          body: JSON.stringify({ token: resetToken, password: authPassword.value })
        });
        resetToken = '';
        window.history.replaceState(null, '', window.location.pathname);
        authForm.reset();
        setAuthMode('login');
        showAuthMessage(result.message, true);
        return;
      }
      const payload = { email: authEmail.value, password: authPassword.value };
      if (authMode === 'register') payload.name = authName.value;
      const endpoint = authMode === 'register' ? '/api/register' : '/api/login';
      const result = await api(endpoint, { method: 'POST', body: JSON.stringify(payload) });
      authForm.reset();
      await enterApp(result.user, result.newIpDetected);
    } catch (error) {
      showAuthMessage(error.message);
    } finally {
      authSubmit.disabled = false;
      authSwitch.disabled = false;
      forgotPasswordButton.disabled = false;
      authSubmit.textContent = authSubmitLabel();
    }
  });

  document.querySelector('#logout').addEventListener('click', async () => {
    try {
      await api('/api/logout', { method: 'POST', body: '{}' });
    } finally {
      transactions = [];
      budget = 0;
      document.querySelector('#app').hidden = true;
      document.querySelector('#authScreen').hidden = false;
      setAuthMode('login');
    }
  });

  document.querySelector('#editProfile').addEventListener('click', async () => {
    const nextName = window.prompt('Nama pribadi yang ingin ditampilkan:', profileName);
    if (nextName === null) return;
    const cleanName = nextName.trim();
    if (!cleanName) {
      showWarning('Nama tidak boleh kosong.');
      return;
    }
    try {
      const result = await api('/api/profile', { method: 'PATCH', body: JSON.stringify({ name: cleanName }) });
      updateProfile(result.user.name);
    } catch (error) {
      showTransactionError(error);
    }
  });

  amountInput.addEventListener('input', () => {
    amountInput.setCustomValidity('');
    const digits = amountInput.value.replace(/\D/g, '').slice(0, 15);
    amountInput.value = digits ? Number(digits).toLocaleString('id-ID') : '';
  });
  customAccountInput.addEventListener('input', () => customAccountInput.setCustomValidity(''));
  customDestinationInput.addEventListener('input', () => customDestinationInput.setCustomValidity(''));
  monthSelect.addEventListener('change', render);
  document.querySelector('#searchInput').addEventListener('input', render);
  document.querySelector('#typeFilter').addEventListener('change', render);

  document.querySelector('#openForm').addEventListener('click', () => {
    form.reset();
    customDestinationField.hidden = true;
    customDestinationInput.required = false;
    customAccountField.hidden = true;
    customAccountInput.required = false;
    selectedType = 'expense';
    updateCategories();
    form.elements.date.value = localDateString();
    dialog.showModal();
    form.elements.name.focus();
  });
  document.querySelector('#closeForm').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  document.querySelectorAll('.type-switch button').forEach(button => button.addEventListener('click', () => {
    selectedType = button.dataset.type;
    updateCategories();
  }));
  accountSelect.addEventListener('change', event => {
    const isCustom = event.target.value === '__custom';
    customAccountField.hidden = !isCustom;
    customAccountInput.required = isCustom;
    if (isCustom) customAccountInput.focus();
  });
  destinationSelect.addEventListener('change', event => {
    const isCustom = event.target.value === '__custom';
    customDestinationField.hidden = !isCustom;
    customDestinationInput.required = isCustom;
    if (isCustom) customDestinationInput.focus();
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const amount = Number(data.get('amount').replace(/\D/g, ''));
    const account = data.get('account') === '__custom' ? data.get('customAccount').trim() : data.get('account');
    const destination = data.get('destination') === '__custom' ? data.get('customDestination').trim() : data.get('destination');
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      amountInput.setCustomValidity('Jumlah harus lebih dari 0.');
      amountInput.reportValidity();
      return;
    }
    if (selectedType === 'transfer' && account.toLocaleLowerCase('id-ID') === destination.toLocaleLowerCase('id-ID')) {
      showWarning('Rekening asal dan tujuan harus berbeda.');
      destinationSelect.focus();
      return;
    }
    const payload = {
      name: data.get('name').trim(), type: selectedType,
      category: selectedType === 'transfer' ? 'Transfer' : data.get('category'),
      account, destination: selectedType === 'transfer' ? destination : '',
      ...(selectedType === 'expense' ? { paymentMethod: data.get('paymentMethod') } : {}),
      amount, date: data.get('date')
    };
    try {
      const result = await api('/api/transactions', { method: 'POST', body: JSON.stringify(payload) });
      transactions.push(result.transaction);
      buildMonthOptions();
      monthSelect.value = payload.date.slice(0, 7);
      dialog.close();
      render();
    } catch (error) {
      showTransactionError(error);
    }
  });

  rows.addEventListener('click', async event => {
    const button = event.target.closest('[data-delete]');
    if (!button) return;
    try {
      await api(`/api/transactions/${encodeURIComponent(button.dataset.delete)}`, { method: 'DELETE' });
      transactions = transactions.filter(item => item.id !== button.dataset.delete);
      buildMonthOptions();
      render();
    } catch (error) {
      showTransactionError(error);
    }
  });

  document.querySelector('#editBudget').addEventListener('click', async () => {
    const answer = window.prompt('Masukkan anggaran bulanan (rupiah):', String(budget));
    if (answer === null) return;
    const nextBudget = Number(answer.replace(/\D/g, ''));
    if (!Number.isSafeInteger(nextBudget) || nextBudget <= 0) {
      showWarning('Anggaran harus berupa angka lebih dari 0.');
      return;
    }
    try {
      const result = await api('/api/budget', { method: 'PUT', body: JSON.stringify({ budget: nextBudget }) });
      budget = result.budget;
      render();
    } catch (error) {
      showTransactionError(error);
    }
  });

  let deferredInstallPrompt = null;
  document.querySelectorAll('[data-install]').forEach(button => button.addEventListener('click', async () => {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      return;
    }
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const instructions = isIOS
      ? 'Untuk memasang aplikasi, buka menu Bagikan di Safari lalu pilih Tambahkan ke Layar Utama.'
      : 'Buka menu browser lalu pilih Instal aplikasi atau Tambahkan ke layar utama.';
    showWarning(`${instructions} Pemasangan memerlukan koneksi HTTPS.`);
  }));

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredInstallPrompt = event;
  });
  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    document.querySelectorAll('[data-install]').forEach(button => button.hidden = true);
  });

  if ('serviceWorker' in navigator && window.isSecureContext) {
    let waitingWorker = null;
    let reloadAfterUpdate = false;
    const updateNotice = document.querySelector('#updateNotice');
    const announceUpdate = worker => {
      waitingWorker = worker;
      updateNotice.hidden = false;
    };

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloadAfterUpdate) window.location.reload();
    });

    document.querySelector('#updateApp').addEventListener('click', () => {
      if (!waitingWorker) return;
      if (!window.confirm('Perbarui aplikasi sekarang? Data tersimpan tetap aman, tetapi draf yang belum disimpan akan hilang.')) return;
      reloadAfterUpdate = true;
      waitingWorker.postMessage('SKIP_WAITING');
    });

    navigator.serviceWorker.register('/sw.js')
      .then(registration => {
        if (registration.waiting && navigator.serviceWorker.controller) announceUpdate(registration.waiting);
        registration.addEventListener('updatefound', () => {
          const installingWorker = registration.installing;
          installingWorker?.addEventListener('statechange', () => {
            if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) announceUpdate(installingWorker);
          });
        });
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') registration.update().catch(() => {});
        });
      })
      .catch(() => {});
  }

  window.addEventListener('resize', () => drawChart(monthTransactions()));
  populateAccountOptions();
  updateCategories();
  if (resetToken) {
    setAuthMode('reset');
  } else if (openPasswordRecovery) {
    setAuthMode('forgot');
  } else {
    setAuthMode('login');
    api('/api/me')
      .then(result => result.user ? enterApp(result.user) : undefined)
      .catch(() => document.querySelector('#authScreen').hidden = false);
  }
})();
