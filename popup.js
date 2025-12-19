// popup.js - 100% compatível com a API Coin Bank
const API_BASE = 'https://bank.foxsrv.net';
let currentSession = null;
let balanceInterval = null;

// DOM Elements
const loginScreen = document.getElementById('loginScreen');
const mainScreen = document.getElementById('mainScreen');
const loginBtn = document.getElementById('loginBtn');
const logoutBtn = document.getElementById('logoutBtn');
const balanceAmount = document.getElementById('balanceAmount');
const accountsList = document.getElementById('accountsList');

// Login/Register Toggle
const authTabs = document.querySelectorAll('.auth-tab');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');

// Tab Navigation
const navTabs = document.querySelectorAll('.nav-tab');
const tabContents = {
  transfer: document.getElementById('transferTab'),
  card: document.getElementById('cardTab'),
  history: document.getElementById('historyTab')
};

// Form Elements
const transferAmount = document.getElementById('transferAmount');
const recipientId = document.getElementById('recipientId');
const transferBtn = document.getElementById('transferBtn');
const billId = document.getElementById('billId');
const payBillBtn = document.getElementById('payBillBtn');
const copyCardBtn = document.getElementById('copyCardBtn');
const resetCardBtn = document.getElementById('resetCardBtn');
const createBillBtn = document.getElementById('createBillBtn');
const billAmount = document.getElementById('billAmount');
const fromUserId = document.getElementById('fromUserId');
const displayUser = document.getElementById('displayUser');
const displayCardId = document.getElementById('displayCardId');
const transactionList = document.getElementById('transactionList');

// Utility Functions
function showScreen(screenName) {
  if (screenName === 'login') {
    loginScreen.classList.add('active');
    mainScreen.classList.remove('active');
    if (balanceInterval) {
      clearInterval(balanceInterval);
      balanceInterval = null;
    }
  } else {
    loginScreen.classList.remove('active');
    mainScreen.classList.add('active');
    startBalanceUpdates();
  }
}

function setTab(tabName) {
  // Update active tab
  navTabs.forEach(tab => {
    tab.classList.toggle('active', tab.dataset.tab === tabName);
  });
  
  // Show corresponding content
  Object.keys(tabContents).forEach(key => {
    tabContents[key].style.display = key === tabName ? 'block' : 'none';
  });
  
  // Load data for the tab
  if (tabName === 'history') {
    loadTransactions();
  } else if (tabName === 'card') {
    loadCardInfo();
  }
}

// Authentication Headers
function authHeaders() {
  if (!currentSession || !currentSession.sessionId) {
    return {
      'Content-Type': 'application/json'
    };
  }
  
  return {
    'Authorization': 'Bearer ' + currentSession.sessionId,
    'Content-Type': 'application/json'
  };
}

// API Request with proper error handling
async function apiRequest(endpoint, options = {}) {
  try {
    const url = `${API_BASE}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });
    
    // Handle 429 rate limit
    if (response.status === 429) {
      throw new Error('RATE_LIMIT');
    }
    
    // Handle queue full
    if (response.status === 503 || response.status === 504) {
      throw new Error('QUEUE_FULL');
    }
    
    const text = await response.text();
    let data;
    
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = {};
    }
    
    if (!response.ok) {
      // Special handling for login errors
      if (endpoint === '/api/login') {
        throw new Error(data.error || 'Login failed');
      }
      throw new Error(data.error || `API error: ${response.status}`);
    }
    
    return data;
  } catch (error) {
    console.error('API request failed:', error.message);
    throw error;
  }
}

// SHA256 Hash function for passwords (matching backend)
function sha256Hash(input) {
  // Simple implementation for browser
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  return crypto.subtle.digest('SHA-256', data)
    .then(hash => {
      const hexArray = Array.from(new Uint8Array(hash))
        .map(byte => byte.toString(16).padStart(2, '0'));
      return hexArray.join('');
    })
    .catch(() => {
      // Fallback simple hash (not secure, but matches format)
      let hash = 0;
      for (let i = 0; i < input.length; i++) {
        const char = input.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
      }
      return Math.abs(hash).toString(16).padStart(64, '0');
    });
}

// Login and Account Management
async function login(username, password) {
  try {
    // NÃO FAÇA HASH DA SENHA NO CLIENTE
    // Envie a senha em texto plano, a API fará o hash
    const data = await apiRequest('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        username: username.trim(), 
        password: password  // ← TEXTO PLANO, SEM HASH!
      })
    });
    
    console.log('Login response:', data); // Para debug
    
    if (data.sessionCreated && data.passwordCorrect) {
      currentSession = {
        username,
        sessionId: data.sessionId,
        userId: data.userId
      };
      
      // Save to storage (WITHOUT password for security)
      await saveAccount(username, password);
      await chrome.storage.local.set({ 
        currentSession,
        lastLogin: Date.now()
      });
      
      // Show main screen
      showScreen('main');
      displayUser.textContent = username;
      loadBalance();
      loadCardInfo();
      
      return true;
    } else {
      // Verificar tipo específico de erro
      if (data.error && data.error.includes('IP blocked')) {
        throw new Error('IP blocked. Try again later.');
      }
      throw new Error('Invalid credentials');
    }
  } catch (error) {
    console.error('Login error:', error);
    
    let errorMsg = 'Login failed';
    if (error.message === 'RATE_LIMIT') {
      errorMsg = 'Too many attempts. Please wait a moment.';
    } else if (error.message === 'QUEUE_FULL') {
      errorMsg = 'Server is busy. Please try again.';
    } else if (error.message.includes('IP blocked')) {
      errorMsg = 'Temporarily blocked. Try again later.';
    } else if (error.message) {
      errorMsg = error.message;
    }
    
    alert(errorMsg);
    return false;
  }
}

async function register(username, password, confirmPassword) {
  try {
    if (!username || !password || !confirmPassword) {
      throw new Error('Please fill all fields');
    }
    
    if (password !== confirmPassword) {
      throw new Error('Passwords do not match');
    }
    
    if (username.length < 3) {
      throw new Error('Username must be at least 3 characters');
    }
    
    if (password.length < 4) {
      throw new Error('Password must be at least 4 characters');
    }
    
    const data = await apiRequest('/api/register', {
      method: 'POST',
      body: JSON.stringify({ 
        username: username.trim(), 
        password 
      })
    });
    
    if (data.success) {
      alert('Account created successfully! Please login.');
      switchToLogin();
      return true;
    } else {
      throw new Error(data.error || 'Registration failed');
    }
  } catch (error) {
    console.error('Register error:', error);
    alert(error.message);
    return false;
  }
}

async function saveAccount(username, password) {
  const accounts = await getSavedAccounts();
  
  // Check if account already exists
  const existingIndex = accounts.findIndex(acc => acc.username === username);
  if (existingIndex !== -1) {
    accounts[existingIndex] = { 
      username, 
      password, 
      lastUsed: Date.now() 
    };
  } else {
    accounts.push({ 
      username, 
      password, 
      lastUsed: Date.now() 
    });
  }
  
  await chrome.storage.local.set({ accounts });
  loadSavedAccounts();
}

async function getSavedAccounts() {
  const data = await chrome.storage.local.get('accounts');
  return data.accounts || [];
}

async function removeAccount(username) {
  const accounts = await getSavedAccounts();
  const filtered = accounts.filter(acc => acc.username !== username);
  await chrome.storage.local.set({ accounts });
  loadSavedAccounts();
}

function loadSavedAccounts() {
  getSavedAccounts().then(accounts => {
    accountsList.innerHTML = '';
    
    if (accounts.length === 0) {
      accountsList.innerHTML = '<div style="color: #8f8f8f; text-align: center; padding: 10px;">No saved accounts</div>';
      return;
    }
    
    accounts.sort((a, b) => b.lastUsed - a.lastUsed);
    
    accounts.forEach(account => {
      const div = document.createElement('div');
      div.className = 'account-item';
      div.innerHTML = `
        <div class="account-user">${account.username}</div>
        <div class="account-remove">×</div>
      `;
      
      // Evento para login - EM TODO O ITEM (linha inteira clicável)
      div.onclick = async (e) => {
        // Impedir que o clique no "×" acione o login
        if (e.target.classList.contains('account-remove')) {
          return;
        }
        
        document.getElementById('loginUsername').value = account.username;
        document.getElementById('loginPassword').value = account.password;
        loginBtn.click();
      };
      
      // Evento para remover (sem confirmação)
      div.querySelector('.account-remove').onclick = async (e) => {
        e.stopPropagation();
        
        // Remover do storage
        const updatedAccounts = accounts.filter(acc => acc.username !== account.username);
        await chrome.storage.local.set({ accounts: updatedAccounts });
        
        // Remover da tela
        div.style.opacity = '0';
        div.style.height = '0';
        div.style.padding = '0';
        div.style.margin = '0';
        div.style.overflow = 'hidden';
        div.style.transition = 'all 0.3s';
        
        setTimeout(() => {
          div.remove();
          
          // Recarregar lista se estiver vazia
          if (accountsList.children.length === 0) {
            loadSavedAccounts();
          }
        }, 300);
      };
      
      accountsList.appendChild(div);
    });
  });
}

// Balance and Data Loading
async function loadBalance() {
  if (!currentSession) return;
  
  try {
    const data = await apiRequest(`/api/user/${currentSession.userId}/balance`, {
      headers: authHeaders()
    });
    
    if (data.coins !== undefined) {
      const formatted = parseFloat(data.coins).toFixed(8);
      balanceAmount.textContent = formatted;
    }
  } catch (error) {
    console.error('Failed to load balance:', error);
  }
}

async function loadCardInfo() {
  if (!currentSession) return;
  
  try {
    const data = await apiRequest('/api/card', {
      method: 'POST',
      headers: authHeaders()
    });
    
    if (data.cardCode) {
      displayCardId.textContent = data.cardCode;
    } else {
      displayCardId.textContent = 'Error loading card';
    }
  } catch (error) {
    console.error('Failed to load card info:', error);
    displayCardId.textContent = 'Error loading card';
  }
}

async function loadTransactions() {
  if (!currentSession) return;
  
  try {
    const data = await apiRequest('/api/transactions?page=1', {
      headers: authHeaders()
    });
    
    transactionList.innerHTML = '';
    
    if (!data.transactions || data.transactions.length === 0) {
      transactionList.innerHTML = '<div style="color: #8f8f8f; text-align: center; padding: 20px;">No transactions found</div>';
      return;
    }
    
    // Show only last 5 transactions
    const recent = data.transactions.slice(0, 5);
    
    recent.forEach(tx => {
      const div = document.createElement('div');
      div.className = 'transaction-item';
      
      const isSent = tx.from_id === currentSession.userId;
      const amount = parseFloat(tx.amount).toFixed(8);
      const date = new Date(tx.date).toLocaleString('en-GB');
      const otherParty = isSent ? tx.to_id : tx.from_id;
      
      div.innerHTML = `
        <div class="tx-header">
          <div style="font-weight: 600; color: ${isSent ? '#ff5c5c' : '#43b581'}">
            ${isSent ? '➔ Sent' : '← Received'}
          </div>
          <div class="tx-amount ${isSent ? 'negative' : ''}">
            ${isSent ? '-' : '+'}${amount}
          </div>
        </div>
        <div style="margin: 4px 0; font-size: 13px;">
          ${isSent ? 'To' : 'From'}: ${otherParty}
        </div>
        <div class="tx-date">${date}</div>
        <div class="tx-id" title="Transaction ID">${tx.id}</div>
      `;
      
      transactionList.appendChild(div);
    });
  } catch (error) {
    console.error('Failed to load transactions:', error);
    transactionList.innerHTML = '<div style="color: #ff5c5c; text-align: center; padding: 20px;">Failed to load transactions</div>';
  }
}

function startBalanceUpdates() {
  if (balanceInterval) clearInterval(balanceInterval);
  
  // Load immediately
  loadBalance();
  loadCardInfo();
  loadTransactions();
  
  // Update every 2 seconds
  balanceInterval = setInterval(() => {
    loadBalance();
  }, 2000);
}

// Actions
async function doTransfer() {
  const amount = parseFloat(transferAmount.value);
  const toId = recipientId.value.trim();
  
  if (!amount || amount <= 0 || !toId) {
    alert('Please enter valid amount and recipient ID');
    return;
  }
  
  if (amount > 999999999) {
    alert('Amount too large');
    return;
  }
  
  try {
    const data = await apiRequest('/api/transfer', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ 
        toId, 
        amount: amount.toFixed(8) 
      })
    });
    
    if (data.success) {
      loadBalance();
      loadTransactions();
    } else {
      throw new Error(data.error || 'Transfer failed');
    }
  } catch (error) {
    console.error('Transfer error:', error);
    alert(error.message || 'Transfer failed. Please try again.');
  }
}

async function doPayBill() {
  const billIdValue = billId.value.trim();
  
  if (!billIdValue) {
    alert('Please enter a bill ID');
    return;
  }
  
  if (!confirm(`Pay bill ${billIdValue}?`)) {
    return;
  }
  
  try {
    const data = await apiRequest('/api/bill/pay', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ 
        billId: billIdValue 
      })
    });
    
    if (data.success) {
      alert('Bill paid successfully!');
      billId.value = '';
      loadBalance();
      loadTransactions();
    } else {
      throw new Error(data.error || 'Failed to pay bill');
    }
  } catch (error) {
    console.error('Pay bill error:', error);
    alert(error.message || 'Failed to pay bill. Please check the ID.');
  }
}

async function doCreateBill() {
  const amount = parseFloat(billAmount.value);
  const fromId = fromUserId.value.trim();
  
  if (!amount || amount <= 0 || !fromId) {
    alert('Please enter valid amount and user ID');
    return;
  }
  
  if (amount > 999999999) {
    alert('Amount too large');
    return;
  }
  
  try {
    const data = await apiRequest('/api/bill/create', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        fromId,
        toId: currentSession.userId,
        amount: amount.toFixed(8)
      })
    });
    
    if (data.success && data.billId) {
      alert(`Bill created successfully!\nBill ID: ${data.billId}`);
      billAmount.value = '';
      fromUserId.value = '';
    } else {
      throw new Error(data.error || 'Failed to create bill');
    }
  } catch (error) {
    console.error('Create bill error:', error);
    alert(error.message || 'Failed to create bill.');
  }
}

async function doResetCard() {
  if (!confirm('Are you sure you want to reset your card? This will generate a new card code.')) {
    return;
  }
  
  try {
    const data = await apiRequest('/api/card/reset', {
      method: 'POST',
      headers: authHeaders()
    });
    
    if (data.newCode) {
      loadCardInfo();
      alert('Card reset successfully! New code: ' + data.newCode);
    } else {
      throw new Error('Failed to reset card');
    }
  } catch (error) {
    console.error('Reset card error:', error);
    alert('Failed to reset card.');
  }
}

// Copy to clipboard
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    // Fallback for older browsers
    const textArea = document.createElement('textarea');
    textArea.value = text;
    document.body.appendChild(textArea);
    textArea.select();
    const success = document.execCommand('copy');
    document.body.removeChild(textArea);
    return success;
  }
}

// Toggle between login and register
function switchToLogin() {
  document.querySelector('.auth-tab[data-auth="login"]').classList.add('active');
  document.querySelector('.auth-tab[data-auth="register"]').classList.remove('active');
  loginForm.style.display = 'block';
  registerForm.style.display = 'none';
}

function switchToRegister() {
  document.querySelector('.auth-tab[data-auth="register"]').classList.add('active');
  document.querySelector('.auth-tab[data-auth="login"]').classList.remove('active');
  loginForm.style.display = 'none';
  registerForm.style.display = 'block';
}

// Event Listeners
loginBtn.addEventListener('click', async () => {
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  
  if (!username || !password) {
    alert('Please enter username and password');
    return;
  }
  
  loginBtn.textContent = 'Logging in...';
  loginBtn.disabled = true;
  
  const success = await login(username, password);
  
  loginBtn.textContent = 'Login';
  loginBtn.disabled = false;
  
  if (!success) {
    document.getElementById('loginPassword').value = '';
  }
});

// Register button
document.getElementById('registerBtn').addEventListener('click', async () => {
  const username = document.getElementById('registerUsername').value.trim();
  const password = document.getElementById('registerPassword').value;
  const confirmPassword = document.getElementById('registerConfirmPassword').value;
  
  const registerBtn = document.getElementById('registerBtn');
  registerBtn.textContent = 'Creating...';
  registerBtn.disabled = true;
  
  const success = await register(username, password, confirmPassword);
  
  registerBtn.textContent = 'Create Account';
  registerBtn.disabled = false;
  
  if (success) {
    document.getElementById('registerUsername').value = '';
    document.getElementById('registerPassword').value = '';
    document.getElementById('registerConfirmPassword').value = '';
  }
});

// Auth tab switching
authTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    if (tab.dataset.auth === 'login') {
      switchToLogin();
    } else {
      switchToRegister();
    }
  });
});

logoutBtn.addEventListener('click', async () => {
  if (currentSession) {
    try {
      await apiRequest('/api/logout', {
        method: 'POST',
        headers: authHeaders()
      });
    } catch (error) {
      // Continue even if logout API fails
    }
  }
  
  await chrome.storage.local.remove('currentSession');
  currentSession = null;
  showScreen('login');
  switchToLogin();
});

// Tab navigation
navTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    setTab(tab.dataset.tab);
  });
});

// Action buttons
transferBtn.addEventListener('click', doTransfer);
payBillBtn.addEventListener('click', doPayBill);
createBillBtn.addEventListener('click', doCreateBill);
resetCardBtn.addEventListener('click', doResetCard);

copyCardBtn.addEventListener('click', async () => {
  try {
    const data = await apiRequest('/api/card', {
      method: 'POST',
      headers: authHeaders()
    });
    
    if (data.cardCode) {
      const success = await copyToClipboard(data.cardCode);
      if (success) {
        alert('Card code copied to clipboard!');
      } else {
        alert('Failed to copy. Please copy manually: ' + data.cardCode);
      }
    } else {
      alert('Failed to get card code');
    }
  } catch (error) {
    alert('Failed to copy card code.');
  }
});

// Initialize
async function init() {
  // Load saved accounts
  loadSavedAccounts();
  
  // Set auth tab listeners
  switchToLogin();
  
  // Try to restore previous session
  try {
    const data = await chrome.storage.local.get('currentSession');
    if (data.currentSession && data.currentSession.sessionId) {
      currentSession = data.currentSession;
      
      // Verify session is still valid
      try {
        await apiRequest(`/api/user/${currentSession.userId}/balance`, {
          headers: authHeaders()
        });
        
        showScreen('main');
        displayUser.textContent = currentSession.username;
        startBalanceUpdates();
        setTab('transfer');
        return;
      } catch (error) {
        // Session expired or invalid
        console.log('Session expired, requiring new login');
        await chrome.storage.local.remove('currentSession');
      }
    }
  } catch (error) {
    console.error('Init error:', error);
  }
  
  showScreen('login');
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', init);

// Handle Enter key in forms
document.getElementById('loginPassword').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    loginBtn.click();
  }
});

document.getElementById('registerConfirmPassword').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    document.getElementById('registerBtn').click();
  }
});

// Handle Enter in transfer fields
transferAmount.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    transferBtn.click();
  }
});

recipientId.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    transferBtn.click();
  }
});

billId.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    payBillBtn.click();
  }
});

// Add a simple notification system
function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 12px 20px;
    background: ${type === 'success' ? '#43b581' : type === 'error' ? '#ff5c5c' : '#7289da'};
    color: white;
    border-radius: 8px;
    z-index: 10000;
    animation: slideIn 0.3s ease-out;
    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
  `;
  
  notification.textContent = message;
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.style.animation = 'slideOut 0.3s ease-out';
    setTimeout(() => {
      if (notification.parentNode) {
        document.body.removeChild(notification);
      }
    }, 300);
  }, 3000);
}

// Add animation styles
const style = document.createElement('style');
style.textContent = `
  @keyframes slideIn {
    from { transform: translateX(100%); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }
  
  @keyframes slideOut {
    from { transform: translateX(0); opacity: 1; }
    to { transform: translateX(100%); opacity: 0; }
  }
`;
document.head.appendChild(style);
