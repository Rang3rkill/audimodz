// Popup script for Judi's Wishlist Importer

const API_BASE = 'http://localhost:5000';

const SUPPORTED_STORES = {
  'temu.com': { name: 'Temu', key: 'temu' },
  'amazon.com': { name: 'Amazon', key: 'amazon' },
};

// DOM elements
const elements = {
  status: document.getElementById('status'),
  unsupported: document.getElementById('unsupported'),
  supported: document.getElementById('supported'),
  storeBadge: document.getElementById('storeBadge'),
  storeName: document.getElementById('storeName'),
  listSelect: document.getElementById('listSelect'),
  importBtn: document.getElementById('importBtn'),
  result: document.getElementById('result'),
};

// Current state
let currentStore = null;
let currentTabId = null;

// Initialize popup
async function init() {
  showStatus('Checking page...', 'loading');

  try {
    // Get current tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTabId = tab.id;

    // Check if supported store
    const url = new URL(tab.url);
    const hostname = url.hostname.replace('www.', '');

    for (const [domain, store] of Object.entries(SUPPORTED_STORES)) {
      if (hostname.includes(domain)) {
        currentStore = store;
        break;
      }
    }

    if (!currentStore) {
      showUnsupported();
      return;
    }

    // Load lists from API
    await loadLists();

    // Show supported UI
    showSupported();

  } catch (error) {
    showStatus('Error: ' + error.message, 'error');
  }
}

// Load lists from the wishlist app
async function loadLists() {
  try {
    const response = await fetch(`${API_BASE}/api/lists`);
    if (!response.ok) throw new Error('Could not connect to wishlist app');

    const lists = await response.json();

    elements.listSelect.innerHTML = lists.map(list =>
      `<option value="${list.id}">${list.name}</option>`
    ).join('');

  } catch (error) {
    console.error('Failed to load lists:', error);
    // Keep default option
  }
}

// Show status message
function showStatus(message, type) {
  elements.status.textContent = message;
  elements.status.className = 'status ' + type;
  elements.status.classList.remove('hidden');
}

// Hide status
function hideStatus() {
  elements.status.classList.add('hidden');
}

// Show unsupported message
function showUnsupported() {
  hideStatus();
  elements.unsupported.classList.remove('hidden');
  elements.supported.classList.add('hidden');
}

// Show supported store UI
function showSupported() {
  hideStatus();
  elements.unsupported.classList.add('hidden');
  elements.supported.classList.remove('hidden');

  elements.storeBadge.textContent = currentStore.key.toUpperCase();
  elements.storeBadge.className = 'store-badge ' + currentStore.key;
  elements.storeName.textContent = currentStore.name + ' detected';
}

// Import cart items
async function importCart() {
  elements.importBtn.disabled = true;
  elements.importBtn.textContent = 'Importing...';
  elements.result.classList.add('hidden');

  try {
    // Execute content script to scrape items
    const results = await chrome.scripting.executeScript({
      target: { tabId: currentTabId },
      func: scrapeCartItems,
      args: [currentStore.key],
    });

    const items = results[0]?.result || [];

    if (items.length === 0) {
      showResult('No items found on this page. Make sure you are on the cart page.', false);
      return;
    }

    // Send to wishlist app
    const listId = parseInt(elements.listSelect.value);
    const response = await fetch(`${API_BASE}/api/items/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        store: currentStore.key,
        items: items,
        list_id: listId,
      }),
    });

    if (!response.ok) throw new Error('Failed to import items');

    const data = await response.json();
    showResult(`Imported ${data.imported} items, ${data.skipped} already existed`, true, data);

  } catch (error) {
    showResult('Error: ' + error.message, false);
  } finally {
    elements.importBtn.disabled = false;
    elements.importBtn.textContent = 'Import Cart Items';
  }
}

// Show result message
function showResult(message, success, data = null) {
  elements.result.classList.remove('hidden', 'success', 'error');
  elements.result.classList.add(success ? 'success' : 'error');

  let html = `<div>${message}</div>`;

  if (data) {
    html += `
      <div class="result-stats">
        <div class="result-stat imported">
          <span class="count">${data.imported}</span> new
        </div>
        <div class="result-stat skipped">
          <span class="count">${data.skipped}</span> skipped
        </div>
      </div>
    `;
  }

  elements.result.innerHTML = html;
}

// Content script function to scrape cart items
// This runs in the context of the page
function scrapeCartItems(store) {
  const items = [];

  if (store === 'temu') {
    // Temu cart scraping
    // Find all product links with goods_id
    const productLinks = document.querySelectorAll('a[href*="goods_id="]');
    const seen = new Set();

    productLinks.forEach(link => {
      // Extract goods_id
      const match = link.href.match(/goods_id=(\d+)/);
      if (!match) return;

      const productId = match[1];
      if (seen.has(productId)) return;
      seen.add(productId);

      // Find the cart item container (traverse up)
      let container = link.closest('div[class*="1is6"]') || link.parentElement?.parentElement?.parentElement;
      if (!container) return;

      // Get title from link text or image alt
      let title = link.textContent?.trim();
      if (!title || title.length < 5) {
        const img = container.querySelector('img[src*="img.kwcdn.com"]');
        title = img?.alt || 'Unknown Product';
      }

      // Get image
      const img = container.querySelector('img[src*="img.kwcdn.com/product"]');
      const imageUrl = img?.src || null;

      // Get price
      let price = null;
      const priceContainer = container.querySelector('[data-through-self="true"]');
      if (priceContainer) {
        const priceText = priceContainer.textContent?.replace(/[^0-9.]/g, '');
        price = parseFloat(priceText) || null;
      }

      // Get quantity
      let quantity = 1;
      const qtyInput = container.querySelector('input[aria-label]');
      if (qtyInput) {
        quantity = parseInt(qtyInput.value) || parseInt(qtyInput.getAttribute('aria-label')) || 1;
      }

      items.push({
        product_id: productId,
        product_url: `https://www.temu.com/goods.html?goods_id=${productId}`,
        title: title,
        image_url: imageUrl,
        price: price,
        quantity: quantity,
      });
    });

  } else if (store === 'amazon') {
    // Amazon cart scraping
    const cartItems = document.querySelectorAll('[data-asin]');
    const seen = new Set();

    cartItems.forEach(item => {
      const asin = item.dataset.asin;
      if (!asin || asin.length !== 10 || seen.has(asin)) return;
      seen.add(asin);

      // Get title
      const titleEl = item.querySelector('.sc-product-title, .a-truncate-cut, a[href*="/dp/"]');
      let title = titleEl?.textContent?.trim() || 'Unknown Product';

      // Get image
      const img = item.querySelector('.sc-product-image img, img[src*="images-amazon"]');
      const imageUrl = img?.src || null;

      // Get price
      let price = null;
      const priceEl = item.querySelector('.sc-product-price, .sc-price, .a-price .a-offscreen');
      if (priceEl) {
        const priceText = priceEl.textContent?.replace(/[^0-9.]/g, '');
        price = parseFloat(priceText) || null;
      }

      // Get quantity
      let quantity = 1;
      const qtyEl = item.querySelector('.sc-quantity-textfield, select[name*="quantity"], input[name*="quantity"]');
      if (qtyEl) {
        quantity = parseInt(qtyEl.value) || 1;
      }

      items.push({
        product_id: asin,
        product_url: `https://www.amazon.com/dp/${asin}`,
        title: title,
        image_url: imageUrl,
        price: price,
        quantity: quantity,
      });
    });
  }

  return items;
}

// Event listeners
elements.importBtn.addEventListener('click', importCart);

// Initialize
init();
