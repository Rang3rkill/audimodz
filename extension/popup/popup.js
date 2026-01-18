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
    const scrapeStats = items._stats || null;
    showResult(`Imported ${data.imported} items, ${data.skipped} already existed`, true, data, scrapeStats);

  } catch (error) {
    showResult('Error: ' + error.message, false);
  } finally {
    elements.importBtn.disabled = false;
    elements.importBtn.textContent = 'Import Cart Items';
  }
}

// Show result message
function showResult(message, success, data = null, scrapeStats = null) {
  elements.result.classList.remove('hidden', 'success', 'error', 'warning');
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

  // Show scrape stats if available
  if (scrapeStats) {
    html += `<div class="scrape-stats">`;

    // Show count validation
    if (scrapeStats.expectedCount) {
      if (scrapeStats.hasCountMismatch) {
        html += `
          <div class="stat-warning">
            &#9888; Found ${scrapeStats.total} items but cart shows ${scrapeStats.expectedCount}
          </div>
        `;
        elements.result.classList.remove('success');
        elements.result.classList.add('warning');
      } else {
        html += `<div class="stat-ok">&#10003; All ${scrapeStats.total} cart items found</div>`;
      }
    }

    // Show data quality
    const imgPercent = Math.round((scrapeStats.withImage / scrapeStats.total) * 100);
    const pricePercent = Math.round((scrapeStats.withPrice / scrapeStats.total) * 100);

    if (imgPercent < 100 || pricePercent < 100) {
      html += `
        <div class="stat-detail">
          Images: ${scrapeStats.withImage}/${scrapeStats.total} (${imgPercent}%) |
          Prices: ${scrapeStats.withPrice}/${scrapeStats.total} (${pricePercent}%)
        </div>
      `;
    }

    html += `</div>`;
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
    // Temu cart scraping - NEW APPROACH: Find items by images first
    console.log('[Judi\'s Wishlist Scraper] === TEMU CART SCRAPING (v2) ===');

    // Collect ALL images from the page that look like product images
    const allImages = document.querySelectorAll('img[src*="kwcdn"], img[src*="akamaized"]');
    console.log(`[Judi\'s Wishlist Scraper] Found ${allImages.length} potential product images`);

    // Build a map of goods_id -> image URL
    const imageMap = new Map();

    // Also collect images by finding them near product links
    const productLinks = document.querySelectorAll('a[href*="goods_id="]');
    console.log(`[Judi\'s Wishlist Scraper] Found ${productLinks.length} product links`);

    // For each product link, search nearby for images
    productLinks.forEach(link => {
      const match = link.href.match(/goods_id=(\d+)/);
      if (!match) return;
      const goodsId = match[1];

      // Search in ancestors for images
      let el = link;
      for (let i = 0; i < 15 && el; i++) {
        el = el.parentElement;
        if (!el) break;

        // Look for any image in this container
        const imgs = el.querySelectorAll('img');
        for (const img of imgs) {
          const src = img.src || img.dataset?.src || img.getAttribute('data-src');
          if (src && (src.includes('kwcdn') || src.includes('akamaized') || src.includes('product'))) {
            // Found a product image near this link
            if (!imageMap.has(goodsId) || src.includes('product')) {
              imageMap.set(goodsId, src);
            }
            break;
          }
        }
        if (imageMap.has(goodsId)) break;
      }
    });

    console.log(`[Judi\'s Wishlist Scraper] Built image map with ${imageMap.size} entries`);

    // Now process each unique product
    const seen = new Set();
    let stats = { total: 0, withImage: 0, withPrice: 0, withTitle: 0 };

    productLinks.forEach((link, index) => {
      const match = link.href.match(/goods_id=(\d+)/);
      if (!match) return;

      const productId = match[1];
      if (seen.has(productId)) return;
      seen.add(productId);
      stats.total++;

      // Find the best container by walking up
      let container = link;
      let bestContainer = null;
      for (let i = 0; i < 15 && container; i++) {
        container = container.parentElement;
        if (!container) break;

        // A good container has: image + price text or quantity input
        const hasImage = container.querySelector('img[src*="kwcdn"], img[src*="akamaized"]');
        const hasPrice = container.textContent?.includes('$');
        const hasQty = container.querySelector('input');

        if (hasImage || hasPrice || hasQty) {
          bestContainer = container;
          // Keep going to find a bigger container with more info
          if (hasImage && hasPrice) break;
        }
      }

      container = bestContainer || link.parentElement?.parentElement?.parentElement;

      // === GET TITLE ===
      let title = null;

      // Method 1: Link text
      if (!title || title.length < 5) {
        title = link.textContent?.trim();
      }

      // Method 2: Look for title-like text in container
      if (!title || title.length < 5) {
        const textNodes = container?.querySelectorAll('span, div, p, a');
        for (const node of textNodes || []) {
          const text = node.textContent?.trim();
          if (text && text.length > 10 && text.length < 300 &&
              !text.includes('$') && !text.includes('%') &&
              !text.match(/^\d+$/) && !text.includes('Qty')) {
            title = text;
            break;
          }
        }
      }

      // Method 3: Image alt text
      if (!title || title.length < 5) {
        const img = container?.querySelector('img');
        if (img?.alt && img.alt.length > 5) {
          title = img.alt;
        }
      }

      if (title && title.length >= 5) stats.withTitle++;

      // === GET IMAGE ===
      let imageUrl = imageMap.get(productId) || null;

      // Fallback: search in container with multiple approaches
      if (!imageUrl && container) {
        // Method 1: Direct img elements with various src attributes
        const imgSelectors = [
          'img[src*="img.kwcdn.com/product"]',
          'img[src*="kwcdn"]',
          'img[src*="akamaized"]',
          'img[data-src*="kwcdn"]',
          'img[data-src*="akamaized"]',
          'img',
        ];
        for (const sel of imgSelectors) {
          const imgs = container.querySelectorAll(sel);
          for (const img of imgs) {
            // Check multiple possible sources for lazy-loaded images
            const src = img.src || img.dataset?.src || img.getAttribute('data-src') ||
                       img.getAttribute('data-lazy-src') || img.getAttribute('data-original');
            if (src && src.startsWith('http') && !src.includes('icon') && !src.includes('logo') &&
                !src.includes('checkbox') && !src.includes('avatar')) {
              imageUrl = src;
              break;
            }
          }
          if (imageUrl) break;
        }

        // Method 2: Check for background-image in style
        if (!imageUrl) {
          const elementsWithBg = container.querySelectorAll('[style*="background"]');
          for (const el of elementsWithBg) {
            const style = el.getAttribute('style') || '';
            const bgMatch = style.match(/url\(['"]?(https?:\/\/[^'")\s]+)['"]?\)/);
            if (bgMatch && (bgMatch[1].includes('kwcdn') || bgMatch[1].includes('product'))) {
              imageUrl = bgMatch[1];
              break;
            }
          }
        }

        // Method 3: Check computed styles for background-image
        if (!imageUrl) {
          const allDivs = container.querySelectorAll('div');
          for (const div of allDivs) {
            try {
              const computedStyle = window.getComputedStyle(div);
              const bgImage = computedStyle.backgroundImage;
              if (bgImage && bgImage !== 'none') {
                const urlMatch = bgImage.match(/url\(['"]?(https?:\/\/[^'")\s]+)['"]?\)/);
                if (urlMatch && (urlMatch[1].includes('kwcdn') || urlMatch[1].includes('product'))) {
                  imageUrl = urlMatch[1];
                  break;
                }
              }
            } catch (e) { /* ignore */ }
          }
        }
      }

      if (imageUrl) stats.withImage++;

      // === GET PRICE ===
      let price = null;

      if (container) {
        // Method 1: Look for price patterns in text
        const allText = container.textContent || '';
        const priceMatches = allText.match(/\$(\d+\.?\d*)/g);
        if (priceMatches && priceMatches.length > 0) {
          // Take the first reasonable price (not too high, not zero)
          for (const pm of priceMatches) {
            const p = parseFloat(pm.replace('$', ''));
            if (p > 0 && p < 10000) {
              price = p;
              break;
            }
          }
        }

        // Method 2: Specific selectors
        if (!price) {
          const priceSelectors = [
            '[data-through-self="true"]',
            'span[class*="price"]',
            'span[class*="Price"]',
            'div[class*="price"]',
          ];
          for (const sel of priceSelectors) {
            const el = container.querySelector(sel);
            if (el) {
              const priceText = el.textContent?.replace(/[^0-9.]/g, '');
              const p = parseFloat(priceText);
              if (p > 0 && p < 10000) {
                price = p;
                break;
              }
            }
          }
        }
      }

      if (price) stats.withPrice++;

      // === GET QUANTITY ===
      let quantity = 1;
      if (container) {
        const qtyEl = container.querySelector('input[type="text"], input[aria-label*="uantity"], input[value]');
        if (qtyEl) {
          const val = parseInt(qtyEl.value) || parseInt(qtyEl.getAttribute('aria-label')?.match(/\d+/)?.[0]);
          if (val && val > 0 && val < 1000) {
            quantity = val;
          }
        }
      }

      // Log first few items for debugging
      if (items.length < 5) {
        console.log(`[Judi\'s Wishlist Scraper] Item ${items.length + 1}:`, {
          id: productId,
          title: title?.substring(0, 40),
          hasImage: !!imageUrl,
          price: price,
          qty: quantity
        });
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

    // === DETECT EXPECTED CART COUNT ===
    let expectedCount = null;
    // Look for "Checkout (172)" or similar patterns
    const checkoutBtn = document.querySelector('button[class*="checkout"], button[class*="Checkout"], a[class*="checkout"]');
    if (checkoutBtn) {
      const match = checkoutBtn.textContent?.match(/\((\d+)\)/);
      if (match) {
        expectedCount = parseInt(match[1]);
        console.log(`[Judi\'s Wishlist Scraper] Expected cart count from checkout button: ${expectedCount}`);
      }
    }

    // Also try to find count in page text
    if (!expectedCount) {
      const pageText = document.body.textContent || '';
      const countMatches = pageText.match(/Checkout\s*\((\d+)\)/i);
      if (countMatches) {
        expectedCount = parseInt(countMatches[1]);
        console.log(`[Judi\'s Wishlist Scraper] Expected cart count from page text: ${expectedCount}`);
      }
    }

    // Store stats for reporting
    stats.expectedCount = expectedCount;
    stats.hasCountMismatch = expectedCount && stats.total !== expectedCount;

    console.log('[Judi\'s Wishlist Scraper] === TEMU RESULTS ===');
    console.log(`[Judi\'s Wishlist Scraper] Total items found: ${stats.total}`);
    if (expectedCount) {
      console.log(`[Judi\'s Wishlist Scraper] Expected count: ${expectedCount}`);
      if (stats.hasCountMismatch) {
        console.warn(`[Judi\'s Wishlist Scraper] WARNING: Count mismatch! Found ${stats.total}, expected ${expectedCount}`);
      } else {
        console.log(`[Judi\'s Wishlist Scraper] Count matches expected!`);
      }
    }
    console.log(`[Judi\'s Wishlist Scraper] With images: ${stats.withImage} (${Math.round(stats.withImage/stats.total*100)}%)`);
    console.log(`[Judi\'s Wishlist Scraper] With prices: ${stats.withPrice} (${Math.round(stats.withPrice/stats.total*100)}%)`);
    console.log(`[Judi\'s Wishlist Scraper] With titles: ${stats.withTitle} (${Math.round(stats.withTitle/stats.total*100)}%)`);

    // Attach stats to items array for reporting
    items._stats = stats;

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
