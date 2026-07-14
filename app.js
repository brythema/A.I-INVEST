/* ==========================================================================
   Aurura Invest — app.js
   Single bundled script: storage layer, UI helpers, per-view logic, and
   the hash router that ties it all together. Sections are separated by
   banner comments below instead of separate files.
   ========================================================================== */

/* ==========================================================================
   1. STORAGE LAYER
   Everything here stands in for backend calls. Every function is written
   so swapping the body for a fetch() later doesn't change any caller.
   ========================================================================== */

const AururaStore = (() => {
  const KEYS = {
    users: 'aurura_users',
    session: 'aurura_session',
  };

  const NETWORKS = [
    { code: 'BTC',         label: 'Bitcoin',  chain: 'Bitcoin' },
    { code: 'ETH',         label: 'Ethereum', chain: 'Ethereum (ERC20)' },
    { code: 'USDT-TRC20',  label: 'USDT',     chain: 'Tron (TRC20)' },
    { code: 'USDT-ERC20',  label: 'USDT',     chain: 'Ethereum (ERC20)' },
    { code: 'BNB',         label: 'BNB',      chain: 'BNB Smart Chain (BEP20)' },
  ];

  const PLANS = [
    { id: 'essential', name: 'Essential', summary: 'For your first allocation.', minAmount: 1000, durations: [30, 60], riskLabel: 'Lower risk', returnRange: [4, 7] },
    { id: 'growth', name: 'Growth', summary: 'For building portfolio participation.', minAmount: 10000, durations: [60, 90], riskLabel: 'Balanced risk', returnRange: [7, 12] },
    { id: 'professional', name: 'Professional', summary: 'For broader access to the full framework.', minAmount: 100000, durations: [90, 180], riskLabel: 'Moderate-high risk', returnRange: [12, 18] },
    { id: 'institutional', name: 'Institutional', summary: 'Tailored allocations for qualified accounts.', minAmount: 25000, durations: [180, 365], riskLabel: 'Custom risk profile', returnRange: [null, null], contactOnly: true },
  ];

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      console.error('Storage read failed', key, e);
      return fallback;
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.error('Storage write failed', key, e);
      return false;
    }
  }

  function genId(prefix = 'id') {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function seededHex(seed, length) {
    let h = 0;
    for (let i = 0; i < seed.length; i++) {
      h = (h << 5) - h + seed.charCodeAt(i);
      h |= 0;
    }
    let out = '';
    const chars = '0123456789abcdef';
    let x = Math.abs(h) || 1;
    for (let i = 0; i < length; i++) {
      x = (x * 48271) % 2147483647;
      out += chars[x % 16];
    }
    return out;
  }

  function generateAddress(userId, networkCode) {
    const seed = `${userId}:${networkCode}`;
    if (networkCode === 'BTC') return `bc1q${seededHex(seed, 38)}`;
    if (networkCode === 'USDT-TRC20') return `T${seededHex(seed, 33).slice(0, 33).toUpperCase()}`;
    return `0x${seededHex(seed, 40)}`;
  }

  function buildWallets(userId) {
    const wallets = {};
    NETWORKS.forEach(n => { wallets[n.code] = { network: n.code, address: generateAddress(userId, n.code) }; });
    return wallets;
  }

  function getUsers() { return read(KEYS.users, {}); }
  function saveUsers(users) { write(KEYS.users, users); }

  function findUserByEmail(email) {
    const users = getUsers();
    return users[email.toLowerCase().trim()] || null;
  }

  function createUser({ fullName, email, phone, country, password }) {
    const users = getUsers();
    const key = email.toLowerCase().trim();
    if (users[key]) return { ok: false, error: 'An account with this email already exists.' };
    const id = genId('usr');
    const user = {
      id, fullName, email: key, phone, country, password,
      createdAt: new Date().toISOString(),
      kyc: { status: 'not_started', submittedAt: null, documentType: null, selfieCaptured: false },
      withdrawalWallet: null,
      balances: { available: 0, invested: 0 },
      wallets: buildWallets(id),
      investments: [],
      transactions: [],
      notifications: [{
        id: genId('ntf'), type: 'welcome', title: 'Welcome to Aurura Invest',
        body: 'Your account is ready. Fund your wallet to get started.',
        read: false, createdAt: new Date().toISOString(),
      }],
    };
    users[key] = user;
    saveUsers(users);
    return { ok: true, user };
  }

  function saveUser(user) {
    const users = getUsers();
    users[user.email] = user;
    saveUsers(users);
  }

  function login(email, password) {
    const user = findUserByEmail(email);
    if (!user) return { ok: false, error: 'No account found with that email.' };
    if (user.password !== password) return { ok: false, error: 'Incorrect password.' };
    write(KEYS.session, { email: user.email });
    return { ok: true, user };
  }

  function logout() { localStorage.removeItem(KEYS.session); }
  function getSession() { return read(KEYS.session, null); }

  function getCurrentUser() {
    const session = getSession();
    if (!session) return null;
    return findUserByEmail(session.email);
  }

  function addTransaction(email, tx) {
    const user = findUserByEmail(email);
    if (!user) return null;
    const record = { id: genId('txn'), createdAt: new Date().toISOString(), status: 'pending', ...tx };
    user.transactions.unshift(record);
    saveUser(user);
    return record;
  }

  function createInvestment(email, { planId, amount, durationDays }) {
    const user = findUserByEmail(email);
    if (!user) return { ok: false, error: 'User not found.' };
    if (amount > user.balances.available) return { ok: false, error: 'That amount is more than your available balance.' };
    const plan = PLANS.find(p => p.id === planId);
    const startedAt = new Date();
    const maturityAt = new Date(startedAt.getTime() + durationDays * 86400000);
    const investment = {
      id: genId('inv'), planId, planName: plan ? plan.name : planId, amount, durationDays,
      startedAt: startedAt.toISOString(), maturityAt: maturityAt.toISOString(),
      status: 'active', currentValue: amount, returnAmount: null,
    };
    user.balances.available -= amount;
    user.balances.invested += amount;
    user.investments.unshift(investment);
    addTransaction(email, {
      type: 'investment_allocation', label: `Allocated to ${investment.planName}`,
      amount: -amount, relatedId: investment.id, status: 'completed',
    });
    saveUser(user);
    return { ok: true, investment };
  }

  function formatCurrency(n) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n || 0);
  }

  function timeAgo(iso) {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  return {
    NETWORKS, PLANS,
    createUser, findUserByEmail, saveUser,
    login, logout, getSession, getCurrentUser,
    addTransaction, createInvestment,
    generateAddress, genId,
    formatCurrency, timeAgo,
  };
})();

/* ==========================================================================
   2. UI HELPERS
   ========================================================================== */

const AururaUI = (() => {
  function ensureToastStack() {
    let stack = document.querySelector('.toast-stack');
    if (!stack) {
      stack = document.createElement('div');
      stack.className = 'toast-stack';
      document.body.appendChild(stack);
    }
    return stack;
  }

  function toast(message, type = 'default') {
    const stack = ensureToastStack();
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.setAttribute('role', 'status');
    el.textContent = message;
    stack.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(-8px)';
      el.style.transition = 'all 200ms ease';
      setTimeout(() => el.remove(), 220);
    }, 3200);
  }

  const ICONS = {
    home: '<path d="M4 11.5 12 4l8 7.5"/><path d="M6 10v9a1 1 0 0 0 1 1h3v-6h4v6h3a1 1 0 0 0 1-1v-9"/>',
    invest: '<path d="M4 19V10"/><path d="M10 19V4"/><path d="M16 19v-7"/><path d="M22 19H2"/>',
    wallet: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/><circle cx="16" cy="14.5" r="1"/>',
    activity: '<path d="M3 12h4l2 8 4-16 2 8h6"/>',
    profile: '<circle cx="12" cy="8" r="4"/><path d="M4 20c1.5-4.5 5-6 8-6s6.5 1.5 8 6"/>',
  };

  function icon(name, size = 22) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
  }

  function initials(name) {
    if (!name) return '?';
    return name.trim().split(/\s+/).slice(0, 2).map(s => s[0].toUpperCase()).join('');
  }

  function bindAccordion(container) {
    container.querySelectorAll('.accordion-item').forEach(item => {
      if (item.dataset.bound) return;
      item.dataset.bound = 'true';
      const trigger = item.querySelector('.accordion-trigger');
      const panel = item.querySelector('.accordion-panel');
      if (!trigger || !panel) return;
      trigger.addEventListener('click', () => {
        const isOpen = item.classList.contains('open');
        item.classList.toggle('open', !isOpen);
        trigger.setAttribute('aria-expanded', String(!isOpen));
        panel.style.maxHeight = !isOpen ? panel.scrollHeight + 'px' : '0px';
      });
      if (item.classList.contains('open')) {
        panel.style.maxHeight = panel.scrollHeight + 'px';
      }
    });
  }

  return { toast, icon, initials, bindAccordion };
})();

/* ==========================================================================
   3. VIEW: auth (login / create account)
   ========================================================================== */

function initAuthView(params) {
  const view = document.querySelector('[data-view="auth"]');
  const tabLogin = document.getElementById('tabLogin');
  const tabCreate = document.getElementById('tabCreate');
  const panelLogin = document.getElementById('panelLogin');
  const panelCreate = document.getElementById('panelCreate');

  function activateTab(which) {
    const isLogin = which === 'login';
    tabLogin.classList.toggle('active', isLogin);
    tabCreate.classList.toggle('active', !isLogin);
    tabLogin.setAttribute('aria-selected', String(isLogin));
    tabCreate.setAttribute('aria-selected', String(!isLogin));
    panelLogin.hidden = !isLogin;
    panelCreate.hidden = isLogin;
  }

  activateTab(params && params.tab === 'create' ? 'create' : 'login');

  if (view.dataset.initialized) return;
  view.dataset.initialized = 'true';

  tabLogin.addEventListener('click', () => activateTab('login'));
  tabCreate.addEventListener('click', () => activateTab('create'));

  document.querySelectorAll('[data-toggle-password]').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.togglePassword);
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      btn.textContent = showing ? 'Show' : 'Hide';
    });
  });

  function setError(fieldId, message) {
    const el = document.getElementById(`${fieldId}Error`);
    const input = document.getElementById(fieldId);
    if (el) el.textContent = message || '';
    if (input) input.setAttribute('aria-invalid', message ? 'true' : 'false');
  }
  function clearErrors(ids) { ids.forEach(id => setError(id, '')); }

  const loginForm = document.getElementById('loginForm');
  loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    clearErrors(['loginEmail', 'loginPassword']);
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    if (!email) return setError('loginEmail', 'Enter your email to continue.');
    if (!password) return setError('loginPassword', 'Enter your password to continue.');

    const submitBtn = document.getElementById('loginSubmit');
    submitBtn.dataset.loading = 'true';
    setTimeout(() => {
      const result = AururaStore.login(email, password);
      submitBtn.dataset.loading = 'false';
      if (!result.ok) { setError('loginPassword', result.error); return; }
      AururaRouter.navigate('dashboard');
    }, 400);
  });

  const createForm = document.getElementById('createForm');
  createForm.addEventListener('submit', (e) => {
    e.preventDefault();
    clearErrors(['regName', 'regEmail', 'regPhone', 'regCountry', 'regPassword', 'agreeTerms']);

    const fullName = document.getElementById('regName').value.trim();
    const email = document.getElementById('regEmail').value.trim();
    const phone = document.getElementById('regPhone').value.trim();
    const country = document.getElementById('regCountry').value;
    const password = document.getElementById('regPassword').value;
    const agreed = document.getElementById('agreeTerms').checked;

    let hasError = false;
    if (fullName.length < 2) { setError('regName', 'Enter your full name.'); hasError = true; }
    if (!/^\S+@\S+\.\S+$/.test(email)) { setError('regEmail', 'Enter a valid email address.'); hasError = true; }
    if (phone.length < 7) { setError('regPhone', 'Enter a valid phone number.'); hasError = true; }
    if (!country) { setError('regCountry', 'Select your country.'); hasError = true; }
    if (password.length < 8) { setError('regPassword', 'Password needs at least 8 characters.'); hasError = true; }
    if (!agreed) { setError('agreeTerms', 'Accept the Terms of Use and Privacy Policy to continue.'); hasError = true; }
    if (hasError) return;

    const submitBtn = document.getElementById('createSubmit');
    submitBtn.dataset.loading = 'true';
    setTimeout(() => {
      const result = AururaStore.createUser({ fullName, email, phone, country, password });
      submitBtn.dataset.loading = 'false';
      if (!result.ok) { setError('regEmail', result.error); return; }
      AururaStore.login(email, password);
      AururaRouter.pendingWelcome = true;
      AururaRouter.navigate('dashboard');
    }, 500);
  });
}

/* ==========================================================================
   4. VIEW: dashboard
   ========================================================================== */

function initDashboardView() {
  const user = AururaStore.getCurrentUser();
  if (!user) return;

  if (AururaRouter.pendingWelcome) {
    AururaRouter.pendingWelcome = false;
    AururaUI.toast(`Welcome, ${user.fullName.split(' ')[0]}. Your account is ready.`, 'success');
  }

  const kycBanner = document.getElementById('kycBanner');
  kycBanner.hidden = user.kyc.status === 'verified';

  const hasUnread = user.notifications.some(n => !n.read);
  document.getElementById('notifDot').hidden = !hasUnread;

  const total = user.balances.available + user.balances.invested;
  document.getElementById('portfolioValue').textContent = AururaStore.formatCurrency(total);
  document.getElementById('availableBalance').textContent = AururaStore.formatCurrency(user.balances.available);
  document.getElementById('investedBalance').textContent = AururaStore.formatCurrency(user.balances.invested);

  const changeEl = document.getElementById('portfolioChange');
  if (user.investments.length === 0) {
    changeEl.textContent = 'Fund your wallet to start your first allocation';
  } else {
    changeEl.innerHTML = `<span class="badge badge-neutral">${user.investments.filter(i => i.status === 'active').length} active</span>`;
  }

  const investmentsEl = document.getElementById('activeInvestments');
  const active = user.investments.filter(i => i.status === 'active');
  if (active.length === 0) {
    investmentsEl.innerHTML = `
      <div class="card empty-state">
        <div class="empty-state-icon">${AururaUI.icon('invest', 26)}</div>
        <h3>No active investments yet</h3>
        <p>Fund your wallet, then choose a plan that matches your goals.</p>
        <a href="#invest" class="btn btn-primary btn-sm" style="margin-top:16px;">Browse plans</a>
      </div>
    `;
  } else {
    investmentsEl.innerHTML = active.slice(0, 3).map(inv => {
      const maturity = new Date(inv.maturityAt);
      const started = new Date(inv.startedAt);
      const totalMs = maturity - started;
      const elapsedMs = Date.now() - started;
      const pct = Math.min(100, Math.max(0, Math.round((elapsedMs / totalMs) * 100)));
      return `
        <div class="card investment-card">
          <div class="investment-card-top">
            <span class="investment-card-name">${inv.planName}</span>
            <span class="badge badge-positive">Active</span>
          </div>
          <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
          <div class="investment-card-meta">
            <span>${AururaStore.formatCurrency(inv.amount)} allocated</span>
            <span>Matures ${maturity.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
          </div>
        </div>
      `;
    }).join('');
  }

  const activityEl = document.getElementById('recentActivity');
  const recent = user.transactions.slice(0, 5);
  if (recent.length === 0) {
    activityEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">${AururaUI.icon('activity', 26)}</div>
        <h3>Nothing here yet</h3>
        <p>Your deposits, allocations, and withdrawals will show up here.</p>
      </div>
    `;
  } else {
    activityEl.innerHTML = recent.map(txn => {
      const positive = txn.amount > 0;
      return `
        <div class="activity-row">
          <div class="activity-icon">${AururaUI.icon(positive ? 'wallet' : 'invest', 18)}</div>
          <div class="activity-body">
            <div class="activity-title">${txn.label}</div>
            <div class="activity-sub">${AururaStore.timeAgo(txn.createdAt)}</div>
          </div>
          <div class="activity-amount ${positive ? 'positive' : 'negative'}">
            ${positive ? '+' : ''}${AururaStore.formatCurrency(txn.amount)}
          </div>
        </div>
      `;
    }).join('');
  }

  const view = document.querySelector('[data-view="dashboard"]');
  if (view.dataset.initialized) return;
  view.dataset.initialized = 'true';
}

/* ==========================================================================
   5. VIEW: wallet
   ========================================================================== */

function initWalletView(params) {
  const user = AururaStore.getCurrentUser();
  if (!user) return;

  document.getElementById('walletBalance').textContent = AururaStore.formatCurrency(user.balances.available);

  function networkOptions() {
    return AururaStore.NETWORKS.map(n => `<option value="${n.code}">${n.label} — ${n.chain}</option>`).join('');
  }
  document.getElementById('depositNetwork').innerHTML = networkOptions();
  document.getElementById('withdrawNetwork').innerHTML = networkOptions();

  const txnsEl = document.getElementById('walletTxns');
  function renderTxns() {
    const txns = user.transactions;
    if (txns.length === 0) {
      txnsEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">${AururaUI.icon('wallet', 26)}</div>
          <h3>No transactions yet</h3>
          <p>Deposits and withdrawals will appear here once you make one.</p>
        </div>
      `;
      return;
    }
    txnsEl.innerHTML = txns.map(t => {
      const positive = t.amount > 0;
      const statusBadge = t.status === 'pending'
        ? '<span class="badge badge-warning">Pending</span>'
        : t.status === 'completed'
          ? '<span class="badge badge-positive">Completed</span>'
          : '<span class="badge badge-negative">Failed</span>';
      return `
        <div class="activity-row">
          <div class="activity-icon">${AururaUI.icon(positive ? 'wallet' : 'invest', 18)}</div>
          <div class="activity-body">
            <div class="activity-title">${t.label}</div>
            <div class="activity-sub">${AururaStore.timeAgo(t.createdAt)}</div>
          </div>
          <div style="text-align:right;">
            <div class="activity-amount ${positive ? 'positive' : 'negative'}">${positive ? '+' : ''}${AururaStore.formatCurrency(t.amount)}</div>
            <div style="margin-top:4px;">${statusBadge}</div>
          </div>
        </div>
      `;
    }).join('');
  }
  renderTxns();

  function openOverlay(id) { document.getElementById(id).classList.add('open'); }
  function closeOverlay(id) { document.getElementById(id).classList.remove('open'); }

  const depositNetworkSelect = document.getElementById('depositNetwork');
  function refreshDepositAddress() {
    const code = depositNetworkSelect.value;
    const wallet = user.wallets[code];
    document.getElementById('depositAddress').textContent = wallet.address;
    const net = AururaStore.NETWORKS.find(n => n.code === code);
    document.getElementById('depositNetworkLabel').textContent = net.label;
  }

  const view = document.querySelector('[data-view="wallet"]');
  if (!view.dataset.initialized) {
    view.dataset.initialized = 'true';

    document.querySelectorAll('#depositOverlay, #withdrawOverlay, #transferOverlay').forEach(ov => {
      ov.addEventListener('click', (e) => { if (e.target === ov) ov.classList.remove('open'); });
    });

    depositNetworkSelect.addEventListener('change', refreshDepositAddress);
    document.getElementById('btnDeposit').addEventListener('click', () => { refreshDepositAddress(); openOverlay('depositOverlay'); });
    document.getElementById('closeDepositBtn').addEventListener('click', () => closeOverlay('depositOverlay'));

    document.getElementById('copyAddressBtn').addEventListener('click', () => {
      const address = document.getElementById('depositAddress').textContent;
      navigator.clipboard.writeText(address).then(() => {
        AururaUI.toast('Address copied', 'success');
      }).catch(() => {
        AururaUI.toast('Could not copy — copy the address manually', 'error');
      });
    });

    document.getElementById('btnWithdraw').addEventListener('click', () => {
      const currentUser = AururaStore.getCurrentUser();
      document.getElementById('withdrawAvailableHint').textContent = `Available: ${AururaStore.formatCurrency(currentUser.balances.available)}`;
      openOverlay('withdrawOverlay');
    });

    document.getElementById('withdrawForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const currentUser = AururaStore.getCurrentUser();
      const networkCode = document.getElementById('withdrawNetwork').value;
      const address = document.getElementById('withdrawAddress').value.trim();
      const amount = parseFloat(document.getElementById('withdrawAmount').value);

      document.getElementById('withdrawAddressError').textContent = '';
      document.getElementById('withdrawAmountError').textContent = '';

      if (!address || address.length < 6) { document.getElementById('withdrawAddressError').textContent = 'Enter a valid destination address.'; return; }
      if (!amount || amount <= 0) { document.getElementById('withdrawAmountError').textContent = 'Enter an amount greater than zero.'; return; }
      if (amount > currentUser.balances.available) { document.getElementById('withdrawAmountError').textContent = 'That amount is more than your available balance.'; return; }

      const btn = document.getElementById('withdrawSubmit');
      btn.dataset.loading = 'true';
      setTimeout(() => {
        currentUser.balances.available -= amount;
        AururaStore.addTransaction(currentUser.email, {
          type: 'withdrawal',
          label: `Withdrawal — ${networkCode} to ${address.slice(0, 6)}…${address.slice(-4)}`,
          amount: -amount, status: 'pending',
        });
        AururaStore.saveUser(currentUser);
        btn.dataset.loading = 'false';
        closeOverlay('withdrawOverlay');
        document.getElementById('withdrawForm').reset();
        document.getElementById('walletBalance').textContent = AururaStore.formatCurrency(currentUser.balances.available);
        renderTxns();
        AururaUI.toast('Withdrawal request submitted', 'success');
      }, 500);
    });

    document.getElementById('btnTransfer').addEventListener('click', () => openOverlay('transferOverlay'));
  }

  if (params && params.action === 'deposit') { refreshDepositAddress(); openOverlay('depositOverlay'); }
  if (params && params.action === 'withdraw') {
    document.getElementById('withdrawAvailableHint').textContent = `Available: ${AururaStore.formatCurrency(user.balances.available)}`;
    openOverlay('withdrawOverlay');
  }
}

/* ==========================================================================
   6. VIEW: invest
   ========================================================================== */

function initInvestView() {
  const user = AururaStore.getCurrentUser();
  if (!user) return;

  document.getElementById('availableStrip').textContent = AururaStore.formatCurrency(user.balances.available);

  const planListEl = document.getElementById('planList');
  planListEl.innerHTML = AururaStore.PLANS.map(plan => `
    <button class="card plan-card" data-plan-id="${plan.id}">
      <div>
        <div class="plan-card-name">${plan.name}</div>
        <div class="plan-card-meta">From ${AururaStore.formatCurrency(plan.minAmount)} · ${plan.riskLabel}</div>
      </div>
      <span class="plan-card-arrow">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>
      </span>
    </button>
  `).join('');

  const myInvestmentsEl = document.getElementById('myInvestments');
  function renderMyInvestments() {
    const currentUser = AururaStore.getCurrentUser();
    if (currentUser.investments.length === 0) {
      myInvestmentsEl.innerHTML = `
        <div class="card empty-state">
          <div class="empty-state-icon">${AururaUI.icon('invest', 26)}</div>
          <h3>No investments yet</h3>
          <p>Choose a plan above to make your first allocation.</p>
        </div>
      `;
      return;
    }
    myInvestmentsEl.innerHTML = currentUser.investments.map(inv => {
      const maturity = new Date(inv.maturityAt);
      const isActive = inv.status === 'active';
      return `
        <div class="card investment-card">
          <div class="investment-card-top">
            <span class="investment-card-name">${inv.planName}</span>
            <span class="badge ${isActive ? 'badge-positive' : 'badge-neutral'}">${isActive ? 'Active' : 'Matured'}</span>
          </div>
          <div class="investment-card-meta">
            <span>${AururaStore.formatCurrency(inv.amount)} allocated</span>
            <span>${isActive ? 'Matures' : 'Matured'} ${maturity.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
          </div>
        </div>
      `;
    }).join('');
  }
  renderMyInvestments();

  const overlay = document.getElementById('planOverlay');
  let activePlan = null;
  let selectedDuration = null;

  function updateSummary() {
    const currentUser = AururaStore.getCurrentUser();
    const pct = parseInt(document.getElementById('allocPercent').value, 10);
    const amount = Math.round((currentUser.balances.available * pct) / 100 * 100) / 100;
    document.getElementById('allocPercentLabel').textContent = `${pct}%`;
    document.getElementById('allocAmountLabel').textContent = AururaStore.formatCurrency(amount);
    document.getElementById('summaryAmount').textContent = AururaStore.formatCurrency(amount);
    document.getElementById('summaryDuration').textContent = `${selectedDuration} days`;
    const maturity = new Date(Date.now() + selectedDuration * 86400000);
    document.getElementById('summaryMaturity').textContent = maturity.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

    const errEl = document.getElementById('allocAmountError');
    errEl.textContent = amount < activePlan.minAmount
      ? `This plan requires a minimum of ${AururaStore.formatCurrency(activePlan.minAmount)}.`
      : '';
  }

  function openPlan(planId) {
    activePlan = AururaStore.PLANS.find(p => p.id === planId);
    if (!activePlan) return;

    document.getElementById('planTitle').textContent = activePlan.name;
    document.getElementById('planSummary').textContent = activePlan.summary;

    const contactOnly = !!activePlan.contactOnly;
    document.getElementById('planAllocateBlock').hidden = contactOnly;
    document.getElementById('planContactBlock').hidden = !contactOnly;

    document.getElementById('planFacts').innerHTML = `
      <div class="plan-fact"><span class="plan-fact-label">Minimum</span><span class="plan-fact-value">${AururaStore.formatCurrency(activePlan.minAmount)}</span></div>
      <div class="plan-fact"><span class="plan-fact-label">Risk profile</span><span class="plan-fact-value">${activePlan.riskLabel}</span></div>
    `;

    if (!contactOnly) {
      selectedDuration = activePlan.durations[0];
      const tabsEl = document.getElementById('durationTabs');
      tabsEl.innerHTML = activePlan.durations.map((d, i) => `
        <button type="button" class="tab ${i === 0 ? 'active' : ''}" data-duration="${d}">${d} days</button>
      `).join('');
      tabsEl.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
          tabsEl.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          selectedDuration = parseInt(tab.dataset.duration, 10);
          updateSummary();
        });
      });

      const slider = document.getElementById('allocPercent');
      slider.value = 25;
      updateSummary();
    }

    overlay.classList.add('open');
  }

  const view = document.querySelector('[data-view="invest"]');
  if (!view.dataset.initialized) {
    view.dataset.initialized = 'true';

    planListEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.plan-card');
      if (btn) openPlan(btn.dataset.planId);
    });

    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.remove('open'); });
    document.getElementById('allocPercent').addEventListener('input', updateSummary);

    document.getElementById('confirmAllocateBtn').addEventListener('click', () => {
      const currentUser = AururaStore.getCurrentUser();
      const pct = parseInt(document.getElementById('allocPercent').value, 10);
      const amount = Math.round((currentUser.balances.available * pct) / 100 * 100) / 100;

      if (amount < activePlan.minAmount) {
        AururaUI.toast(`Minimum for ${activePlan.name} is ${AururaStore.formatCurrency(activePlan.minAmount)}`, 'error');
        return;
      }
      if (amount <= 0) { AururaUI.toast('Fund your wallet before allocating.', 'error'); return; }

      const btn = document.getElementById('confirmAllocateBtn');
      btn.dataset.loading = 'true';
      setTimeout(() => {
        const result = AururaStore.createInvestment(currentUser.email, { planId: activePlan.id, amount, durationDays: selectedDuration });
        btn.dataset.loading = 'false';
        if (!result.ok) { AururaUI.toast(result.error, 'error'); return; }

        overlay.classList.remove('open');
        document.getElementById('availableStrip').textContent = AururaStore.formatCurrency(AururaStore.getCurrentUser().balances.available);
        renderMyInvestments();
        AururaUI.toast(`Allocated ${AururaStore.formatCurrency(amount)} to ${activePlan.name}`, 'success');
      }, 500);
    });
  }
}

/* ==========================================================================
   7. VIEW: activity
   ========================================================================== */

function initActivityView() {
  const user = AururaStore.getCurrentUser();
  if (!user) return;

  const listEl = document.getElementById('activityList');
  const tabs = document.querySelectorAll('#filterTabs .tab');

  function render(filter) {
    const currentUser = AururaStore.getCurrentUser();
    const txns = currentUser.transactions.filter(t => filter === 'all' || t.type === filter);
    if (txns.length === 0) {
      listEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">${AururaUI.icon('activity', 26)}</div>
          <h3>Nothing here yet</h3>
          <p>This is where your account activity will show up once you make a move.</p>
        </div>
      `;
      return;
    }
    listEl.innerHTML = txns.map(t => {
      const positive = t.amount > 0;
      const statusBadge = t.status === 'pending'
        ? '<span class="badge badge-warning">Pending</span>'
        : t.status === 'completed'
          ? '<span class="badge badge-positive">Completed</span>'
          : '<span class="badge badge-negative">Failed</span>';
      return `
        <div class="activity-row">
          <div class="activity-icon">${AururaUI.icon(positive ? 'wallet' : 'invest', 18)}</div>
          <div class="activity-body">
            <div class="activity-title">${t.label}</div>
            <div class="activity-sub">${new Date(t.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
          </div>
          <div style="text-align:right;">
            <div class="activity-amount ${positive ? 'positive' : 'negative'}">${positive ? '+' : ''}${AururaStore.formatCurrency(t.amount)}</div>
            <div style="margin-top:4px;">${statusBadge}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  const view = document.querySelector('[data-view="activity"]');
  if (!view.dataset.initialized) {
    view.dataset.initialized = 'true';
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        render(tab.dataset.filter);
      });
    });
  }

  const activeTab = document.querySelector('#filterTabs .tab.active');
  render(activeTab ? activeTab.dataset.filter : 'all');
}

/* ==========================================================================
   8. VIEW: profile
   ========================================================================== */

function initProfileView(params) {
  const user = AururaStore.getCurrentUser();
  if (!user) return;

  document.getElementById('avatarInitials').textContent = AururaUI.initials(user.fullName);
  document.getElementById('profileName').textContent = user.fullName;
  document.getElementById('profileEmail').textContent = user.email;

  const kycCard = document.getElementById('kycStatusCard');
  const statusMap = {
    not_started: { label: 'Not verified', cta: 'Start verification' },
    pending: { label: 'Verification pending', cta: 'View status' },
    verified: { label: 'Verified', cta: 'View details' },
  };
  const status = statusMap[user.kyc.status] || statusMap.not_started;
  kycCard.innerHTML = `
    <div>
      <div class="kyc-status-card-label">Identity verification</div>
      <div class="kyc-status-card-value">${status.label}</div>
    </div>
    <a href="#kyc" class="btn btn-secondary btn-sm">${status.cta}</a>
  `;

  const notifList = document.getElementById('notificationsList');
  if (user.notifications.length === 0) {
    notifList.innerHTML = `<div class="empty-state"><p>No notifications yet.</p></div>`;
  } else {
    notifList.innerHTML = user.notifications.map(n => `
      <div class="notif-row">
        <div class="notif-dot-inline ${n.read ? 'read' : ''}"></div>
        <div>
          <div class="notif-title">${n.title}</div>
          <div class="notif-body">${n.body}</div>
          <div class="notif-time">${AururaStore.timeAgo(n.createdAt)}</div>
        </div>
      </div>
    `).join('');
    user.notifications.forEach(n => n.read = true);
    AururaStore.saveUser(user);
    document.getElementById('notifDot').hidden = true;
  }

  const view = document.querySelector('[data-view="profile"]');
  if (!view.dataset.initialized) {
    view.dataset.initialized = 'true';

    document.getElementById('rowWallets').addEventListener('click', (e) => {
      e.preventDefault();
      AururaRouter.navigate('wallet');
    });
    document.getElementById('rowSecurity').addEventListener('click', (e) => {
      e.preventDefault();
      AururaUI.toast('Security settings arrive with account sign-in from the backend.', 'default');
    });
    document.getElementById('rowNotifications').addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById('notifications').scrollIntoView({ behavior: 'smooth' });
    });
    document.getElementById('logoutBtn').addEventListener('click', () => {
      AururaStore.logout();
      AururaRouter.navigate('home');
    });
  }

  if (params && params.scrollTo === 'notifications') {
    setTimeout(() => {
      document.getElementById('notifications').scrollIntoView({ behavior: 'smooth' });
    }, 60);
  }
}

/* ==========================================================================
   9. VIEW: kyc
   ========================================================================== */

function initKycView() {
  const user = AururaStore.getCurrentUser();
  if (!user) return;

  const already = document.getElementById('kycAlready');
  const form = document.getElementById('kycForm');

  if (user.kyc.status !== 'not_started') {
    already.hidden = false;
    form.hidden = true;
    return;
  }
  already.hidden = true;
  form.hidden = false;

  const steps = document.querySelectorAll('.kyc-step');
  const panels = document.querySelectorAll('.kyc-panel');

  function goToStep(n) {
    panels.forEach(p => p.hidden = p.dataset.panel !== String(n));
    steps.forEach(s => {
      const stepNum = parseInt(s.dataset.step, 10);
      s.classList.toggle('active', stepNum === n);
      s.classList.toggle('done', stepNum < n);
    });
  }
  goToStep(1);

  const view = document.querySelector('[data-view="kyc"]');
  if (view.dataset.initialized) return;
  view.dataset.initialized = 'true';

  document.querySelectorAll('.kyc-next').forEach(btn => {
    btn.addEventListener('click', () => goToStep(parseInt(btn.dataset.next, 10)));
  });
  document.querySelectorAll('.kyc-back').forEach(btn => {
    btn.addEventListener('click', () => goToStep(parseInt(btn.dataset.back, 10)));
  });

  const uploadFront = document.getElementById('uploadFront');
  uploadFront.addEventListener('change', () => {
    if (uploadFront.files.length) {
      document.getElementById('uploadFrontBox').classList.add('filled');
      document.getElementById('uploadFrontLabel').textContent = uploadFront.files[0].name;
      document.getElementById('step2Continue').disabled = false;
    }
  });

  const uploadSelfie = document.getElementById('uploadSelfie');
  uploadSelfie.addEventListener('change', () => {
    if (uploadSelfie.files.length) {
      document.getElementById('uploadSelfieBox').classList.add('filled');
      document.getElementById('uploadSelfieLabel').textContent = 'Selfie captured';
      document.getElementById('kycSubmit').disabled = false;
    }
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const currentUser = AururaStore.getCurrentUser();
    const checked = document.querySelector('input[name="docType"]:checked');
    const docType = checked ? checked.value : null;

    const btn = document.getElementById('kycSubmit');
    btn.dataset.loading = 'true';
    setTimeout(() => {
      currentUser.kyc = { status: 'pending', submittedAt: new Date().toISOString(), documentType: docType, selfieCaptured: true };
      currentUser.notifications.unshift({
        id: AururaStore.genId('ntf'), type: 'kyc', title: 'Verification submitted',
        body: "We're reviewing your documents. This usually takes a short while.",
        read: false, createdAt: new Date().toISOString(),
      });
      AururaStore.saveUser(currentUser);
      AururaRouter.navigate('profile');
    }, 600);
  });
}

/* ==========================================================================
   10. MARKETING / STATIC VIEWS
   ========================================================================== */

function setFooterYear() {
  const el = document.getElementById('year');
  if (el) el.textContent = new Date().getFullYear();
}

const FULL_FAQS = [
  { q: 'How do I get started?', a: 'Create an account, complete identity verification, fund your wallet, then choose a plan that matches your goals.' },
  { q: 'Which digital assets can I deposit?', a: 'Aurura Invest currently supports Bitcoin, Ethereum, USDT (TRC20 and ERC20), and BNB. Your dashboard shows the deposit address for each network.' },
  { q: 'How do I choose how much to invest?', a: 'From your dashboard, select a plan, then choose what percentage of your available balance to allocate and for how long. You confirm the exact amount before it\u2019s submitted.' },
  { q: 'When can I withdraw?', a: 'Your available balance can be withdrawn at any time, subject to our verification procedures. Funds allocated to an active investment plan become available once that plan reaches maturity.' },
  { q: 'Is my identity information required?', a: 'Yes. Identity verification helps protect your account and is required before you can withdraw funds.' },
  { q: 'How is my account secured?', a: 'Your account is protected through identity verification, authentication, and ongoing account monitoring. See our Security page for more detail.' },
  { q: 'What happens if I need help?', a: 'Reach our support team any time from the Contact page or from Support in your dashboard.' },
];

const TEASER_FAQS = FULL_FAQS.slice(0, 3);

function renderFaqAccordion(container, items) {
  container.innerHTML = items.map((item) => `
    <div class="accordion-item">
      <button class="accordion-trigger" aria-expanded="false">
        <span>${item.q}</span>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
      </button>
      <div class="accordion-panel"><p style="padding-bottom:0;">${item.a}</p></div>
    </div>
  `).join('');
  AururaUI.bindAccordion(container);
}

function initHomeView() {
  const el = document.getElementById('faqTeaserAccordion');
  if (el && !el.dataset.rendered) {
    el.dataset.rendered = 'true';
    renderFaqAccordion(el, TEASER_FAQS);
  }
}

function initFaqView() {
  const el = document.getElementById('accordion');
  if (el && !el.dataset.rendered) {
    el.dataset.rendered = 'true';
    renderFaqAccordion(el, FULL_FAQS);
  }
}

function initContactView() {
  const form = document.getElementById('contactForm');
  if (!form || form.dataset.initialized) return;
  form.dataset.initialized = 'true';
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    btn.textContent = 'Message sent';
    btn.disabled = true;
  });
}

function initStaticAccordions() {
  document.querySelectorAll('[data-view="philosophy"] .accordion-item, [data-view="risk-management"] .accordion-item').forEach(item => {
    AururaUI.bindAccordion(item.parentElement);
  });
}

/* ==========================================================================
   11. ROUTER
   Hash-based router. Shows/hides [data-view] sections, toggles shared
   chrome (marketing nav/footer, app sidebar/topbar/bottomnav), guards
   protected views, and calls each view's initializer.
   ========================================================================== */

const AururaRouter = (() => {
  const MARKETING_FAMILY = ['home', 'about', 'story', 'philosophy', 'ai-technology', 'strategy', 'risk-management', 'faq', 'contact', 'terms', 'privacy', 'risk-disclosure'];
  const APP_VIEWS = ['dashboard', 'wallet', 'invest', 'activity', 'profile', 'kyc'];
  const ALL_VIEWS = MARKETING_FAMILY.concat(APP_VIEWS, ['auth']);

  const ALIASES = {
    'auth-create': { view: 'auth', params: { tab: 'create' } },
    'wallet-deposit': { view: 'wallet', params: { action: 'deposit' } },
    'wallet-withdraw': { view: 'wallet', params: { action: 'withdraw' } },
  };

  const initializers = {
    auth: initAuthView,
    dashboard: initDashboardView,
    wallet: initWalletView,
    invest: initInvestView,
    activity: initActivityView,
    profile: initProfileView,
    kyc: initKycView,
    home: initHomeView,
    faq: initFaqView,
    contact: initContactView,
  };

  let pendingParams = {};

  function parseHash() {
    const raw = location.hash.replace('#', '');
    if (!raw) return { view: null, params: {} };
    if (ALIASES[raw]) return ALIASES[raw];
    return { view: raw, params: {} };
  }

  function navigate(view, params) {
    if (params) pendingParams = params;
    if (location.hash === '#' + view) {
      render();
    } else {
      location.hash = view;
    }
  }

  function updateNavActiveStates(view) {
    document.querySelectorAll('[data-view-link]').forEach(el => {
      el.classList.toggle('active', el.dataset.viewLink === view);
    });
  }

  function render() {
    const parsed = parseHash();
    const user = AururaStore.getCurrentUser();
    let view = parsed.view;

    if (!view || !ALL_VIEWS.includes(view)) view = user ? 'dashboard' : 'home';
    if (APP_VIEWS.includes(view) && !user) view = 'auth';
    if (view === 'auth' && user) view = 'dashboard';

    const params = Object.assign({}, parsed.params, pendingParams);
    pendingParams = {};

    document.querySelectorAll('.view').forEach(el => { el.hidden = el.dataset.view !== view; });

    const inMarketing = MARKETING_FAMILY.indexOf(view) !== -1;
    const inApp = APP_VIEWS.indexOf(view) !== -1;

    document.getElementById('marketingNav').hidden = !inMarketing;
    document.getElementById('marketingFooter').hidden = !inMarketing;
    document.getElementById('appSidebar').hidden = !inApp;
    document.getElementById('appTopbar').hidden = !inApp;
    document.getElementById('appShellWrap').hidden = !inApp;
    document.getElementById('appBottomnav').hidden = !inApp;

    document.body.classList.toggle('app-body', inApp);
    document.body.classList.toggle('auth-body', view === 'auth');

    const backBtn = document.getElementById('appBackBtn');
    const notifBtn = document.getElementById('notifBtn');
    if (backBtn) backBtn.hidden = view !== 'kyc';
    if (notifBtn) notifBtn.hidden = view === 'kyc';

    window.scrollTo(0, 0);

    if (initializers[view]) initializers[view](params);

    updateNavActiveStates(view);
  }

  return { navigate, render, pendingWelcome: false };
})();

/* ==========================================================================
   12. BOOTSTRAP
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  setFooterYear();
  initStaticAccordions();
  initContactView();

  const appBrand = document.getElementById('appBrand');
  if (appBrand) appBrand.addEventListener('click', () => AururaRouter.navigate('dashboard'));

  const appBackBtn = document.getElementById('appBackBtn');
  if (appBackBtn) appBackBtn.addEventListener('click', () => AururaRouter.navigate('profile'));

  const notifBtn = document.getElementById('notifBtn');
  if (notifBtn) notifBtn.addEventListener('click', () => AururaRouter.navigate('profile', { scrollTo: 'notifications' }));

  const sidebarLogout = document.getElementById('sidebarLogout');
  if (sidebarLogout) {
    sidebarLogout.addEventListener('click', (e) => {
      e.preventDefault();
      AururaStore.logout();
      AururaRouter.navigate('home');
    });
  }

  window.addEventListener('hashchange', AururaRouter.render);
  AururaRouter.render();
});
