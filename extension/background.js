// Background service worker for Judi's Wishlist Importer

const API_BASE = 'http://localhost:5000';

// ============================================================
// NETWORK SNIFFING: Capture Temu's actual cart API responses
// ============================================================
// Instead of guessing API endpoints, we listen to what Temu's own
// frontend fetches. When the user loads their cart page, Temu's JS
// makes XHR/fetch calls to load cart data. We capture those responses
// via a content script that monkey-patches fetch/XMLHttpRequest.
//
// The captured data is stored here and served to popup.js on demand.
// This is the most reliable method because we get the exact same data
// that Temu's own UI renders.

// Store captured cart data per tab
const capturedCartData = new Map();

// Listen for installation
chrome.runtime.onInstalled.addListener(() => {
  console.log('[Judi\'s Wishlist] Extension installed');
});

// Handle messages from popup or content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'IMPORT_ITEMS') {
    handleImport(message.data)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Keep message channel open for async response
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

  // Content script captured a cart API response
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
      // Keep only last 5 minutes of data
      const cutoff = Date.now() - 5 * 60 * 1000;
      const entries = capturedCartData.get(tabId).filter(e => e.timestamp > cutoff);
      capturedCartData.set(tabId, entries);
    }
    return false;
  }

  // Popup requests captured cart data for a tab
  if (message.type === 'GET_CAPTURED_CART') {
    const entries = capturedCartData.get(message.tabId) || [];
    // Return the most recent capture
    const recent = entries.filter(e => Date.now() - e.timestamp < 5 * 60 * 1000);
    sendResponse({ entries: recent });
    return false;
  }

  // Popup requests to clear captured data (after successful import)
  if (message.type === 'CLEAR_CAPTURED_CART') {
    capturedCartData.delete(message.tabId);
    return false;
  }

  // Fix missing images - open each product page and grab real image
  if (message.type === 'FIX_IMAGES_START') {
    fixMissingImages()
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

// Clean up captured data when tabs are closed
chrome.tabs.onRemoved.addListener((tabId) => {
  capturedCartData.delete(tabId);
});

// ============================================================
// FIX IMAGES: Open each product page, grab real image, update DB
// ============================================================
let fixImagesRunning = false;
let fixImagesStatus = { total: 0, processed: 0, updated: 0, failed: 0, autoFixed: 0, current: '' };

async function fixMissingImages() {
  if (fixImagesRunning) return fixImagesStatus;
  fixImagesRunning = true;
  fixImagesStatus = { total: 0, processed: 0, updated: 0, failed: 0, autoFixed: 0, current: '' };

  try {
    // 1. Ask server which items need images (server auto-fixes items with embedded thumb_urls)
    const resp = await fetch(`${API_BASE}/api/items/needs-images`);
    if (!resp.ok) throw new Error('Failed to get items needing images');
    const { items, auto_fixed } = await resp.json();

    fixImagesStatus.autoFixed = auto_fixed || 0;
    fixImagesStatus.total = items.length;
    if (items.length === 0) {
      fixImagesRunning = false;
      return fixImagesStatus;
    }

    // 2. Process each item: open tab, scrape image, update server
    for (const item of items) {
      fixImagesStatus.current = (item.title || '').substring(0, 50);

      try {
        const imageUrl = await scrapeImageFromProductPage(item.product_url);

        if (imageUrl) {
          // Send to server
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
        } else {
          fixImagesStatus.failed++;
        }
      } catch (e) {
        console.log(`[Judi's Wishlist] Failed to scrape image for item ${item.id}: ${e.message}`);
        fixImagesStatus.failed++;
      }

      fixImagesStatus.processed++;

      // Small delay between items to be nice
      await new Promise(r => setTimeout(r, 500));
    }
  } catch (e) {
    console.error('[Judi\'s Wishlist] Fix images error:', e);
  } finally {
    fixImagesRunning = false;
    fixImagesStatus.current = '';
  }

  return fixImagesStatus;
}

async function scrapeImageFromProductPage(url) {
  // First, check if the product URL already has a thumb_url embedded (set by extension during import)
  try {
    const urlObj = new URL(url);
    const embeddedThumb = urlObj.searchParams.get('thumb_url');
    if (embeddedThumb) {
      const decoded = decodeURIComponent(embeddedThumb);
      if (decoded.startsWith('http')) {
        console.log(`[Judi's Wishlist] Using embedded thumb_url for ${url.substring(0, 60)}`);
        return decoded;
      }
    }
  } catch {}

  // Open the product page in a background tab
  const tab = await chrome.tabs.create({ url, active: false });

  try {
    // Wait for the page to load
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Tab load timeout')), 30000);

      function listener(tabId, changeInfo) {
        if (tabId === tab.id && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          clearTimeout(timeout);
          // Give Temu's heavy JS more time to render (SPA needs longer)
          setTimeout(resolve, 5000);
        }
      }
      chrome.tabs.onUpdated.addListener(listener);
    });

    // Try scraping up to 3 times with increasing wait times
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) {
        await new Promise(r => setTimeout(r, 3000));
      }

      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const BAD_PATTERNS = ['/sale', '/banner', '/promo', '/countdown', '/clock', '/timer',
            'sale_banner', 'flash_sale', 'promotion', 'coupon', '/bg/', '/background/',
            'placeholder', 'upload_aimg', '/aimg/', '/splash/', '/event/'];

          function isGoodImage(url) {
            if (!url || !url.startsWith('http')) return false;
            const lower = url.toLowerCase();
            for (const p of BAD_PATTERNS) {
              if (lower.includes(p)) return false;
            }
            // Must be from a known Temu CDN
            if (!lower.includes('kwcdn') && !lower.includes('akamaized') &&
                !lower.includes('temu') && !lower.includes('cloudfront')) return false;
            if (url.length < 30) return false;
            return true;
          }

          // 1. og:image meta tag
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

          // 3. Search ALL inline scripts for thumb_url, hdThumbUrl, goods_img patterns
          const scripts = document.querySelectorAll('script:not([src])');
          for (const script of scripts) {
            const text = script.textContent;
            if (!text || text.length < 10) continue;

            // Try multiple JSON key patterns
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

          // 4. Gallery/carousel images (Temu uses these on product pages)
          const gallerySelectors = [
            // Temu product gallery containers
            'img[data-not-lazy][src*="kwcdn"]',
            'img[data-not-lazy][src*="akamaized"]',
            '.product-img img',
            '.goods-img img',
            '.gallery img',
            '[class*="gallery"] img',
            '[class*="Gallery"] img',
            '[class*="ProductImage"] img',
            '[class*="product-image"] img',
            '[class*="goodsImage"] img',
            '[class*="mainImage"] img',
            '[class*="MainImage"] img',
            // Generic product page image containers
            '[data-testid*="image"] img',
            '[data-testid*="gallery"] img',
          ];

          for (const selector of gallerySelectors) {
            try {
              const imgs = document.querySelectorAll(selector);
              for (const img of imgs) {
                // Check src, data-src, and srcset
                const src = img.src || img.dataset.src || img.getAttribute('data-origin-src') || '';
                if (isGoodImage(src)) return src;

                // Check srcset for high-res version
                const srcset = img.srcset || img.dataset.srcset || '';
                if (srcset) {
                  const parts = srcset.split(',');
                  for (const part of parts) {
                    const srcUrl = part.trim().split(/\s+/)[0];
                    if (isGoodImage(srcUrl)) return srcUrl;
                  }
                }
              }
            } catch {}
          }

          // 5. Any CDN image on the page (src, data-src, or style background)
          const allImgs = document.querySelectorAll('img');
          for (const img of allImgs) {
            // Try data-src first (lazy-loaded images)
            const dataSrc = img.dataset.src || img.getAttribute('data-origin-src') || '';
            if (isGoodImage(dataSrc)) return dataSrc;

            // Then actual src (skip tiny icons - check dimensions OR lack thereof in background tabs)
            const src = img.src;
            if (isGoodImage(src)) {
              // In background tabs naturalWidth may be 0 due to lazy loading,
              // so also accept images without dimension info
              const w = img.naturalWidth || parseInt(img.getAttribute('width')) || 0;
              const h = img.naturalHeight || parseInt(img.getAttribute('height')) || 0;
              if (w === 0 && h === 0) return src; // Can't check size, trust the CDN domain
              if (w > 50 && h > 50) return src;
            }
          }

          // 6. CSS background images from product containers
          const bgSelectors = ['[class*="product"]', '[class*="goods"]', '[class*="gallery"]',
            '[class*="image"]', '[class*="thumb"]', '[class*="main-pic"]'];
          for (const sel of bgSelectors) {
            try {
              const els = document.querySelectorAll(sel);
              for (const el of els) {
                const bg = getComputedStyle(el).backgroundImage;
                if (bg && bg !== 'none') {
                  const match = bg.match(/url\(["']?(https?:\/\/[^"')]+)/);
                  if (match && isGoodImage(match[1])) return match[1];
                }
              }
            } catch {}
          }

          return null;
        },
      });

      const imageUrl = results[0]?.result;
      if (imageUrl) return imageUrl;
    }

    return null;
  } finally {
    // Always close the tab
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

  return response.json();
}

// Fetch lists from the wishlist app
async function fetchLists() {
  const response = await fetch(`${API_BASE}/api/lists`);

  if (!response.ok) {
    throw new Error('Failed to fetch lists');
  }

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
