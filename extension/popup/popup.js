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
  elements.importBtn.textContent = 'Scrolling to load all items...';
  elements.result.classList.add('hidden');

  try {
    console.log('[Judi\'s Wishlist Popup] Starting import for store:', currentStore.key);
    console.log('[Judi\'s Wishlist Popup] Tab ID:', currentTabId);

    // First, scroll through the page to load all lazy-loaded items
    elements.importBtn.textContent = 'Loading all items...';
    await chrome.scripting.executeScript({
      target: { tabId: currentTabId },
      func: scrollToLoadAllItems,
    });

    // Small delay to let items render
    await new Promise(r => setTimeout(r, 1000));

    elements.importBtn.textContent = 'Scraping items...';

    // Execute content script to scrape items
    const results = await chrome.scripting.executeScript({
      target: { tabId: currentTabId },
      func: scrapeCartItems,
      args: [currentStore.key],
    });

    console.log('[Judi\'s Wishlist Popup] Script execution results:', results);

    const items = results[0]?.result || [];

    console.log('[Judi\'s Wishlist Popup] Items found:', items.length);
    if (items.length > 0) {
      console.log('[Judi\'s Wishlist Popup] First item:', items[0]);
      console.log('[Judi\'s Wishlist Popup] Last item:', items[items.length - 1]);
    }

    if (items.length === 0) {
      showResult('No items found on this page. Make sure you are on the cart page. Check browser console (F12) for debug info.', false);
      return;
    }

    elements.importBtn.textContent = `Importing ${items.length} items...`;

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

// Function to scroll through the page and load all lazy-loaded items
// This runs in the context of the page
function scrollToLoadAllItems() {
  return new Promise((resolve) => {
    console.log('[Judi\'s Wishlist] Starting auto-scroll to load all items...');

    const scrollStep = 800; // pixels per scroll
    const scrollDelay = 300; // ms between scrolls
    let lastHeight = 0;
    let sameHeightCount = 0;
    let scrollCount = 0;
    const maxScrolls = 100; // Safety limit

    function doScroll() {
      const currentHeight = document.documentElement.scrollHeight;
      const currentPosition = window.scrollY + window.innerHeight;

      console.log(`[Judi\'s Wishlist] Scroll ${scrollCount}: pos=${Math.round(currentPosition)}, height=${currentHeight}`);

      // Check if we've reached the bottom or nothing new is loading
      if (currentPosition >= currentHeight - 100) {
        if (currentHeight === lastHeight) {
          sameHeightCount++;
          if (sameHeightCount >= 3) {
            console.log('[Judi\'s Wishlist] Reached bottom, no more items loading');
            // Scroll back to top
            window.scrollTo(0, 0);
            resolve();
            return;
          }
        } else {
          sameHeightCount = 0;
        }
      }

      lastHeight = currentHeight;
      scrollCount++;

      if (scrollCount >= maxScrolls) {
        console.log('[Judi\'s Wishlist] Max scrolls reached');
        window.scrollTo(0, 0);
        resolve();
        return;
      }

      // Scroll down
      window.scrollBy(0, scrollStep);

      // Continue scrolling
      setTimeout(doScroll, scrollDelay);
    }

    // Start scrolling
    doScroll();
  });
}

// Content script function to scrape cart items
// This runs in the context of the page
function scrapeCartItems(store) {
  const items = [];

  console.log('[Judi\'s Wishlist Scraper] Starting scrape for store:', store);
  console.log('[Judi\'s Wishlist Scraper] Page URL:', window.location.href);
  console.log('[Judi\'s Wishlist Scraper] Page title:', document.title);

  if (store === 'temu') {
    // Temu cart scraping
    console.log('[Judi\'s Wishlist Scraper] === TEMU CART SCRAPING ===');

    // Try multiple selectors for product links
    const selectors = [
      'a[href*="goods_id="]',
      'a[href*="/goods.html"]',
      'a[href*="product"]',
    ];

    let productLinks = [];
    for (const sel of selectors) {
      const links = document.querySelectorAll(sel);
      console.log(`[Judi\'s Wishlist Scraper] Selector "${sel}" found ${links.length} links`);
      if (links.length > productLinks.length) {
        productLinks = links;
      }
    }

    console.log('[Judi\'s Wishlist Scraper] Using', productLinks.length, 'product links');

    // Also log what we can find with various cart-related selectors
    const debugSelectors = {
      'div with cart class': 'div[class*="cart"]',
      'div with Cart class': 'div[class*="Cart"]',
      'div with item class': 'div[class*="item"]',
      'div with product class': 'div[class*="product"]',
      'images from kwcdn': 'img[src*="kwcdn"]',
      'all links': 'a',
      'checkboxes': 'input[type="checkbox"]',
    };

    for (const [name, sel] of Object.entries(debugSelectors)) {
      const els = document.querySelectorAll(sel);
      console.log(`[Judi\'s Wishlist Scraper] DEBUG: ${name} = ${els.length}`);
    }

    const seen = new Set();
    let skippedDuplicate = 0;
    let skippedNoId = 0;

    productLinks.forEach((link, index) => {
      // Extract goods_id
      const match = link.href.match(/goods_id=(\d+)/);
      if (!match) {
        if (index < 5) console.log(`[Judi\'s Wishlist Scraper] Link ${index}: No goods_id in`, link.href.substring(0, 80));
        skippedNoId++;
        return;
      }

      const productId = match[1];
      if (seen.has(productId)) {
        skippedDuplicate++;
        return;
      }
      seen.add(productId);

      // Find the cart item container (traverse up)
      let container = link.parentElement;
      let depth = 0;
      while (container && depth < 10) {
        // Look for a container that has an image
        if (container.querySelector('img[src*="kwcdn"]')) {
          break;
        }
        container = container.parentElement;
        depth++;
      }

      if (!container) {
        console.log(`[Judi\'s Wishlist Scraper] Product ${productId}: No container found`);
        container = link.parentElement?.parentElement?.parentElement;
      }

      // Get title from link text or image alt
      let title = link.textContent?.trim();
      if (!title || title.length < 5) {
        const img = container?.querySelector('img[src*="kwcdn"]');
        title = img?.alt || 'Unknown Product';
      }

      // Get image - try multiple selectors
      let imageUrl = null;
      const imgSelectors = [
        'img[src*="img.kwcdn.com/product"]',
        'img[src*="kwcdn"]',
        'img[src*="akamaized"]',
        'img',
      ];
      for (const imgSel of imgSelectors) {
        const img = container?.querySelector(imgSel);
        if (img?.src && img.src.includes('http')) {
          imageUrl = img.src;
          break;
        }
      }

      // Get price - try multiple selectors
      let price = null;
      const priceSelectors = [
        '[data-through-self="true"]',
        'span[class*="price"]',
        'div[class*="price"]',
        '[class*="Price"]',
      ];
      for (const priceSel of priceSelectors) {
        const priceEl = container?.querySelector(priceSel);
        if (priceEl) {
          const priceText = priceEl.textContent?.replace(/[^0-9.]/g, '');
          price = parseFloat(priceText) || null;
          if (price) break;
        }
      }

      // Get quantity
      let quantity = 1;
      const qtyInput = container?.querySelector('input[aria-label], input[type="text"][value]');
      if (qtyInput) {
        quantity = parseInt(qtyInput.value) || parseInt(qtyInput.getAttribute('aria-label')) || 1;
      }

      if (items.length < 3) {
        console.log(`[Judi\'s Wishlist Scraper] Item ${items.length + 1}: "${title?.substring(0, 40)}" @ $${price}, qty=${quantity}`);
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

    console.log('[Judi\'s Wishlist Scraper] === TEMU RESULTS ===');
    console.log('[Judi\'s Wishlist Scraper] Items found:', items.length);
    console.log('[Judi\'s Wishlist Scraper] Skipped (duplicate):', skippedDuplicate);
    console.log('[Judi\'s Wishlist Scraper] Skipped (no goods_id):', skippedNoId);
    console.log('[Judi\'s Wishlist Scraper] Unique IDs seen:', seen.size);

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
