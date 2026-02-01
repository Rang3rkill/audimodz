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
    const response = await fetch(`${API_BASE}/api/lists`);
    if (!response.ok) throw new Error('Could not connect to wishlist app');

    const lists = await response.json();

    const optionsHtml = lists.map(list =>
      `<option value="${list.id}">${list.name}</option>`
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

    // Show data quality
    const imgPercent = scrapeStats.total > 0 ? Math.round((scrapeStats.withImage / scrapeStats.total) * 100) : 0;
    const pricePercent = scrapeStats.total > 0 ? Math.round((scrapeStats.withPrice / scrapeStats.total) * 100) : 0;

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

// Multi-tab scraper for Temu - clicks through each filter tab and collects all items
// This runs in the context of the page
async function scrapeTemuAllTabs() {
  const allItems = new Map(); // Use Map to deduplicate by product_id
  const stats = { total: 0, withImage: 0, withPrice: 0, withTitle: 0, tabsProcessed: 0 };

  console.log('[Judi\'s Wishlist] === MULTI-TAB SCRAPER ===');

  // === METHOD 1: Try to find cart data in JavaScript/JSON ===
  console.log('[Judi\'s Wishlist] Attempting to find cart data in page JavaScript...');

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

          let rawPrice = parseFloat(item.price || item.sale_price || item.salePrice || item.current_price);
          // Normalize price - Temu JS often stores cents (e.g. 1299 = $12.99)
          if (!isNaN(rawPrice) && rawPrice > 100 && Number.isInteger(rawPrice)) {
            rawPrice = rawPrice / 100;
          }
          const validPrice = (!isNaN(rawPrice) && isFinite(rawPrice) && rawPrice > 0.01 && rawPrice < 99999) ? rawPrice : null;

          const itemImage = item.thumb_url || item.thumbUrl || item.image || item.img || item.goods_img || null;
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
            price: validPrice,
            quantity: Math.max(1, parseInt(item.quantity || item.qty) || 1),
          });
        });

        if (allItems.size > 0) {
          console.log(`[Judi\'s Wishlist] Successfully extracted ${allItems.size} items from JS data`);
          const finalItems = Array.from(allItems.values());
          stats.total = finalItems.length;
          stats.withImage = finalItems.filter(i => i.image_url).length;
          stats.withPrice = finalItems.filter(i => i.price).length;
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
          const imgMatch = context.match(/"(?:thumb_url|image|img|goods_img)"\s*:\s*"([^"]+)"/);
          const priceMatch = context.match(/"(?:price|sale_price|salePrice)"\s*:\s*(\d+\.?\d*)/);

          if (titleMatch || imgMatch) {
            const scriptImage = imgMatch ? imgMatch[1].replace(/\\/g, '') : null;
            let scriptUrl = `https://www.temu.com/goods.html?goods_id=${goodsId}`;
            if (scriptImage) {
              scriptUrl += '&thumb_url=' + encodeURIComponent(scriptImage);
            }
            // Normalize price - Temu JS often stores cents (e.g. 1299 = $12.99)
            let scriptPrice = priceMatch ? parseFloat(priceMatch[1]) : null;
            if (scriptPrice && scriptPrice > 100 && Number.isInteger(scriptPrice)) {
              scriptPrice = scriptPrice / 100;
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

  if (allItems.size > 50) {
    console.log(`[Judi\'s Wishlist] Found ${allItems.size} items from script tags`);
    const finalItems = Array.from(allItems.values());
    stats.total = finalItems.length;
    stats.withImage = finalItems.filter(i => i.image_url).length;
    stats.withPrice = finalItems.filter(i => i.price).length;
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

      // Get image - try multiple approaches
      let imageUrl = null;
      // Method 1: Direct img with known CDN
      const imgSelectors = [
        'img[src*="img.kwcdn.com"]',
        'img[src*="kwcdn"]',
        'img[src*="akamaized"]',
        'img[data-src*="kwcdn"]',
        'img[data-src*="akamaized"]',
      ];
      for (const sel of imgSelectors) {
        const img = container?.querySelector(sel);
        if (img) {
          imageUrl = img.src || img.dataset?.src || img.getAttribute('data-src');
          if (imageUrl && imageUrl.startsWith('http')) break;
        }
      }
      // Method 2: Any img with src
      if (!imageUrl) {
        const anyImg = container?.querySelector('img[src^="http"]');
        if (anyImg && !anyImg.src.includes('icon') && !anyImg.src.includes('logo')) {
          imageUrl = anyImg.src;
        }
      }

      // Get price - try multiple approaches
      let price = null;
      // Method 1: Look for elements with price-like classes
      const priceSelectors = [
        '[class*="price"]',
        '[class*="Price"]',
        '[class*="cost"]',
        '[class*="Cost"]',
        '[data-testid*="price"]',
      ];
      for (const sel of priceSelectors) {
        const priceEl = container?.querySelector(sel);
        if (priceEl) {
          const priceMatch = priceEl.textContent?.match(/\$\s*([\d,]+\.?\d*)/);
          if (priceMatch) {
            const parsed = parseFloat(priceMatch[1].replace(/,/g, ''));
            if (!isNaN(parsed) && isFinite(parsed) && parsed > 0.01 && parsed < 99999) {
              price = parsed;
              break;
            }
          }
        }
      }
      // Method 2: Search entire container for price pattern
      if (!price && container) {
        // Look for prices, prefer the "current" price (usually the lower one after discount)
        const allPrices = container.textContent?.match(/\$\s*([\d,]+\.?\d*)/g) || [];
        if (allPrices.length > 0) {
          // Parse all prices and take the lowest (usually the sale price)
          const priceValues = allPrices
            .map(p => parseFloat(p.replace(/[\$\s,]/g, '')))
            .filter(p => !isNaN(p) && isFinite(p) && p > 0.01 && p < 99999);
          if (priceValues.length > 0) {
            price = Math.min(...priceValues);
          }
        }
      }
      // Method 3: Check for "LAST DAY" or sale price patterns
      if (!price && container) {
        const saleMatch = container.textContent?.match(/LAST DAY\s*\$(\d+\.?\d*)/i);
        if (saleMatch) {
          price = parseFloat(saleMatch[1]);
        }
      }

      // Get quantity
      let quantity = 1;
      const qtyEl = container?.querySelector('input[type="text"], input[value], input[type="number"]');
      if (qtyEl) {
        quantity = parseInt(qtyEl.value) || 1;
      }

      // Embed thumb_url in product URL for server-side image recovery
      let domProductUrl = `https://www.temu.com/goods.html?goods_id=${productId}`;
      if (imageUrl) {
        domProductUrl += '&thumb_url=' + encodeURIComponent(imageUrl);
      }

      items.push({
        product_id: productId,
        product_url: domProductUrl,
        title: title,
        image_url: imageUrl,
        price: price,
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

    // Send to wishlist app
    const listId = parseInt(elements.shareListSelect.value);
    const response = await fetch(`${API_BASE}/api/items/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        store: 'temu',
        items: items,
        list_id: listId,
      }),
    });

    if (!response.ok) throw new Error('Failed to import items');

    const data = await response.json();
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
  elements.refreshImagesBtn.textContent = '🖼️ Scanning cart for images...';
  elements.refreshResult.classList.add('hidden');

  try {
    // Re-use the existing scraper to get items with images
    const results = await chrome.scripting.executeScript({
      target: { tabId: currentTabId },
      func: currentStore.key === 'temu' ? scrapeTemuAllTabs : scrapeCartItems,
      args: [currentStore.key],
    });

    const items = results[0]?.result || [];
    if (items.length === 0) {
      elements.refreshResult.textContent = 'No items found on cart page.';
      elements.refreshResult.className = 'result error';
      elements.refreshResult.classList.remove('hidden');
      return;
    }

    // Build updates: extract goods_id from product_url and pair with image
    const updates = [];
    for (const item of items) {
      if (!item.image_url || !item.product_url) continue;
      const match = item.product_url.match(/goods_id=(\d+)/);
      if (!match) continue;
      updates.push({ goods_id: match[1], image_url: item.image_url });
    }

    elements.refreshImagesBtn.textContent = `🖼️ Pushing ${updates.length} images...`;

    const response = await fetch(`${API_BASE}/api/items/update-images`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates }),
    });

    if (!response.ok) throw new Error('Server error');

    const data = await response.json();
    elements.refreshResult.textContent = `Updated ${data.updated} of ${data.total} images`;
    elements.refreshResult.className = 'result success';
    elements.refreshResult.classList.remove('hidden');
  } catch (error) {
    console.error('Image refresh failed:', error);
    elements.refreshResult.textContent = 'Failed: ' + error.message;
    elements.refreshResult.className = 'result error';
    elements.refreshResult.classList.remove('hidden');
  } finally {
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

// Allow Enter key to trigger import
elements.shareLink.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    importFromShareLink();
  }
});

// Initialize
init();
