/**
 * AE HOME POS SYSTEM - FRONTEND LOGIC (Part 1)
 * Single Page Application (SPA) with Role-Based Access, 
 * Multi-Device Session Security, and Responsive UI.
 */

// ==========================================
// 1. GLOBAL CONFIGURATIONS & STATE
// ==========================================
const SCRIPT_URL = "YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE"; // Palitan ng iyong kasalukuyang Deployment URL
let currentUser = null;
let sessionPollInterval = null;
let cachedInventory = [];
let currentCart = [];
let html5QrCode = null;

// Role-Based Menu Definitions
const ROLE_PERMISSIONS = {
  "Admin": ["dashboard", "pos", "inventory", "finance", "users", "receipts", "sales-summary", "analytics", "void-tx"],
  "Cashier": ["pos", "receipts", "sales-summary"],
  "Clerk": ["inventory", "sales-summary", "pos", "analytics", "void-tx"],
  "Viewer": ["dashboard", "receipts"]
};

// ==========================================
// 2. APP INITIALIZATION & DOM READY
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
  initApp();
  setupEventListeners();
});

function initApp() {
  // Suriin kung may nakatagong session sa LocalStorage
  const savedUser = localStorage.getItem("ae_home_user");
  const savedToken = localStorage.getItem("ae_home_session_token");

  if (savedUser && savedToken) {
    currentUser = JSON.parse(savedUser);
    validateSavedSession(currentUser.username, savedToken);
  } else {
    showScreen("login-screen");
  }

  // Register PWA Service Worker for offline capabilities
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js")
      .then(() => console.log("Service Worker Registered Successfully."))
      .catch(err => console.error("Service Worker Registration Failed:", err));
  }
}

// ==========================================
// 3. SECURITY, LOGIN & SESSION POLLING
// ==========================================
function handleLogin(username, password) {
  showLoading(true, "Verifying credentials...");
  
  const params = new URLSearchParams();
  params.append("action", "login");
  params.append("username", username);
  params.append("password", password);

  fetch(SCRIPT_URL, {
    method: "POST",
    body: params,
    headers: { "Content-Type": "application/x-www-form-urlencoded" }
  })
  .then(res => res.json())
  .then(data => {
    showLoading(false);
    if (data.status === "success") {
      currentUser = {
        username: data.username,
        role: data.role,
        name: data.name
      };
      
      localStorage.setItem("ae_home_user", JSON.stringify(currentUser));
      localStorage.setItem("ae_home_session_token", data.sessionToken);
      
      showToast(`Welcome back, ${currentUser.name}!`, "success");
      setupNavigationMenu();
      startSessionPoller(data.username, data.sessionToken);
      
      // Default screen matapos ang login base sa role
      if (currentUser.role === "Cashier") {
        showScreen("pos-screen");
      } else {
        showScreen("dashboard-screen");
        initDashboard();
      }
    } else {
      showToast(data.message || "Invalid Username or Password.", "danger");
    }
  })
  .catch(err => {
    showLoading(false);
    console.error("Login Error:", err);
    showToast("Connection error. Please try again.", "danger");
  });
}

function validateSavedSession(username, token) {
  const params = new URLSearchParams();
  params.append("action", "validateSession");
  params.append("username", username);
  params.append("token", token);

  fetch(SCRIPT_URL, { method: "POST", body: params })
    .then(res => res.json())
    .then(data => {
      if (data.status === "valid") {
        setupNavigationMenu();
        startSessionPoller(username, token);
        if (currentUser.role === "Cashier") {
          showScreen("pos-screen");
        } else {
          showScreen("dashboard-screen");
          initDashboard();
        }
      } else {
        clearSession();
        showToast("Session expired or opened on another device.", "warning");
      }
    })
    .catch(() => {
      // Offline fallback: Payagang makapasok gamit ang cached data kung mayroon
      setupNavigationMenu();
      showToast("Operating in offline mode.", "info");
    });
}

function startSessionPoller(username, token) {
  if (sessionPollInterval) clearInterval(sessionPollInterval);
  
  // Magcheck tuwing 15 segundo para sa Single-Session Security
  sessionPollInterval = setInterval(() => {
    const params = new URLSearchParams();
    params.append("action", "checkSession");
    params.append("username", username);
    params.append("token", token);

    fetch(SCRIPT_URL, { method: "POST", body: params })
      .then(res => res.json())
      .then(data => {
        if (data.status === "kick") {
          clearSession();
          showToast("Logged out: This account was opened on another device.", "danger");
        }
      })
      .catch(err => console.log("Polling skipped (network down)."));
  }, 15000);
}

function clearSession() {
  if (sessionPollInterval) clearInterval(sessionPollInterval);
  currentUser = null;
  localStorage.removeItem("ae_home_user");
  localStorage.removeItem("ae_home_session_token");
  showScreen("login-screen");
}

// ==========================================
// 4. NAVIGATION & ROLE-BASED UI CONTROLS
// ==========================================
function setupNavigationMenu() {
  if (!currentUser) return;
  
  const allowedMenus = ROLE_PERMISSIONS[currentUser.role] || [];
  const navLinks = document.querySelectorAll(".nav-link-item");
  
  navLinks.forEach(link => {
    const targetMenu = link.getAttribute("data-target");
    if (allowedMenus.includes(targetMenu)) {
      link.classList.remove("d-none");
    } else {
      link.classList.add("d-none");
    }
  });

  // Ipakita ang pangalan at papel ng user sa sidebar/header
  document.getElementById("user-display-name").textContent = currentUser.name;
  document.getElementById("user-display-role").textContent = `(${currentUser.role})`;
}

function showScreen(screenId) {
  // Itago ang lahat ng screens
  const screens = document.querySelectorAll(".app-screen");
  screens.forEach(s => s.classList.add("d-none"));
  
  // Ipakita ang piniling screen
  const target = document.getElementById(screenId);
  if (target) {
    target.classList.remove("d-none");
  }
  
  // Isara ang sidebar sa mobile view kapag nakapili na ng menu
  const sidebar = document.getElementById("sidebarMenu");
  if (sidebar && sidebar.classList.contains("show")) {
    const bsCollapse = bootstrap.Collapse.getInstance(sidebar);
    if (bsCollapse) bsCollapse.hide();
  }
}

// ==========================================
// 5. GLOBAL UTILITIES (UI FEEDBACK)
// ==========================================
function showLoading(status, msg = "Loading...") {
  const overlay = document.getElementById("loadingOverlay");
  const text = document.getElementById("loadingText");
  if (!overlay) return;
  
  if (status) {
    text.textContent = msg;
    overlay.classList.remove("d-none");
  } else {
    overlay.classList.add("d-none");
  }
}

function showToast(message, type = "success") {
  const container = document.getElementById("toastContainer");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast align-items-center text-white bg-${type} border-0 show m-2`;
  toast.setAttribute("role", "alert");
  toast.innerHTML = `
    <div class="d-flex">
      <div class="toast-body">${message}</div>
      <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
    </div>
  `;
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.classList.remove("show");
    toast.remove();
  }, 4000);
}// ==========================================
// 6. POS OPERATIONS & CART MANAGEMENT
// ==========================================

/**
 * Nagre-refresh ng Listahan ng mga Produkto sa POS Screen base sa search o kategorya
 */
function renderPOSProducts(productsToRender = cachedInventory) {
  const container = document.getElementById("pos-products-grid");
  if (!container) return;
  container.innerHTML = "";

  if (productsToRender.length === 0) {
    container.innerHTML = `<div class="col-12 text-center text-muted py-5">Walang produktong nahanap.</div>`;
    return;
  }

  productsToRender.forEach(prod => {
    const card = document.createElement("div");
    card.className = "col-6 col-md-4 col-lg-3 mb-3";
    
    // Fallback image kung walang nakalagay na photo
    const imgSrc = prod.photo && prod.photo.startsWith("data:image") 
      ? prod.photo 
      : "./assets/img/no-image.png";

    card.innerHTML = `
      <div class="card h-100 product-card shadow-sm border-0">
        <div class="position-relative">
          <img src="${imgSrc}" class="card-img-top object-fit-cover" style="height: 120px;" alt="${prod.name}">
          ${prod.stock <= prod.min_stock ? '<span class="badge bg-danger position-absolute top-0 end-0 m-2">Low Stock</span>' : ""}
        </div>
        <div class="card-body p-2 d-flex flex-column justify-content-between">
          <div>
            <h6 class="card-title text-dark mb-1 text-truncate" title="${prod.name}">${prod.name}</h6>
            <small class="text-muted d-block mb-1">Stock: ${prod.stock} ${prod.unit || 'pcs'}</small>
          </div>
          <div>
            <!-- Dual-Unit Choice Selection Buttons -->
            <div class="d-grid gap-1 mb-2">
              <button class="btn btn-sm btn-outline-primary py-1" onclick="addToCart('${prod.id}', 'piece')">
                Pcs: ₱${parseFloat(prod.price_piece).toFixed(2)}
              </button>
              ${prod.price_pack && prod.price_pack > 0 ? `
                <button class="btn btn-sm btn-outline-success py-1" onclick="addToCart('${prod.id}', 'pack')">
                  Pack: ₱${parseFloat(prod.price_pack).toFixed(2)}
                </button>
              ` : ''}
            </div>
          </div>
        </div>
      </div>
    `;
    container.appendChild(card);
  });
}

/**
 * Pagdagdag ng aytem sa Cart na may konsiderasyon sa napiling Unit at Stock Control
 */
function addToCart(productId, selectedUnit = "piece") {
  const product = cachedInventory.find(p => p.id === productId);
  if (!product) return;

  // Suriin kung may sapat pang stock
  if (parseInt(product.stock) <= 0) {
    showToast("Paumanhin, out of stock na ang produktong ito.", "danger");
    return;
  }

  // Tingnan kung may kaparehong item at parehong unit na sa cart
  const existingIndex = currentCart.findIndex(item => item.id === productId && item.sellUnit === selectedUnit);
  const currentQtyInCart = existingIndex !== -1 ? currentCart[existingIndex].quantity : 0;

  if (currentQtyInCart >= parseInt(product.stock)) {
    showToast(`Hindi na maaaring dagdagan. ${product.stock} na lang ang natitirang stock.`, "warning");
    return;
  }

  if (existingIndex !== -1) {
    currentCart[existingIndex].quantity += 1;
  } else {
    const activePrice = selectedUnit === "pack" ? product.price_pack : product.price_piece;
    currentCart.push({
      id: product.id,
      name: product.name,
      barcode: product.barcode,
      price: parseFloat(activePrice),
      sellUnit: selectedUnit,
      quantity: 1,
      maxStock: parseInt(product.stock)
    });
  }

  updateCartUI();
}

/**
 * Pagbabago ng dami (Quantity) ng aytem nang direkta sa Cart Sidebar
 */
function updateCartQuantity(index, newQty) {
  const qty = parseInt(newQty);
  if (isNaN(qty) || qty <= 0) {
    currentCart.splice(index, 1);
  } else if (qty > currentCart[index].maxStock) {
    showToast(`Hanggang ${currentCart[index].maxStock} piraso lamang ang pwedeng ibenta base sa stock.`, "warning");
    currentCart[index].quantity = currentCart[index].maxStock;
  } else {
    currentCart[index].quantity = qty;
  }
  updateCartUI();
}

/**
 * UI Render at Calculation ng Cart Items
 */
function updateCartUI() {
  const cartBody = document.getElementById("cart-items-list");
  if (!cartBody) return;
  cartBody.innerHTML = "";

  let totalAmount = 0;

  currentCart.forEach((item, index) => {
    const subtotal = item.price * item.quantity;
    totalAmount += subtotal;

    const row = document.createElement("div");
    row.className = "cart-item d-flex align-items-center justify-content-between p-2 mb-2 border-bottom bg-light rounded";
    row.innerHTML = `
      <div class="flex-grow-1 min-w-0 me-2">
        <h6 class="mb-0 text-truncate font-weight-bold" style="font-size: 0.9rem;">${item.name}</h6>
        <small class="text-muted">₱${item.price.toFixed(2)} / ${item.sellUnit}</small>
      </div>
      <div class="d-flex align-items-center">
        <div class="input-group input-group-sm me-2" style="width: 100px;">
          <button class="btn btn-outline-secondary px-2" type="button" onclick="updateCartQuantity(${index}, ${item.quantity - 1})">-</button>
          <input type="number" class="form-control text-center p-0" value="${item.quantity}" min="1" onchange="updateCartQuantity(${index}, this.value)">
          <button class="btn btn-outline-secondary px-2" type="button" onclick="updateCartQuantity(${index}, ${item.quantity + 1})">+</button>
        </div>
        <div class="text-end" style="width: 70px;">
          <span class="small font-weight-bold">₱${subtotal.toFixed(2)}</span>
        </div>
        <button class="btn btn-sm text-danger ms-2 p-0" onclick="updateCartQuantity(${index}, 0)">
          <i class="bi bi-trash"></i>
        </button>
      </div>
    `;
    cartBody.appendChild(row);
  });

  // I-update ang kabuuang babayaran sa UI
  document.getElementById("cart-total-payable").textContent = `₱${totalAmount.toFixed(2)}`;
}

// ==========================================
// 7. BARCODE SCANNING METHODS (HARDWARE & CAMERA)
// ==========================================

/**
 * Hardware Barcode Scanner Listener (Auto-focus catch)
 */
let barcodeBuffer = "";
let lastKeyTime = Date.now();

function handleHardwareBarcodeScan(e) {
  // Harangan ang input kung nasa login screen o labas ng POS screen
  const loginScreen = document.getElementById("login-screen");
  if (loginScreen && !loginScreen.classList.contains("d-none")) return;

  const currentTime = Date.now();
  if (currentTime - lastKeyTime > 100) {
    barcodeBuffer = ""; // I-clear kung masyadong matagal ang pagitan ng tipa
  }
  lastKeyTime = currentTime;

  if (e.key === "Enter") {
    if (barcodeBuffer.length > 2) {
      processScannedBarcode(barcodeBuffer);
      barcodeBuffer = "";
    }
  } else if (e.key !== "Process" && e.key.length === 1) {
    barcodeBuffer += e.key;
  }
}

function processScannedBarcode(barcode) {
  const cleanBarcode = barcode.trim();
  const product = cachedInventory.find(p => p.barcode === cleanBarcode);
  
  if (product) {
    addToCart(product.id, "piece"); // Default unit kapag scan ay piece
    showToast(`Naidagdag: ${product.name}`, "success");
  } else {
    showToast(`Hindi mahanap ang barcode: ${cleanBarcode}`, "warning");
  }
}

/**
 * Camera-Based QR/Barcode Scanner gamit ang Html5Qrcode Library
 */
function toggleCameraScanner() {
  const container = document.getElementById("camera-scan-region");
  if (!container) return;

  if (html5QrCode && html5QrCode.isScanning) {
    stopCameraScanner();
    return;
  }

  container.classList.remove("d-none");
  html5QrCode = new Html5Qrcode("camera-scan-view");
  
  html5QrCode.start(
    { facingMode: "environment" },
    { fps: 10, qrbox: { width: 250, height: 150 } },
    (decodedText) => {
      processScannedBarcode(decodedText);
      stopCameraScanner(); // Isara pagkatapos makascan ng isa para hindi mag-loop
    },
    (errorMessage) => {
      // Tahimik lang kung walang makitang barcode sa frame para iwas spam sa console
    }
  ).catch(err => {
    console.error("Camera Init Error:", err);
    showToast("Hindi mabuksan ang camera. Siguraduhing may pahintulot.", "danger");
    container.classList.add("d-none");
  });
}

function stopCameraScanner() {
  const container = document.getElementById("camera-scan-region");
  if (html5QrCode) {
    html5QrCode.stop().then(() => {
      html5QrCode.clear();
      if (container) container.classList.add("d-none");
    }).catch(err => console.log("Error stopping scanner:", err));
  }
}

// ==========================================
// 8. CHECKOUT PROCESS
// ==========================================
function openCheckoutModal() {
  if (currentCart.length === 0) {
    showToast("Walang laman ang iyong cart.", "warning");
    return;
  }

  let total = 0;
  currentCart.forEach(item => total += (item.price * item.quantity));

  document.getElementById("modal-checkout-total").textContent = `₱${total.toFixed(2)}`;
  
  const cashInput = document.getElementById("checkout-cash-received");
  cashInput.value = "";
  document.getElementById("checkout-change-display").textContent = "₱0.00";

  const checkoutModal = new bootstrap.Modal(document.getElementById("checkoutModal"));
  checkoutModal.show();
  
  setTimeout(() => cashInput.focus(), 500);
}

function calculateChange() {
  let total = 0;
  currentCart.forEach(item => total += (item.price * item.quantity));

  const cashReceived = parseFloat(document.getElementById("checkout-cash-received").value) || 0;
  const change = cashReceived - total;

  const changeDisplay = document.getElementById("checkout-change-display");
  changeDisplay.textContent = `₱${change >= 0 ? change.toFixed(2) : "0.00"}`;
  
  if (change < 0) {
    changeDisplay.classList.add("text-danger");
  } else {
    changeDisplay.classList.remove("text-danger");
  }
}

function submitCheckout() {
  let total = 0;
  currentCart.forEach(item => total += (item.price * item.quantity));

  const cashReceivedInput = document.getElementById("checkout-cash-received");
  const cashReceived = parseFloat(cashReceivedInput.value) || 0;

  if (cashReceived < total) {
    showToast("Kulang ang tinanggap na pera para sa kabuuang halaga.", "danger");
    cashReceivedInput.focus();
    return;
  }

  showLoading(true, "Pinoproseso ang transaksyon...");

  const params = new URLSearchParams();
  params.append("action", "processSale");
  params.append("cashier", currentUser.username);
  params.append("total_amount", total);
  params.append("cash_received", cashReceived);
  params.append("cart_items", JSON.stringify(currentCart));

  fetch(SCRIPT_URL, {
    method: "POST",
    body: params,
    headers: { "Content-Type": "application/x-www-form-urlencoded" }
  })
  .then(res => res.json())
  .then(data => {
    showLoading(false);
    if (data.status === "success") {
      showToast("Transaksyon Kumpleto!", "success");
      
      // Isara ang modal
      const checkoutModalEl = document.getElementById("checkoutModal");
      const modalInstance = bootstrap.Modal.getInstance(checkoutModalEl);
      if (modalInstance) modalInstance.hide();

      // I-trigger ang pagpapakita at pag-print ng resibo
      generateReceiptUI(data.receiptId, total, cashReceived, currentCart);
      
      // I-clear ang cart at i-refresh ang lokal na kopya ng inventory
      currentCart = [];
      updateCartUI();
      if (typeof fetchInventory === "function") fetchInventory();
    } else {
      showToast(`Hindi natuloy ang pagbenta: ${data.message}`, "danger");
    }
  })
  .catch(err => {
    showLoading(false);
    console.error("Checkout Error:", err);
    showToast("Nagka-error sa koneksyon ngunit naka-save ang resibo sa offline mode.", "warning");
  });
}
// ==========================================
// 9. INVENTORY MANAGEMENT (FETCH, ADD, EDIT)
// ==========================================

/**
 * Kumukuha ng pinakabagong listahan ng produkto mula sa Google Sheets backend
 */
function fetchInventory() {
  showLoading(true, "Kina-load ang imbentaryo...");
  
  // Cache busting gamit ang timestamp para iwas sa lumang data mula sa server
  fetch(`${SCRIPT_URL}?action=getInventory&_=${new Date().getTime()}`)
    .then(res => res.json())
    .then(data => {
      showLoading(false);
      if (Array.isArray(data)) {
        cachedInventory = data;
        
        // I-render ang data sa kung anong screen ang kasalukuyang aktibo
        if (typeof renderPOSProducts === "function") renderPOSProducts();
        if (typeof renderInventoryTable === "function") renderInventoryTable();
      } else {
        showToast("Maling format ng data ang natanggap mula sa server.", "danger");
      }
    })
    .catch(err => {
      showLoading(false);
      console.error("Fetch Inventory Error:", err);
      showToast("Hindi makuha ang imbentaryo. Gumagana sa offline mode.", "warning");
    });
}

/**
 * Nagpapadala o nag-e-edit ng isang partikular na produkto sa database
 */
function saveProduct(formData) {
  showLoading(true, "Inise-save ang produkto...");

  const params = new URLSearchParams();
  params.append("action", "saveProduct");
  for (const pair of formData.entries()) {
    params.append(pair[0], pair[1]);
  }

  fetch(SCRIPT_URL, {
    method: "POST",
    body: params,
    headers: { "Content-Type": "application/x-www-form-urlencoded" }
  })
  .then(res => res.json())
  .then(data => {
    showLoading(false);
    if (data.status === "success") {
      showToast("Matagumpay na na-save ang produkto!", "success");
      
      const productModalEl = document.getElementById("productModal");
      const modalInstance = bootstrap.Modal.getInstance(productModalEl);
      if (modalInstance) modalInstance.hide();

      fetchInventory(); // I-refresh ang UI listahan
    } else {
      showToast(`Error: ${data.message}`, "danger");
    }
  })
  .catch(err => {
    showLoading(false);
    console.error("Save Product Error:", err);
    showToast("Hindi maikonekta sa server. Pakisubukang muli.", "danger");
  });
}

// ==========================================
// 10. EXCEL & CSV BULK IMPORT LOGIC
// ==========================================

/**
 * Nagbabasa at nag-a-analisa ng piniling Excel o CSV file para sa maramihang import
 */
function handleBulkImportFile(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  
  // Suriin kung Excel file o CSV ang pinasok
  if (file.name.endsWith(".xlsx") || file.name.endsWith(".xls")) {
    reader.onload = function(e) {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: "array" });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet);
      
      processImportRows(jsonData);
    };
    reader.readAsArrayBuffer(file);
  } else if (file.name.endsWith(".csv")) {
    reader.onload = function(e) {
      const text = e.target.result;
      const jsonData = csvToJson(text);
      processImportRows(jsonData);
    };
    reader.readAsText(file);
  } else {
    showToast("Hindi suportado ang format ng file. Gumamit ng .xlsx o .csv", "danger");
  }
}

function processImportRows(rows) {
  if (!rows || rows.length === 0) {
    showToast("Walang data na nahanap sa loob ng file.", "warning");
    return;
  }

  // I-map ang headers ng Excel/CSV sa standard structural keys ng system
  const formattedProducts = rows.map(row => ({
    id: row.ID || row.id || "",
    name: row.Name || row.name || "Unnamed Product",
    barcode: row.Barcode || row.barcode || "",
    category: row.Category || row.category || "General",
    price_piece: parseFloat(row.PricePiece || row.price_piece) || 0,
    price_pack: parseFloat(row.PricePack || row.price_pack) || 0,
    stock: parseInt(row.Stock || row.stock) || 0,
    min_stock: parseInt(row.MinStock || row.min_stock) || 5,
    unit: row.Unit || row.unit || "piece"
  }));

  // Hatiin sa tig-50 aytem kada batch para maiwasan ang payload timeout sa Google Servers
  const batchSize = 50;
  for (let i = 0; i < formattedProducts.length; i += batchSize) {
    const batch = formattedProducts.slice(i, i + batchSize);
    gasBulkImport(batch);
  }
}

/**
 * Nagpapadala ng maramihang produkto (batch) sa Google Apps Script backend.
 * Ginagamit ang URLSearchParams para sa ligtas at maayos na pag-encode ng data.
 */
function gasBulkImport(batch) {
  if (!batch || batch.length === 0) {
    showToast("Walang data na i-a-import.", "danger");
    return;
  }

  // Encode each product individually and send as numbered params
  const params = new URLSearchParams();
  params.append("action", "bulkImportProducts");
  params.append("count", batch.length);

  batch.forEach((product, index) => {
    params.append(`id_${index}`, product.id || "");
    params.append(`name_${index}`, product.name || "");
    params.append(`barcode_${index}`, product.barcode || "");
    params.append(`category_${index}`, product.category || "");
    params.append(`price_piece_${index}`, product.price_piece || 0);
    params.append(`price_pack_${index}`, product.price_pack || 0);
    params.append(`stock_${index}`, product.stock || 0);
    params.append(`min_stock_${index}`, product.min_stock || 0);
    params.append(`unit_${index}`, product.unit || "piece");
  });

  showLoading(true, `Ina-upload ang ${batch.length} na aytem sa server...`);

  fetch(SCRIPT_URL, {
    method: "POST",
    body: params,
    headers: { "Content-Type": "application/x-www-form-urlencoded" }
  })
  .then(res => res.json())
  .then(data => {
    showLoading(false);
    if (data.status === "success") {
      showToast(`Matagumpay na na-import ang ${batch.length} na produkto!`, "success");
      fetchInventory();
      
      const importModal = document.getElementById("importModal");
      if (importModal) {
        const modalInstance = bootstrap.Modal.getInstance(importModal);
        if (modalInstance) modalInstance.hide();
      }
    } else {
      showToast(`Nagka-error sa pag-import: ${data.message}`, "danger");
    }
  })
  .catch(error => {
    showLoading(false);
    console.error("Bulk Import Error:", error);
    showToast("Nagka-error sa pag-upload. Pakisuri ang iyong koneksyon.", "danger");
  });
}

// ==========================================
// 11. DIGITAL RECEIPT GENERATOR & DOWNLOADER
// ==========================================

function generateReceiptUI(receiptId, total, cashReceived, items) {
  const container = document.getElementById("receipt-modal-body-area");
  if (!container) return;

  const change = cashReceived - total;
  const vatAmount = total - (total / 1.12); // 12% VAT computation
  const currentDateTime = new Date().toLocaleString("en-PH", { timeZone: "Asia/Manila" });

  let itemsHtml = "";
  items.forEach(item => {
    const itemSub = item.price * item.quantity;
    itemsHtml += `
      <div class="d-flex justify-content-between text-monospace small">
        <span>${item.name} (${item.quantity} x ₱${item.price.toFixed(2)})</span>
        <span>₱${itemSub.toFixed(2)}</span>
      </div>
    `;
  });

  container.innerHTML = `
    <div id="printable-receipt-card" class="bg-white p-3 border rounded text-dark text-center" style="font-family: 'Courier New', Courier, monospace; max-width: 350px; margin: 0 auto;">
      <h5 class="font-weight-bold mb-0">AE HOME TRADE CORP.</h5>
      <small class="text-muted d-block mb-2">Vigan City, Ilocos Sur</small>
      <hr class="border-top border-dark my-2">
      <div class="text-start small mb-2">
        <div><strong>OR No:</strong> ${receiptId}</div>
        <div><strong>Petsa:</strong> ${currentDateTime}</div>
        <div><strong>Cashier:</strong> ${currentUser ? currentUser.name : "System"}</div>
      </div>
      <hr class="border-top border-dark my-2">
      <div class="mb-2 text-start">
        ${itemsHtml}
      </div>
      <hr class="border-top border-dark my-2">
      <div class="text-start small">
        <div class="d-flex justify-content-between"><strong>KABUUAN:</strong> <strong>₱${total.toFixed(2)}</strong></div>
        <div class="d-flex justify-content-between text-muted"><span>12% VAT Inc:</span> <span>₱${vatAmount.toFixed(2)}</span></div>
        <div class="d-flex justify-content-between"><span>Tinanggap na Pera:</span> <span>₱${cashReceived.toFixed(2)}</span></div>
        <div class="d-flex justify-content-between font-weight-bold text-success"><span>SUKLI:</span> <span>₱${change.toFixed(2)}</span></div>
      </div>
      <hr class="border-top border-dark my-2">
      <p class="small mb-0 mt-2 font-italic">Maraming salamat sa pagtangkilik sa AE Home!</p>
    </div>
  `;

  // I-cache ang resibo sa LocalStorage para sa mabilisang reprinting kung kinakailangan
  saveReceiptToLocalStorage(receiptId, container.innerHTML);

  const receiptModal = new bootstrap.Modal(document.getElementById("receiptDisplayModal"));
  receiptModal.show();
}

/**
 * Nagda-download ng resibo bilang isang .PNG na imahe gamit ang HTML2Canvas
 */
function downloadReceiptAsImage() {
  const receiptCard = document.getElementById("printable-receipt-card");
  if (!receiptCard) return;

  showLoading(true, "Inihahanda ang resibo para sa pag-download...");

  html2canvas(receiptCard, { scale: 2 }).then(canvas => {
    showLoading(false);
    const link = document.createElement("a");
    link.download = `AE-Home-Receipt-${new Date().getTime()}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }).catch(err => {
    showLoading(false);
    console.error("Receipt Canvas Download Error:", err);
    showToast("Hindi ma-download ang resibo bilang imahe.", "danger");
  });
}

function saveReceiptToLocalStorage(id, htmlContent) {
  try {
    let history = JSON.parse(localStorage.getItem("ae_home_receipt_history")) || [];
    history.unshift({ id: id, html: htmlContent, timestamp: new Date().getTime() });
    
    // Panatilihin lamang ang huling 100 na resibo para hindi mapuno ang LocalStorage memory
    if (history.length > 100) history.pop();
    
    localStorage.setItem("ae_home_receipt_history", JSON.stringify(history));
  } catch (e) {
    console.warn("Hindi nai-save sa local history, puno na ang storage:", e);
  }
}

// Helper function para sa CSV strings conversion
function csvToJson(csvText) {
  const lines = csvText.split("\n");
  const result = [];
  const headers = lines[0].split(",");

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const obj = {};
    const currentline = lines[i].split(",");

    for (let j = 0; j < headers.length; j++) {
      obj[headers[j].trim()] = currentline[j] ? currentline[j].trim() : "";
    }
    result.push(obj);
  }
  return result;
}

// ==========================================
// 12. EVENT LISTENERS ASSIGNMENTS
// ==========================================
function setupEventListeners() {
  // Catch hardware barcode scanner events global-wide
  window.addEventListener("keypress", handleHardwareBarcodeScan);

  // Form Submission Event para sa Manwal na Pagdaragdag/Pag-edit ng Produkto sa Inventory
  const productForm = document.getElementById("productCrudForm");
  if (productForm) {
    productForm.addEventListener("submit", function(e) {
      e.preventDefault();
      const formData = new FormData(this);
      saveProduct(formData);
    });
  }

  // Event para sa bulk uploading file change trigger
  const fileInput = document.getElementById("bulkImportFileInput");
  if (fileInput) {
    fileInput.addEventListener("change", handleBulkImportFile);
  }
}
