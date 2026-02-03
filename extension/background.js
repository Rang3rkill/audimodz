// Background service worker for Judi's Wishlist Importer

const API_BASE = 'http://localhost:5000';

// ============================================================
// NETWORK SNIFFING: Capture Temu's actual cart API responses
// ============================================================
const capturedCartData = new Map();

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Judi\'s Wishlist] Extension installed');
});

// Handle messages from popup or content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'IMPORT_ITEMS') {
    handleImport(message.data)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.type === 'GET_LISTS') {
    fetchLists()
      .then(lists => sendResponse({ success: true, data: lists }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.type === 'CHECK_CONNECTION') {
    checkConnection()
      .then(connected => sendResponse({ success: true, connected }))
      .catch(() => sendResponse({ success: false, connected: false }));
    return true;
  }

  if (message.type === 'CART_API_CAPTURED') {
    const tabId = sender.tab?.id;
    if (tabId && message.data) {
      console.log(`[Judi's Wishlist] Captured cart API data from tab ${tabId}: ${message.endpoint}`);
      if (!capturedCartData.has(tabId)) {
        capturedCartData.set(tabId, []);
      }
      capturedCartData.get(tabId).push({
        endpoint: message.endpoint,
        data: message.data,
        timestamp: Date.now(),
      });
      const cutoff = Date.now() - 5 * 60 * 1000;
      const entries = capturedCartData.get(tabId).filter(e => e.timestamp > cutoff);
      capturedCartData.set(tabId, entries);
    }
    return false;
  }

  if (message.type === 'GET_CAPTURED_CART') {
    const entries = capturedCartData.get(message.tabId) || [];
    const recent = entries.filter(e => Date.now() - e.timestamp < 5 * 60 * 1000);
    sendResponse({ entries: recent });
    return false;
  }

  if (message.type === 'CLEAR_CAPTURED_CART') {
    capturedCartData.delete(message.tabId);
    return false;
  }

  // Fix/refresh images — open each product page and grab the real image
  if (message.type === 'FIX_IMAGES_START') {
    fixMissingImages(message.mode || 'needs-fix')
      .then(status => console.log('[Judi\'s Wishlist] Fix images done:', status))
      .catch(e => console.error('[Judi\'s Wishlist] Fix images error:', e));
    sendResponse({ success: true, message: 'Started' });
    return false;
  }

  if (message.type === 'FIX_IMAGES_STATUS') {
    sendResponse({ ...fixImagesStatus, running: fixImagesRunning });
    return false;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  capturedCartData.delete(tabId);
});

// ============================================================
// FIX IMAGES: Open each product page, grab real image, update DB
// ============================================================
let fixImagesRunning = false;
let fixImagesStatus = { total: 0, processed: 0, updated: 0, failed: 0, current: '' };

/**
 * Open each product page in a VISIBLE tab, grab the product image, update DB.
 * @param {string} mode - 'needs-fix' (only bad/missing images), 'all' (every item), or 'import' (post-import pass)
 * @param {Array} itemList - optional pre-filtered list of items to process
 */
async function fixMissingImages(mode = 'needs-fix', itemList = null) {
  if (fixImagesRunning) return fixImagesStatus;
  fixImagesRunning = true;
  fixImagesStatus = { total: 0, processed: 0, updated: 0, failed: 0, current: '' };

  try {
    let items;

    if (itemList) {
      items = itemList;
    } else {
      // Get all items from server
      const resp = await fetch(`${API_BASE}/api/items`);
      if (!resp.ok) throw new Error('Failed to get items');
      const allItems = await resp.json();

      if (mode === 'all') {
        // Refresh ALL items — open every product page
        items = allItems.filter(i => i.product_url && i.product_url.includes('temu.com'));
      } else {
        // Only items that need image fixes
        const BAD_IMG_PATTERNS = ['/sale', '/banner', '/promo', '/countdown', '/clock', '/timer',
          'sale_banner', 'flash_sale', 'promotion', 'coupon', '/bg/', '/background/',
          'placeholder', 'upload_aimg', '/aimg/', '/splash/', '/event/'];

        function needsImage(item) {
          if (!item.product_url || !item.product_url.includes('temu.com')) return false;
          const img = item.image_url || '';
          if (!img) return true;
          const lower = img.toLowerCase();
          for (const p of BAD_IMG_PATTERNS) {
            if (lower.includes(p)) return true;
          }
          return false;
        }

        items = allItems.filter(needsImage);

        // Also detect duplicate images (3+ items sharing same URL = generic placeholder)
        const imgCounts = {};
        for (const item of allItems) {
          if (item.image_url) imgCounts[item.image_url] = (imgCounts[item.image_url] || 0) + 1;
        }
        for (const item of allItems) {
          if (item.image_url && imgCounts[item.image_url] >= 3 && !items.find(i => i.id === item.id)) {
            if (item.product_url && item.product_url.includes('temu.com')) {
              items.push(item);
            }
          }
        }
      }
    }

    fixImagesStatus.total = items.length;
    if (items.length === 0) {
      fixImagesRunning = false;
      return fixImagesStatus;
    }

    // Process each item: open visible tab, scrape image, close tab, update DB
    for (const item of items) {
      fixImagesStatus.current = (item.title || '').substring(0, 50);

      try {
        const imageUrl = await scrapeImageFromProductPage(item.product_url);

        if (imageUrl && imageUrl !== item.image_url) {
          const updateResp = await fetch(`${API_BASE}/api/items/${item.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image_url: imageUrl }),
          });
          if (updateResp.ok) {
            fixImagesStatus.updated++;
          } else {
            fixImagesStatus.failed++;
          }
        } else if (!imageUrl) {
          fixImagesStatus.failed++;
        }
        // If imageUrl === item.image_url, it already has the right image — skip silently
      } catch (e) {
        console.log(`[Judi's Wishlist] Failed to fix image for item ${item.id}: ${e.message}`);
        fixImagesStatus.failed++;
      }

      fixImagesStatus.processed++;
    }
  } catch (e) {
    console.error('[Judi\'s Wishlist] Fix images error:', e);
  } finally {
    fixImagesRunning = false;
    fixImagesStatus.current = '';
  }

  return fixImagesStatus;
}

/**
 * Open a product page in a VISIBLE (active) tab, wait for it to render,
 * scrape the product image, close the tab, and return the image URL.
 */
async function scrapeImageFromProductPage(url) {
  // Open the product page in a VISIBLE tab so Temu renders it fully
  const tab = await chrome.tabs.create({ url, active: true });

  try {
    // Wait for the page to fully load
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(); // Don't reject — still try to scrape
      }, 25000);

      function listener(tabId, changeInfo) {
        if (tabId === tab.id && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          clearTimeout(timeout);
          // Give Temu's JS time to render images
          setTimeout(resolve, 4000);
        }
      }
      chrome.tabs.onUpdated.addListener(listener);
    });

    // First, dismiss any popups/overlays that might block the page
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          // Close common Temu popups/overlays
          const closeSelectors = [
            '[class*="close"]', '[class*="Close"]', '[aria-label="Close"]',
            '[class*="dismiss"]', '.modal-close', '[data-testid="close"]',
            'button[class*="dialog"] svg', '[class*="overlay-close"]',
          ];
          for (const sel of closeSelectors) {
            try {
              const btn = document.querySelector(sel);
              if (btn && btn.offsetParent !== null) btn.click();
            } catch {}
          }
        },
      });
    } catch {}

    // Wait a moment for popup dismissal to take effect
    await new Promise(r => setTimeout(r, 1000));

    // Scrape the product image from the rendered page
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        // Check we're actually on a product page (not redirected to homepage)
        const url = window.location.href;
        if (!url.includes('goods_id') && !url.includes('_p_') && !url.includes('/product/')) {
          return null; // Redirected away from product page
        }

        const BAD_PATTERNS = ['/sale', '/banner', '/promo', '/countdown', '/clock', '/timer',
          'sale_banner', 'flash_sale', 'promotion', 'coupon', '/bg/', '/background/',
          'placeholder', 'upload_aimg', '/aimg/', '/splash/', '/event/'];

        function isGoodImage(url) {
          if (!url || !url.startsWith('http')) return false;
          const lower = url.toLowerCase();
          for (const p of BAD_PATTERNS) {
            if (lower.includes(p)) return false;
          }
          if (!lower.includes('kwcdn') && !lower.includes('akamaized') &&
              !lower.includes('temu') && !lower.includes('cloudfront')) return false;
          if (url.length < 30) return false;
          return true;
        }

        // 1. og:image meta tag (most reliable on rendered product pages)
        const ogImage = document.querySelector('meta[property="og:image"]');
        if (ogImage?.content && isGoodImage(ogImage.content)) {
          return ogImage.content;
        }

        // 2. JSON-LD structured data
        const jsonLd = document.querySelectorAll('script[type="application/ld+json"]');
        for (const script of jsonLd) {
          try {
            const data = JSON.parse(script.textContent);
            if (data.image) {
              const img = Array.isArray(data.image) ? data.image[0] : data.image;
              const imgUrl = typeof img === 'string' ? img : img?.url;
              if (isGoodImage(imgUrl)) return imgUrl;
            }
          } catch {}
        }

        // 3. Search inline scripts for image URL patterns
        const scripts = document.querySelectorAll('script:not([src])');
        for (const script of scripts) {
          const text = script.textContent;
          if (!text || text.length < 10) continue;
          const patterns = [
            /"thumb_url"\s*:\s*"(https?:[^"]+)"/,
            /"thumbUrl"\s*:\s*"(https?:[^"]+)"/,
            /"hdThumbUrl"\s*:\s*"(https?:[^"]+)"/,
            /"goods_img"\s*:\s*"(https?:[^"]+)"/,
            /"goodsImg"\s*:\s*"(https?:[^"]+)"/,
            /"image_url"\s*:\s*"(https?:[^"]+)"/,
            /"imageUrl"\s*:\s*"(https?:[^"]+)"/,
            /"originImage"\s*:\s*"(https?:[^"]+)"/,
          ];
          for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match) {
              const found = match[1].replace(/\\u002F/g, '/').replace(/\\\//g, '/');
              if (isGoodImage(found)) return found;
            }
          }
        }

        // 4. Visible product images on the page (gallery, main image, etc.)
        const selectors = [
          'img[data-not-lazy][src*="kwcdn"]',
          'img[data-not-lazy][src*="akamaized"]',
          '[class*="gallery"] img', '[class*="Gallery"] img',
          '[class*="ProductImage"] img', '[class*="product-image"] img',
          '[class*="goodsImage"] img', '[class*="mainImage"] img',
          '.product-img img', '.goods-img img',
        ];
        for (const selector of selectors) {
          try {
            const imgs = document.querySelectorAll(selector);
            for (const img of imgs) {
              const src = img.src || img.dataset.src || '';
              if (isGoodImage(src)) return src;
            }
          } catch {}
        }

        // 5. Any CDN image on the page
        const allImgs = document.querySelectorAll('img');
        for (const img of allImgs) {
          const src = img.src;
          if (isGoodImage(src)) {
            const w = img.naturalWidth || 0;
            const h = img.naturalHeight || 0;
            if (w > 80 && h > 80) return src;
          }
        }

        return null;
      },
    });

    return results?.[0]?.result || null;
  } catch (e) {
    console.log(`[Judi's Wishlist] Scrape error for ${url.substring(0, 60)}: ${e.message}`);
    return null;
  } finally {
    // Always close the tab when done
    try { await chrome.tabs.remove(tab.id); } catch {}
  }
}

// Import items to the wishlist app
async function handleImport(data) {
  const response = await fetch(`${API_BASE}/api/items/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw new Error('Failed to import items');
  }

  const result = await response.json();

  // After import completes, automatically fix images for all imported items
  // by opening each product page. Run in background — don't block the import response.
  if (result.items && result.items.length > 0) {
    const itemsToFix = result.items
      .filter(i => i.product_url && i.product_url.includes('temu.com'))
      .map(i => ({
        id: i.id,
        product_url: i.product_url,
        image_url: i.image_url,
        title: i.title,
      }));

    if (itemsToFix.length > 0) {
      console.log(`[Judi's Wishlist] Post-import: fixing images for ${itemsToFix.length} items`);
      // Don't await — let it run in background
      fixMissingImages('import', itemsToFix)
        .then(s => console.log(`[Judi's Wishlist] Post-import image fix done:`, s))
        .catch(e => console.error(`[Judi's Wishlist] Post-import image fix error:`, e));
    }
  }

  return result;
}

// Fetch lists from the wishlist app
async function fetchLists() {
  const response = await fetch(`${API_BASE}/api/lists`);
  if (!response.ok) throw new Error('Failed to fetch lists');
  return response.json();
}

// Check if wishlist app is running
async function checkConnection() {
  try {
    const response = await fetch(`${API_BASE}/api/lists`, {
      method: 'GET',
      signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
