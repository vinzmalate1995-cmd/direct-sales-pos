/* =============================================
   AE HOME POS SYSTEM - app.js
   ============================================= */

// ─── CONFIG ───────────────────────────────────
const GAS_URL = "https://script.google.com/macros/s/AKfycbzbdiqn_2POqByVcw_vTRS4wqhVj_4BsmHE9K55OOHxpTvbpP0F-y9CHTmRHv2eonsSJg/exec";

// ─── STATE ────────────────────────────────────
let currentUser = null; // { id, name, role, username }
let currentPage = 'dashboard';
let cart = [];
let activeUsers = {};   // { sessionId: { name, role, loginTime } }
let mySessionId = null;

// ─── ROLE CONFIG ──────────────────────────────
const ROLE_NAV = {
  admin: [
    { id: 'dashboard', icon: '', label: 'Dashboard' },
    { id: 'pos', icon: '', label: 'Point of Sale' },
    { id: 'inventory', icon: '', label: 'Inventory' },
    { id: 'finance', icon: '', label: 'Finance' },
    { id: 'cashiers', icon: '', label: 'Users' },
    { id: 'receipts', icon: '', label: 'Receipts' },
    { id: 'summary', icon: '', label: 'Sales Summary' },
    { id: 'logs', icon: '', label: 'Analytics' },
    { id: 'void', icon: '', label: 'Void Transactions' },
  ],
  cashier: [
    { id: 'pos', icon: '', label: 'Point of Sale' },
    { id: 'summary', icon: '', label: 'Sales Summary' },
    { id: 'receipts', icon: '', label: 'Receipts' },
  ],
  clerk: [
    { id: 'inventory', icon: '', label: 'Inventory' },
    { id: 'summary', icon: '', label: 'Sales Summary' },
    { id: 'pos', icon: '', label: 'Point of Sale' },
    { id: 'logs', icon: '', label: 'Analytics' },
    { id: 'void', icon: '', label: 'Void Transactions' },
  ],
  viewer: [
    { id: 'dashboard', icon: '', label: 'Dashboard' },
    { id: 'receipts', icon: '', label: 'Receipts' },
  ]
};

// ─── INIT ─────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  startClock();
  loadCartFromStorage();
  const saved = localStorage.getItem('ae_session');
  if (saved) {
    try {
      const sess = JSON.parse(saved);
      currentUser = sess;
      initApp();
    } catch(e) { showLogin(); }
  } else {
    showLogin();
  }
  registerSW();
});

function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

function startClock() {
  const tick = () => {
    const el = document.getElementById('liveClock');
 if (el) el.textContent = new Date().toLocaleString('en-PH', { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short', month: 'short', day: 'numeric' });
  };
  tick();
  setInterval(tick, 1000);
}

// ─── LOGIN ────────────────────────────────────
function showLogin() {
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('loginScreen').classList.add('active');
  document.getElementById('appScreen').classList.add('hidden');
}

async function doLogin() {
  const u = document.getElementById('loginUser').value.trim();
  const p = document.getElementById('loginPass').value.trim();
  const errEl = document.getElementById('loginError');
  errEl.classList.add('hidden');
  if (!u || !p) { showLoginErr('Please enter username and password.'); return; }

  // Admin hardcoded
  if (u === 'admin' && p === 'admin123') {
    currentUser = { id: 'admin', name: 'Administrator', role: 'admin', username: 'admin' };
    finishLogin();
    return;
  }

  showLoginErr('Checking credentials...');
  try {
    const res = await gasRequest({ action: 'login', username: u, password: p });
    if (res.success) {
      currentUser = { id: res.id, name: res.name, role: res.role, username: u };
      finishLogin();
    } else {
      showLoginErr(res.message || 'Invalid username or password.');
    }
  } catch(e) {
    showLoginErr('Connection error. Check GAS URL or network.');
  }
}

function showLoginErr(msg) {
  const el = document.getElementById('loginError');
 el.textContent = msg;
  el.classList.remove('hidden');
}

function enterViewerMode() {
  currentUser = { id: 'viewer', name: 'Viewer', role: 'viewer', username: 'viewer' };
  finishLogin();
}

function finishLogin() {
  mySessionId = 'sess_' + Date.now();
  localStorage.setItem('ae_session', JSON.stringify(currentUser));
  localStorage.setItem('ae_session_id', mySessionId);
  trackActiveUser(true);
  // Register session in GAS (for cross-device single session)
  if (currentUser.role !== 'viewer') {
    gasPost({
      action: 'registerSession',
      userId: currentUser.id || currentUser.username,
      sessionId: mySessionId,
      username: currentUser.username,
      name: currentUser.name,
      role: currentUser.role,
      device: navigator.userAgent.substring(0, 80)
    }).catch(() => {}); // silent fail
  }
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('loginScreen').classList.remove('active');
  document.getElementById('appScreen').classList.remove('hidden');
  initApp();
  // Start session polling — check every 15 seconds if session is still valid
  startSessionPoller();
}

function doLogout(showConfirm = true) {
  if (showConfirm && !confirm('Are you sure you want to logout?')) return;
  stopSessionPoller();
  trackActiveUser(false);
  // Unregister session from GAS
  if (currentUser && currentUser.role !== 'viewer' && mySessionId) {
    gasPost({ action: 'unregisterSession', userId: currentUser.id || currentUser.username, sessionId: mySessionId }).catch(() => {});
  }
  currentUser = null;
  mySessionId = null;
  localStorage.removeItem('ae_session');
  localStorage.removeItem('ae_session_id');
  cart = [];
  saveCartToStorage();
  document.getElementById('appScreen').classList.add('hidden');
  showLogin();
  document.getElementById('loginUser').value = '';
  document.getElementById('loginPass').value = '';
  document.getElementById('loginError').classList.add('hidden');
}

// ── SESSION POLLER ─────────────────────────────
let sessionPollInterval = null;

function startSessionPoller() {
  stopSessionPoller();
  if (!currentUser || currentUser.role === 'viewer') return;
  sessionPollInterval = setInterval(async () => {
    if (!currentUser || !mySessionId) return;
    try {
      const res = await gasRequest({
        action: 'checkSession',
        userId: currentUser.id || currentUser.username,
        sessionId: mySessionId
      });
      if (res.valid === false) {
        // Session was invalidated — another device logged in!
        stopSessionPoller();
        showSessionKicked();
      }
    } catch(e) {} // silent fail — don't logout on network error
  }, 15000); // check every 15 seconds
}

function stopSessionPoller() {
  if (sessionPollInterval) {
    clearInterval(sessionPollInterval);
    sessionPollInterval = null;
  }
}

function showSessionKicked() {
  // Force logout with notification
  trackActiveUser(false);
  currentUser = null;
  mySessionId = null;
  localStorage.removeItem('ae_session');
  localStorage.removeItem('ae_session_id');
  cart = [];
  saveCartToStorage();
  document.getElementById('appScreen').classList.add('hidden');
  showLogin();
  document.getElementById('loginUser').value = '';
  document.getElementById('loginPass').value = '';
  // Show kicked message
  const errEl = document.getElementById('loginError');
  if (errEl) {
    errEl.textContent = '⚠️ You were logged out because this account was used on another device.';
    errEl.classList.remove('hidden');
    errEl.style.background = '#fff7e0';
    errEl.style.borderColor = '#f59e0b';
    errEl.style.color = '#92400e';
  }
}

// ─── ACTIVE USER TRACKING ─────────────────────
function trackActiveUser(add) {
  let users = JSON.parse(localStorage.getItem('ae_active_users') || '{}');
  if (add && currentUser) {
    users[mySessionId] = {
      name: currentUser.name,
      role: currentUser.role,
      loginTime: new Date().toISOString()
    };
  } else if (mySessionId) {
    delete users[mySessionId];
  }
  localStorage.setItem('ae_active_users', JSON.stringify(users));
}

function showActiveUsers() {
  const users = JSON.parse(localStorage.getItem('ae_active_users') || '{}');
  const panel = document.getElementById('activeUsersPanel');
  const list = document.getElementById('activeUsersList');
  const entries = Object.entries(users);
  if (entries.length === 0) {
 list.innerHTML = '<p class="text-muted text-center mt-10">No active users tracked.</p>';
  } else {
 list.innerHTML = entries.map(([sid, u]) =>`
<div class="aup-item">
 <div class="aup-dot"></div>
        <div>
<div class="aup-name">${u.name}</div>
<div class="aup-role">${u.role}</div>
        </div>
<div class="aup-time">${new Date(u.loginTime).toLocaleTimeString('en-PH', { hour12: true })}</div>
      </div>
    `).join('');
  }
  panel.classList.remove('hidden');
}

function hideActiveUsers() {
  document.getElementById('activeUsersPanel').classList.add('hidden');
}

// ─── APP INIT ─────────────────────────────────
function initApp() {
  const role = currentUser.role;

  // User badge
 document.getElementById('userAvatar').textContent = currentUser.name.charAt(0).toUpperCase();
 document.getElementById('userNameDisplay').textContent = currentUser.name;
 document.getElementById('userRoleDisplay').textContent = role;

  // Build nav
  buildNav(role);

  // Default page
  const defaultPages = { admin: 'dashboard', cashier: 'pos', clerk: 'inventory', viewer: 'dashboard' };
  navigateTo(defaultPages[role] || 'dashboard');
}

function buildNav(role) {
  const items = ROLE_NAV[role] || ROLE_NAV.viewer;
  const nav = document.getElementById('navMenu');
 nav.innerHTML = items.map(it =>`
    <button class="nav-item" id="nav_${it.id}" onclick="navigateTo('${it.id}')">
      
      <span>${it.label}</span>
    </button>
  `).join('');
}

function navigateTo(page) {
  currentPage = page;
  // highlight nav
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  const ni = document.getElementById('nav_' + page);
  if (ni) ni.classList.add('active');
  // title
  const titles = {
    dashboard: 'Dashboard', pos: 'Point of Sale',
    inventory: 'Inventory Management', finance: 'Finance',
    cashiers: 'User Management', receipts: 'Receipts',
    summary: 'Sales Summary', logs: 'Analytics & Insights',
    void: 'Void Transactions'
  };
 document.getElementById('topbarTitle').textContent = titles[page] || page;
  // render
  const pc = document.getElementById('pageContent');
 pc.innerHTML = `<div class="loading-spinner"><div class="spinner"></div> Loading...</div>`;
  setTimeout(() => renderPage(page), 150);
  // close sidebar on mobile
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sideOverlay')?.classList.remove('show');
}

function toggleSidebar() {
  const s = document.getElementById('sidebar');
  s.classList.toggle('open');
  let ov = document.getElementById('sideOverlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'sideOverlay';
    ov.className = 'sidebar-overlay';
    ov.onclick = () => { s.classList.remove('open'); ov.classList.remove('show'); };
    document.body.appendChild(ov);
  }
  ov.classList.toggle('show');
}

// ─── PAGE RENDERER ────────────────────────────
function renderPage(page) {
  const pages = {
    dashboard: renderDashboard,
    pos: renderPOS,
    inventory: renderInventory,
    finance: renderFinance,
    cashiers: renderCashiers,
    receipts: renderReceipts,
    summary: renderSummary,
    logs: renderLogs,
    void: renderVoidTransactions,
  };
  if (pages[page]) pages[page]();
  else {
    const pc = document.getElementById('pageContent');
    if (pc) pc.innerHTML = '<div class="no-data"><div class="no-data-icon"></div><div>Page not available.</div></div>';
  }
}

// ─── GAS REQUEST ─────────────────────────────
async function gasRequest(params) {
  const url = GAS_URL + '?' + new URLSearchParams(params);
  const res = await fetch(url, { method: 'GET', redirect: 'follow' });
  const text = await res.text();
  try { return JSON.parse(text); }
  catch(e) { throw new Error('Invalid response from server'); }
}

async function gasPost(payload) {
  // Use GET with base64 encoded payload — works across all browsers/CORS
  const json = JSON.stringify(payload);
  const encoded = btoa(unescape(encodeURIComponent(json)));
  const url = GAS_URL + '?method=post&data=' + encodeURIComponent(encoded);
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'follow' });
    const text = await res.text();
    try { return JSON.parse(text); }
    catch(e) { return { success: true }; }
  } catch(e) {
    throw new Error('Network error: ' + e.message);
  }
}

async function gasPostWithResult(payload) {
  // For operations where we need a result back, use GET with small payloads
  const json = JSON.stringify(payload);
  if (json.length < 1500) {
    // Small payload — use GET
    const encoded = btoa(unescape(encodeURIComponent(json)));
    const url = GAS_URL + '?method=post&data=' + encodeURIComponent(encoded);
    const res = await fetch(url, { method: 'GET', redirect: 'follow' });
    const text = await res.text();
    try { return JSON.parse(text); }
    catch(e) { throw new Error('Invalid response'); }
  } else {
    // Large payload — chunk it via GET with smaller pieces
    // Split products into chunks of 15 and send as GET
    throw new Error('PAYLOAD_TOO_LARGE');
  }
}

// ─── TOAST ────────────────────────────────────
function toast(msg, type = 'info', duration = 3500) {
  const icons = { success: '✓', error: '✕', warning: '!', info: 'i' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="toast-icon">${icons[type]||'i'}</span><span>${msg}</span>`;
  document.getElementById('toastContainer').appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(20px)';
    el.style.transition = 'all 0.3s ease';
    setTimeout(() => el.remove(), 300);
  }, duration);
}

function showLoading(msg = 'Processing...') {
  let el = document.getElementById('loadingOverlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'loadingOverlay';
    el.className = 'loading-overlay';
    document.body.appendChild(el);
  }
  el.innerHTML = `
    <div class="loading-overlay-box">
      <div class="loading-ring"><div></div><div></div><div></div><div></div></div>
      <div class="loading-overlay-msg">${msg}</div>
    </div>`;
  el.style.display = 'flex';
  el.style.opacity = '0';
  setTimeout(() => { el.style.opacity = '1'; el.style.transition = 'opacity 0.2s'; }, 10);
}

function hideLoading() {
  const el = document.getElementById('loadingOverlay');
  if (el) {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.2s';
    setTimeout(() => { el.style.display = 'none'; }, 200);
  }
}

// ─── MODAL ────────────────────────────────────
function openModal(html) {
 document.getElementById('modalContent').innerHTML = html;
  document.getElementById('modalOverlay').classList.remove('hidden');
}
function closeModal(e) {
  if (e.target === document.getElementById('modalOverlay')) closeModalDirect();
}
function closeModalDirect() {
  document.getElementById('modalOverlay').classList.add('hidden');
}

// ─── RESET TEST DATA ──────────────────────────
function resetTestData() {
  if (!confirm('⚠️ This will clear your cart and cached data. Google Sheets data will NOT be deleted. Continue?')) return;
  cart = [];
  saveCartToStorage();
  localStorage.removeItem('ae_saved_cart');
  localStorage.removeItem('ae_receipt_gallery');
  localStorage.removeItem('ae_active_users');
 toast('Test data cleared! Cart and local cache reset.', 'success');
  navigateTo('dashboard');
}

// ─── CART STORAGE ─────────────────────────────
function saveCartToStorage() {
  localStorage.setItem('ae_cart', JSON.stringify(cart));
}
function loadCartFromStorage() {
  try { cart = JSON.parse(localStorage.getItem('ae_cart') || '[]'); } catch(e) { cart = []; }
}

// ═══════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════
async function renderDashboard() {
 document.getElementById('pageContent').innerHTML = `
    ${currentUser.role === 'admin' ? `
    <div style="display:flex;justify-content:flex-end;margin-bottom:12px">
<button class="btn btn-danger btn-sm" onclick="resetTestData()">️ Reset Test Data</button>
    </div>` : ''}
<div class="kpi-grid" id="kpiGrid">
      ${['Today Sales','Weekly Sales','Monthly Sales','Total Products','Total Transactions','Low Stock'].map((k,i) => `
<div class="kpi-card ${['kpi-blue','kpi-green','kpi-grad','kpi-blue','kpi-green','kpi-orange'][i]}">
<div class="kpi-icon">''</div>
<div class="kpi-label">${k}</div>
<div class="kpi-value" id="kpi_${i}">—</div>
        </div>`).join('')}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
<div class="card">
<div class="card-title">Recent Transactions</div>
 <div id="recentTx"><div class="loading-spinner"><div class="spinner"></div></div></div>
      </div>
<div class="card">
<div class="card-title">️ Low Stock Items</div>
 <div id="lowStockList"><div class="loading-spinner"><div class="spinner"></div></div></div>
      </div>
    </div>`;

  try {
    const [salesRes, productsRes] = await Promise.all([
      gasRequest({ action: 'getSales' }),
      gasRequest({ action: 'getProducts' })
    ]);
    const sales = salesRes.data || [];
    const products = productsRes.data || [];

    const now = new Date();
    const todayStr = now.toDateString();
    const weekAgo = new Date(now - 7*86400000);
    const monthAgo = new Date(now - 30*86400000);

    const todaySales = sales.filter(s => new Date(s.date).toDateString() === todayStr);
    const weekSales = sales.filter(s => new Date(s.date) >= weekAgo);
    const monthSales = sales.filter(s => new Date(s.date) >= monthAgo);

    const sum = arr => arr.reduce((a, s) => a + parseFloat(s.total || 0), 0);
    const lowStock = products.filter(p => parseInt(p.qtyPcs || 0) <= 5);

 document.getElementById('kpi_0').textContent = '₱' + sum(todaySales).toLocaleString('en-PH', {minimumFractionDigits:2});
 document.getElementById('kpi_1').textContent = '₱' + sum(weekSales).toLocaleString('en-PH', {minimumFractionDigits:2});
 document.getElementById('kpi_2').textContent = '₱' + sum(monthSales).toLocaleString('en-PH', {minimumFractionDigits:2});
 document.getElementById('kpi_3').textContent = products.length;
 document.getElementById('kpi_4').textContent = sales.length;
 document.getElementById('kpi_5').textContent = lowStock.length;

    // Recent Tx
    const recentEl = document.getElementById('recentTx');
    if (!recentEl) return;
    const recent = [...sales].reverse().slice(0, 8);
 recentEl.innerHTML = recent.length ? `
 <div class="tbl-wrap"><table>
        <thead><tr><th>Tx#</th><th>Cashier</th><th>Total</th><th>Date</th></tr></thead>
        <tbody>${recent.map(s => `<tr>
          <td><span style="font-family:var(--font-mono);font-size:0.8rem">${s.transactionId || ''}</span></td>
          <td>${s.cashierName || ''}</td>
          <td class="text-green fw-700">₱${parseFloat(s.total||0).toLocaleString('en-PH',{minimumFractionDigits:2})}</td>
          <td class="text-muted" style="font-size:0.8rem">${s.date ? new Date(s.date).toLocaleDateString('en-PH') : ''}</td>
        </tr>`).join('')}</tbody>
 </table></div>` : '<div class="no-data"><div class="no-data-icon"></div><div class="no-data-text">No transactions yet.</div></div>';

    // Low stock
    const lsEl = document.getElementById('lowStockList');
 lsEl.innerHTML = lowStock.length ? `
 <div class="tbl-wrap"><table>
        <thead><tr><th>Product</th><th>Qty</th></tr></thead>
        <tbody>${lowStock.map(p => `<tr>
          <td>${p.name}</td>
          <td><span class="${parseInt(p.qtyPcs||0)===0?'badge-out':'badge-low'}">${p.qtyPcs} pcs</span></td>
        </tr>`).join('')}</tbody>
 </table></div>` : '<div class="no-data"><div class="no-data-icon"></div><div class="no-data-text">All items well-stocked.</div></div>';

  } catch(e) {
 toast('Failed to load dashboard data.', 'error');
  }
}

// ═══════════════════════════════════════════════
// POS
// ═══════════════════════════════════════════════
let allProducts = [];
let searchTimeout = null;

async function renderPOS() {
 document.getElementById('pageContent').innerHTML = `
<div class="pos-layout">
<div class="pos-left">
<div class="barcode-scanner-bar" id="barcodeBar" onclick="document.getElementById('barcodeInput').focus()">
          <span class="bc-label">BARCODE</span>
          <input type="text" id="barcodeInput"
            placeholder="Scan or type barcode..."
            autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
            onkeydown="handleBarcodeKey(event,this)"
            onfocus="document.getElementById('barcodeBar').style.borderLeftColor='var(--blue)'"
            onblur="document.getElementById('barcodeBar').style.borderLeftColor=''">
          <span class="bc-status" id="bcStatus">●</span>
          <button class="bc-cam-btn" onclick="openCameraScanner()" title="Use Camera">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
          </button>
        </div>
        <!-- Camera Scanner Modal -->
        <div id="cameraScannerModal" class="camera-modal hidden">
          <div class="camera-backdrop" onclick="closeCameraScanner()"></div>
          <div class="camera-box">
            <div class="camera-header">
              <span>Camera Scanner</span>
              <button onclick="closeCameraScanner()">✕</button>
            </div>
            <div class="camera-viewport">
              <video id="cameraFeed" autoplay playsinline muted></video>
              <div class="camera-overlay">
                <div class="scan-line"></div>
                <div class="scan-corners"></div>
              </div>
            </div>
            <div class="camera-status" id="cameraStatus">Point camera at barcode...</div>
            <div id="scanConfirmDiv" style="display:none"></div>
            <div class="camera-actions">
              <button class="btn btn-ghost btn-sm" onclick="switchCamera()">Flip Camera</button>
              <button class="btn btn-danger btn-sm" onclick="closeCameraScanner()">Cancel</button>
            </div>
          </div>
        </div>
        <div style="display:flex;gap:10px;align-items:center;margin-bottom:14px">
<div class="search-wrap" style="flex:1;margin-bottom:0">
            <span class="search-icon">🔍</span>
<input type="text" id="posSearch" placeholder="Search product name..." oninput="onPosSearch(this.value)" autocomplete="off">
 <div class="search-dropdown hidden" id="searchDropdown"></div>
          </div>
 ${currentUser.role === 'admin' ? `<button class="btn btn-ghost btn-sm" onclick="openReceiptSettings()" title="Receipt Settings">️ Receipt</button>` : ''}
        </div>
<div class="product-grid" id="productGrid">
 <div class="loading-spinner" style="grid-column:1/-1"><div class="spinner"></div> Loading products...</div>
        </div>
      </div>
<div class="pos-right">
<div class="cart-header">
          <span>🛒 Cart</span>
<button class="btn btn-ghost btn-sm" onclick="clearCart()">Clear</button>
        </div>
 <div class="cart-items" id="cartItems"></div>
<div class="cart-footer">
 <div class="cart-total-row"><span class="ct-label">Items</span><span class="ct-value" id="cartItemCount">0</span></div>
 <div class="cart-total-row"><span class="ct-label">Subtotal</span><span class="ct-value" id="cartSubtotal">₱0.00</span></div>
 <div class="cart-total-row"><span class="ct-label fw-700">TOTAL</span><span class="ct-value ct-grand" id="cartTotal">₱0.00</span></div>
          <button class="btn-checkout" id="checkoutBtn" onclick="openCheckout()">💳 CHECKOUT</button>
        </div>
      </div>
    </div>`;

  await loadProducts();
  renderCart();
  focusBarcodeInput();
}

async function loadProducts() {
  try {
    const res = await gasRequest({ action: 'getProducts' });
    allProducts = res.data || [];
    renderProductGrid(allProducts);
  } catch(e) {
 document.getElementById('productGrid').innerHTML = '<div class="no-data" style="grid-column:1/-1"><div class="no-data-icon"></div><div>Failed to load products. Check GAS URL.</div></div>';
  }
}

function renderProductGrid(products) {
  const grid = document.getElementById('productGrid');
  if (!grid) return;
  if (!products.length) {
 grid.innerHTML = '<div class="no-data" style="grid-column:1/-1"><div class="no-data-icon"></div><div class="no-data-text">No products found.</div></div>';
    return;
  }
 grid.innerHTML = products.map(p =>{
    const qty = parseInt(p.qtyPcs || 0);
    const qtyPk = parseInt(p.qtyPacks || 0);
    const hasPack = parseFloat(p.pricePack || 0) > 0;
    const oos = qty <= 0 && (!hasPack || qtyPk <= 0);
    const pcImg = getProductImage(p.id);
    return `
<div class="product-card ${oos ? 'out-of-stock' : ''}">
${pcImg ? `<img src="${pcImg}" class="pc-img">` : ''}
<div class="pc-name">${p.name}</div>
 ${p.barcode ? `<div class="pc-barcode">${p.barcode}</div>` : ''}
<div class="pc-stock ${oos ? 'text-red' : qty<= 5 ? 'text-orange' : 'text-muted'}" style="margin-bottom:6px">
        ${oos ? '❌ Out of stock' : `📦 ${qty} pcs${qtyPk ? ' | '+qtyPk+' pks':''}`}
      </div>
      ${oos ? '' : `
<div class="pc-unit-btns">
 ${qty >0 ? `<button class="pc-unit-btn btn-piece" onclick="addToCart('${p.id}','piece')">
          <span class="pc-unit-label">Per Piece</span>
          <span class="pc-unit-price">₱${parseFloat(p.pricePer||0).toFixed(2)}</span>
        </button>` : ''}
 ${hasPack && qtyPk >0 ? `<button class="pc-unit-btn btn-pack" onclick="addToCart('${p.id}','pack')">
          <span class="pc-unit-label">Per Pack</span>
          <span class="pc-unit-price">₱${parseFloat(p.pricePack||0).toFixed(2)}</span>
        </button>` : ''}
      </div>`}
    </div>`;
  }).join('');
}

function handleBarcodeKey(e, input) {
  if (e.key === 'Enter') {
    e.preventDefault();
    const val = (input.value || '').trim();
    input.value = '';
    input.focus();
    if (val) processBarcodeValue(val);
  }
}

function handleBarcodeScan(input) {
  const val = (input.value || '').trim();
  input.value = '';
  if (val) processBarcodeValue(val);
}

let globalBarcodeBuffer = '';
let globalBarcodeTimer = null;

// Global keypress listener — auto-route to barcode input on POS page
document.addEventListener('keydown', function(e) {
  if (currentPage !== 'pos') return;
  const active = document.activeElement;
  const bcInput = document.getElementById('barcodeInput');
  if (!bcInput) return;
  // If not in any input, focus barcode
  if (!active || (active.tagName !== 'INPUT' && active.tagName !== 'TEXTAREA')) {
    if (e.key.length === 1 || e.key === 'Enter') {
      bcInput.focus();
    }
  }
});


function focusBarcodeInput() {
  setTimeout(() => {
    const el = document.getElementById('barcodeInput');
    if (el) el.focus();
  }, 300);
}

// ── CAMERA BARCODE SCANNER (BarcodeDetector + ZXing fallback) ──
let cameraStream = null;
let cameraFacingMode = 'environment';
let isScanning = false;
let scanRafId = null;

async function openCameraScanner() {
  const modal = document.getElementById('cameraScannerModal');
  if (!modal) return;
  modal.classList.remove('hidden');
  startCamera();
}

async function startCamera() {
  const video = document.getElementById('cameraFeed');
  const status = document.getElementById('cameraStatus');
  if (!video) return;
  stopCamera();

  try {
    if (status) status.textContent = 'Starting camera...';

    // Request camera — optimized for barcode scanning
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: cameraFacingMode },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        advanced: [{ focusMode: 'continuous' }, { zoom: 1.0 }]
      }
    });

    video.srcObject = cameraStream;
    video.setAttribute('playsinline', true);
    await video.play();

    // Try to enable torch/flash on mobile for better scanning
    try {
      const track = cameraStream.getVideoTracks()[0];
      await track.applyConstraints({ advanced: [{ torch: false }] });
    } catch(e) {}

    if (status) status.textContent = 'Point camera at barcode...';
    isScanning = true;

    // Use native BarcodeDetector if available (Android Chrome 83+, fast!)
    if ('BarcodeDetector' in window) {
      if (status) status.textContent = 'Ready (Native Scanner)';
      startNativeScanner(video, status);
    } else {
      // Load ZXing as fallback
      if (typeof ZXing === 'undefined') {
        if (status) status.textContent = 'Loading scanner...';
        try {
          await loadScript('https://cdn.jsdelivr.net/npm/@zxing/library@0.19.1/umd/index.min.js');
        } catch(e) {
          await loadScript('https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js');
        }
      }
      if (typeof ZXing !== 'undefined') {
        if (status) status.textContent = 'Ready (ZXing Scanner)';
        startZXingStream(video, status);
      } else {
        if (status) status.textContent = 'Ready (jsQR Scanner)';
        startJsQRStream(video, status);
      }
    }
  } catch(e) {
    if (!status) return;
    if (e.name === 'NotAllowedError') status.textContent = 'Camera denied. Allow camera access in browser settings.';
    else if (e.name === 'NotFoundError') status.textContent = 'No camera found.';
    else if (e.name === 'OverconstrainedError') {
      // Retry with simpler constraints
      cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: cameraFacingMode } });
      video.srcObject = cameraStream;
      await video.play();
      isScanning = true;
      startNativeScanner(video, status);
    } else status.textContent = 'Camera error: ' + e.message;
  }
}

// ── NATIVE BarcodeDetector (fastest on Android Chrome) ──
async function startNativeScanner(video, status) {
  const detector = new BarcodeDetector({
    formats: ['ean_13','ean_8','code_128','code_39','upc_a','upc_e','qr_code','data_matrix','itf','codabar']
  });

  async function detect() {
    if (!isScanning) return;
    try {
      const barcodes = await detector.detect(video);
      if (barcodes.length > 0) {
        const val = barcodes[0].rawValue.trim();
        if (status) {
          status.textContent = 'Found: ' + val;
          status.style.color = 'var(--green)';
        }
        showScanConfirm(val);
        return;
      }
    } catch(e) {}
    scanRafId = requestAnimationFrame(detect);
  }
  detect();
}

// ── ZXing stream scanner ──
function startZXingStream(video, status) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let reader;
  try {
    const hints = new Map();
    hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
      ZXing.BarcodeFormat.EAN_13, ZXing.BarcodeFormat.EAN_8,
      ZXing.BarcodeFormat.CODE_128, ZXing.BarcodeFormat.CODE_39,
      ZXing.BarcodeFormat.UPC_A, ZXing.BarcodeFormat.UPC_E,
      ZXing.BarcodeFormat.QR_CODE,
    ]);
    hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
    reader = new ZXing.BrowserMultiFormatReader(hints);
  } catch(e) { startJsQRStream(video, status); return; }

  function scan() {
    if (!isScanning) return;
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      try {
        const lum = new ZXing.HTMLCanvasElementLuminanceSource(canvas);
        const bmp = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(lum));
        const result = reader.decodeBitmap(bmp);
        if (result) {
          const val = result.getText().trim();
          if (status) {
            status.textContent = 'Found: ' + val;
            status.style.color = 'var(--green)';
          }
          showScanConfirm(val);
          return;
        }
      } catch(e) {} // NotFoundException is normal
    }
    scanRafId = requestAnimationFrame(scan);
  }
  scan();
}

// ── jsQR fallback ──
function startJsQRStream(video, status) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  function scan() {
    if (!isScanning) return;
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      if (typeof jsQR !== 'undefined') {
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'attemptBoth'
        });
        if (code && code.data) {
          const val = code.data.trim();
          if (status) {
            status.textContent = 'Found: ' + val;
            status.style.color = 'var(--green)';
          }
          showScanConfirm(val);
          return;
        }
      }
    }
    scanRafId = requestAnimationFrame(scan);
  }
  scan();
}

function stopCamera() {
  isScanning = false;
  if (scanRafId) { cancelAnimationFrame(scanRafId); scanRafId = null; }
  if (cameraStream) { cameraStream.getTracks().forEach(t => t.stop()); cameraStream = null; }
  const video = document.getElementById('cameraFeed');
  if (video) video.srcObject = null;
}

function switchCamera() {
  cameraFacingMode = cameraFacingMode === 'environment' ? 'user' : 'environment';
  startCamera();
}

function closeCameraScanner() {
  const modal = document.getElementById('cameraScannerModal');
  if (modal) modal.classList.add('hidden');
  stopCamera();
}

function showScanConfirm(val) {
  // Pause scanning while confirming
  isScanning = false;
  if (scanRafId) { cancelAnimationFrame(scanRafId); scanRafId = null; }

  const status = document.getElementById('cameraStatus');
  const confirmDiv = document.getElementById('scanConfirmDiv');

  // Find product match
  // Match against multiple barcodes (comma-separated) or name
  const matchBarcode = (barcodeField, scanVal) => {
    const codes = (barcodeField || '').split(',').map(b => b.trim()).filter(Boolean);
    return codes.some(c =>
      c === scanVal ||
      c.toLowerCase() === scanVal.toLowerCase() ||
      c.replace(/^0+/, '') === scanVal.replace(/^0+/, '')
    );
  };
  const match =
    allProducts.find(p => matchBarcode(p.barcode, val)) ||
    allProducts.find(p => (p.name || '').trim().toLowerCase() === val.toLowerCase());

  if (confirmDiv) {
    if (match) {
      confirmDiv.innerHTML = `
        <div style="background:rgba(0,200,83,0.15);border:1px solid var(--green);border-radius:8px;padding:10px;margin:8px 16px;text-align:center">
          <div style="color:white;font-weight:700;font-size:0.9rem">${match.name}</div>
          <div style="color:rgba(255,255,255,0.7);font-size:0.78rem">₱${parseFloat(match.pricePer||0).toFixed(2)} • ${match.qtyPcs||0} pcs</div>
          <div style="display:flex;gap:8px;margin-top:8px;justify-content:center">
            <button class="btn btn-success btn-sm" onclick="confirmScan('${val}')"> Add to Cart</button>
            <button class="btn btn-ghost btn-sm" style="color:white;border-color:rgba(255,255,255,0.3)" onclick="resumeScanning()"> Rescan</button>
          </div>
        </div>`;
    } else {
      confirmDiv.innerHTML = `
        <div style="background:rgba(239,68,68,0.15);border:1px solid #ef4444;border-radius:8px;padding:10px;margin:8px 16px;text-align:center">
          <div style="color:#fca5a5;font-size:0.82rem">No product found for:</div>
          <div style="color:white;font-weight:700;font-family:var(--font-mono);font-size:0.85rem">${val}</div>
          <button class="btn btn-ghost btn-sm" style="color:white;border-color:rgba(255,255,255,0.3);margin-top:8px" onclick="resumeScanning()"> Try Again</button>
        </div>`;
    }
    confirmDiv.style.display = 'block';
  }
}

function confirmScan(val) {
  const confirmDiv = document.getElementById('scanConfirmDiv');
  if (confirmDiv) { confirmDiv.innerHTML = ''; confirmDiv.style.display = 'none'; }
  closeCameraScanner();
  processBarcodeValue(val);
}

function resumeScanning() {
  const confirmDiv = document.getElementById('scanConfirmDiv');
  if (confirmDiv) { confirmDiv.innerHTML = ''; confirmDiv.style.display = 'none'; }
  const status = document.getElementById('cameraStatus');
  if (status) { status.textContent = 'Point camera at barcode...'; status.style.color = ''; }
  isScanning = true;
  // Restart scan loop
  const video = document.getElementById('cameraFeed');
  if (video && video.srcObject) {
    if ('BarcodeDetector' in window) {
      startNativeScanner(video, status);
    } else if (typeof ZXing !== 'undefined') {
      startZXingStream(video, status);
    } else {
      startJsQRStream(video, status);
    }
  }
}

function processBarcodeValue(val) {
  if (!val || val.length < 1) return;
  const bcStatus = document.getElementById('bcStatus');
  const bar = document.getElementById('barcodeBar');

  // Normalize: trim only, preserve leading zeros
  // Try exact match first, then case-insensitive, then strip leading zeros as last resort
  // Match against multiple barcodes (comma-separated) or name
  const matchBarcode = (barcodeField, scanVal) => {
    const codes = (barcodeField || '').split(',').map(b => b.trim()).filter(Boolean);
    return codes.some(c =>
      c === scanVal ||
      c.toLowerCase() === scanVal.toLowerCase() ||
      c.replace(/^0+/, '') === scanVal.replace(/^0+/, '')
    );
  };
  const match =
    allProducts.find(p => matchBarcode(p.barcode, val)) ||
    allProducts.find(p => (p.name || '').trim().toLowerCase() === val.toLowerCase());

  if (match) {
    const qty = parseInt(match.qtyPcs || 0);
    if (qty <= 0) {
      toast(match.name + ' — Out of stock!', 'error');
      if (bcStatus) { bcStatus.style.color = '#ef4444'; setTimeout(() => { bcStatus.style.color = 'var(--green)'; }, 1000); }
      return;
    }
    addToCart(match.id, 'piece');
    toast(match.name + ' added!', 'success');
    if (bcStatus) { bcStatus.style.color = 'var(--green)'; }
    if (bar) {
      bar.style.background = 'rgba(0,200,83,0.06)';
      setTimeout(() => { bar.style.background = ''; }, 500);
    }
  } else {
    toast('No product: ' + val, 'error');
    if (bcStatus) { bcStatus.style.color = '#ef4444'; setTimeout(() => { bcStatus.style.color = 'var(--green)'; }, 1200); }
  }
}


function onPosSearch(val) {
  clearTimeout(searchTimeout);
  const dd = document.getElementById('searchDropdown');
  if (!val || val.length < 2) { dd.classList.add('hidden'); renderProductGrid(allProducts); return; }
  searchTimeout = setTimeout(() => {
    const q = val.toLowerCase();
    const matched = allProducts.filter(p =>
      (p.name || '').toLowerCase().includes(q) ||
      (p.barcode || '').toLowerCase().includes(q)
    );
    renderProductGrid(matched);
    if (matched.length > 0) {
 dd.innerHTML = matched.slice(0, 8).map(p =>{
        const hasPack = parseFloat(p.pricePack||0) > 0 && parseInt(p.qtyPacks||0) > 0;
 return `<div class="search-item">
          <div style="flex:1">
<div class="search-item-name">${p.name}</div>
<div class="search-item-stock">${p.qtyPcs||0} pcs${p.qtyPacks ? ' | '+p.qtyPacks+' pks' : ''}</div>
          </div>
          <div style="display:flex;gap:6px;align-items:center">
<button class="pc-unit-btn btn-piece" style="padding:4px 8px;font-size:0.75rem" onclick="addToCart('${p.id}','piece');document.getElementById('searchDropdown').classList.add('hidden')">
              Piece<br><b>₱${parseFloat(p.pricePer||0).toFixed(2)}</b>
            </button>
 ${hasPack ? `<button class="pc-unit-btn btn-pack" style="padding:4px 8px;font-size:0.75rem" onclick="addToCart('${p.id}','pack');document.getElementById('searchDropdown').classList.add('hidden')">
              Pack<br><b>₱${parseFloat(p.pricePack||0).toFixed(2)}</b>
            </button>` : ''}
          </div>
        </div>`;
      }).join('');
      dd.classList.remove('hidden');
    } else {
      dd.classList.add('hidden');
    }
  }, 200);
}

document.addEventListener('click', (e) => {
  const dd = document.getElementById('searchDropdown');
  if (dd && !dd.contains(e.target) && e.target.id !== 'posSearch') dd.classList.add('hidden');
});

function addToCart(productId, unit) {
  const p = allProducts.find(x => x.id === productId);
  if (!p) return;
  const existing = cart.find(c => c.productId === productId && c.unit === unit);
  if (existing) {
    existing.qty++;
    existing.total = existing.qty * existing.price;
  } else {
    const price = unit === 'pack' ? parseFloat(p.pricePack || 0) : parseFloat(p.pricePer || 0);
    cart.push({
      productId, unit,
      name: p.name,
      price,
      qty: 1,
      total: price,
      maxQty: unit === 'pack' ? parseInt(p.qtyPacks || 0) : parseInt(p.qtyPcs || 0)
    });
  }
  saveCartToStorage();
  renderCart();
 toast(`${p.name} added to cart`, 'success');
}

function addToCartWithUnit(productId) {
  const p = allProducts.find(x => x.id === productId);
  if (!p) return;
  const hasPack = parseFloat(p.pricePack || 0) > 0 && parseInt(p.qtyPacks || 0) > 0;
  if (hasPack) {
    openModal(`
<div class="modal-title">Select Unit — ${p.name}</div>
      <p style="color:var(--text2);margin-bottom:16px">Choose how to add this item:</p>
<div class="gap-10">
<button class="btn btn-primary" onclick="addToCart('${p.id}','piece');closeModalDirect()">Per Piece — ₱${parseFloat(p.pricePer||0).toFixed(2)}</button>
<button class="btn btn-success" onclick="addToCart('${p.id}','pack');closeModalDirect()">️ Per Pack — ₱${parseFloat(p.pricePack||0).toFixed(2)}</button>
      </div>`);
  } else {
    addToCart(productId, 'piece');
  }
}

function renderCart() {
  const itemsEl = document.getElementById('cartItems');
  const countEl = document.getElementById('cartItemCount');
  const subtEl = document.getElementById('cartSubtotal');
  const totalEl = document.getElementById('cartTotal');
  if (!itemsEl) return;

  if (cart.length === 0) {
 itemsEl.innerHTML = `<div class="empty-cart"><div class="empty-cart-icon"></div><div class="empty-cart-text">Cart is empty.<br>Tap a product to add.</div></div>`;
  } else {
 itemsEl.innerHTML = cart.map((item, idx) =>{
      const prod = allProducts.find(p => p.id === item.productId);
      const hasPack = prod && parseFloat(prod.pricePack||0) > 0;
      return `
<div class="cart-item">
<div class="ci-info">
<div class="ci-name">${item.name}</div>
<div class="ci-price">₱${item.price.toFixed(2)} / ${item.unit}</div>
 ${hasPack ? `<div class="ci-unit-toggle">
            <button class="${item.unit==='piece'?'active-piece':''}" onclick="switchCartUnit(${idx},'piece')">Piece ₱${parseFloat(prod.pricePer||0).toFixed(2)}</button>
            <button class="${item.unit==='pack'?'active-pack':''}" onclick="switchCartUnit(${idx},'pack')">Pack ₱${parseFloat(prod.pricePack||0).toFixed(2)}</button>
</div>` : `<div class="ci-unit">${item.unit === 'pack' ? '️ Pack' : ' Piece'}</div>`}
        </div>
<div class="ci-controls">
          <button class="ci-qty-btn" onclick="changeCartQty(${idx}, -1)">−</button>
          <input class="ci-qty-input" type="number" min="1" value="${item.qty}" onchange="setCartQty(${idx}, this.value)">
          <button class="ci-qty-btn" onclick="changeCartQty(${idx}, 1)">+</button>
        </div>
<div class="ci-total">₱${item.total.toFixed(2)}</div>
        <button class="ci-remove" onclick="removeFromCart(${idx})">✕</button>
      </div>`;
    }).join('');
  }

  const total = cart.reduce((s, c) => s + c.total, 0);
  const itemCount = cart.reduce((s, c) => s + c.qty, 0);
 if (countEl) countEl.textContent = itemCount;
 if (subtEl) subtEl.textContent = '₱' + total.toLocaleString('en-PH', { minimumFractionDigits: 2 });
 if (totalEl) totalEl.textContent = '₱' + total.toLocaleString('en-PH', { minimumFractionDigits: 2 });
 const btn = document.getElementById('checkoutBtn');
  if (btn) btn.disabled = cart.length === 0;
}

function switchCartUnit(idx, unit) {
  const prod = allProducts.find(p => p.id === cart[idx].productId);
  if (!prod) return;
  cart[idx].unit = unit;
  cart[idx].price = unit === 'pack' ? parseFloat(prod.pricePack||0) : parseFloat(prod.pricePer||0);
  cart[idx].total = cart[idx].qty * cart[idx].price;
  saveCartToStorage();
  renderCart();
}

function changeCartQty(idx, delta) {
  cart[idx].qty = Math.max(1, cart[idx].qty + delta);
  cart[idx].total = cart[idx].qty * cart[idx].price;
  saveCartToStorage();
  renderCart();
}

function setCartQty(idx, val) {
  const q = Math.max(1, parseInt(val) || 1);
  cart[idx].qty = q;
  cart[idx].total = q * cart[idx].price;
  saveCartToStorage();
  renderCart();
}

function removeFromCart(idx) {
  cart.splice(idx, 1);
  saveCartToStorage();
  renderCart();
}

function clearCart() {
  if (cart.length === 0) return;
  if (!confirm('Clear all items from cart?')) return;
  cart = [];
  saveCartToStorage();
  renderCart();
}

// ─── CHECKOUT ─────────────────────────────────
function openCheckout() {
 if (cart.length === 0) { toast('Cart is empty!', 'warning'); return; }
  const total = cart.reduce((s, c) => s + c.total, 0);
  openModal(`
<div class="modal-title">Checkout</div>
<div class="checkout-form">
<div class="checkout-summary">
 ${cart.map(c => `<div class="checkout-item-line"><span>${c.name} (${c.unit}) x${c.qty}</span><span>₱${c.total.toFixed(2)}</span></div>`).join('')}
 <div class="checkout-total-line"><span>TOTAL</span><span>₱${total.toFixed(2)}</span></div>
      </div>
<div class="field">
<label>Cash Received (₱)</label>
<input type="number" id="cashInput" placeholder="0.00" min="${total}" step="0.01" oninput="updateChange(${total})">
      </div>
<div class="change-display" id="changeDisplay">
<div class="change-label">Change</div>
<div class="change-amount" id="changeAmt">₱0.00</div>
      </div>
<button class="btn btn-primary btn-lg" style="width:100%" onclick="processCheckout(${total})">Confirm & Save Transaction</button>
    </div>`);
  setTimeout(() => document.getElementById('cashInput')?.focus(), 200);
}

function updateChange(total) {
  const cash = parseFloat(document.getElementById('cashInput')?.value || 0);
  const change = cash - total;
  const cd = document.getElementById('changeDisplay');
  const ca = document.getElementById('changeAmt');
 if (ca) ca.textContent = '₱' + Math.abs(change).toLocaleString('en-PH', { minimumFractionDigits: 2 });
  if (cd) { cd.classList.toggle('negative', change < 0); }
}

async function processCheckout(total) {
  const cash = parseFloat(document.getElementById('cashInput')?.value || 0);
 if (!cash || cash< total) { toast('Cash received is insufficient!', 'error'); return; }
  const change = cash - total;
  const txId = 'TX' + Date.now();
  const siNum = 'SI' + Date.now();
  const now = new Date();

  const payload = {
    action: 'saveSale',
    transactionId: txId,
    siNumber: siNum,
    cashierName: currentUser.name,
    cashierId: currentUser.id,
    date: now.toISOString(),
    items: JSON.stringify(cart),
    total,
    cash,
    change,
  };

  closeModalDirect();
 toast('Saving transaction...', 'info');

  try {
    const res = await gasPost(payload);
    if (res.success) {
      generateAndShowReceipt({ txId, siNum, cashier: currentUser.name, date: now, items: [...cart], total, cash, change });
      cart = [];
      saveCartToStorage();
      // save receipt metadata to local
      saveReceiptToLocal({ txId, siNum, cashier: currentUser.name, date: now.toISOString(), total });
      saveFullReceiptToLocal({ txId, siNum, cashier: currentUser.name, date: now, items: [...cart], total, cash, change });
 toast('Transaction saved!', 'success');
    } else {
 toast('Error saving: ' + (res.message || 'Unknown error'), 'error');
    }
  } catch(e) {
 toast('Network error. Transaction not saved.', 'error');
  }
}

// ─── RECEIPT ──────────────────────────────────
let currentReceiptData = null;

function generateAndShowReceipt(data) {
  currentReceiptData = data;
  const { txId, siNum, cashier, date, items, total, cash, change } = data;
  const dateStr = new Date(date).toLocaleString('en-PH', { dateStyle: 'long', timeStyle: 'short' });
  const vatRate = 0.12;
  const vatAmount = total * vatRate / (1 + vatRate);
  const netAmount = total - vatAmount;

  const itemRows = items.map(it => `
<div class="receipt-item-row">
      <span class="desc">${it.name} (${it.unit})</span>
      <span class="qty">${it.qty}</span>
      <span class="amt">₱${it.total.toFixed(2)}</span>
    </div>`).join('');

  const totalQty = items.reduce((s, i) => s + i.qty, 0);

  const rs = getReceiptSettings();
 document.getElementById('receiptContent').innerHTML = `
<div class="receipt-head">
<div class="receipt-store">${rs.storeName}</div>
 ${rs.ownedBy ? `<div class="receipt-owned">Owned by: ${rs.ownedBy}</div>` : ''}
 ${rs.vatTin ? `<div class="receipt-vat">VAT Reg TIN: ${rs.vatTin}</div>` : ''}
 ${rs.address ? `<div class="receipt-addr">${rs.address}</div>` : ''}
    </div>
<div class="receipt-body">
<div class="receipt-meta">
        <div><b>SI #:</b> ${siNum}</div>
        <div><b>Transaction #:</b> ${txId}</div>
        <div><b>Cashier:</b> ${cashier}</div>
        <div><b>Date & Time:</b> ${dateStr}</div>
      </div>
      <hr class="receipt-divider">
<div class="receipt-items-header">
        <span>DESCRIPTION</span><span>QTY</span><span style="text-align:right">AMOUNT</span>
      </div>
      ${itemRows}
      <hr class="receipt-divider">
 <div class="receipt-meta" style="text-align:right"><b>Total Qty:</b> ${totalQty}</div>
<div class="receipt-totals">
 <div class="receipt-total-row"><span>Amount Due</span><span>₱${total.toFixed(2)}</span></div>
 <div class="receipt-total-row"><span>Cash</span><span>₱${cash.toFixed(2)}</span></div>
 <div class="receipt-total-row grand"><span>CHANGE</span><span>₱${change.toFixed(2)}</span></div>
 <div class="receipt-total-row vat-row"><span>VAT (12% incl.)</span><span>₱${vatAmount.toFixed(2)}</span></div>
      </div>
    </div>
<div class="receipt-footer">
      ${rs.footer || 'This serves as Sales Invoice for Inventory Only'}<br>
      Thank you for shopping at ${rs.storeName}!
    </div>`;

  document.getElementById('receiptModal').classList.remove('hidden');
}

function closeReceiptModal() {
  document.getElementById('receiptModal').classList.add('hidden');
  currentReceiptData = null;
  // Save & Exit — always go back to POS fresh
  cart = [];
  saveCartToStorage();
  navigateTo('pos');
}

async function downloadReceipt() {
  if (!currentReceiptData) return;
  try {
    const el = document.getElementById('receiptContent');
    if (typeof html2canvas !== 'undefined') {
      const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
      const link = document.createElement('a');
      link.download = `receipt_${currentReceiptData.txId}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } else {
      // fallback: load html2canvas dynamically
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
      downloadReceipt();
    }
  } catch(e) {
 toast('Download failed. Try again.', 'error');
  }
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

function saveReceiptToLocal(meta) {
  let gallery = JSON.parse(localStorage.getItem('ae_receipt_gallery') || '[]');
  gallery.unshift(meta);
  if (gallery.length > 200) gallery = gallery.slice(0, 200);
  localStorage.setItem('ae_receipt_gallery', JSON.stringify(gallery));
}

function saveFullReceiptToLocal(data) {
  // Save full receipt data for reprinting
  try {
    let full = JSON.parse(localStorage.getItem('ae_receipt_full') || '{}');
    full[data.txId] = {
      txId: data.txId,
      siNum: data.siNum,
      cashier: data.cashier,
      date: data.date instanceof Date ? data.date.toISOString() : data.date,
      items: data.items,
      total: data.total,
      cash: data.cash,
      change: data.change
    };
    // Keep only last 100 full receipts
    const keys = Object.keys(full);
    if (keys.length > 100) {
      keys.slice(0, keys.length - 100).forEach(k => delete full[k]);
    }
    localStorage.setItem('ae_receipt_full', JSON.stringify(full));
  } catch(e) {}
}

// ═══════════════════════════════════════════════
// INVENTORY
// ═══════════════════════════════════════════════
let invProducts = [];

async function renderInventory() {
  const isReadOnly = currentUser.role === 'viewer';
 document.getElementById('pageContent').innerHTML = `
<div class="inv-toolbar">
<div class="search-wrap" style="flex:1;min-width:200px;margin-bottom:0">
        <span class="search-icon">🔍</span>
<input type="text" id="invSearch" placeholder="Search products..." oninput="filterInventory(this.value)">
      </div>
      ${!isReadOnly ? `
<button class="btn btn-primary" onclick="openAddProductModal()">Add Product</button>
<button class="btn btn-ghost" onclick="openImportModal()">Import CSV/Excel</button>
      ` : ''}
    </div>
<div class="card">
 <div id="inventoryTable"><div class="loading-spinner"><div class="spinner"></div> Loading...</div></div>
    </div>`;
  await loadInventory();
}

async function loadInventory() {
  try {
    const res = await gasRequest({ action: 'getProducts' });
    invProducts = res.data || [];
    renderInventoryTable(invProducts);
  } catch(e) {
    const el = document.getElementById('inventoryTable');
 if (el) el.innerHTML = '<div class="no-data"><div class="no-data-icon"></div><div>Failed to load inventory.</div></div>';
  }
}


// ── PRODUCT IMAGES (base64 in localStorage) ──
function getProductImage(productId) {
  try {
    const imgs = JSON.parse(localStorage.getItem('ae_product_images') || '{}');
    return imgs[productId] || null;
  } catch(e) { return null; }
}

function saveProductImage(productId, base64) {
  try {
    const imgs = JSON.parse(localStorage.getItem('ae_product_images') || '{}');
    imgs[productId] = base64;
    localStorage.setItem('ae_product_images', JSON.stringify(imgs));
  } catch(e) { toast('Image too large or storage full.', 'error'); }
}

function deleteProductImage(productId) {
  try {
    const imgs = JSON.parse(localStorage.getItem('ae_product_images') || '{}');
    delete imgs[productId];
    localStorage.setItem('ae_product_images', JSON.stringify(imgs));
  } catch(e) {}
}

function openImageUpload(productId, productName) {
  openModal(`
    <div class="modal-title">Product Image — ${productName}</div>
    <p style="color:var(--text3);font-size:0.82rem;margin-bottom:16px">
      Images are stored on this device only. Max recommended size: 1MB.
    </p>
    <div class="img-upload-area" id="imgUploadArea" onclick="document.getElementById('imgFileInput').click()">
      <div id="imgPreviewWrap">
        ${getProductImage(productId)
          ? `<img src="${getProductImage(productId)}" style="max-width:100%;max-height:200px;border-radius:8px;object-fit:contain">`
          : `<div style="text-align:center;color:var(--text3);padding:32px">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin:0 auto 10px;display:block"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
              <div style="font-size:0.85rem">Click to upload image</div>
              <div style="font-size:0.75rem;margin-top:4px">JPG, PNG, WEBP</div>
            </div>`
        }
      </div>
    </div>
    <input type="file" id="imgFileInput" accept="image/*" style="display:none" onchange="handleImageUpload(this,'${productId}')">
    <div style="display:flex;gap:10px;margin-top:14px">
      ${getProductImage(productId) ? `<button class="btn btn-danger btn-sm" onclick="deleteProductImage('${productId}');closeModalDirect();loadInventory()">Remove Image</button>` : ''}
      <button class="btn btn-ghost" style="flex:1" onclick="closeModalDirect()">Cancel</button>
    </div>`);
}

function handleImageUpload(input, productId) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    toast('Image too large! Max 2MB.', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = function(e) {
    const base64 = e.target.result;
    // Resize image before saving
    const img = new Image();
    img.onload = function() {
      const canvas = document.createElement('canvas');
      const MAX = 300;
      let w = img.width, h = img.height;
      if (w > h) { if (w > MAX) { h = h * MAX / w; w = MAX; } }
      else { if (h > MAX) { w = w * MAX / h; h = MAX; } }
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      const resized = canvas.toDataURL('image/jpeg', 0.75);
      saveProductImage(productId, resized);
      toast('Image saved!', 'success');
      closeModalDirect();
      loadInventory();
    };
    img.src = base64;
  };
  reader.readAsDataURL(file);
}

function viewProductImage(productId, productName) {
  const img = getProductImage(productId);
  if (!img) { openImageUpload(productId, productName); return; }
  openModal(`
    <div class="modal-title">${productName}</div>
    <div style="text-align:center">
      <img src="${img}" style="max-width:100%;max-height:360px;border-radius:10px;object-fit:contain;box-shadow:var(--shadow)">
    </div>
    <div style="display:flex;gap:10px;margin-top:16px">
      <button class="btn btn-ghost btn-sm" onclick="openImageUpload('${productId}','${productName}');closeModalDirect()">Change Image</button>
      <button class="btn btn-danger btn-sm" onclick="deleteProductImage('${productId}');closeModalDirect();loadInventory()">Remove</button>
      <button class="btn btn-primary" style="flex:1" onclick="closeModalDirect()">Close</button>
    </div>`);
}

function renderInventoryTable(products) {
  const el = document.getElementById('inventoryTable');
  if (!el) return;
  const isReadOnly = currentUser.role === 'viewer';
  const canDelete = ['admin','clerk'].includes(currentUser.role);
  const canEdit = ['admin','clerk'].includes(currentUser.role);
  const adminOnly = currentUser.role === 'admin';

  if (!products.length) {
    el.innerHTML = '<div class="no-data"><div class="no-data-icon"></div><div class="no-data-text">No products yet.</div></div>';
    return;
  }

  const chkCol = canDelete ? '<th style="width:36px"><input type="checkbox" id="selectAll" onchange="toggleSelectAll(this)"></th>' : '';
  const actCol = canEdit ? '<th>Actions</th>' : '';
  const imgCol = '<th style="width:52px">Image</th>';

  let rows = products.map(p => {
    const qty = parseInt(p.qtyPcs || 0);
    const badge = qty === 0 ? '<span class="badge-out">Out</span>' : qty <= 5 ? '<span class="badge-low">Low</span>' : '<span class="badge-in-stock">In Stock</span>';
    const chk = canDelete ? `<td><input type="checkbox" class="row-select" value="${p.id}" onchange="updateBulkBar()"></td>` : '';
    const img = getProductImage(p.id);
    const thumb = img ? `<img src="${img}" class="prod-thumb" onclick="viewProductImage('${p.id}','${p.name}')">` : `<div class="prod-thumb-empty" onclick="openImageUpload('${p.id}','${p.name}')">+</div>`;
    const acts = canEdit ? `<td><div class="inv-btn-group">
      <button class="inv-btn inv-btn-edit" onclick="openEditProductModal('${p.id}')" title="Edit"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Edit</button>
      <button class="inv-btn inv-btn-in" onclick="openStockModal('${p.id}','in')" title="Stock In"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></svg> In</button>
      <button class="inv-btn inv-btn-out" onclick="openStockModal('${p.id}','out')" title="Stock Out"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="8 8 12 12 16 8"/><line x1="12" y1="12" x2="12" y2="3"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></svg> Out</button>
      <button class="inv-btn inv-btn-del" onclick="deleteProduct('${p.id}')" title="Delete"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></button>
    </div></td>` : '';
    return `<tr>${chk}
      <td>${thumb}</td>
      <td style="font-family:var(--font-mono);font-size:0.8rem">${p.barcode||'—'}</td>
      <td><b>${p.name}</b></td>
      <td>${p.qtyPcs||0}</td><td>${p.qtyPacks||0}</td>
      <td>₱${parseFloat(p.pricePer||0).toFixed(2)}</td>
      <td>₱${parseFloat(p.pricePack||0).toFixed(2)}</td>
      <td>${badge}</td>${acts}
    </tr>`;
  }).join('');

  el.innerHTML = `
    ${canDelete ? '<div class="bulk-action-bar" id="bulkActionBar" style="display:none"><span id="selectedCount">0 selected</span><button class="btn btn-danger btn-sm" onclick="bulkDeleteSelected()">Delete Selected</button><button class="btn btn-ghost btn-sm" onclick="clearSelection()">Clear</button></div>' : ''}
    <div class="tbl-wrap"><table>
      <thead><tr>${chkCol}${imgCol}<th>Barcode</th><th>Name</th><th>Qty Pcs</th><th>Qty Packs</th><th>Price/Pc</th><th>Price/Pack</th><th>Status</th>${actCol}</tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

function toggleSelectAll(cb) {
  document.querySelectorAll('.row-select').forEach(c => c.checked = cb.checked);
  updateBulkBar();
}

function updateBulkBar() {
  const selected = document.querySelectorAll('.row-select:checked');
  const bar = document.getElementById('bulkActionBar');
  const count = document.getElementById('selectedCount');
  if (bar) bar.style.display = selected.length > 0 ? 'flex' : 'none';
  if (count) count.textContent = selected.length + ' selected';
  const selAll = document.getElementById('selectAll');
  const all = document.querySelectorAll('.row-select');
  if (selAll) selAll.checked = all.length > 0 && selected.length === all.length;
}

function clearSelection() {
  document.querySelectorAll('.row-select').forEach(c => c.checked = false);
  const selAll = document.getElementById('selectAll');
  if (selAll) selAll.checked = false;
  updateBulkBar();
}

async function bulkDeleteSelected() {
  const selected = [...document.querySelectorAll('.row-select:checked')].map(c => c.value);
  if (!selected.length) return;
  if (!confirm('Delete ' + selected.length + ' product(s)? Cannot be undone.')) return;
  toast('Deleting ' + selected.length + ' products...', 'info');
  let done = 0;
  for (const id of selected) {
    try { const res = await gasPost({ action: 'deleteProduct', id }); if (res.success) done++; } catch(e) {}
  }
  toast('Deleted ' + done + ' of ' + selected.length + ' products.', 'success');
  loadInventory();
}

function filterInventory(val) {
  const q = val.toLowerCase();
  const filtered = invProducts.filter(p =>
    (p.name || '').toLowerCase().includes(q) ||
    (p.barcode || '').toLowerCase().includes(q)
  );
  renderInventoryTable(filtered);
}

// ── PRODUCT BARCODES STATE ──
let productBarcodes = []; // up to 3 barcodes
let productPhotoData = null; // base64 photo
let productScannerActive = false;

function openAddProductModal() {
  productBarcodes = [];
  productPhotoData = null;
  productScannerActive = false;
  openModal(buildProductModal(null));
  setTimeout(() => initProductModalListeners(), 200);
}

function openEditProductModal(id) {
  const p = invProducts.find(x => x.id === id);
  if (!p) return;
  // Parse existing barcodes (comma separated)
  productBarcodes = (p.barcode || '').split(',').map(b => b.trim()).filter(Boolean).slice(0, 3);
  productPhotoData = getProductImage(id) || null;
  productScannerActive = false;
  openModal(buildProductModal(p));
  setTimeout(() => initProductModalListeners(), 200);
}

function buildProductModal(p) {
  const isEdit = !!p;
  const existingPhoto = p ? getProductImage(p.id) : null;
  return `
    <div class="modal-title">${isEdit ? 'Edit Product' : 'Add New Product'}</div>

    <!-- PHOTO SECTION -->
    <div class="prod-modal-section">
      <div class="prod-modal-label">Product Photo</div>
      <div class="prod-photo-area">
        <div class="prod-photo-preview" id="prodPhotoPreview">
          ${existingPhoto
            ? `<img src="${existingPhoto}" id="prodPhotoImg" style="width:100%;height:100%;object-fit:cover;border-radius:8px">`
            : `<div class="prod-photo-placeholder" id="prodPhotoPlaceholder">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                <span>No photo</span>
              </div>`}
        </div>
        <div class="prod-photo-btns">
          <button class="inv-btn inv-btn-edit" onclick="openProductCamera()">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
            Take Photo
          </button>
          <button class="inv-btn inv-btn-in" onclick="document.getElementById('prodPhotoFile').click()">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            Upload
          </button>
          ${existingPhoto || productPhotoData ? `<button class="inv-btn inv-btn-del" onclick="removeProductPhoto()">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
          </button>` : ''}
        </div>
        <input type="file" id="prodPhotoFile" accept="image/*" style="display:none" onchange="handleProductPhoto(this)">
      </div>
      <!-- Camera for photo -->
      <div id="prodPhotoCameraWrap" style="display:none;margin-top:10px">
        <video id="prodPhotoVideo" autoplay playsinline muted style="width:100%;border-radius:8px;max-height:200px;object-fit:cover;background:#000"></video>
        <div style="display:flex;gap:8px;margin-top:8px">
          <button class="btn btn-primary btn-sm" style="flex:1" onclick="captureProductPhoto()">Capture</button>
          <button class="btn btn-ghost btn-sm" onclick="closeProductCamera()">Cancel</button>
        </div>
      </div>
    </div>

    <!-- BARCODES SECTION -->
    <div class="prod-modal-section">
      <div class="prod-modal-label">Barcodes <span style="color:var(--text3);font-weight:400">(up to 3)</span></div>
      <div id="barcodeList" class="barcode-list"></div>
      ${productBarcodes.length < 3 ? `
      <div class="barcode-add-row">
        <input type="text" id="barcodeManualInput" placeholder="Type barcode + Enter or scan..."
          autocomplete="off" onkeydown="if(event.key==='Enter'){event.preventDefault();addBarcodeManual()}">
        <button class="inv-btn inv-btn-edit" onclick="openProductBarcodeScanner()">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
          Scan
        </button>
        <button class="inv-btn inv-btn-in" onclick="addBarcodeManual()">Add</button>
      </div>` : `<p style="color:var(--text3);font-size:0.78rem">Maximum 3 barcodes reached.</p>`}
      <!-- Inline barcode scanner -->
      <div id="prodBarcodeScannerWrap" style="display:none;margin-top:10px">
        <video id="prodBarcodeVideo" autoplay playsinline muted style="width:100%;border-radius:8px;max-height:180px;object-fit:cover;background:#000"></video>
        <div class="camera-status" id="prodBarcodeScanStatus" style="color:var(--text2);background:var(--bg);border-radius:6px;margin-top:4px">Point at barcode...</div>
        <button class="btn btn-ghost btn-sm" style="margin-top:6px;width:100%" onclick="closeProductBarcodeScanner()">Cancel</button>
      </div>
    </div>

    <!-- PRODUCT DETAILS -->
    <div class="prod-modal-section">
      <div class="prod-modal-label">Product Details</div>
      <div class="input-row">
        <div class="field" style="grid-column:1/-1">
          <label>Product Name *</label>
          <input id="f_name" value="${p?.name || ''}" placeholder="e.g. Coca-Cola 1.5L">
        </div>
      </div>
      <div class="input-row">
        <div class="field" style="grid-column:1/-1">
          <label>Description</label>
          <input id="f_desc" value="${p?.description || ''}" placeholder="Optional description">
        </div>
      </div>
      <div class="input-row">
        <div class="field">
          <label>Variants</label>
          <input id="f_variants" value="${p?.variants || ''}" placeholder="e.g. Red, Blue, Large">
        </div>
        <div class="field">
          <label>Category</label>
          <input id="f_category" value="${p?.category || ''}" placeholder="e.g. Beverages">
        </div>
      </div>
    </div>

    <!-- STOCK & PRICE -->
    <div class="prod-modal-section">
      <div class="prod-modal-label">Stock & Pricing</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        <div class="field">
          <label>Qty (Pcs)</label>
          <input id="f_qtyPcs" type="number" min="0" value="${p?.qtyPcs || 0}">
        </div>
        <div class="field">
          <label>Qty (Packs)</label>
          <input id="f_qtyPacks" type="number" min="0" value="${p?.qtyPacks || 0}">
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        <div class="field">
          <label>Price per Piece (₱)</label>
          <input id="f_pricePer" type="number" min="0" step="0.01" value="${p?.pricePer || 0}" placeholder="0.00">
        </div>
        <div class="field">
          <label>Price per Pack (₱)</label>
          <input id="f_pricePack" type="number" min="0" step="0.01" value="${p?.pricePack || 0}" placeholder="0.00">
        </div>
      </div>
    </div>

    <button class="btn btn-primary" style="width:100%;margin-top:8px" onclick="saveProduct(${p ? "'"+p.id+"'" : ''})">
      ${isEdit ? 'Update Product' : 'Save Product'}
    </button>`;
}

function initProductModalListeners() {
  renderBarcodeList();
  if (productPhotoData) {
    const img = document.getElementById('prodPhotoImg');
    if (!img) {
      const preview = document.getElementById('prodPhotoPreview');
      if (preview) preview.innerHTML = `<img src="${productPhotoData}" style="width:100%;height:100%;object-fit:cover;border-radius:8px">`;
    }
  }
}

function renderBarcodeList() {
  const el = document.getElementById('barcodeList');
  if (!el) return;
  if (!productBarcodes.length) {
    el.innerHTML = '<p style="color:var(--text3);font-size:0.78rem;margin-bottom:6px">No barcodes added yet.</p>';
    return;
  }
  el.innerHTML = productBarcodes.map((b, i) => `
    <div class="barcode-pill">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="2" height="16"/><rect x="5" y="4" width="1" height="16"/><rect x="8" y="4" width="2" height="16"/><rect x="12" y="4" width="1" height="16"/><rect x="15" y="4" width="2" height="16"/><rect x="19" y="4" width="1" height="16"/><rect x="22" y="4" width="1" height="16"/></svg>
      <span style="font-family:var(--font-mono);font-size:0.82rem">${b}</span>
      <span style="font-size:0.7rem;color:var(--text3)">BC${i+1}</span>
      <button onclick="removeBarcode(${i})" style="background:none;border:none;cursor:pointer;color:#ef4444;font-size:0.85rem;padding:0 2px">✕</button>
    </div>`).join('');
}

function addBarcodeManual() {
  const input = document.getElementById('barcodeManualInput');
  if (!input) return;
  const val = input.value.trim();
  if (!val) { toast('Enter a barcode value.', 'warning'); return; }
  addBarcodeToList(val);
  input.value = '';
  input.focus();
}

function addBarcodeToList(val) {
  if (productBarcodes.length >= 3) { toast('Maximum 3 barcodes only.', 'warning'); return; }
  if (productBarcodes.includes(val)) { toast('Barcode already added.', 'warning'); return; }
  productBarcodes.push(val);
  renderBarcodeList();
  toast('Barcode added: ' + val, 'success');
  // Hide scanner if open
  closeProductBarcodeScanner();
}

function removeBarcode(idx) {
  productBarcodes.splice(idx, 1);
  renderBarcodeList();
}

// ── PRODUCT BARCODE SCANNER (inline) ──
let prodBarcodeStream = null;
let prodBarcodeScanId = null;
let prodBarcodeScanning = false;

async function openProductBarcodeScanner() {
  const wrap = document.getElementById('prodBarcodeScannerWrap');
  const video = document.getElementById('prodBarcodeVideo');
  const status = document.getElementById('prodBarcodeScanStatus');
  if (!wrap || !video) return;
  wrap.style.display = 'block';
  prodBarcodeScanning = true;

  try {
    prodBarcodeStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
    });
    video.srcObject = prodBarcodeStream;
    await video.play();
    if (status) status.textContent = 'Point at barcode...';

    if ('BarcodeDetector' in window) {
      const detector = new BarcodeDetector({ formats: ['ean_13','ean_8','code_128','code_39','upc_a','upc_e','qr_code'] });
      async function detect() {
        if (!prodBarcodeScanning) return;
        try {
          const codes = await detector.detect(video);
          if (codes.length > 0) {
            const val = codes[0].rawValue.trim();
            if (status) status.textContent = 'Found: ' + val;
            addBarcodeToList(val);
            return;
          }
        } catch(e) {}
        prodBarcodeScanId = requestAnimationFrame(detect);
      }
      detect();
    } else {
      // ZXing/jsQR fallback
      if (typeof ZXing === 'undefined' && typeof jsQR === 'undefined') {
        await loadScript('https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js');
      }
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      function scan() {
        if (!prodBarcodeScanning) return;
        if (video.readyState === video.HAVE_ENOUGH_DATA) {
          canvas.width = video.videoWidth; canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0);
          if (typeof jsQR !== 'undefined') {
            const code = jsQR(ctx.getImageData(0,0,canvas.width,canvas.height).data, canvas.width, canvas.height);
            if (code && code.data) {
              if (status) status.textContent = 'Found: ' + code.data;
              addBarcodeToList(code.data.trim());
              return;
            }
          }
        }
        prodBarcodeScanId = requestAnimationFrame(scan);
      }
      scan();
    }
  } catch(e) {
    if (status) status.textContent = e.name === 'NotAllowedError' ? 'Camera denied.' : 'Camera error.';
  }
}

function closeProductBarcodeScanner() {
  prodBarcodeScanning = false;
  if (prodBarcodeScanId) { cancelAnimationFrame(prodBarcodeScanId); prodBarcodeScanId = null; }
  if (prodBarcodeStream) { prodBarcodeStream.getTracks().forEach(t => t.stop()); prodBarcodeStream = null; }
  const wrap = document.getElementById('prodBarcodeScannerWrap');
  const video = document.getElementById('prodBarcodeVideo');
  if (wrap) wrap.style.display = 'none';
  if (video) video.srcObject = null;
}

// ── PRODUCT PHOTO CAMERA ──
let prodPhotoStream = null;

async function openProductCamera() {
  const wrap = document.getElementById('prodPhotoCameraWrap');
  const video = document.getElementById('prodPhotoVideo');
  if (!wrap || !video) return;
  wrap.style.display = 'block';
  try {
    prodPhotoStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
    });
    video.srcObject = prodPhotoStream;
    await video.play();
  } catch(e) {
    toast(e.name === 'NotAllowedError' ? 'Camera permission denied.' : 'Camera error.', 'error');
    wrap.style.display = 'none';
  }
}

function captureProductPhoto() {
  const video = document.getElementById('prodPhotoVideo');
  if (!video) return;
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  // Resize to max 400px
  const MAX = 400;
  const resizeCanvas = document.createElement('canvas');
  let w = canvas.width, h = canvas.height;
  if (w > h) { if (w > MAX) { h = h * MAX / w; w = MAX; } }
  else { if (h > MAX) { w = w * MAX / h; h = MAX; } }
  resizeCanvas.width = w; resizeCanvas.height = h;
  resizeCanvas.getContext('2d').drawImage(canvas, 0, 0, w, h);
  productPhotoData = resizeCanvas.toDataURL('image/jpeg', 0.8);
  // Update preview
  const preview = document.getElementById('prodPhotoPreview');
  if (preview) preview.innerHTML = `<img src="${productPhotoData}" style="width:100%;height:100%;object-fit:cover;border-radius:8px">`;
  closeProductCamera();
  toast('Photo captured!', 'success');
}

function closeProductCamera() {
  if (prodPhotoStream) { prodPhotoStream.getTracks().forEach(t => t.stop()); prodPhotoStream = null; }
  const wrap = document.getElementById('prodPhotoCameraWrap');
  const video = document.getElementById('prodPhotoVideo');
  if (wrap) wrap.style.display = 'none';
  if (video) video.srcObject = null;
}

function handleProductPhoto(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { toast('Image too large! Max 5MB.', 'error'); return; }
  const reader = new FileReader();
  reader.onload = function(e) {
    const img = new Image();
    img.onload = function() {
      const MAX = 400;
      const canvas = document.createElement('canvas');
      let w = img.width, h = img.height;
      if (w > h) { if (w > MAX) { h = h * MAX / w; w = MAX; } }
      else { if (h > MAX) { w = w * MAX / h; h = MAX; } }
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      productPhotoData = canvas.toDataURL('image/jpeg', 0.8);
      const preview = document.getElementById('prodPhotoPreview');
      if (preview) preview.innerHTML = `<img src="${productPhotoData}" style="width:100%;height:100%;object-fit:cover;border-radius:8px">`;
      toast('Photo uploaded!', 'success');
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function removeProductPhoto() {
  productPhotoData = null;
  const preview = document.getElementById('prodPhotoPreview');
  if (preview) preview.innerHTML = `<div class="prod-photo-placeholder" id="prodPhotoPlaceholder">
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
    <span>No photo</span>
  </div>`;
}

async function saveProduct(id = null) {
  const name = document.getElementById('f_name')?.value.trim();
  if (!name) { toast('Product name is required.', 'error'); return; }
  if (!productBarcodes.length) {
    if (!confirm('No barcode added. Save product without barcode?')) return;
  }
  // Stop any open cameras
  closeProductCamera();
  closeProductBarcodeScanner();

  const payload = {
    action: id ? 'updateProduct' : 'addProduct',
    id, name,
    barcode: productBarcodes.join(','),
    description: document.getElementById('f_desc')?.value.trim() || '',
    variants: document.getElementById('f_variants')?.value.trim() || '',
    category: document.getElementById('f_category')?.value.trim() || '',
    qtyPcs: parseInt(document.getElementById('f_qtyPcs')?.value || 0),
    qtyPacks: parseInt(document.getElementById('f_qtyPacks')?.value || 0),
    pricePer: parseFloat(document.getElementById('f_pricePer')?.value || 0),
    pricePack: parseFloat(document.getElementById('f_pricePack')?.value || 0),
  };

  showLoading(id ? 'Updating product...' : 'Saving product...');
  try {
    const res = await gasPost(payload);
    hideLoading();
    if (res.success) {
      const productId = id || res.id;
      if (productPhotoData && productId) {
        saveProductImage(productId, productPhotoData);
      } else if (!productPhotoData && productId && id) {
        deleteProductImage(productId);
      }
      toast(id ? 'Product updated!' : 'Product added!', 'success');
      closeModalDirect();
      loadInventory();
    } else {
      toast(res.message || 'Error saving product.', 'error');
    }
  } catch(e) { hideLoading(); toast('Network error.', 'error'); }
}

async function deleteProduct(id) {
  if (!confirm('Delete this product? This cannot be undone.')) return;
  try {
    const res = await gasPost({ action: 'deleteProduct', id });
 if (res.success) { toast('Product deleted.', 'success'); loadInventory(); }
 else toast(res.message || 'Error deleting.', 'error');
 } catch(e) { toast('Network error.', 'error'); }
}

function openStockModal(id, direction) {
  const p = invProducts.find(x => x.id === id);
  if (!p) return;
  openModal(`
<div class="modal-title">${direction === 'in' ? ' Stock In' : ' Stock Out'} — ${p.name}</div>
<div class="input-row">
 <div class="field"><label>Quantity</label><input id="stockQty" type="number" min="1" value="1" placeholder="Enter qty"></div>
 <div class="field"><label>Unit</label>
        <select id="stockUnit">
          <option value="pcs">Pieces (pcs)</option>
          <option value="packs">Packs</option>
        </select>
      </div>
    </div>
 <div class="field"><label>Notes / Reason</label><input id="stockNote" placeholder="Optional notes"></div>
<button class="btn btn-primary" style="width:100%;margin-top:10px" onclick="saveStock('${id}','${direction}')">Save</button>`);
}

async function saveStock(id, direction) {
  const qty = parseInt(document.getElementById('stockQty')?.value || 0);
  const unit = document.getElementById('stockUnit')?.value;
  const note = document.getElementById('stockNote')?.value.trim();
 if (!qty || qty< 1) { toast('Enter a valid quantity.', 'error'); return; }
  try {
    const res = await gasPost({
      action: 'stockAdjust', id, direction, qty, unit, note,
      adjustedBy: currentUser.name, date: new Date().toISOString()
    });
 if (res.success) { toast(`Stock ${direction} saved!`, 'success'); closeModalDirect(); loadInventory(); }
 else toast(res.message || 'Error.', 'error');
 } catch(e) { toast('Network error.', 'error'); }
}

// ── RECEIPT SETTINGS ─────────────────────────
function getReceiptSettings() {
  const defaults = {
    storeName: 'AE HOME',
    ownedBy: 'AE Home Trade Corp.',
    vatTin: '010-948-69500000',
    address: 'Alcantara Street, Brgy VIII, City of Vigan',
    footer: 'This serves as Sales Invoice for Inventory Only'
  };
  try {
    const saved = JSON.parse(localStorage.getItem('ae_receipt_settings') || '{}');
    return { ...defaults, ...saved };
  } catch(e) { return defaults; }
}

function saveReceiptSettings() {
  const s = {
    storeName: document.getElementById('rs_storeName')?.value.trim() || 'AE HOME',
    ownedBy: document.getElementById('rs_ownedBy')?.value.trim() || '',
    vatTin: document.getElementById('rs_vatTin')?.value.trim() || '',
    address: document.getElementById('rs_address')?.value.trim() || '',
    footer: document.getElementById('rs_footer')?.value.trim() || '',
  };
  localStorage.setItem('ae_receipt_settings', JSON.stringify(s));
 toast('Receipt settings saved!', 'success');
  closeModalDirect();
}

function openReceiptSettings() {
  const s = getReceiptSettings();
  openModal(`
<div class="modal-title">Receipt / Company Settings</div>
    <p style="color:var(--text3);font-size:0.82rem;margin-bottom:16px">These details will appear on every receipt.</p>
<div class="input-row">
 <div class="field" style="grid-column:1/-1"><label>Store Name</label>
 <input id="rs_storeName" value="${s.storeName}" placeholder="AE HOME"></div>
    </div>
<div class="input-row">
 <div class="field" style="grid-column:1/-1"><label>Owned By</label>
 <input id="rs_ownedBy" value="${s.ownedBy}" placeholder="AE Home Trade Corp."></div>
    </div>
<div class="input-row">
 <div class="field"><label>VAT Reg TIN</label>
 <input id="rs_vatTin" value="${s.vatTin}" placeholder="000-000-000-000"></div>
    </div>
<div class="input-row">
 <div class="field" style="grid-column:1/-1"><label>Address</label>
 <input id="rs_address" value="${s.address}" placeholder="Street, Barangay, City"></div>
    </div>
<div class="input-row">
 <div class="field" style="grid-column:1/-1"><label>Receipt Footer Note</label>
 <input id="rs_footer" value="${s.footer}" placeholder="e.g. This serves as Sales Invoice..."></div>
    </div>
    <div style="display:flex;gap:10px;margin-top:8px">
<button class="btn btn-ghost" style="flex:1" onclick="closeModalDirect()">Cancel</button>
<button class="btn btn-primary" style="flex:2" onclick="saveReceiptSettings()">Save Settings</button>
    </div>`);
}

// Store parsed rows globally for import confirmation
let pendingImportRows = [];

function openImportModal() {
  pendingImportRows = [];
  openModal(`
<div class="modal-title">Import Products from CSV/Excel</div>
    <p style="color:var(--text2);font-size:0.88rem;margin-bottom:12px">
      Required column: <b>name</b>. Optional: barcode, qtyPcs, qtyPacks, pricePer, pricePack.<br>
      <span style="color:var(--text3);font-size:0.8rem">Tip: Use comma-separated CSV or Excel (.xlsx/.xls)</span>
    </p>
<div class="import-area" id="importArea" onclick="document.getElementById('importFile').click()">
 <div class="import-icon"></div>
<div class="import-text">Click to select file</div>
<div class="import-sub">.csv, .xlsx, .xls accepted</div>
    </div>
    <input type="file" id="importFile" accept=".csv,.xlsx,.xls" style="display:none" onchange="handleImportFile(this)">
    <div id="importPreview" style="margin-top:16px"></div>`);
}

async function handleImportFile(input) {
  const file = input.files[0];
  if (!file) return;

  // Show parsing indicator
  const preview = document.getElementById('importPreview');
 if (preview) preview.innerHTML = `
    <div style="text-align:center;padding:20px;color:var(--text2)">
 <div class="spinner" style="margin:0 auto 10px"></div>
      <div>Reading file: <b>${file.name}</b>...</div>
    </div>`;

  const importArea = document.getElementById('importArea');
  if (importArea) importArea.style.opacity = '0.5';

  const ext = file.name.split('.').pop().toLowerCase();
  try {
    if (ext === 'csv') {
      const text = await file.text();
      processImportCSV(text, file.name);
    } else {
      if (typeof XLSX === 'undefined') {
 if (preview) preview.innerHTML += '<div style="text-align:center;color:var(--text3);font-size:0.8rem">Loading Excel parser...</div>';
        await loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
      }
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const csv = XLSX.utils.sheet_to_csv(ws);
      processImportCSV(csv, file.name);
    }
  } catch(e) {
 if (preview) preview.innerHTML = `<div class="no-data"><div class="no-data-icon"></div><div>Failed to read file. Make sure it's a valid CSV or Excel file.</div></div>`;
    if (importArea) importArea.style.opacity = '1';
  }
}

function processImportCSV(csvText, filename) {
  const preview = document.getElementById('importPreview');
  const importArea = document.getElementById('importArea');
  if (importArea) importArea.style.opacity = '1';

  const lines = csvText.trim().split('\n').filter(l => l.trim());
  if (lines.length < 2) {
 if (preview) preview.innerHTML = '<div class="no-data"><div class="no-data-icon">️</div><div>File is empty or has no data rows.</div></div>';
 toast('File has no data rows!', 'error');
    return;
  }

  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g, '').replace(/\r/g, ''));
  const rows = lines.slice(1).map(line => {
    // Handle quoted values with commas inside
    const vals = [];
    let cur = '', inQuote = false;
    for (let ch of line) {
      if (ch === '"') { inQuote = !inQuote; }
      else if (ch === ',' && !inQuote) { vals.push(cur.trim()); cur = ''; }
      else { cur += ch; }
    }
    vals.push(cur.trim().replace(/\r/g, ''));
    const obj = {};
    headers.forEach((h, i) => obj[h] = (vals[i] || '').replace(/"/g, ''));
    return obj;
  }).filter(r => r.name && r.name.trim());

  if (!rows.length) {
 if (preview) preview.innerHTML = '<div class="no-data"><div class="no-data-icon">️</div><div>No valid products found. Make sure you have a "name" column.</div></div>';
 toast('No valid products found in file!', 'error');
    return;
  }

  // Validate rows — check for issues
  const issues = [];
  rows.forEach((r, i) => {
    if (!r.name.trim()) issues.push(`Row ${i+2}: Missing name`);
    const price = parseFloat(r.priceper || r.pricePer || 0);
    if (isNaN(price)) issues.push(`Row ${i+2}: Invalid price`);
  });

  // Store globally
  pendingImportRows = rows;

  if (!preview) return;
 preview.innerHTML = `
    <div style="background:var(--bg2);border-radius:10px;padding:12px;margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <span style="font-weight:700;font-size:0.9rem">📄 ${filename}</span>
        <span style="background:var(--green);color:white;padding:3px 10px;border-radius:20px;font-size:0.78rem;font-weight:700">${rows.length} products found</span>
      </div>
      ${issues.length ? `<div style="color:#f59e0b;font-size:0.78rem;margin-top:4px">⚠️ ${issues.length} row(s) may have issues — will still be imported if name is present.</div>` : '<div style="color:var(--green);font-size:0.78rem">✅ All rows look valid!</div>'}
    </div>

    <div style="font-size:0.82rem;font-weight:700;color:var(--text3);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px">Preview (first 10 rows)</div>
<div class="tbl-wrap" style="max-height:220px;overflow-y:auto;border:1px solid var(--border);border-radius:10px">
      <table>
        <thead><tr><th>#</th><th>Name</th><th>Barcode</th><th>Qty Pcs</th><th>Qty Packs</th><th>Price/Pc</th><th>Price/Pack</th></tr></thead>
        <tbody>
          ${rows.slice(0, 10).map((r, i) => `<tr>
            <td class="text-muted">${i+1}</td>
            <td><b>${r.name}</b></td>
            <td>${r.barcode || '—'}</td>
            <td>${r.qtypcs || r.qtyPcs || r['qty(pcs)'] || 0}</td>
            <td>${r.qtypacks || r.qtyPacks || r['qty(packs)'] || 0}</td>
            <td>₱${parseFloat(r.priceper || r.pricePer || r['price/pc'] || 0).toFixed(2)}</td>
            <td>₱${parseFloat(r.pricepack || r.pricePack || r['price/pack'] || 0).toFixed(2)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    ${rows.length > 10 ? `<p style="color:var(--text3);font-size:0.78rem;margin-top:6px;text-align:center">...and <b>${rows.length - 10}</b> more rows</p>` : ''}

    <div style="display:flex;gap:10px;margin-top:14px">
<button class="btn btn-ghost" style="flex:1" onclick="openImportModal()">↩ Choose Different File</button>
<button class="btn btn-primary" style="flex:2" id="confirmImportBtn" onclick="confirmImport()">
        ✅ Confirm & Import ${rows.length} Products
      </button>
    </div>`;
}

// Special bulk import via GET — splits product data into URL-safe chunks
async function gasBulkImport(batch) {
  // Encode each product individually and send as numbered params
  const params = new URLSearchParams();
  params.set('action', 'bulkAddProducts');
  params.set('count', batch.length);
  batch.forEach((p, i) => {
    params.set('p' + i + '_name', p.name || '');
    params.set('p' + i + '_barcode', p.barcode || '');
    params.set('p' + i + '_qtyPcs', p.qtypcs || p.qtyPcs || p['qty(pcs)'] || '0');
    params.set('p' + i + '_qtyPacks', p.qtypacks || p.qtyPacks || p['qty(packs)'] || '0');
    params.set('p' + i + '_pricePer', p.priceper || p.pricePer || p['price/pc'] || '0');
    params.set('p' + i + '_pricePack', p.pricepack || p.pricePack || p['price/pack'] || '0');
  });
  const url = GAS_URL + '?' + params.toString();
  const res = await fetch(url, { method: 'GET', redirect: 'follow' });
  const text = await res.text();
  try { return JSON.parse(text); }
  catch(e) { throw new Error('Invalid response: ' + text.substring(0, 80)); }
}

async function confirmImport() {
  const rows = pendingImportRows;
 if (!rows || !rows.length) { toast('No data to import.', 'warning'); return; }

 const btn = document.getElementById('confirmImportBtn');
  if (btn) {
    btn.disabled = true;
 btn.innerHTML = '<div class="spinner" style="display:inline-block;width:16px;height:16px;margin-right:8px;vertical-align:middle"></div> Starting import...';
  }

  // Show status element
  const preview = document.getElementById('importPreview');
  let statusEl = document.getElementById('importStatus');
  if (!statusEl && preview) {
    statusEl = document.createElement('div');
    statusEl.id = 'importStatus';
    statusEl.style.cssText = 'margin-top:12px;padding:14px;background:var(--bg2);border-radius:10px;font-size:0.85rem;text-align:center;color:var(--text2)';
    preview.appendChild(statusEl);
  }

  // ── BATCH IMPORT (15 per batch — URL-safe size) ──
  const BATCH_SIZE = 15;
  const batches = [];
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    batches.push(rows.slice(i, i + BATCH_SIZE));
  }

  let totalImported = 0;
  let failed = 0;

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    const batchNum = b + 1;
    const progress = Math.round((b / batches.length) * 100);

    // Update status
    if (statusEl) {
 statusEl.innerHTML = `
 <div class="spinner" style="margin:0 auto 10px"></div>
        <div style="font-weight:600;margin-bottom:6px">Importing batch ${batchNum} of ${batches.length}...</div>
        <div style="background:var(--border);border-radius:20px;height:8px;overflow:hidden;margin:8px 0">
          <div style="background:var(--grad);height:100%;width:${progress}%;border-radius:20px;transition:width 0.3s"></div>
        </div>
        <div style="font-size:0.78rem;color:var(--text3)">${totalImported} of ${rows.length} products saved so far...</div>`;
    }
 if (btn) btn.innerHTML = `⏳ ${progress}% (${batchNum}/${batches.length} batches)`;

    try {
      const res = await gasBulkImport(batch);
      if (res.success) {
        totalImported += res.count || batch.length;
      } else {
        failed += batch.length;
        console.warn('Batch ' + batchNum + ' failed:', res.message);
      }
    } catch(e) {
      // Retry once after 2s
      await new Promise(r => setTimeout(r, 2000));
      try {
        const res2 = await gasBulkImport(batch);
        if (res2.success) totalImported += res2.count || batch.length;
        else failed += batch.length;
      } catch(e2) {
        failed += batch.length;
        console.warn('Batch ' + batchNum + ' retry also failed:', e2.message);
      }
    }

    // Small pause between batches to avoid GAS rate limit
    if (b < batches.length - 1) await new Promise(r => setTimeout(r, 800));
  }

  // ── FINAL RESULT ─────────────────────────────
  if (failed === 0) {
 if (statusEl) statusEl.innerHTML = `<div style="color:var(--green);font-size:1rem;font-weight:700">All ${totalImported} products imported successfully!</div>`;
 toast(` Imported ${totalImported} products!`, 'success');
    pendingImportRows = [];
    setTimeout(() => { closeModalDirect(); loadInventory(); }, 1500);
  } else if (totalImported > 0) {
 if (statusEl) statusEl.innerHTML = `<div style="color:#f59e0b;font-weight:700">️ Imported ${totalImported} products. ${failed} failed — try importing the rest again.</div>`;
 toast(`Partial import: ${totalImported} saved, ${failed} failed.`, 'warning');
 if (btn) { btn.disabled = false; btn.innerHTML = ' Retry Failed'; }
  } else {
 if (statusEl) statusEl.innerHTML = '<div style="color:#ef4444;font-weight:700">Import failed. Check your connection and try again.</div>';
 toast('Import failed. Try again.', 'error');
 if (btn) { btn.disabled = false; btn.innerHTML = ' Retry Import'; }
  }
}

// ═══════════════════════════════════════════════
// FINANCE
// ═══════════════════════════════════════════════
async function renderFinance() {
 document.getElementById('pageContent').innerHTML = `
<div class="finance-tabs">
      <button class="finance-tab active" onclick="switchFinanceTab('expenses',this)">💸 Expenses</button>
      <button class="finance-tab" onclick="switchFinanceTab('allowance',this)">💰 Allowance</button>
    </div>
    <div id="financeContent"></div>`;
  loadExpenses();
}

function switchFinanceTab(tab, btn) {
  document.querySelectorAll('.finance-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  if (tab === 'expenses') loadExpenses();
  else loadAllowance();
}

async function loadExpenses() {
  const el = document.getElementById('financeContent');
 el.innerHTML = `
<div class="card" style="margin-bottom:16px">
<div class="card-title">Add Expense</div>
<div class="input-row">
 <div class="field"><label>Description</label><input id="exp_desc" placeholder="Expense description"></div>
 <div class="field"><label>Amount (₱)</label><input id="exp_amount" type="number" min="0" step="0.01" placeholder="0.00"></div>
 <div class="field"><label>Date</label><input id="exp_date" type="date" value="${new Date().toISOString().split('T')[0]}"></div>
      </div>
<button class="btn btn-primary" onclick="saveExpense()">Add Expense</button>
    </div>
<div class="card">
<div class="card-title">Expense Records</div>
 <div id="expenseList"><div class="loading-spinner"><div class="spinner"></div></div></div>
    </div>`;
  try {
    const res = await gasRequest({ action: 'getExpenses' });
    const data = res.data || [];
    const total = data.reduce((s, e) => s + parseFloat(e.amount || 0), 0);
    const el2 = document.getElementById('expenseList');
    if (!el2) return;
 if (!data.length) { el2.innerHTML = '<div class="no-data"><div class="no-data-icon"></div><div>No expenses recorded.</div></div>'; return; }
 el2.innerHTML = `
      <div style="background:var(--bg2);padding:12px;border-radius:10px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center">
        <span style="font-weight:700">Total Expenses</span>
        <span style="font-family:var(--font-head);font-size:1.2rem;font-weight:800;color:#ef4444">₱${total.toLocaleString('en-PH',{minimumFractionDigits:2})}</span>
      </div>
 <div class="tbl-wrap"><table>
        <thead><tr><th>Description</th><th>Amount</th><th>Date</th><th>Actions</th></tr></thead>
        <tbody>${data.map(e => `<tr>
          <td>${e.description}</td>
          <td class="text-red fw-700">₱${parseFloat(e.amount||0).toFixed(2)}</td>
          <td class="text-muted">${e.date ? new Date(e.date).toLocaleDateString('en-PH') : ''}</td>
 <td><button class="btn btn-danger btn-sm" onclick="deleteExpense('${e.id}')">️</button></td>
        </tr>`).join('')}</tbody>
      </table></div>`;
 } catch(e) { document.getElementById('expenseList').innerHTML = '<div class="no-data">Failed to load expenses.</div>'; }
}

async function saveExpense() {
  const desc = document.getElementById('exp_desc')?.value.trim();
  const amount = parseFloat(document.getElementById('exp_amount')?.value || 0);
  const date = document.getElementById('exp_date')?.value;
 if (!desc || !amount) { toast('Fill in description and amount.', 'error'); return; }
  try {
    const res = await gasPost({ action: 'addExpense', description: desc, amount, date, addedBy: currentUser.name });
 if (res.success) { toast('Expense saved!', 'success'); loadExpenses(); }
 else toast(res.message || 'Error.', 'error');
 } catch(e) { toast('Network error.', 'error'); }
}

async function deleteExpense(id) {
  if (!confirm('Delete this expense?')) return;
  try {
    const res = await gasPost({ action: 'deleteExpense', id });
 if (res.success) { toast('Deleted.', 'success'); loadExpenses(); }
 else toast(res.message || 'Error.', 'error');
 } catch(e) { toast('Network error.', 'error'); }
}

async function loadAllowance() {
  const el = document.getElementById('financeContent');
 el.innerHTML = `
<div class="card" style="margin-bottom:16px">
<div class="card-title">Add Allowance Record</div>
<div class="input-row">
 <div class="field"><label>For</label><input id="alw_for" placeholder="Person / purpose"></div>
 <div class="field"><label>Amount (₱)</label><input id="alw_amount" type="number" min="0" step="0.01"></div>
 <div class="field"><label>Date</label><input id="alw_date" type="date" value="${new Date().toISOString().split('T')[0]}"></div>
      </div>
<button class="btn btn-primary" onclick="saveAllowance()">Save</button>
    </div>
<div class="card">
<div class="card-title">Allowance Records</div>
 <div id="allowanceList"><div class="loading-spinner"><div class="spinner"></div></div></div>
    </div>`;
  try {
    const res = await gasRequest({ action: 'getAllowances' });
    const data = res.data || [];
    const total = data.reduce((s, e) => s + parseFloat(e.amount || 0), 0);
    const el2 = document.getElementById('allowanceList');
    if (!el2) return;
 if (!data.length) { el2.innerHTML = '<div class="no-data"><div class="no-data-icon"></div><div>No allowance records.</div></div>'; return; }
 el2.innerHTML = `
      <div style="background:var(--bg2);padding:12px;border-radius:10px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center">
        <span style="font-weight:700">Total Allowance</span>
        <span style="font-family:var(--font-head);font-size:1.2rem;font-weight:800;color:var(--green)">₱${total.toLocaleString('en-PH',{minimumFractionDigits:2})}</span>
      </div>
 <div class="tbl-wrap"><table>
        <thead><tr><th>For</th><th>Amount</th><th>Date</th><th>Actions</th></tr></thead>
        <tbody>${data.map(e => `<tr>
          <td>${e.forPerson || e.for || ''}</td>
          <td class="text-green fw-700">₱${parseFloat(e.amount||0).toFixed(2)}</td>
          <td class="text-muted">${e.date ? new Date(e.date).toLocaleDateString('en-PH') : ''}</td>
 <td><button class="btn btn-danger btn-sm" onclick="deleteAllowance('${e.id}')">️</button></td>
        </tr>`).join('')}</tbody>
      </table></div>`;
 } catch(e) { document.getElementById('allowanceList').innerHTML = '<div class="no-data">Failed to load.</div>'; }
}

async function saveAllowance() {
  const forP = document.getElementById('alw_for')?.value.trim();
  const amount = parseFloat(document.getElementById('alw_amount')?.value || 0);
  const date = document.getElementById('alw_date')?.value;
 if (!forP || !amount) { toast('Fill all fields.', 'error'); return; }
  try {
    const res = await gasPost({ action: 'addAllowance', forPerson: forP, amount, date, addedBy: currentUser.name });
 if (res.success) { toast('Saved!', 'success'); loadAllowance(); }
 else toast(res.message || 'Error.', 'error');
 } catch(e) { toast('Network error.', 'error'); }
}

async function deleteAllowance(id) {
  if (!confirm('Delete this record?')) return;
  try {
    const res = await gasPost({ action: 'deleteAllowance', id });
 if (res.success) { toast('Deleted.', 'success'); loadAllowance(); }
 else toast(res.message || 'Error.', 'error');
 } catch(e) { toast('Network error.', 'error'); }
}

// ═══════════════════════════════════════════════
// CASHIERS
// ═══════════════════════════════════════════════
async function renderCashiers() {
 document.getElementById('pageContent').innerHTML = `
<div class="card" style="margin-bottom:16px">
<div class="card-title">Manage System Users</div>
<button class="btn btn-primary" onclick="openAddCashierModal()">Add User</button>
    </div>
<div class="card">
 <div id="cashierList"><div class="loading-spinner"><div class="spinner"></div></div></div>
    </div>`;
  loadCashiers();
}

async function loadCashiers() {
  try {
    const res = await gasRequest({ action: 'getCashiers' });
    const data = res.data || [];
    const el = document.getElementById('cashierList');
    if (!el) return;
 if (!data.length) { el.innerHTML = '<div class="no-data"><div class="no-data-icon"></div><div>No users yet. Add your first cashier!</div></div>'; return; }
 el.innerHTML = `<div class="tbl-wrap"><table>
      <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${data.map(c => `<tr>
        <td><b>${c.name}</b></td>
        <td><span style="font-family:var(--font-mono);font-size:0.85rem">${c.username}</span></td>
        <td><span class="role-badge role-${c.role}">${c.role}</span></td>
        <td><span class="${c.active !== 'false' ? 'badge-in-stock' : 'badge-out'}">${c.active !== 'false' ? 'Active' : 'Inactive'}</span></td>
        <td>
<div class="gap-10">
<button class="btn btn-ghost btn-sm" onclick="openEditCashierModal('${c.id}')">️ Edit</button>
<button class="btn btn-danger btn-sm" onclick="deleteCashier('${c.id}')">️</button>
          </div>
        </td>
      </tr>`).join('')}</tbody>
    </table></div>`;
  } catch(e) {
 document.getElementById('cashierList').innerHTML = '<div class="no-data">Failed to load users.</div>';
  }
}

function openAddCashierModal() {
  openModal(`
<div class="modal-title">Add New User</div>
<div class="input-row">
 <div class="field"><label>Full Name *</label><input id="c_name" placeholder="Full name"></div>
 <div class="field"><label>Username *</label><input id="c_username" placeholder="Login username"></div>
    </div>
<div class="input-row">
 <div class="field"><label>Password *</label><input id="c_password" type="password" placeholder="Password"></div>
 <div class="field"><label>Role *</label>
        <select id="c_role">
          <option value="cashier">Cashier</option>
          <option value="clerk">Inventory Clerk</option>
          <option value="admin">Admin</option>
        </select>
      </div>
    </div>
<button class="btn btn-primary" style="width:100%;margin-top:8px" onclick="saveCashier()">Save User</button>`);
}

function openEditCashierModal(id) {
  gasRequest({ action: 'getCashiers' }).then(res => {
    const c = (res.data || []).find(x => x.id === id);
    if (!c) return;
    openModal(`
<div class="modal-title">️ Edit User — ${c.name}</div>
<div class="input-row">
 <div class="field"><label>Full Name</label><input id="c_name" value="${c.name}"></div>
 <div class="field"><label>Username</label><input id="c_username" value="${c.username}"></div>
      </div>
<div class="input-row">
 <div class="field"><label>New Password (leave blank to keep)</label><input id="c_password" type="password" placeholder="New password"></div>
 <div class="field"><label>Role</label>
          <select id="c_role">
            <option value="cashier" ${c.role==='cashier'?'selected':''}>Cashier</option>
            <option value="clerk" ${c.role==='clerk'?'selected':''}>Inventory Clerk</option>
            <option value="admin" ${c.role==='admin'?'selected':''}>Admin</option>
          </select>
        </div>
      </div>
<button class="btn btn-primary" style="width:100%;margin-top:8px" onclick="saveCashier('${id}')">Update User</button>`);
  });
}

async function saveCashier(id = null) {
  const name = document.getElementById('c_name')?.value.trim();
  const username = document.getElementById('c_username')?.value.trim();
  const password = document.getElementById('c_password')?.value.trim();
  const role = document.getElementById('c_role')?.value;
 if (!name || !username) { toast('Name and username are required.', 'error'); return; }
 if (!id && !password) { toast('Password is required for new users.', 'error'); return; }
  try {
    const res = await gasPost({ action: id ? 'updateCashier' : 'addCashier', id, name, username, password, role });
 if (res.success) { toast(id ? 'User updated!' : 'User added!', 'success'); closeModalDirect(); loadCashiers(); }
 else toast(res.message || 'Error.', 'error');
 } catch(e) { toast('Network error.', 'error'); }
}

async function deleteCashier(id) {
  if (!confirm('Delete this user? This cannot be undone.')) return;
  try {
    const res = await gasPost({ action: 'deleteCashier', id });
 if (res.success) { toast('User deleted.', 'success'); loadCashiers(); }
 else toast(res.message || 'Error.', 'error');
 } catch(e) { toast('Network error.', 'error'); }
}

// ═══════════════════════════════════════════════
// RECEIPTS
// ═══════════════════════════════════════════════
async function renderReceipts() {
  document.getElementById('pageContent').innerHTML = `
    <div class="tab-bar">
      <button class="tab-btn active" onclick="showLocalReceipts(this)">This Device</button>
      <button class="tab-btn" onclick="showGASReceipts(this)">All Receipts (Sheets)</button>
    </div>
    <div id="receiptsContent"><div class="loading-spinner"><div class="spinner"></div></div></div>`;
  showLocalReceipts(document.querySelector('.tab-btn'));
}

function showLocalReceipts(btn) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const gallery = JSON.parse(localStorage.getItem('ae_receipt_gallery') || '[]');
  const fullData = JSON.parse(localStorage.getItem('ae_receipt_full') || '{}');
  const el = document.getElementById('receiptsContent');
  if (!el) return;
  if (!gallery.length) {
    el.innerHTML = '<div class="no-data"><div class="no-data-icon"></div><div>No receipts on this device yet.</div></div>';
    return;
  }
  el.innerHTML = `
    <div class="card">
      <div class="card-title">Receipts — This Device</div>
      <p style="color:var(--text3);font-size:0.82rem;margin-bottom:14px">Click View to reprint any receipt.</p>
      <div class="tbl-wrap"><table>
        <thead><tr><th>SI #</th><th>TX #</th><th>Cashier</th><th>Total</th><th>Date</th><th>Action</th></tr></thead>
        <tbody>${gallery.map(r => {
          const hasFullData = !!fullData[r.txId];
          return `<tr>
            <td style="font-family:var(--font-mono);font-size:0.78rem">${r.siNum||'—'}</td>
            <td style="font-family:var(--font-mono);font-size:0.78rem">${r.txId}</td>
            <td>${r.cashier}</td>
            <td class="text-green fw-700">₱${parseFloat(r.total||0).toLocaleString('en-PH',{minimumFractionDigits:2})}</td>
            <td style="font-size:0.78rem">${new Date(r.date).toLocaleString('en-PH',{dateStyle:'medium',timeStyle:'short'})}</td>
            <td>${hasFullData
              ? `<button class="btn btn-primary btn-sm" onclick="reprintReceipt('${r.txId}')">View / Print</button>`
              : `<span style="color:var(--text3);font-size:0.78rem">No data</span>`}
            </td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>
    </div>`;
}

async function showGASReceipts(btn) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const el = document.getElementById('receiptsContent');
  if (!el) return;
  el.innerHTML = '<div class="loading-spinner"><div class="spinner"></div> Loading from Google Sheets...</div>';
  try {
    const res = await gasRequest({ action: 'getSales' });
    const sales = (res.data || []).reverse();
    if (!sales.length) {
      el.innerHTML = '<div class="no-data"><div class="no-data-icon"></div><div>No sales records yet.</div></div>';
      return;
    }
    const fullData = JSON.parse(localStorage.getItem('ae_receipt_full') || '{}');
    el.innerHTML = `
      <div class="card">
        <div class="card-title">All Receipts — Google Sheets (${sales.length} total)</div>
        <div class="tbl-wrap"><table>
          <thead><tr><th>SI #</th><th>TX #</th><th>Cashier</th><th>Total</th><th>Date</th><th>Action</th></tr></thead>
          <tbody>${sales.map(s => {
            const hasLocal = !!fullData[s.transactionId];
            return `<tr>
              <td style="font-family:var(--font-mono);font-size:0.78rem">${s.siNumber||'—'}</td>
              <td style="font-family:var(--font-mono);font-size:0.78rem">${s.transactionId||''}</td>
              <td>${s.cashierName||''}</td>
              <td class="text-green fw-700">₱${parseFloat(s.total||0).toLocaleString('en-PH',{minimumFractionDigits:2})}</td>
              <td style="font-size:0.78rem">${s.date ? new Date(s.date).toLocaleString('en-PH',{dateStyle:'short',timeStyle:'short'}) : ''}</td>
              <td>${hasLocal
                ? `<button class="btn btn-primary btn-sm" onclick="reprintReceipt('${s.transactionId}')">View / Print</button>`
                : `<button class="btn btn-ghost btn-sm" onclick="reprintFromSheets('${s.transactionId}')">Reprint</button>`}
              </td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>
      </div>`;
  } catch(e) {
    el.innerHTML = '<div class="no-data">Failed to load. Check connection.</div>';
  }
}

function reprintReceipt(txId) {
  const fullData = JSON.parse(localStorage.getItem('ae_receipt_full') || '{}');
  const data = fullData[txId];
  if (!data) { toast('Receipt data not available on this device.', 'warning'); return; }
  generateAndShowReceipt({
    txId: data.txId, siNum: data.siNum, cashier: data.cashier,
    date: new Date(data.date), items: data.items,
    total: data.total, cash: data.cash, change: data.change
  });
}

async function reprintFromSheets(txId) {
  toast('Loading receipt from Sheets...', 'info');
  try {
    const res = await gasRequest({ action: 'getSales' });
    const sale = (res.data || []).find(s => s.transactionId === txId);
    if (!sale) { toast('Receipt not found.', 'error'); return; }
    const items = JSON.parse(sale.items || '[]');
    generateAndShowReceipt({
      txId: sale.transactionId, siNum: sale.siNumber || '',
      cashier: sale.cashierName, date: new Date(sale.date),
      items, total: parseFloat(sale.total||0),
      cash: parseFloat(sale.cash||0), change: parseFloat(sale.change||0)
    });
  } catch(e) { toast('Failed to load receipt.', 'error'); }
}

// ═══════════════════════════════════════════════
// SALES SUMMARY
// ═══════════════════════════════════════════════
async function renderSummary() {
 document.getElementById('pageContent').innerHTML = `
<div class="tab-bar">
<button class="tab-btn active" onclick="loadSummary('today',this)">Today</button>
      <button class="tab-btn" onclick="loadSummary('week',this)">This Week</button>
      <button class="tab-btn" onclick="loadSummary('month',this)">This Month</button>
      <button class="tab-btn" onclick="loadSummary('all',this)">All Time</button>
    </div>
 <div id="summaryContent"><div class="loading-spinner"><div class="spinner"></div></div></div>`;
  loadSummary('today', document.querySelector('.tab-btn'));
}

async function loadSummary(period, btn) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const el = document.getElementById('summaryContent');
 el.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>';
  try {
    const res = await gasRequest({ action: 'getSales' });
    const all = res.data || [];
    const now = new Date();
    const todayStr = now.toDateString();
    const weekAgo = new Date(now - 7*86400000);
    const monthAgo = new Date(now - 30*86400000);
    let filtered = all;
    if (period === 'today') filtered = all.filter(s => new Date(s.date).toDateString() === todayStr);
    else if (period === 'week') filtered = all.filter(s => new Date(s.date) >= weekAgo);
    else if (period === 'month') filtered = all.filter(s => new Date(s.date) >= monthAgo);

    // Separate void and valid transactions
    const voidTx = filtered.filter(t => t.status === 'VOID');
    const validTx = filtered.filter(t => t.status !== 'VOID');

    if (!filtered.length) {
 el.innerHTML = '<div class="no-data"><div class="no-data-icon"></div><div>No transactions for this period.</div></div>';
      return;
    }

    // Only count non-void for totals
    const grandTotal = validTx.reduce((s, t) => s + parseFloat(t.total || 0), 0);
    const vatAmount = grandTotal * 0.12 / 1.12;
    const cashierTotals = {};
    let allItemTotals = {};
    let totalQty = 0;

    validTx.forEach(t => {
      cashierTotals[t.cashierName] = (cashierTotals[t.cashierName] || 0) + parseFloat(t.total || 0);
      try {
        const items = JSON.parse(t.items || '[]');
        items.forEach(it => {
          allItemTotals[it.name] = (allItemTotals[it.name] || { qty: 0, total: 0 });
          allItemTotals[it.name].qty += it.qty;
          allItemTotals[it.name].total += it.total;
          totalQty += it.qty;
        });
      } catch(e) {}
    });

    const periodLabel = { today: "Today's", week: "This Week's", month: "This Month's", all: "All-Time" }[period];

 el.innerHTML = `
      <div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap">
<button class="btn btn-primary" onclick="generateSummaryReceipt('${period}')">️ Generate Summary Receipt</button>
<button class="btn btn-ghost" onclick="loadSummary('${period}',null)">Refresh</button>
      </div>
<div class="summary-receipt" id="summaryReceiptEl">
<div class="summary-header">
          <div style="font-size:1.5rem">🏪</div>
          <h2>AE HOME — ${periodLabel} Sales Summary</h2>
          <div style="font-size:0.8rem;color:var(--text3)">Generated: ${new Date().toLocaleString('en-PH')}</div>
          <div style="font-size:0.8rem;color:var(--text3)">${validTx.length} transactions${voidTx.length > 0 ? ' <span style="color:#ef4444">('+voidTx.length+' voided)</span>' : ''}</div>
        </div>

<div class="summary-section-title">Items Sold</div>
        ${Object.entries(allItemTotals).map(([name, d]) => `
<div class="summary-row">
            <span>${name}</span>
            <span>${d.qty} pcs — ₱${d.total.toFixed(2)}</span>
          </div>`).join('')}
<div class="summary-row" style="font-weight:700;border-top:2px solid var(--border);margin-top:4px">
          <span>Total Qty Sold</span><span>${totalQty} pcs</span>
        </div>

<div class="summary-section-title">Cashier Performance</div>
        ${Object.entries(cashierTotals).map(([name, total]) => `
<div class="summary-row">
            <span>${name}</span>
            <span class="text-green fw-700">₱${total.toLocaleString('en-PH',{minimumFractionDigits:2})}</span>
          </div>`).join('')}

<div class="summary-section-title">Financials</div>
 <div class="summary-row"><span>Gross Sales</span><span>₱${grandTotal.toLocaleString('en-PH',{minimumFractionDigits:2})}</span></div>
 <div class="summary-row"><span>VAT (12% incl.)</span><span>₱${vatAmount.toLocaleString('en-PH',{minimumFractionDigits:2})}</span></div>
<div class="summary-grand">
          <span>NET AMOUNT DUE</span>
          <span>₱${(grandTotal - vatAmount).toLocaleString('en-PH',{minimumFractionDigits:2})}</span>
        </div>

<div class="summary-section-title" style="margin-top:20px">Transaction Details</div>
<div class="tbl-wrap" style="max-height:400px;overflow-y:auto">
          <table>
            <thead><tr><th>TX#</th><th>Cashier</th><th>Total</th><th>Date</th></tr></thead>
            <tbody>${filtered.map(t => {
              const isVoid = t.status === 'VOID';
              return `<tr style="${isVoid ? 'opacity:0.5;background:#fff5f5' : ''}">
                <td style="font-family:var(--font-mono);font-size:0.78rem">${t.transactionId}${isVoid ? ' <span style="background:#ef4444;color:white;padding:1px 6px;border-radius:4px;font-size:0.65rem;font-weight:700">VOID</span>' : ''}</td>
                <td>${t.cashierName}</td>
                <td class="${isVoid ? 'text-red' : 'text-green fw-700'}" style="${isVoid ? 'text-decoration:line-through' : ''}">₱${parseFloat(t.total||0).toFixed(2)}</td>
                <td style="font-size:0.78rem">${new Date(t.date).toLocaleString('en-PH',{dateStyle:'short',timeStyle:'short'})}</td>
              </tr>`;
            }).join('')}</tbody>
          </table>
        </div>
      </div>`;
  } catch(e) {
 el.innerHTML = '<div class="no-data"><div class="no-data-icon"></div><div>Failed to load summary.</div></div>';
  }
}

async function generateSummaryReceipt(period) {
  const el = document.getElementById('summaryReceiptEl');
 if (!el) { toast('No summary to generate.', 'warning'); return; }
 toast('Generating receipt image...', 'info');
  try {
    if (typeof html2canvas === 'undefined') await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
    const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
    const link = document.createElement('a');
    link.download = `summary_${period}_${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
 toast('Summary downloaded!', 'success');
 } catch(e) { toast('Failed to generate image.', 'error'); }
}

// ═══════════════════════════════════════════════
// ANALYTICS & INSIGHTS (replaces Inv. Logs)
// ═══════════════════════════════════════════════
async function renderLogs() {
 document.getElementById('pageContent').innerHTML = `
<div class="analytics-grid" id="analyticsCards">
      ${['Gross Revenue Today','This Week Revenue','Total SKUs','Low Stock Items','Transactions Today','All-Time Revenue'].map((l,i) =>
 `<div class="analytics-card ${['','green','','orange','green','purple'][i]}">
<div class="ac-label">${['','','','️','',''][i]} ${l}</div>
<div class="ac-value" id="ac_${i}">—</div>
 <div class="ac-sub" id="ac_sub_${i}"></div>
        </div>`).join('')}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
<div class="card">
<div class="card-title">Top Products</div>
 <div id="topProducts"><div class="loading-spinner"><div class="spinner"></div></div></div>
      </div>
<div class="card">
<div class="card-title">Recent Stock Movements</div>
 <div id="recentLogs"><div class="loading-spinner"><div class="spinner"></div></div></div>
      </div>
    </div>`;

  try {
    const [salesRes, productsRes, logsRes] = await Promise.all([
      gasRequest({ action: 'getSales' }),
      gasRequest({ action: 'getProducts' }),
      gasRequest({ action: 'getInventoryLogs' }),
    ]);
    const sales = salesRes.data || [];
    const products = productsRes.data || [];
    const logs = (logsRes.data || []).reverse();
    const now = new Date();
    const todayStr = now.toDateString();
    const weekAgo = new Date(now - 7*86400000);

    const todaySales = sales.filter(s => new Date(s.date).toDateString() === todayStr);
    const weekSales = sales.filter(s => new Date(s.date) >= weekAgo);
    const lowStock = products.filter(p => parseInt(p.qtyPcs||0) <= 5);
    const sum = arr => arr.reduce((a,s) => a + parseFloat(s.total||0), 0);
    const allTotal = sum(sales);

 document.getElementById('ac_0').textContent = '₱' + sum(todaySales).toLocaleString('en-PH',{minimumFractionDigits:2});
 document.getElementById('ac_sub_0').textContent = todaySales.length + ' transactions';
 document.getElementById('ac_1').textContent = '₱' + sum(weekSales).toLocaleString('en-PH',{minimumFractionDigits:2});
 document.getElementById('ac_sub_1').textContent = weekSales.length + ' transactions';
 document.getElementById('ac_2').textContent = products.length;
 document.getElementById('ac_sub_2').textContent = 'products in system';
 document.getElementById('ac_3').textContent = lowStock.length;
 document.getElementById('ac_sub_3').textContent = 'items need restocking';
 document.getElementById('ac_4').textContent = todaySales.length;
 document.getElementById('ac_sub_4').textContent = 'completed today';
 document.getElementById('ac_5').textContent = '₱' + allTotal.toLocaleString('en-PH',{minimumFractionDigits:2});
 document.getElementById('ac_sub_5').textContent = sales.length + ' total transactions';

    // Top products from sales
    const itemTotals = {};
    sales.forEach(s => {
      try {
        JSON.parse(s.items||'[]').forEach(it => {
          itemTotals[it.name] = (itemTotals[it.name]||0) + it.qty;
        });
      } catch(e) {}
    });
    const topItems = Object.entries(itemTotals).sort((a,b)=>b[1]-a[1]).slice(0,6);
    const tpEl = document.getElementById('topProducts');
 if (tpEl) tpEl.innerHTML = topItems.length ? topItems.map(([name,qty],i) =>`
      <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:0.85rem">
        <span>${['🥇','🥈','🥉','4️⃣','5️⃣','6️⃣'][i]} ${name}</span>
        <span class="text-green fw-700">${qty} sold</span>
      </div>`).join('') :
 '<div class="no-data"><div class="no-data-icon"></div><div>No sales data yet.</div></div>';

    // Recent logs
    const rlEl = document.getElementById('recentLogs');
 if (rlEl) rlEl.innerHTML = logs.length ? `<div class="tbl-wrap"><table>
      <thead><tr><th>Product</th><th>Type</th><th>Qty</th><th>By</th></tr></thead>
      <tbody>${logs.slice(0,8).map(l=>`<tr>
        <td style="font-size:0.82rem">${l.productName||''}</td>
        <td><span class="${l.type==='in'?'log-in':l.type==='sale'?'log-sale':'log-out'}">${(l.type||'').toUpperCase()}</span></td>
        <td>${l.qty}</td>
        <td style="font-size:0.78rem">${l.adjustedBy||''}</td>
      </tr>`).join('')}</tbody>
    </table></div>` :
 '<div class="no-data"><div class="no-data-icon"></div><div>No logs yet.</div></div>';

  } catch(e) {
 toast('Failed to load analytics.', 'error');
  }
}


// ═══════════════════════════════════════════════
// VOID TRANSACTIONS
// ═══════════════════════════════════════════════
async function renderVoidTransactions() {
  document.getElementById('pageContent').innerHTML = `
    <div class="card" style="margin-bottom:16px">
      <div class="card-title">Void a Transaction</div>
      <p style="color:var(--text3);font-size:0.82rem;margin-bottom:14px">
        Search for a transaction to void. Stock will be automatically restored.
        Only Admin and Clerk can void transactions.
      </p>
      <div class="search-wrap" style="max-width:400px">
        <span class="search-icon">⌕</span>
        <input type="text" id="voidSearch" placeholder="Search TX# or SI#..." oninput="searchVoidTransaction(this.value)">
      </div>
      <div id="voidSearchResults" style="margin-top:12px"></div>
    </div>
    <div class="card">
      <div class="card-title">Voided Transactions</div>
      <div id="voidedList"><div class="loading-spinner"><div class="spinner"></div></div></div>
    </div>`;
  loadVoidedList();
}

async function searchVoidTransaction(query) {
  const el = document.getElementById('voidSearchResults');
  if (!el) return;
  if (!query || query.length < 2) { el.innerHTML = ''; return; }
  el.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>';
  try {
    const res = await gasRequest({ action: 'getSales' });
    const all = res.data || [];
    const q = query.toLowerCase();
    const matches = all.filter(t =>
      t.status !== 'VOID' && (
        (t.transactionId || '').toLowerCase().includes(q) ||
        (t.siNumber || '').toLowerCase().includes(q) ||
        (t.cashierName || '').toLowerCase().includes(q)
      )
    ).slice(0, 5);

    if (!matches.length) {
      el.innerHTML = '<p style="color:var(--text3);font-size:0.85rem">No transactions found.</p>';
      return;
    }

    el.innerHTML = `<div class="tbl-wrap"><table>
      <thead><tr><th>TX#</th><th>SI#</th><th>Cashier</th><th>Total</th><th>Date</th><th>Action</th></tr></thead>
      <tbody>${matches.map(t => `<tr>
        <td style="font-family:var(--font-mono);font-size:0.78rem">${t.transactionId}</td>
        <td style="font-family:var(--font-mono);font-size:0.78rem">${t.siNumber||'—'}</td>
        <td>${t.cashierName}</td>
        <td class="text-green fw-700">₱${parseFloat(t.total||0).toFixed(2)}</td>
        <td style="font-size:0.78rem">${new Date(t.date).toLocaleString('en-PH',{dateStyle:'short',timeStyle:'short'})}</td>
        <td><button class="btn btn-danger btn-sm" onclick="openVoidModal('${t.transactionId}')">Void</button></td>
      </tr>`).join('')}</tbody>
    </table></div>`;
  } catch(e) {
    el.innerHTML = '<p style="color:#ef4444">Failed to search.</p>';
  }
}

async function loadVoidedList() {
  const el = document.getElementById('voidedList');
  if (!el) return;
  try {
    const res = await gasRequest({ action: 'getSales' });
    const voided = (res.data || []).filter(t => t.status === 'VOID').reverse();
    if (!voided.length) {
      el.innerHTML = '<div class="no-data"><div class="no-data-icon"></div><div>No voided transactions.</div></div>';
      return;
    }
    el.innerHTML = `<div class="tbl-wrap"><table>
      <thead><tr><th>TX#</th><th>SI#</th><th>Cashier</th><th>Total</th><th>Voided By</th><th>Reason</th><th>Date Voided</th></tr></thead>
      <tbody>${voided.map(t => `<tr style="opacity:0.7">
        <td style="font-family:var(--font-mono);font-size:0.78rem">${t.transactionId} <span style="background:#ef4444;color:white;padding:1px 6px;border-radius:4px;font-size:0.65rem;font-weight:700">VOID</span></td>
        <td style="font-family:var(--font-mono);font-size:0.78rem">${t.siNumber||'—'}</td>
        <td>${t.cashierName}</td>
        <td class="text-red" style="text-decoration:line-through">₱${parseFloat(t.total||0).toFixed(2)}</td>
        <td>${t.voidedBy||'—'}</td>
        <td style="font-size:0.78rem">${t.voidReason||'—'}</td>
        <td style="font-size:0.78rem">${t.voidDate ? new Date(t.voidDate).toLocaleString('en-PH',{dateStyle:'short',timeStyle:'short'}) : '—'}</td>
      </tr>`).join('')}</tbody>
    </table></div>`;
  } catch(e) {
    el.innerHTML = '<div class="no-data">Failed to load voided transactions.</div>';
  }
}

async function openVoidModal(txId) {
  try {
    const res = await gasRequest({ action: 'getSales' });
    const tx = (res.data || []).find(t => t.transactionId === txId);
    if (!tx) { toast('Transaction not found.', 'error'); return; }
    const items = JSON.parse(tx.items || '[]');

    openModal(`
      <div class="modal-title" style="color:#ef4444">Void Transaction</div>
      <div style="background:#fff5f5;border:1px solid #fecaca;border-radius:10px;padding:14px;margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;margin-bottom:8px">
          <span style="font-weight:700;font-family:var(--font-mono);font-size:0.85rem">${tx.transactionId}</span>
          <span style="font-weight:800;color:#ef4444">₱${parseFloat(tx.total||0).toLocaleString('en-PH',{minimumFractionDigits:2})}</span>
        </div>
        <div style="font-size:0.82rem;color:var(--text2);margin-bottom:6px">Cashier: ${tx.cashierName} | ${new Date(tx.date).toLocaleString('en-PH',{dateStyle:'medium',timeStyle:'short'})}</div>
        <div style="border-top:1px dashed var(--border);padding-top:8px;margin-top:8px">
          ${items.map(it => `<div style="display:flex;justify-content:space-between;font-size:0.82rem;padding:2px 0">
            <span>${it.name} (${it.unit}) x${it.qty}</span>
            <span>₱${it.total.toFixed(2)}</span>
          </div>`).join('')}
        </div>
      </div>
      <div class="field" style="margin-bottom:12px">
        <label>Reason for Void *</label>
        <select id="voidReasonSelect" onchange="toggleOtherReason(this.value)">
          <option value="">-- Select reason --</option>
          <option value="Wrong item scanned">Wrong item scanned</option>
          <option value="Wrong price">Wrong price</option>
          <option value="Customer cancelled">Customer cancelled</option>
          <option value="Duplicate transaction">Duplicate transaction</option>
          <option value="Others">Others (specify below)</option>
        </select>
      </div>
      <div class="field" id="otherReasonField" style="display:none;margin-bottom:12px">
        <label>Specify Reason *</label>
        <input type="text" id="voidReasonOther" placeholder="Enter reason...">
      </div>
      <div style="background:#fff7e0;border:1px solid #fde68a;border-radius:8px;padding:10px;margin-bottom:16px;font-size:0.82rem">
        <b>⚠️ Warning:</b> This will mark the transaction as VOID and restore stock. This cannot be undone.
      </div>
      <div style="display:flex;gap:10px">
        <button class="btn btn-ghost" style="flex:1" onclick="closeModalDirect()">Cancel</button>
        <button class="btn btn-danger" style="flex:2" onclick="confirmVoid('${txId}')">Confirm Void</button>
      </div>`);
  } catch(e) {
    toast('Failed to load transaction.', 'error');
  }
}

function toggleOtherReason(val) {
  const f = document.getElementById('otherReasonField');
  if (f) f.style.display = val === 'Others' ? 'flex' : 'none';
}

async function confirmVoid(txId) {
  const reasonSelect = document.getElementById('voidReasonSelect')?.value;
  const reasonOther = document.getElementById('voidReasonOther')?.value.trim();
  const reason = reasonSelect === 'Others' ? (reasonOther || '') : reasonSelect;

  if (!reason) { toast('Please select a reason for void.', 'error'); return; }

  const btn = document.querySelector('#modalBox .btn-danger');
  if (btn) { btn.disabled = true; btn.textContent = 'Processing...'; }

  showLoading('Voiding transaction...');
  try {
    const res = await gasPost({
      action: 'voidTransaction',
      transactionId: txId,
      voidedBy: currentUser.name,
      voidReason: reason,
      voidDate: new Date().toISOString()
    });
    hideLoading();
    if (res.success) {
      toast('Transaction voided! Stock restored.', 'success');
      closeModalDirect();
      renderVoidTransactions();
    } else {
      toast(res.message || 'Failed to void.', 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Confirm Void'; }
    }
  } catch(e) {
    hideLoading();
    toast('Network error.', 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Confirm Void'; }
  }
}

// ─── Enter key for login ──────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    if (document.getElementById('loginScreen')?.classList.contains('active')) doLogin();
  }
});
