/* =============================================
   AE HOME POS SYSTEM - app.js (UPDATED - PART 1)
   ============================================= */

// ─── CONFIG ───────────────────────────────────
const GAS_URL = "https://script.google.com/macros/s/AKfycbzbdiqn_2POqByVcw_vTRS4wqhVj_4BsmHE9K55OOHxpTvbpP0F-y9CHTmRHv2eonsSJg/exec";

// ─── STATE ────────────────────────────────────
let currentUser = null; // { id, name, role, username }
let currentPage = 'dashboard';
let cart = [];
let activeUsers = {};   // { sessionId: { name, role, loginTime } }\nlet mySessionId = null;

// ─── ROLE CONFIG ──────────────────────────────
const ROLE_NAV = {
  admin: [
    { id: 'dashboard', icon: '📊', label: 'Dashboard' },
    { id: 'pos', icon: '🛒', label: 'Point of Sale' },
    { id: 'inventory', icon: '📦', label: 'Inventory' },
    { id: 'finance', icon: '💰', label: 'Finance' },
    { id: 'cashiers', icon: '👥', label: 'Users' },
    { id: 'receipts', icon: '📄', label: 'Receipts' },
    { id: 'summary', icon: '📈', label: 'Sales Summary' },
    { id: 'logs', icon: '📝', label: 'Analytics' },
    { id: 'void', icon: '❌', label: 'Void Transactions' },
  ],
  cashier: [
    { id: 'pos', icon: '🛒', label: 'Point of Sale' },
    { id: 'receipts', icon: '📄', label: 'Receipts' },
    { id: 'summary', icon: '📈', label: 'Sales Summary' },
  ],
  clerk: [
    { id: 'inventory', icon: '📦', label: 'Inventory' },
    { id: 'summary', icon: '📈', label: 'Sales Summary' }
  ]
};

// ─── APP INIT ─────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  initClock();
  const saved = localStorage.getItem('ae_pos_user');
  const savedSession = localStorage.getItem('ae_pos_session');
  
  if (saved && savedSession) {
    currentUser = JSON.parse(saved);
    mySessionId = savedSession;
    
    showLoading('Checking active session...');
    const isValid = await validateSessionOnServer(currentUser.username, mySessionId);
    hideLoading();
    
    if (isValid) {
      buildNav();
      document.getElementById('loginScreen').classList.remove('active');
      document.getElementById('appLayout').classList.add('active');
      switchPage(currentUser.role === 'cashier' ? 'pos' : 'dashboard');
      startSessionPolling();
    } else {
      logout();
    }
  }
});

function initClock() {
  setInterval(() => {
    const clock = document.getElementById('liveClock');
    if (clock) clock.textContent = new Date().toLocaleString('en-PH', { timeZone: 'Asia/Manila' });
  }, 1000);
}

// ─── CORE SERVER FETCH WRAPPERS ───────────────
async function gasGet(params = {}) {
  const q = new URLSearchParams(params).toString();
  const res = await fetch(`${GAS_URL}?${q}`);
  return res.json();
}

async function gasPost(data = {}) {
  const form = new URLSearchParams();
  for (const k in data) form.append(k, data[k]);
  const res = await fetch(GAS_URL, {
    method: 'POST',
    body: form,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });
  return res.json();
}

// ─── AUTHENTICATION & SESSIONS ────────────────
async function login() {
  const u = document.getElementById('usernameInput').value.trim();
  const p = document.getElementById('passwordInput').value.trim();
  if (!u || !p) return;

  showLoading('Verifying credentials...');
  try {
    const sessionToken = 'SESS-' + Date.now() + '-' + Math.floor(Math.random()*1000);
    const res = await gasPost({ action: 'login', username: u, password: p, sessionId: sessionToken });
    hideLoading();

    if (res.success) {
      currentUser = { username: u, name: res.name, role: res.role.toLowerCase() };
      mySessionId = sessionToken;
      
      localStorage.setItem('ae_pos_user', JSON.stringify(currentUser));
      localStorage.setItem('ae_pos_session', mySessionId);
      
      buildNav();
      document.getElementById('loginScreen').classList.remove('active');
      document.getElementById('appLayout').classList.add('active');
      switchPage(currentUser.role === 'cashier' ? 'pos' : 'dashboard');
      startSessionPolling();
      toast(`Welcome, ${res.name}!`, 'success');
    } else {
      toast(res.message || 'Invalid login.', 'error');
    }
  } catch (e) {
    hideLoading();
    toast('Network connection failed.', 'error');
  }
}

async function validateSessionOnServer(username, sessionId) {
  try {
    const res = await gasGet({ action: 'checkSession', username, sessionId });
    return res.valid === true;
  } catch(e) {
    return true; // Fallback to offline tolerance if network dips
  }
}

function startSessionPolling() {
  setInterval(async () => {
    if (!currentUser) return;
    try {
      const res = await gasGet({ action: 'checkSession', username: currentUser.username, sessionId: mySessionId });
      if (res.kick) {
        toast('Logged out: Account logged in on another device.', 'error');
        setTimeout(() => logout(), 2000);
      } else if (res.activeUsers) {
        activeUsers = res.activeUsers;
        updateActiveUsersPanel();
      }
    } catch(e) {}
  }, 10000);
}

function logout() {
  localStorage.removeItem('ae_pos_user');
  localStorage.removeItem('ae_pos_session');
  currentUser = null;
  mySessionId = null;
  document.getElementById('appLayout').classList.remove('active');
  document.getElementById('loginScreen').classList.add('active');
}

// ─── NAVIGATION ENGINE ────────────────────────
function buildNav() {
  const box = document.getElementById('sidebarNav');
  if (!box) return;
  box.innerHTML = '';
  
  const links = ROLE_NAV[currentUser.role] || [];
  links.forEach(l => {
    const a = document.createElement('a');
    a.className = `nav-item ${currentPage === l.id ? 'active' : ''}`;
    a.href = '#';
    a.onclick = (e) => { e.preventDefault(); switchPage(l.id); };
    a.innerHTML = `<span class="nav-icon">${l.icon}</span> <span class="nav-label">${l.label}</span>`;
    box.appendChild(a);
  });

  const userDisplay = document.getElementById('profileName');
  if (userDisplay) userDisplay.textContent = currentUser.name;
  const roleDisplay = document.getElementById('profileRole');
  if (roleDisplay) roleDisplay.textContent = currentUser.role.toUpperCase();
}

function switchPage(pageId) {
  currentPage = pageId;
  buildNav();
  
  const title = document.getElementById('topbarTitle');
  const links = ROLE_NAV[currentUser.role] || [];
  const found = links.find(l => l.id === pageId);
  if (title && found) title.textContent = found.label;

  // Trigger lazy loading per operational tab view
  if (pageId === 'dashboard') renderDashboard();
  else if (pageId === 'pos') renderPOS();
  else if (pageId === 'inventory') renderInventory();
  else if (pageId === 'finance') renderFinance();
  else if (pageId === 'cashiers') renderCashiers();
  else if (pageId === 'receipts') renderReceipts();
  else if (pageId === 'summary') renderSummary();
  else if (pageId === 'logs') renderLogs();
  else if (pageId === 'void') renderVoidTransactions();
}/* =============================================
   AE HOME POS SYSTEM - app.js (UPDATED - PART 2)
   ============================================= */

// ─── EXCEL & CSV BULK IMPORT LOGIC (FIXED) ────
function triggerBulkImportClick() {
  const input = document.getElementById('bulkImportFileInput');
  if (input) input.click();
}

function handleBulkImportFile(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  
  if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
    reader.onload = function(e) {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet);
      processImportRows(jsonData);
    };
    reader.readAsArrayBuffer(file);
  } else if (file.name.endsWith('.csv')) {
    reader.onload = function(e) {
      const text = e.target.result;
      const jsonData = csvToJson(text);
      processImportRows(jsonData);
    };
    reader.readAsText(file);
  } else {
    toast('Unsupported file extension. Use .xlsx or .csv', 'error');
  }
  // Reset input field value so same file can be triggered again
  event.target.value = '';
}

function csvToJson(csvText) {
  const lines = csvText.split('\n');
  const result = [];
  const headers = lines[0].split(',').map(h => h.trim());

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const obj = {};
    const currentline = lines[i].split(',');

    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]] = currentline[j] ? currentline[j].trim() : '';
    }
    result.push(obj);
  }
  return result;
}

function processImportRows(rows) {
  if (!rows || rows.length === 0) {
    toast('No rows or data found inside the file.', 'error');
    return;
  }

  // Map incoming Excel/CSV records safely to match structural system layout
  const formattedProducts = rows.map(row => ({
    id: row.ID || row.id || '',
    name: row.Name || row.name || 'Unnamed Product',
    barcode: row.Barcode || row.barcode || '',
    category: row.Category || row.category || 'General',
    price_piece: parseFloat(row.PricePiece || row.price_piece) || 0,
    price_pack: parseFloat(row.PricePack || row.price_pack) || 0,
    stock: parseInt(row.Stock || row.stock) || 0,
    min_stock: parseInt(row.MinStock || row.min_stock) || 5,
    unit: row.Unit || row.unit || 'piece'
  }));

  // Batch into groups of 40 to completely prevent GAS execution timeout caps
  const BATCH_SIZE = 40;
  let delayOffset = 0;

  for (let i = 0; i < formattedProducts.length; i += BATCH_SIZE) {
    const currentBatch = formattedProducts.slice(i, i + BATCH_SIZE);
    
    // Use timeout cascades to prevent slamming the server with parallel threads simultaneously
    setTimeout(() => {
      gasBulkImport(currentBatch, i + currentBatch.length, formattedProducts.length);
    }, delayOffset);
    
    delayOffset += 2500; // 2.5 seconds break before executing the next payload array bundle
  }
}

/**
 * Sends a distinct structured batch to the Google Apps Script container logic.
 */
function gasBulkImport(batch, currentProgressCount, totalOverallRecords) {
  if (!batch || batch.length === 0) return;

  const params = new URLSearchParams();
  params.append('action', 'bulkImportProducts');
  params.append('count', batch.length);

  batch.forEach((product, index) => {
    params.append(`id_${index}`, product.id || '');
    params.append(`name_${index}`, product.name || '');
    params.append(`barcode_${index}`, product.barcode || '');
    params.append(`category_${index}`, product.category || '');
    params.append(`price_piece_${index}`, product.price_piece || 0);
    params.append(`price_pack_${index}`, product.price_pack || 0);
    params.append(`stock_${index}`, product.stock || 0);
    params.append(`min_stock_${index}`, product.min_stock || 0);
    params.append(`unit_${index}`, product.unit || 'piece');
  });

  showLoading(`Uploading batch rows (${currentProgressCount}/${totalOverallRecords})...`);

  fetch(GAS_URL, {
    method: 'POST',
    body: params,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  })
  .then(res => res.json())
  .then(data => {
    if (data.status === 'success') {
      toast(`Processed batch (${currentProgressCount}/${totalOverallRecords}) successfully!`, 'success');
      
      // If this was the last bundle in the structural payload loop queue, run UI updates
      if (currentProgressCount >= totalOverallRecords) {
        hideLoading();
        if (currentPage === 'inventory') renderInventory();
        if (currentPage === 'dashboard') renderDashboard();
      }
    } else {
      hideLoading();
      toast(`Server Error: ${data.message}`, 'error');
    }
  })
  .catch(error => {
    hideLoading();
    console.error('Bulk Import Error:', error);
    toast('Network payload connection timeout. Please retry.', 'error');
  });
}

// ─── GLOBAL VISUAL FEEDBACK UTILS ────────────
function showLoading(text = 'Processing...') {
  // Integration point targeting your native layout indicators
  const loader = document.getElementById('loadingOverlay') || document.getElementById('globalLoader');
  if (loader) {
    loader.classList.remove('hidden');
    const txtNode = loader.querySelector('.loading-text') || loader;
    if (txtNode && txtNode.nodeName !== 'DIV') txtNode.textContent = text;
  }
}

function hideLoading() {
  const loader = document.getElementById('loadingOverlay') || document.getElementById('globalLoader');
  if (loader) loader.classList.add('hidden');
}

function toast(msg, type = 'success') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  container.appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3500);
}

// ─── DYNAMIC ACTION AND VOID CONTROLS ────────
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
      if (typeof renderVoidTransactions === 'function') renderVoidTransactions();
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

// Global Key Catch Listeners
document.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const loginScreen = document.getElementById('loginScreen');
    if (loginScreen && loginScreen.classList.contains('active')) {
      login();
    }
  }
});
