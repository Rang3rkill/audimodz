// Popup script for Judi's Wishlist Importer

const API_BASE = 'http://localhost:5000';

const SUPPORTED_STORES = {
  'temu.com': { name: 'Temu', key: 'temu' },
  'amazon.com': { name: 'Amazon', key: 'amazon' },
};

// DOM elements
const elements = {
  status: document.getElementById('status'),
  // Method selector
  methodScanBtn: document.getElementById('methodScanBtn'),
  methodShareBtn: document.getElementById('methodShareBtn'),
  // Scan section
  scanSection: document.getElementById('scanSection'),
  storeInfo: document.getElementById('storeInfo'),
  storeBadge: document.getElementById('storeBadge'),
  storeName: document.getElementById('storeName'),
  unsupportedMsg: document.getElementById('unsupportedMsg'),
  scanControls: document.getElementById('scanControls'),
  listSelect: document.getElementById('listSelect'),
  importBtn: document.getElementById('importBtn'),
  result: document.getElementById('result'),
  refreshImagesBtn: document.getElementById('refreshImagesBtn'),
  fixImagesBtn: document.getElementById('fixImagesBtn'),
  cancelFixBtn: document.getElementById('cancelFixBtn'),
  fixImagesStatus: document.getElementById('fixImagesStatus'),
  refreshResult: document.getElementById('refreshResult'),
  // Share link section
  shareSection: document.getElementById('shareSection'),
  shareLink: document.getElementById('shareLink'),
  sharePasteBtn: document.getElementById('sharePasteBtn'),
  shareListSelect: document.getElementById('shareListSelect'),
  shareImportBtn: document.getElementById('shareImportBtn'),
  shareResult: document.getElementById('shareResult'),
};

// Current state
let currentStore = null;
let currentTabId = null;
let currentMethod = 'scan'; // 'scan' or 'share'

// Initialize popup
async function init() {
  // Load lists first
  await loadLists();

  // Get current tab info
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTabId = tab.id;

    // Check if on a supported store
    const url = new URL(tab.url);
    const hostname = url.hostname.replace('www.', '');

    for (const [domain, store] of Object.entries(SUPPORTED_STORES)) {
      if (hostname.includes(domain)) {
        currentStore = store;
        break;
      }
    }
  } catch (error) {
    console.error('Error checking tab:', error);
  }

  // Show the scan section by default, update its state
  updateScanSection();
  hideStatus();
}

// Switch between methods
function switchMethod(method) {
  currentMethod = method;

  // Update button states
  elements.methodScanBtn.classList.toggle('active', method === 'scan');
  elements.methodShareBtn.classList.toggle('active', method === 'share');

  // Show/hide sections
  elements.scanSection.classList.toggle('hidden', method !== 'scan');
  elements.shareSection.classList.toggle('hidden', method !== 'share');

  // Hide any previous status
  hideStatus();
}

// Update scan section based on current tab
function updateScanSection() {
  if (currentStore) {
    // On a supported store - show controls
    elements.storeInfo.classList.remove('hidden');
    elements.storeBadge.textContent = currentStore.key.toUpperCase();
    elements.storeBadge.className = 'store-badge ' + currentStore.key;
    elements.storeName.textContent = currentStore.name + ' cart detected';
    elements.scanControls.classList.remove('hidden');
    elements.unsupportedMsg.classList.add('hidden');
    elements.refreshImagesBtn.classList.remove('hidden');
  } else {
    // Not on a supported store
    elements.storeInfo.classList.add('hidden');
    elements.scanControls.classList.add('hidden');
    elements.unsupportedMsg.classList.remove('hidden');
    elements.refreshImagesBtn.classList.add('hidden');
  }
}

// Load lists from the wishlist app
async function loadLists() {
  try {
    const response = await fetch(`${API_BASE}/api/lists`, {
      signal: AbortSignal.timeout(5000), // 5 second timeout
    });
    if (!response.ok) throw new Error('Could not connect to wishlist app');

    const lists = await response.json();

    // Escape HTML to prevent XSS from malicious list names
    function escapeHtml(str) {
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    }

    const optionsHtml = lists.map(list =>
      `<option value="${list.id}">${escapeHtml(list.name)}</option>`
    ).join('');

    elements.listSelect.innerHTML = optionsHtml;
    elements.shareListSelect.innerHTML = optionsHtml;

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


// Import cart items
async function importCart() {
  elements.importBtn.disabled = true;
  elements.importBtn.textContent = 'Scrolling to load all items...';
  elements.result.classList.add('hidden');

  try {
    console.log('[Judi\'s Wishlist Popup] Starting import for store:', currentStore.key);
    console.log('[Judi\'s Wishlist Popup] Tab ID:', currentTabId);

    // For Temu, use the multi-tab scraper that clicks through each filter
    elements.importBtn.textContent = 'Scanning cart tabs...';

    // Execute the multi-tab scraper
    const results = await chrome.scripting.executeScript({
      target: { tabId: currentTabId },
      func: currentStore.key === 'temu' ? scrapeTemuAllTabs : scrapeCartItems,
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

    // Send to wishlist app with retry logic
    const listId = parseInt(elements.listSelect.value) || 1;
    let response;
    let lastError;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        response = await fetch(`${API_BASE}/api/items/import`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            store: currentStore.key,
            items: items,
            list_id: listId,
          }),
          signal: AbortSignal.timeout(30000), // 30 second timeout
        });
        if (response.ok) {
          lastError = null;
          break;
        } else {
          lastError = new Error(`Server error: ${response.status}`);
        }
      } catch (e) {
        lastError = e;
        console.warn(`[Judi's Wishlist] Import attempt ${attempt} failed:`, e.message);
      }
      if (attempt < 3) {
        await new Promise(r => setTimeout(r, attempt * 2000));
        elements.importBtn.textContent = `Retrying (${attempt}/3)...`;
      }
    }

    if (lastError || !response?.ok) {
      throw new Error(lastError?.message || 'Failed to import items after 3 attempts');
    }

    let data;
    try {
      data = await response.json();
    } catch (e) {
      throw new Error('Invalid response from server')
    }
    const scrapeStats = items._stats || null;

    // Build result message
    let msg = `Imported ${data.imported} new`;
    if (data.updated > 0) {
      msg += `, ${data.updated} prices updated`;
      if (data.price_drops > 0) msg += ` (${data.price_drops} dropped!)`;
    }
    if (data.skipped > 0) {
      msg += `, ${data.skipped} unchanged`;
    }
    showResult(msg, true, data, scrapeStats);

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
    html += `<div class="result-stats">`;
    html += `<div class="result-stat imported"><span class="count">${data.imported}</span> new</div>`;

    if (data.updated > 0) {
      html += `<div class="result-stat updated"><span class="count">${data.updated}</span> updated</div>`;
    }

    if (data.price_drops > 0) {
      html += `<div class="result-stat price-drop"><span class="count">${data.price_drops}</span> price drops!</div>`;
    }

    html += `<div class="result-stat skipped"><span class="count">${data.skipped}</span> unchanged</div>`;
    html += `</div>`;
  }

  // Show scrape stats if available
  if (scrapeStats) {
    html += `<div class="scrape-stats">`;

    // Show tabs processed
    if (scrapeStats.tabsProcessed) {
      html += `<div class="stat-detail">Processed ${scrapeStats.tabsProcessed} tab(s)</div>`;
    }

    // Show count validation
    if (scrapeStats.expectedCount) {
      if (scrapeStats.hasCountMismatch) {
        const missing = scrapeStats.expectedCount - scrapeStats.total;
        html += `
          <div class="stat-warning">
            &#9888; Found ${scrapeStats.total} of ${scrapeStats.expectedCount} items (${missing} missing)
          </div>
        `;
        elements.result.classList.remove('success');
        elements.result.classList.add('warning');
      } else {
        html += `<div class="stat-ok">&#10003; All ${scrapeStats.total} cart items found</div>`;
      }
    } else {
      html += `<div class="stat-ok">&#10003; Found ${scrapeStats.total} items</div>`;
    }

    // Show which method was used
    const methodNames = {
      'api_capture': 'API capture (best)',
      'js_state': 'JS state',
      'script_tags': 'Script tags',
      'dom_scraping': 'DOM scraping (fallback)',
    };
    if (scrapeStats.method) {
      html += `<div class="stat-detail">Method: ${methodNames[scrapeStats.method] || scrapeStats.method}</div>`;
    }

    // Show data quality
    const imgPercent = scrapeStats.total > 0 ? Math.round((scrapeStats.withImage / scrapeStats.total) * 100) : 0;
    const pricePercent = scrapeStats.total > 0 ? Math.round((scrapeStats.withPrice / scrapeStats.total) * 100) : 0;

    html += `<div class="stat-detail">`;
    html += `Images: ${scrapeStats.withImage}/${scrapeStats.total} (${imgPercent}%) | `;
    html += `Prices: ${scrapeStats.withPrice}/${scrapeStats.total} (${pricePercent}%)`;
    html += `</div>`;

    const noPriceCount = scrapeStats.total - scrapeStats.withPrice;
    if (noPriceCount > 0) {
      html += `<div class="stat-warning">&#9888; ${noPriceCount} item(s) have no price — try refreshing the cart page and importing again</div>`;
      elements.result.classList.remove('success');
      elements.result.classList.add('warning');
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

    const scrollStep = 400; // Smaller steps for better loading
    const scrollDelay = 500; // Longer delay to let items render
    let lastHeight = 0;
    let sameHeightCount = 0;
    let scrollCount = 0;
    const maxScrolls = 200; // Higher limit for large carts
    let passes = 0;
    const maxPasses = 3; // Do multiple scroll passes

    function doScroll() {
      const currentHeight = document.documentElement.scrollHeight;
      const currentPosition = window.scrollY + window.innerHeight;

      // Check if we've reached the bottom
      if (currentPosition >= currentHeight - 50) {
        if (currentHeight === lastHeight) {
          sameHeightCount++;
          if (sameHeightCount >= 5) {
            passes++;
            console.log(`[Judi\'s Wishlist] Completed pass ${passes}/${maxPasses}`);

            if (passes < maxPasses) {
              // Go back to top and scroll again
              sameHeightCount = 0;
              window.scrollTo(0, 0);
              setTimeout(doScroll, 1000); // Wait 1 second before next pass
              return;
            } else {
              console.log('[Judi\'s Wishlist] All passes complete');
              window.scrollTo(0, 0);
              resolve();
              return;
            }
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

      // Log progress every 20 scrolls
      if (scrollCount % 20 === 0) {
        console.log(`[Judi\'s Wishlist] Scroll ${scrollCount}, position: ${Math.round(currentPosition)}/${currentHeight}`);
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

// Helper: pick the best sale/current price from a Temu data object.
// Temu stores `price` = original full price, `salePrice` = discounted price.
// We want the sale price (what the customer actually pays).
function pickBestPrice(obj) {
  // Flatten nested price containers (Temu cart API nests prices in price_info)
  const pi = obj.price_info || obj.priceInfo || {};
  const ps = pi.price_schema || pi.priceSchema || {};

  // Parse a price value - handles numbers, "$4.99", "4.99", cent integers,
  // and Temu's split arrays like ["$","4",".","9","9"]
  // Returns { value: number, hasDecimalInSource: boolean, rawString: string|null }
  function parsePrice(v) {
    if (v == null) return { value: NaN, hasDecimalInSource: false, rawString: null };
    if (typeof v === 'number') {
      return { value: v, hasDecimalInSource: v % 1 !== 0, rawString: null };
    }
    if (Array.isArray(v)) {
      const joined = v.map(x => (typeof x === 'object' && x?.text) ? x.text : String(x ?? '')).join('');
      if (!joined) return { value: NaN, hasDecimalInSource: false, rawString: null };
      return { value: parseFloat(joined.replace(/[^0-9.]/g, '')), hasDecimalInSource: joined.includes('.'), rawString: joined };
    }
    if (typeof v === 'string') {
      return { value: parseFloat(v.replace(/[^0-9.]/g, '')), hasDecimalInSource: v.includes('.'), rawString: v };
    }
    return { value: NaN, hasDecimalInSource: false, rawString: null };
  }

  // Smart cent normalization - handles more edge cases than simple threshold
  // Strategy: Use context clues to determine if a value is in cents or dollars
  function normalizeCents(val, hasDecimal, rawString, contextPrices) {
    if (val === null || isNaN(val)) return null;
    // If source had decimal like "$4.99", it's definitely already in dollars
    if (hasDecimal) return val;
    // If source string had $ and digits like "$299", it's dollars not cents
    if (rawString && rawString.includes('$') && /\$\s*\d/.test(rawString)) return val;
    // If value is a float (not integer), it's already in dollars
    if (!Number.isInteger(val)) return val;
    // For integers: use smart heuristics
    // If we have context prices (other prices from same object) that are clearly
    // in dollars (have decimals), and this integer is 100x larger, it's likely cents
    if (contextPrices && contextPrices.length > 0) {
      const dollarPrices = contextPrices.filter(p => p.hasDecimal && p.value > 0 && p.value < 1000);
      if (dollarPrices.length > 0) {
        const avgDollar = dollarPrices.reduce((a, b) => a + b.value, 0) / dollarPrices.length;
        // If this integer is roughly 100x a known dollar price, it's cents
        if (val > avgDollar * 50 && val < avgDollar * 200) {
          return val / 100;
        }
      }
    }
    // Fallback heuristic: integers >= 100 that look like cent values
    // Pattern: 3-5 digit integers where dividing by 100 gives reasonable price
    if (val >= 100 && val <= 999999) {
      const asDollars = val / 100;
      // If dividing by 100 gives a "normal" price range ($1-$9999), likely cents
      // But avoid false positives: $150 item shouldn't become $1.50
      // Key insight: cent values rarely end in 00 (e.g., 15000 for $150.00 is rare)
      // Dollar values often are round numbers ($150, $200)
      const lastTwoDigits = val % 100;
      if (lastTwoDigits !== 0 && asDollars >= 0.50 && asDollars <= 9999) {
        return asDollars;
      }
      // For values ending in 00, only treat as cents if very high (>= 10000 = $100+)
      if (lastTwoDigits === 0 && val >= 10000) {
        return asDollars;
      }
    }
    return val;
  }

  // Collect all parsed prices for context
  const allParsed = [];

  // Explicit cent fields - always divide by 100 (field name indicates cents)
  const centFields = [
    obj.salePriceCent, obj.sale_price_cent,
    obj.priceCent, obj.price_cent,
    pi.priceCent, pi.price_cent,
    pi.salePriceCent, pi.sale_price_cent,
    ps.priceCent, ps.price_cent,
  ];
  for (const v of centFields) {
    if (v != null && typeof v === 'number' && v > 0) {
      const best = v / 100;
      if (best >= 0.01 && best <= 99999) {
        // Also try to find original price in cent form
        const origCentFields = [obj.marketPriceCent, obj.market_price_cent, pi.marketPriceCent, pi.market_price_cent];
        let origPrice = null;
        for (const ov of origCentFields) {
          if (ov != null && typeof ov === 'number' && ov > 0) {
            const op = ov / 100;
            if (op > best && op <= 99999) {
              origPrice = op;
              break;
            }
          }
        }
        return { salePrice: best, originalPrice: origPrice };
      }
    }
  }

  // Sale/discount price candidates (prioritize explicit sale fields)
  // Order matters: most specific sale fields first, generic 'price' last
  const saleCandidates = [
    // Explicit sale/promo prices (highest priority)
    pi.sale_price, pi.salePrice,
    obj.sale_price, obj.salePrice,
    ps.sale_price, ps.salePrice,
    pi.promo_price, pi.promoPrice,
    obj.promo_price, obj.promoPrice,
    ps.promo_price, ps.promoPrice,
    pi.discount_price, pi.discountPrice,
    obj.discount_price, obj.discountPrice,
    ps.discount_price, ps.discountPrice,
    obj.current_price, obj.currentPrice,
    pi.current_price, pi.currentPrice,
    // String representations (usually already formatted as dollars)
    pi.price_str, pi.priceStr, pi.price_text,
    pi.split_price_text,
    // Generic price fields (lower priority - could be original price)
    pi.price, obj.price, ps.price,
  ];

  // Original/market price candidates
  const originalCandidates = [
    pi.market_price, pi.marketPrice, pi.market_price_str,
    pi.original_price, pi.originalPrice,
    obj.market_price, obj.marketPrice,
    obj.original_price, obj.originalPrice,
    ps.market_price, ps.marketPrice,
    ps.original_price, ps.originalPrice,
  ];

  // First pass: collect all parsed values for context
  for (const v of [...saleCandidates, ...originalCandidates]) {
    const parsed = parsePrice(v);
    if (!isNaN(parsed.value) && parsed.value > 0) {
      allParsed.push(parsed);
    }
  }

  // Find best sale price
  let best = null;
  let bestHasDecimal = false;
  let bestRawString = null;
  for (const v of saleCandidates) {
    const { value: n, hasDecimalInSource, rawString } = parsePrice(v);
    if (!isNaN(n) && n > 0) {
      best = n;
      bestHasDecimal = hasDecimalInSource;
      bestRawString = rawString;
      break;
    }
  }

  // Find original price
  let original = null;
  let origHasDecimal = false;
  let origRawString = null;
  for (const v of originalCandidates) {
    const { value: n, hasDecimalInSource, rawString } = parsePrice(v);
    if (!isNaN(n) && n > 0) {
      original = n;
      origHasDecimal = hasDecimalInSource;
      origRawString = rawString;
      break;
    }
  }

  // Normalize cents using smart logic with context
  best = normalizeCents(best, bestHasDecimal, bestRawString, allParsed);
  original = normalizeCents(original, origHasDecimal, origRawString, allParsed);

  // Validate range
  if (best !== null && (best < 0.01 || best > 99999)) best = null;
  if (original !== null && (original < 0.01 || original > 99999)) original = null;

  // Don't return original if it equals or is less than sale price
  if (original !== null && best !== null && original <= best) {
    original = null;
  }

  return { salePrice: best, originalPrice: original };
}

// Multi-tab scraper for Temu - clicks through each filter tab and collects all items
// This runs in the context of the page
async function scrapeTemuAllTabs() {
  const allItems = new Map(); // Use Map to deduplicate by product_id
  const stats = { total: 0, withImage: 0, withPrice: 0, withTitle: 0, tabsProcessed: 0 };

  console.log('[Judi\'s Wishlist] === MULTI-TAB SCRAPER ===');

  // === METHOD 0: Use captured cart API data from network interceptor ===
  // The interceptor.js content script patches fetch/XHR on page load and
  // captures any response containing cart item data. This is the most
  // reliable method because it's the EXACT data Temu's own UI renders.
  // The data was already captured when the page loaded — we just retrieve it.
  console.log('[Judi\'s Wishlist] METHOD 0: Checking captured API data...');
  // NOTE: This code runs in the PAGE context (executeScript), so we can't
  // call chrome.runtime directly. Instead, check if the interceptor left
  // data on window for us.
  try {
    // The interceptor stores captured data on the page via a custom event
    // that the bridge picks up. But from page context we can also check
    // if there's data stashed. Let's try reading it via a DOM approach:
    // We dispatch a request event and listen for the response.
    const capturedData = await new Promise((resolve) => {
      const handler = (event) => {
        if (event.data?.type === '__JWL_CART_DATA_RESPONSE__') {
          window.removeEventListener('message', handler);
          resolve(event.data.entries || []);
        }
      };
      window.addEventListener('message', handler);
      window.postMessage({ type: '__JWL_CART_DATA_REQUEST__' }, '*');
      // Timeout after 500ms
      setTimeout(() => {
        window.removeEventListener('message', handler);
        resolve([]);
      }, 500);
    });

    for (const entry of capturedData) {
      const apiJson = entry.data;
      if (!apiJson || typeof apiJson !== 'object') continue;
      console.log(`[Judi's Wishlist] Processing captured data from: ${entry.endpoint}`);

      // Navigate Temu's response structure to find cart items array
      // Recursively search for arrays containing goods_id objects
      function findItemArrays(obj, depth) {
        if (!obj || typeof obj !== 'object' || depth > 6) return [];
        const results = [];
        if (Array.isArray(obj)) {
          if (obj.length > 0 && obj.some(i => i?.goods_id || i?.goodsId || i?.product_id)) {
            results.push(obj);
          }
        } else {
          for (const val of Object.values(obj)) {
            results.push(...findItemArrays(val, depth + 1));
          }
        }
        return results;
      }

      const itemArrays = findItemArrays(apiJson, 0);
      // Use the largest array (most items = the cart list, not a sub-component)
      const allFoundItems = itemArrays.sort((a, b) => b.length - a.length);

      for (const itemArray of allFoundItems) {
        for (const item of itemArray) {
          const productId = String(item.goods_id || item.goodsId || item.product_id || item.subjectId || '');
          if (!productId || allItems.has(productId)) continue;

          // Prefer long_thumb_url (product photo) over thumb_url (may be sale banner).
          // item.image is an object on the cart API, so filter to strings only.
          const imageCandidates = [item.long_thumb_url, item.thumb_url, item.thumbUrl, item.goods_img, item.hdThumbUrl];
          const image = imageCandidates.find(v => typeof v === 'string' && v.startsWith('http')) || null;
          const { salePrice, originalPrice } = pickBestPrice(item);

          // Build product URL, prefer seo_link_url if available
          let productUrl = item.seo_link_url
            ? `https://www.temu.com${item.seo_link_url}`
            : `https://www.temu.com/goods.html?goods_id=${productId}`;
          if (image) productUrl += (productUrl.includes('?') ? '&' : '?') + 'thumb_url=' + encodeURIComponent(image);

          // Quantity: check skc_list[0].quantity, then direct fields
          let qty = 1;
          const skcList = item.skc_list || item.skcList;
          if (Array.isArray(skcList) && skcList.length > 0) {
            qty = parseInt(skcList[0].quantity || skcList[0].qty) || 1;
          }
          if (qty <= 1) {
            qty = Math.max(1, parseInt(item.quantity || item.qty || item.selectedQuantity) || 1);
          }

          allItems.set(productId, {
            product_id: productId,
            product_url: productUrl,
            title: item.goods_name || item.goodsName || item.title || item.page_alt || item.name || 'Unknown',
            image_url: image,
            price: salePrice,
            original_price: originalPrice,
            quantity: qty,
          });
        }
      }

      if (allItems.size > 0) {
        console.log(`[Judi's Wishlist] SUCCESS: Got ${allItems.size} items from captured API data`);
        const finalItems = Array.from(allItems.values());
        stats.total = finalItems.length;
        stats.withImage = finalItems.filter(i => i.image_url).length;
        stats.withPrice = finalItems.filter(i => i.price).length;
        stats.method = 'api_capture';
        finalItems._stats = stats;
        return finalItems;
      }
    }
    console.log('[Judi\'s Wishlist] No captured API data available (page may need refresh)');
  } catch (e) {
    console.log('[Judi\'s Wishlist] METHOD 0 failed:', e.message);
  }

  // === METHOD 1: Try to find cart data in JavaScript/JSON ===
  console.log('[Judi\'s Wishlist] METHOD 1: Checking page JavaScript state...');

  // Look for cart data in common locations
  const dataLocations = [
    () => window.__INITIAL_STATE__?.cart?.items,
    () => window.__INITIAL_STATE__?.cartData?.items,
    () => window.__NEXT_DATA__?.props?.pageProps?.cart?.items,
    () => window.__NUXT__?.state?.cart?.items,
    () => window.cartData?.items,
    () => window.pageData?.cart?.items,
  ];

  for (const getter of dataLocations) {
    try {
      const items = getter();
      if (items && Array.isArray(items) && items.length > 0) {
        console.log(`[Judi\'s Wishlist] Found ${items.length} items in JavaScript data!`);
        items.forEach(item => {
          const productId = item.goods_id || item.goodsId || item.product_id || item.subject_id || item.id;
          if (!productId || allItems.has(String(productId))) return;

          // Build URL - use goods_id format for consistency
          let productUrl = item.product_url || item.url || '';
          if (!productUrl || !productUrl.includes('temu.com')) {
            productUrl = `https://www.temu.com/goods.html?goods_id=${productId}`;
          }

          const { salePrice, originalPrice } = pickBestPrice(item);

          // Filter to string URLs only (item.image can be an object on Temu's API)
          const imgCandidates = [item.long_thumb_url, item.thumb_url, item.thumbUrl, item.goods_img, item.hdThumbUrl];
          const itemImage = imgCandidates.find(v => typeof v === 'string' && v.startsWith('http')) || null;
          // Embed thumb_url in product URL for server-side image recovery
          let finalUrl = productUrl;
          if (itemImage && !finalUrl.includes('thumb_url=')) {
            finalUrl += (finalUrl.includes('?') ? '&' : '?') + 'thumb_url=' + encodeURIComponent(itemImage);
          }

          allItems.set(String(productId), {
            product_id: String(productId),
            product_url: finalUrl,
            title: item.goods_name || item.goodsName || item.title || item.name || 'Unknown',
            image_url: itemImage,
            price: salePrice,
            original_price: originalPrice,
            quantity: Math.max(1, parseInt(item.quantity || item.qty) || 1),
          });
        });

        if (allItems.size > 0) {
          console.log(`[Judi\'s Wishlist] Successfully extracted ${allItems.size} items from JS data`);
          const finalItems = Array.from(allItems.values());
          stats.total = finalItems.length;
          stats.withImage = finalItems.filter(i => i.image_url).length;
          stats.withPrice = finalItems.filter(i => i.price).length;
          stats.method = 'js_state';
          finalItems._stats = stats;
          return finalItems;
        }
      }
    } catch (e) { /* continue */ }
  }

  // === METHOD 2: Look for JSON in script tags ===
  console.log('[Judi\'s Wishlist] Checking script tags for cart data...');
  const scripts = document.querySelectorAll('script:not([src])');
  for (const script of scripts) {
    const text = script.textContent || '';
    // Look for cart-like JSON structures
    const cartPatterns = [
      /"goods_id"\s*:\s*"?(\d+)"?/g,
      /"goodsId"\s*:\s*"?(\d+)"?/g,
      /"product_id"\s*:\s*"?(\d+)"?/g,
      /"subject_id"\s*:\s*"?(\d+)"?/g,
    ];

    for (const pattern of cartPatterns) {
      const matches = text.matchAll(pattern);
      for (const match of matches) {
        const goodsId = match[1];
        if (!allItems.has(goodsId)) {
          // Try to extract more data around this goods_id
          const contextStart = Math.max(0, match.index - 500);
          const contextEnd = Math.min(text.length, match.index + 1000);
          const context = text.slice(contextStart, contextEnd);

          // Extract data from context
          const titleMatch = context.match(/"(?:goods_name|title|name)"\s*:\s*"([^"]+)"/);
          // Prefer thumb_url/long_thumb_url over generic "image" (which may be sale banners)
          const imgMatch = context.match(/"(?:long_thumb_url|thumb_url|goods_img|hdThumbUrl)"\s*:\s*"(https?:[^"]+)"/);
          const priceMatch = context.match(/"(?:price|sale_price|salePrice)"\s*:\s*(\d+\.?\d*)/);

          if (titleMatch || imgMatch) {
            let scriptImage = imgMatch ? imgMatch[1].replace(/\\/g, '') : null;
            // Reject obvious sale/promo banner images
            if (scriptImage && (/\/sale|sale_banner|flash_sale|\/banner|\/promo|upload_aimg|\/aimg\//i.test(scriptImage))) {
              scriptImage = null;
            }
            let scriptUrl = `https://www.temu.com/goods.html?goods_id=${goodsId}`;
            if (scriptImage) {
              scriptUrl += '&thumb_url=' + encodeURIComponent(scriptImage);
            }
            // Normalize price - Temu JS often stores cents (e.g. 1299 = $12.99)
            // Use smart heuristics: non-00 ending integers are likely cents
            let scriptPrice = priceMatch ? parseFloat(priceMatch[1]) : null;
            if (scriptPrice && Number.isInteger(scriptPrice) && scriptPrice >= 100) {
              const lastTwoDigits = scriptPrice % 100;
              // Non-zero ending (like 1299, 499) = definitely cents
              // Zero ending but high value (>=10000) = likely cents ($100+)
              if (lastTwoDigits !== 0 || scriptPrice >= 10000) {
                scriptPrice = scriptPrice / 100;
              }
            }
            // Validate price range
            if (scriptPrice && (scriptPrice < 0.01 || scriptPrice > 99999)) {
              scriptPrice = null;
            }
            allItems.set(goodsId, {
              product_id: goodsId,
              product_url: scriptUrl,
              title: titleMatch ? titleMatch[1] : 'Unknown Product',
              image_url: scriptImage,
              price: scriptPrice,
              quantity: 1,
            });
          }
        }
      }
    }
  }

  // Return script tag results if we found items with meaningful data (title or image)
  const scriptItemsWithData = Array.from(allItems.values()).filter(i => i.title !== 'Unknown Product' || i.image_url);
  if (scriptItemsWithData.length > 0) {
    console.log(`[Judi\'s Wishlist] Found ${allItems.size} items from script tags (${scriptItemsWithData.length} with data)`);
    const finalItems = Array.from(allItems.values());
    stats.total = finalItems.length;
    stats.withImage = finalItems.filter(i => i.image_url).length;
    stats.withPrice = finalItems.filter(i => i.price).length;
    stats.method = 'script_tags';
    finalItems._stats = stats;
    return finalItems;
  }

  // === METHOD 3: Fall back to DOM scraping ===
  console.log('[Judi\'s Wishlist] Falling back to DOM scraping...');
  allItems.clear(); // Reset for DOM scraping

  // Helper function to scroll through current view
  async function scrollCurrentTab() {
    return new Promise((resolve) => {
      const scrollStep = 500;
      const scrollDelay = 350;
      let scrollCount = 0;
      const maxScrolls = 300; // Increased for 500+ item carts
      let lastHeight = 0;
      let sameCount = 0;

      function doScroll() {
        const currentHeight = document.documentElement.scrollHeight;
        const currentPosition = window.scrollY + window.innerHeight;

        if (currentPosition >= currentHeight - 50) {
          if (currentHeight === lastHeight) {
            sameCount++;
            if (sameCount >= 5) { // Wait longer before giving up
              window.scrollTo(0, 0);
              resolve();
              return;
            }
          } else {
            sameCount = 0;
          }
        }

        lastHeight = currentHeight;
        scrollCount++;

        if (scrollCount >= maxScrolls) {
          window.scrollTo(0, 0);
          resolve();
          return;
        }

        window.scrollBy(0, scrollStep);
        setTimeout(doScroll, scrollDelay);
      }

      doScroll();
    });
  }

  // Helper function to scrape items from current view
  function scrapeCurrentItems() {
    const items = [];
    // Find links using multiple selectors to catch both browser and app-added items
    const linkSelectors = [
      'a[href*="goods_id="]',
      'a[href*="_p_"]',
      'a[href*="/product/"]',
      'a[href*="subject_id="]',
      'a[href*="share.temu.com"]',
    ];
    const linkSet = new Set();
    for (const sel of linkSelectors) {
      document.querySelectorAll(sel).forEach(l => linkSet.add(l));
    }
    const productLinks = Array.from(linkSet);

    productLinks.forEach(link => {
      // Try multiple ID extraction patterns
      let match = link.href.match(/goods_id=(\d+)/);
      if (!match) match = link.href.match(/_p_(\d+)\.html/);
      if (!match) match = link.href.match(/\/product\/(\d+)/);
      if (!match) match = link.href.match(/subject_id=(\d+)/);
      if (!match) return;

      const productId = match[1];
      if (allItems.has(productId)) return; // Already have this item

      // Find container - walk up to find the cart item wrapper
      let container = link;
      for (let i = 0; i < 20 && container; i++) {
        container = container.parentElement;
        if (!container) break;
        // Look for a container that has both image and price elements
        const hasImg = container.querySelector('img');
        const hasPrice = container.textContent?.includes('$');
        if (hasImg && hasPrice) break;
      }
      container = container || link.parentElement?.parentElement?.parentElement?.parentElement;

      // Get title
      let title = link.textContent?.trim();
      if (!title || title.length < 5) {
        const img = container?.querySelector('img');
        title = img?.alt || 'Unknown Product';
      }

      // Get image - try multiple approaches, filtering out sale/promo banners
      let imageUrl = null;
      const BAD_IMG_RE = /\/sale|sale_banner|flash_sale|\/banner|\/promo|upload_aimg|\/aimg\/|icon|logo/i;

      function isProductImage(img) {
        const src = img.src || img.dataset?.src || img.getAttribute('data-src') || '';
        if (!src.startsWith('http') || BAD_IMG_RE.test(src)) return false;
        // Skip images that are too small or banner-shaped (wide aspect ratio)
        const rect = img.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && rect.width / rect.height > 2.5) return false;
        if (rect.width < 40 || rect.height < 40) return false;
        return src;
      }

      // Method 1: Direct img with known CDN (product images)
      const cdnImgs = container?.querySelectorAll('img[src*="kwcdn"], img[src*="akamaized"], img[data-src*="kwcdn"]') || [];
      for (const img of cdnImgs) {
        const src = isProductImage(img);
        if (src) { imageUrl = src; break; }
      }
      // Method 2: Any img with src
      if (!imageUrl) {
        const anyImgs = container?.querySelectorAll('img[src^="http"]') || [];
        for (const img of anyImgs) {
          const src = isProductImage(img);
          if (src) { imageUrl = src; break; }
        }
      }

      // Get price — careful to avoid strikethrough prices and shipping costs.
      // Strategy: find ALL price elements, classify each, pick the best.
      let price = null;
      let originalPrice = null;

      if (container) {
        // Collect all price elements and their context
        const priceEls = container.querySelectorAll(
          '[class*="price"], [class*="Price"], [class*="cost"], [class*="Cost"], [data-testid*="price"]'
        );
        const salePrices = [];
        const strikePrices = [];
        const otherPrices = [];

        for (const el of priceEls) {
          const priceMatch = el.textContent?.match(/\$\s*([\d,]+\.?\d*)/);
          if (!priceMatch) continue;
          const val = parseFloat(priceMatch[1].replace(/,/g, ''));
          if (isNaN(val) || val < 0.01 || val > 99999) continue;

          const classes = (el.className || '').toLowerCase();
          const parentClasses = (el.parentElement?.className || '').toLowerCase();
          const style = el.style || {};
          const computedStyle = window.getComputedStyle?.(el) || {};

          // Detect strikethrough/original prices
          const isStrike = (
            computedStyle.textDecoration?.includes('line-through') ||
            style.textDecoration?.includes('line-through') ||
            classes.includes('origin') || classes.includes('original') ||
            classes.includes('strike') || classes.includes('delete') ||
            classes.includes('old') || classes.includes('was') ||
            parentClasses.includes('origin') || parentClasses.includes('original') ||
            el.closest('del, s, strike') !== null
          );

          // Detect shipping prices
          const isShipping = (
            classes.includes('shipping') || classes.includes('delivery') ||
            parentClasses.includes('shipping') || parentClasses.includes('delivery') ||
            el.closest('[class*="shipping"], [class*="delivery"]') !== null
          );

          if (isShipping) continue; // Skip shipping prices entirely

          if (isStrike) {
            strikePrices.push(val);
          } else if (classes.includes('sale') || classes.includes('promo') ||
                     classes.includes('discount') || classes.includes('current')) {
            salePrices.push(val);
          } else {
            otherPrices.push(val);
          }
        }

        // Pick price: sale > other > strike (last resort)
        if (salePrices.length > 0) {
          price = Math.min(...salePrices);
        } else if (otherPrices.length > 0) {
          // If there are strikethrough prices too, the non-strike price is the sale price
          price = Math.min(...otherPrices);
        }
        // Original price is the strikethrough or the highest price
        if (strikePrices.length > 0) {
          originalPrice = Math.max(...strikePrices);
        }

        // Fallback: parse all $ values from container text
        if (!price) {
          const allPriceMatches = container.textContent?.match(/\$\s*([\d,]+\.?\d*)/g) || [];
          const parsed = allPriceMatches
            .map(p => parseFloat(p.replace(/[\$\s,]/g, '')))
            .filter(p => !isNaN(p) && p > 0.01 && p < 99999);
          // Deduplicate prices (same value appearing multiple times)
          const uniquePrices = [...new Set(parsed)].sort((a, b) => a - b);
          if (uniquePrices.length === 1) {
            price = uniquePrices[0]; // Only one price visible = it's the price
          } else if (uniquePrices.length === 2) {
            // Two prices: lower is sale, higher is original
            // But sanity check: if lower price is suspiciously low (< $1)
            // compared to higher (e.g., $0.99 shipping vs $15 item), skip the low one
            const [low, high] = uniquePrices;
            if (low < 1 && high > 5) {
              // Low price is likely shipping, use high as product price
              price = high;
            } else {
              price = low;
              originalPrice = high;
            }
          } else if (uniquePrices.length > 2) {
            // Multiple prices - try to find the most likely product price
            // Filter out very low prices (likely shipping) and take the lowest remaining
            const nonShipping = uniquePrices.filter(p => p >= 1);
            if (nonShipping.length >= 1) {
              price = nonShipping[0]; // Lowest non-shipping price
              if (nonShipping.length >= 2) {
                originalPrice = nonShipping[nonShipping.length - 1]; // Highest
              }
            } else {
              price = uniquePrices[0]; // Fallback to lowest if all < $1
            }
          }
        }

        // Last resort: "LAST DAY $X.XX" pattern
        if (!price) {
          const saleMatch = container.textContent?.match(/LAST DAY\s*\$(\d+\.?\d*)/i);
          if (saleMatch) price = parseFloat(saleMatch[1]);
        }
      }

      // Get quantity (validate it's reasonable)
      let quantity = 1;
      const qtyEl = container?.querySelector('input[type="text"], input[value], input[type="number"]');
      if (qtyEl) {
        const parsedQty = parseInt(qtyEl.value);
        if (!isNaN(parsedQty) && parsedQty > 0 && parsedQty < 1000) {
          quantity = parsedQty;
        }
      }

      // Embed thumb_url in product URL for server-side image recovery
      let domProductUrl = `https://www.temu.com/goods.html?goods_id=${productId}`;
      if (imageUrl) {
        domProductUrl += '&thumb_url=' + encodeURIComponent(imageUrl);
      }

      // Final validation of price/originalPrice bounds
      if (price !== null && (isNaN(price) || price < 0.01 || price > 99999)) {
        price = null;
      }
      if (originalPrice !== null && (isNaN(originalPrice) || originalPrice < 0.01 || originalPrice > 99999)) {
        originalPrice = null;
      }

      items.push({
        product_id: productId,
        product_url: domProductUrl,
        title: title,
        image_url: imageUrl,
        price: price,
        original_price: originalPrice && originalPrice > (price || 0) ? originalPrice : undefined,
        quantity: quantity,
      });
    });

    return items;
  }

  // Find filter tabs - try multiple approaches
  let tabs = [];

  // Approach 1: Find ANY element with text like "All (539)" or "Local warehouse (440)"
  const allElements = document.querySelectorAll('*');
  const tabPattern = /^(All|Local warehouse|Ships from Temu|Standard shipping|Temu shipping)\s*\(\d+\)$/i;

  for (const el of allElements) {
    // Check direct text content (not including children)
    const directText = Array.from(el.childNodes)
      .filter(n => n.nodeType === Node.TEXT_NODE)
      .map(n => n.textContent.trim())
      .join('');

    // Also check full text for simpler elements
    const fullText = el.textContent?.trim() || '';

    if ((tabPattern.test(directText) || tabPattern.test(fullText)) &&
        el.tagName !== 'SCRIPT' && el.tagName !== 'STYLE') {
      // Make sure it's clickable (has reasonable size and is visible)
      const rect = el.getBoundingClientRect();
      if (rect.width > 20 && rect.height > 10 && rect.top < window.innerHeight) {
        // Avoid duplicates (parent/child with same text)
        const isDuplicate = tabs.some(t =>
          t.textContent?.trim() === el.textContent?.trim() ||
          t.contains(el) ||
          el.contains(t)
        );
        if (!isDuplicate) {
          tabs.push(el);
          console.log(`[Judi\'s Wishlist] Found tab: "${el.textContent?.trim()}" (${el.tagName})`);
        }
      }
    }
  }

  // Approach 2: Fallback to class-based selectors if nothing found
  if (tabs.length === 0) {
    const tabSelectors = [
      'button[class*="tab"]',
      'div[class*="tab"]',
      'span[class*="tab"]',
      '[role="tab"]',
      '[class*="Tab"]',
      '[class*="filter"]',
      '[class*="Filter"]',
    ];

    for (const sel of tabSelectors) {
      try {
        const found = document.querySelectorAll(sel);
        const validTabs = Array.from(found).filter(el => {
          const text = el.textContent || '';
          return text.match(/\(\d+\)/);
        });
        if (validTabs.length > tabs.length) {
          tabs = validTabs;
        }
      } catch (e) { /* ignore */ }
    }
  }

  console.log(`[Judi\'s Wishlist] Found ${tabs.length} filter tabs`);

  if (tabs.length === 0) {
    // No tabs found - do MULTIPLE scroll passes to catch all lazy-loaded items
    console.log('[Judi\'s Wishlist] No filter tabs found, doing multiple scroll passes...');

    let lastCount = 0;
    let passCount = 0;
    const maxPasses = 5;

    while (passCount < maxPasses) {
      passCount++;
      console.log(`[Judi\'s Wishlist] Scroll pass ${passCount}/${maxPasses}...`);

      await scrollCurrentTab();
      await new Promise(r => setTimeout(r, 1000)); // Wait for items to render

      const items = scrapeCurrentItems();
      const newCount = allItems.size + items.filter(i => !allItems.has(i.product_id)).length;

      items.forEach(item => {
        if (!allItems.has(item.product_id)) {
          allItems.set(item.product_id, item);
          if (item.image_url) stats.withImage++;
          if (item.price) stats.withPrice++;
          if (item.title && item.title.length >= 5) stats.withTitle++;
        }
      });

      console.log(`[Judi\'s Wishlist] Pass ${passCount}: Found ${allItems.size} total items`);

      // If we didn't find any new items, we're done
      if (allItems.size === lastCount) {
        console.log('[Judi\'s Wishlist] No new items found, stopping');
        break;
      }
      lastCount = allItems.size;
    }
  } else {
    // Only scrape the All tab — it has everything. Other tabs are duplicates.
    const allTab = tabs.find(t => t.textContent?.includes('All'));
    const tabsToProcess = allTab ? [allTab] : [tabs[0]];

    for (let i = 0; i < tabsToProcess.length; i++) {
      const tab = tabsToProcess[i];
      const tabName = tab.textContent?.trim() || `Tab ${i + 1}`;
      console.log(`[Judi\'s Wishlist] Processing tab: ${tabName}`);

      // Click the tab - try multiple approaches
      // First scroll the tab into view
      tab.scrollIntoView({ behavior: 'instant', block: 'center' });
      await new Promise(r => setTimeout(r, 300));

      // Try clicking the tab itself, or find a clickable child
      const clickTarget = tab.querySelector('a, button, span') || tab;
      clickTarget.click();

      // Also try dispatching a proper click event
      const clickEvent = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: window
      });
      tab.dispatchEvent(clickEvent);

      // Wait longer for content to load after tab click
      await new Promise(r => setTimeout(r, 2500));

      // Scroll to top first
      window.scrollTo(0, 0);
      await new Promise(r => setTimeout(r, 500));

      // Scroll through this tab's items
      await scrollCurrentTab();

      // Wait a bit more for items to render
      await new Promise(r => setTimeout(r, 1000));

      // Scrape items
      const items = scrapeCurrentItems();
      console.log(`[Judi\'s Wishlist] Found ${items.length} items in "${tabName}"`);

      items.forEach(item => {
        if (!allItems.has(item.product_id)) {
          allItems.set(item.product_id, item);
          if (item.image_url) stats.withImage++;
          if (item.price) stats.withPrice++;
          if (item.title && item.title.length >= 5) stats.withTitle++;
        }
      });

      stats.tabsProcessed++;
    }
  }

  // Convert map to array
  const finalItems = Array.from(allItems.values());
  stats.total = finalItems.length;

  // Try to get expected count
  const pageText = document.body.textContent || '';
  const countMatch = pageText.match(/All\s*\((\d+)\)/i);
  stats.expectedCount = countMatch ? parseInt(countMatch[1]) : null;
  stats.hasCountMismatch = stats.expectedCount && stats.total !== stats.expectedCount;

  console.log('[Judi\'s Wishlist] === MULTI-TAB RESULTS ===');
  console.log(`[Judi\'s Wishlist] Tabs processed: ${stats.tabsProcessed}`);
  console.log(`[Judi\'s Wishlist] Total unique items: ${stats.total}`);
  console.log(`[Judi\'s Wishlist] Expected: ${stats.expectedCount || 'unknown'}`);
  console.log(`[Judi\'s Wishlist] With images: ${stats.withImage} (${Math.round(stats.withImage/stats.total*100)}%)`);
  console.log(`[Judi\'s Wishlist] With prices: ${stats.withPrice} (${Math.round(stats.withPrice/stats.total*100)}%)`);

  // Attach stats
  stats.method = 'dom_scraping';
  finalItems._stats = stats;

  return finalItems;
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

      // Embed thumb_url in product URL for server-side image recovery
      let shareProductUrl = `https://www.temu.com/goods.html?goods_id=${productId}`;
      if (imageUrl) {
        shareProductUrl += '&thumb_url=' + encodeURIComponent(imageUrl);
      }

      items.push({
        product_id: productId,
        product_url: shareProductUrl,
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
    let stats = { total: 0, withImage: 0, withPrice: 0, withTitle: 0 };

    cartItems.forEach(item => {
      const asin = item.dataset.asin;
      // ASIN can be 10 chars (B0xxxxxxxxx) or other formats - just check it exists and is alphanumeric
      if (!asin || asin.length < 5 || !/^[A-Z0-9]+$/i.test(asin) || seen.has(asin)) return;
      seen.add(asin);
      stats.total++;

      // Get title
      const titleEl = item.querySelector('.sc-product-title, .a-truncate-cut, a[href*="/dp/"]');
      let title = titleEl?.textContent?.trim() || 'Unknown Product';
      if (title && title.length > 5) stats.withTitle++;

      // Get image
      const img = item.querySelector('.sc-product-image img, img[src*="images-amazon"]');
      const imageUrl = img?.src || null;
      if (imageUrl) stats.withImage++;

      // Get price
      let price = null;
      const priceEl = item.querySelector('.sc-product-price, .sc-price, .a-price .a-offscreen');
      if (priceEl) {
        const priceText = priceEl.textContent?.replace(/[^0-9.]/g, '');
        const parsed = parseFloat(priceText);
        // Validate price is reasonable (not negative, not absurdly high)
        if (!isNaN(parsed) && parsed > 0 && parsed < 100000) {
          price = parsed;
          stats.withPrice++;
        }
      }

      // Get quantity
      let quantity = 1;
      const qtyEl = item.querySelector('.sc-quantity-textfield, select[name*="quantity"], input[name*="quantity"]');
      if (qtyEl) {
        const parsedQty = parseInt(qtyEl.value);
        // Validate quantity is reasonable
        if (!isNaN(parsedQty) && parsedQty > 0 && parsedQty < 1000) {
          quantity = parsedQty;
        }
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

    // Attach stats for consistent reporting
    stats.method = 'dom_scraping';
    items._stats = stats;
  }

  return items;
}

// Validate a Temu share link
function isValidShareLink(url) {
  try {
    const parsed = new URL(url);
    // Accept share.temu.com short links (e.g., https://share.temu.com/CNdtnUqXKRC)
    if (parsed.hostname === 'share.temu.com') {
      return true;
    }
    // Accept temu.com links with share in path or share_key param
    if (parsed.hostname.includes('temu.com')) {
      return parsed.pathname.includes('share') || parsed.searchParams.has('share_key');
    }
    return false;
  } catch {
    return false;
  }
}

// Import from a Temu share link
async function importFromShareLink() {
  const shareUrl = elements.shareLink.value.trim();

  if (!shareUrl) {
    showShareResult('Please paste a Temu share link', false);
    return;
  }

  if (!isValidShareLink(shareUrl)) {
    showShareResult('Invalid share link. Please paste a valid Temu share link.', false);
    return;
  }

  elements.shareImportBtn.disabled = true;
  elements.shareImportBtn.textContent = 'Opening share link...';
  elements.shareResult.classList.add('hidden');

  try {
    console.log('[Judi\'s Wishlist] Opening share link:', shareUrl);

    // Open the share link in a new tab
    const tab = await chrome.tabs.create({ url: shareUrl, active: false });

    elements.shareImportBtn.textContent = 'Waiting for page to load...';

    // Wait for the tab to finish loading
    await waitForTabLoad(tab.id);

    // Give extra time for JavaScript to render content
    await new Promise(r => setTimeout(r, 3000));

    elements.shareImportBtn.textContent = 'Scanning cart items...';

    // Execute the scraper on the share page
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scrapeTemuAllTabs,
    });

    const items = results[0]?.result || [];
    console.log('[Judi\'s Wishlist] Found items from share link:', items.length);

    // Close the tab after scraping
    try {
      await chrome.tabs.remove(tab.id);
    } catch (e) {
      console.log('[Judi\'s Wishlist] Could not close tab:', e);
    }

    if (items.length === 0) {
      showShareResult('No items found. The share link may have expired or the cart is empty.', false);
      return;
    }

    elements.shareImportBtn.textContent = `Importing ${items.length} items...`;

    // Send to wishlist app with retry logic
    const listId = parseInt(elements.shareListSelect.value) || 1;
    let response;
    let lastError;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        response = await fetch(`${API_BASE}/api/items/import`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            store: 'temu',
            items: items,
            list_id: listId,
          }),
          signal: AbortSignal.timeout(30000), // 30 second timeout
        });
        if (response.ok) {
          lastError = null;
          break;
        } else {
          lastError = new Error(`Server error: ${response.status}`);
        }
      } catch (e) {
        lastError = e;
        console.warn(`[Judi's Wishlist] Share import attempt ${attempt} failed:`, e.message);
      }
      if (attempt < 3) {
        await new Promise(r => setTimeout(r, attempt * 2000));
        elements.shareImportBtn.textContent = `Retrying (${attempt}/3)...`;
      }
    }

    if (lastError || !response?.ok) {
      throw new Error(lastError?.message || 'Failed to import items after 3 attempts');
    }

    let data;
    try {
      data = await response.json();
    } catch (e) {
      throw new Error('Invalid response from server')
    }
    const scrapeStats = items._stats || null;

    // Build result message
    let msg = `Imported ${data.imported} new`;
    if (data.updated > 0) {
      msg += `, ${data.updated} prices updated`;
      if (data.price_drops > 0) msg += ` (${data.price_drops} dropped!)`;
    }
    if (data.skipped > 0) {
      msg += `, ${data.skipped} unchanged`;
    }
    showShareResult(msg, true, data, scrapeStats);

    // Clear the input on success
    elements.shareLink.value = '';

  } catch (error) {
    console.error('[Judi\'s Wishlist] Share import error:', error);
    showShareResult('Error: ' + error.message, false);
  } finally {
    elements.shareImportBtn.disabled = false;
    elements.shareImportBtn.textContent = 'Import from Share Link';
  }
}

// Wait for a tab to finish loading
function waitForTabLoad(tabId) {
  return new Promise((resolve, reject) => {
    let timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Page load timeout'));
    }, 30000); // 30 second timeout

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(listener);
  });
}

// Show share result message
function showShareResult(message, success, data = null, scrapeStats = null) {
  elements.shareResult.classList.remove('hidden', 'success', 'error', 'warning');
  elements.shareResult.classList.add(success ? 'success' : 'error');

  let html = `<div>${message}</div>`;

  if (data) {
    html += `<div class="result-stats">`;
    html += `<div class="result-stat imported"><span class="count">${data.imported}</span> new</div>`;

    if (data.updated > 0) {
      html += `<div class="result-stat updated"><span class="count">${data.updated}</span> updated</div>`;
    }

    if (data.price_drops > 0) {
      html += `<div class="result-stat price-drop"><span class="count">${data.price_drops}</span> price drops!</div>`;
    }

    html += `<div class="result-stat skipped"><span class="count">${data.skipped}</span> unchanged</div>`;
    html += `</div>`;
  }

  // Show scrape stats if available
  if (scrapeStats) {
    html += `<div class="scrape-stats">`;
    if (scrapeStats.total) {
      html += `<div class="stat-ok">✓ Found ${scrapeStats.total} items from share link</div>`;
    }

    const imgPercent = scrapeStats.total ? Math.round((scrapeStats.withImage / scrapeStats.total) * 100) : 0;
    const pricePercent = scrapeStats.total ? Math.round((scrapeStats.withPrice / scrapeStats.total) * 100) : 0;

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

  elements.shareResult.innerHTML = html;
}

// Paste from clipboard
async function pasteFromClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    elements.shareLink.value = text;
  } catch (error) {
    console.error('Failed to paste from clipboard:', error);
    // Fallback: focus the input so user can paste manually
    elements.shareLink.focus();
  }
}

// Event listeners
// Refresh images: scrape cart for images and push to server
async function refreshImages() {
  elements.refreshImagesBtn.disabled = true;
  elements.refreshImagesBtn.textContent = '🖼️ Opening product pages...';
  elements.refreshResult.classList.add('hidden');

  try {
    // Tell background to open every product page and grab images
    chrome.runtime.sendMessage({ type: 'FIX_IMAGES_START', mode: 'all' });

    elements.refreshResult.textContent = 'Opening product pages to grab images...';
    elements.refreshResult.className = 'result success';
    elements.refreshResult.classList.remove('hidden');

    // Poll for status
    const poll = () => {
      chrome.runtime.sendMessage({ type: 'FIX_IMAGES_STATUS' }, (status) => {
        if (!status) return;

        const pct = status.total > 0 ? Math.round((status.processed / status.total) * 100) : 0;
        elements.refreshResult.textContent = `${status.processed}/${status.total} — ${status.updated} updated${status.current ? ' — ' + status.current : ''}`;
        elements.refreshImagesBtn.textContent = `🖼️ ${pct}% (${status.processed}/${status.total})`;

        if (status.running) {
          setTimeout(poll, 2000);
        } else {
          elements.refreshImagesBtn.disabled = false;
          elements.refreshImagesBtn.textContent = '🖼️ Refresh All Images';
          let doneMsg = `Done! Updated ${status.updated} images, ${status.failed} failed`;
          if (status.skipped > 0) doneMsg += `, ${status.skipped} already correct`;
          doneMsg += ` out of ${status.total}`;
          elements.refreshResult.textContent = doneMsg;
        }
      });
    };
    setTimeout(poll, 3000);
  } catch (error) {
    console.error('Image refresh failed:', error);
    elements.refreshResult.textContent = 'Failed: ' + error.message;
    elements.refreshResult.className = 'result error';
    elements.refreshResult.classList.remove('hidden');
    elements.refreshImagesBtn.disabled = false;
    elements.refreshImagesBtn.textContent = '🖼️ Refresh All Images';
  }
}

// Method switching
elements.methodScanBtn.addEventListener('click', () => switchMethod('scan'));
elements.methodShareBtn.addEventListener('click', () => switchMethod('share'));

// Import buttons
elements.importBtn.addEventListener('click', importCart);
elements.shareImportBtn.addEventListener('click', importFromShareLink);
elements.sharePasteBtn.addEventListener('click', pasteFromClipboard);
elements.refreshImagesBtn.addEventListener('click', refreshImages);
elements.fixImagesBtn.addEventListener('click', fixMissingImages);
elements.cancelFixBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'FIX_IMAGES_CANCEL' }, () => {
    elements.cancelFixBtn.classList.add('hidden');
    elements.fixImagesStatus.textContent += ' (cancelling...)';
  });
});

async function fixMissingImages() {
  elements.fixImagesBtn.disabled = true;
  elements.fixImagesBtn.textContent = '🔧 Starting...';
  elements.cancelFixBtn.classList.remove('hidden');
  elements.fixImagesStatus.classList.remove('hidden');
  elements.fixImagesStatus.textContent = 'Opening product pages to grab images...';

  try {
    // Tell background to open each product page with a bad/missing image
    chrome.runtime.sendMessage({ type: 'FIX_IMAGES_START', mode: 'needs-fix' });

    // Poll for status
    const poll = () => {
      chrome.runtime.sendMessage({ type: 'FIX_IMAGES_STATUS' }, (status) => {
        if (!status) return;

        const pct = status.total > 0 ? Math.round((status.processed / status.total) * 100) : 0;
        elements.fixImagesStatus.textContent = `${status.processed}/${status.total} checked — ${status.updated} fixed, ${status.failed} failed${status.skipped ? ', ' + status.skipped + ' already correct' : ''}${status.current ? ' — ' + status.current : ''}`;
        elements.fixImagesBtn.textContent = `🔧 ${pct}% (${status.processed}/${status.total})`;

        if (status.running) {
          setTimeout(poll, 2000);
        } else {
          elements.fixImagesBtn.disabled = false;
          elements.fixImagesBtn.textContent = '🔧 Fix Missing Images';
          elements.cancelFixBtn.classList.add('hidden');
          if (status.total === 0) {
            elements.fixImagesStatus.textContent = 'All items already have valid images!';
          } else {
            let doneMsg = `Done! Fixed ${status.updated} images, ${status.failed} failed`;
            if (status.skipped > 0) doneMsg += `, ${status.skipped} already correct`;
            doneMsg += ` out of ${status.total}`;
            elements.fixImagesStatus.textContent = doneMsg;
          }
        }
      });
    };

    setTimeout(poll, 3000);
  } catch (error) {
    elements.fixImagesStatus.textContent = 'Error: ' + error.message;
    elements.fixImagesBtn.disabled = false;
    elements.fixImagesBtn.textContent = '🔧 Fix Missing Images';
    elements.cancelFixBtn.classList.add('hidden');
  }
}

// Allow Enter key to trigger import
elements.shareLink.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    importFromShareLink();
  }
});

// Diagnostic tool — runs on the Temu cart page and reports exactly what data
// is available. Shows intercepted API structure, window state, DOM stats.
// Output can be copy/pasted for debugging.
document.getElementById('diagLink')?.addEventListener('click', async (e) => {
  e.preventDefault();
  const diagResult = document.getElementById('diagnosticResult');
  diagResult.classList.remove('hidden');
  diagResult.textContent = 'Running diagnostics...';

  if (!currentTabId) {
    diagResult.textContent = 'No active tab found. Navigate to a Temu cart page first.';
    return;
  }

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: currentTabId },
      func: function() {
        const diag = { url: location.href, timestamp: new Date().toISOString() };

        // 1. Check intercepted API data
        diag.interceptor = { available: false, entries: [] };
        try {
          const p = new Promise((resolve) => {
            const h = (event) => {
              if (event.data?.type === '__JWL_CART_DATA_RESPONSE__') {
                window.removeEventListener('message', h);
                resolve(event.data.entries || []);
              }
            };
            window.addEventListener('message', h);
            window.postMessage({ type: '__JWL_CART_DATA_REQUEST__' }, '*');
            setTimeout(() => { window.removeEventListener('message', h); resolve([]); }, 1000);
          });
          // Can't await in sync, use callback approach
          // Actually executeScript supports async, so let's return a promise
          return p.then(entries => {
            diag.interceptor.available = entries.length > 0;
            for (const entry of entries) {
              const summary = { endpoint: entry.endpoint };
              // Map the structure: show keys at each level, and for arrays, show first item's keys
              function mapStructure(obj, depth) {
                if (!obj || depth > 4) return typeof obj;
                if (Array.isArray(obj)) {
                  return { _type: 'array', _length: obj.length, _firstItemKeys: obj[0] ? Object.keys(obj[0]).slice(0, 30) : [] };
                }
                if (typeof obj === 'object') {
                  const result = {};
                  for (const [k, v] of Object.entries(obj).slice(0, 20)) {
                    result[k] = mapStructure(v, depth + 1);
                  }
                  return result;
                }
                return typeof obj;
              }
              summary.structure = mapStructure(entry.data, 0);

              // Find any array with goods_id items and show a SAMPLE item
              function findSampleItem(obj, depth) {
                if (!obj || depth > 5) return null;
                if (Array.isArray(obj)) {
                  const item = obj.find(i => i?.goods_id || i?.goodsId);
                  if (item) {
                    // Return keys and sample values (truncated)
                    const sample = {};
                    for (const [k, v] of Object.entries(item)) {
                      if (typeof v === 'string') sample[k] = v.substring(0, 80);
                      else if (typeof v === 'number' || typeof v === 'boolean') sample[k] = v;
                      else if (Array.isArray(v)) sample[k] = `[array: ${v.length}]`;
                      else if (v && typeof v === 'object') sample[k] = `{${Object.keys(v).slice(0, 5).join(',')}}`;
                      else sample[k] = String(v);
                    }
                    return sample;
                  }
                }
                if (typeof obj === 'object' && !Array.isArray(obj)) {
                  for (const v of Object.values(obj)) {
                    const found = findSampleItem(v, depth + 1);
                    if (found) return found;
                  }
                }
                return null;
              }
              summary.sampleItem = findSampleItem(entry.data, 0);
              diag.interceptor.entries.push(summary);
            }

            // 2. Check window state locations
            diag.windowState = {};
            const locations = [
              '__INITIAL_STATE__', '__NEXT_DATA__', '__NUXT__',
              'cartData', 'pageData', '__APP_DATA__', '__SSR_DATA__',
            ];
            for (const loc of locations) {
              try {
                const val = window[loc];
                if (val) {
                  diag.windowState[loc] = Object.keys(val).slice(0, 15);
                }
              } catch (e) {}
            }

            // 3. DOM stats
            diag.dom = {};
            diag.dom.productLinks = {
              'goods_id': document.querySelectorAll('a[href*="goods_id="]').length,
              '_p_': document.querySelectorAll('a[href*="_p_"]').length,
              '/product/': document.querySelectorAll('a[href*="/product/"]').length,
              'subject_id': document.querySelectorAll('a[href*="subject_id="]').length,
            };
            diag.dom.priceElements = document.querySelectorAll('[class*="price"], [class*="Price"]').length;
            diag.dom.images = document.querySelectorAll('img[src*="kwcdn"], img[src*="akamaized"]').length;
            diag.dom.scriptTags = document.querySelectorAll('script:not([src])').length;

            // 4. Check for cart-related script content
            const scripts = document.querySelectorAll('script:not([src])');
            let cartScriptFound = false;
            for (const s of scripts) {
              if (s.textContent?.includes('goods_id') || s.textContent?.includes('goodsId')) {
                cartScriptFound = true;
                break;
              }
            }
            diag.dom.hasCartDataInScripts = cartScriptFound;

            return diag;
          });
        } catch (e) {
          diag.interceptor.error = e.message;
          return diag;
        }
      },
    });

    const diag = results[0]?.result;
    if (diag) {
      diagResult.innerHTML = `<strong>Diagnostic Report</strong> (copy all below):<br><pre style="white-space:pre-wrap;font-size:9px;">${JSON.stringify(diag, null, 2)}</pre>`;
    } else {
      diagResult.textContent = 'No diagnostic data returned. Make sure you are on a Temu page.';
    }
  } catch (err) {
    diagResult.textContent = 'Error: ' + err.message;
  }
});

// Initialize
init();
