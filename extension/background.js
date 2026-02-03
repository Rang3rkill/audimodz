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

  // Allow cancellation
  if (message.type === 'FIX_IMAGES_CANCEL') {
    fixImagesCancelled = true;
    sendResponse({ success: true });
    return false;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  capturedCartData.delete(tabId);
});

// ============================================================
// HELPERS
// ============================================================

const BAD_IMG_PATTERNS = ['/sale', '/banner', '/promo', '/countdown', '/clock', '/timer',
  'sale_banner', 'flash_sale', 'promotion', 'coupon', '/bg/', '/background/',
  'placeholder', 'upload_aimg', '/aimg/', '/splash/', '/event/'];

/**
 * Check if an image URL looks like a real product image (not a placeholder/promo).
 */
function isGoodImageUrl(url) {
  if (!url || !url.startsWith('http')) return false;
  const lower = url.toLowerCase();
  for (const p of BAD_IMG_PATTERNS) {
    if (lower.includes(p)) return false;
  }
  if (url.length < 30) return false;
  return true;
}

/**
 * Check if an item needs its image fixed.
 */
function itemNeedsImage(item) {
  if (!item.product_url || !item.product_url.includes('temu.com')) return false;
  if (item.is_unavailable) return false; // Skip unavailable items
  const img = item.image_url || '';
  if (!img) return true;
  if (!isGoodImageUrl(img)) return true;
  return false;
}

/**
 * Strip internal tracking params (thumb_url) from a product URL before opening it.
 * Temu might reject URLs with unexpected query params.
 */
function cleanProductUrl(url) {
  try {
    const u = new URL(url);
    u.searchParams.delete('thumb_url');
    return u.toString();
  } catch {
    return url;
  }
}

// ============================================================
// FIX IMAGES: Open each product page, grab real image, update DB
// ============================================================
let fixImagesRunning = false;
let fixImagesCancelled = false;
let fixImagesStatus = { total: 0, processed: 0, updated: 0, failed: 0, skipped: 0, current: '' };

/**
 * Open each product page in a VISIBLE tab, grab the product image, update DB.
 * @param {string} mode - 'needs-fix' (only bad/missing), 'all' (every item), or 'import' (post-import)
 * @param {Array} itemList - optional pre-filtered list of items to process
 */
async function fixMissingImages(mode = 'needs-fix', itemList = null) {
  if (fixImagesRunning) return fixImagesStatus;
  fixImagesRunning = true;
  fixImagesCancelled = false;
  fixImagesStatus = { total: 0, processed: 0, updated: 0, failed: 0, skipped: 0, current: '' };

  try {
    let items;

    if (itemList) {
      items = itemList;
    } else {
      // Get all items from server
      const resp = await fetch(`${API_BASE}/api/items`, {
        signal: AbortSignal.timeout(10000), // 10 second timeout
      });
      if (!resp.ok) throw new Error('Failed to get items');
      const allItems = await resp.json();

      if (mode === 'all') {
        // Refresh ALL items — open every product page (skip unavailable)
        items = allItems.filter(i =>
          i.product_url && i.product_url.includes('temu.com') && !i.is_unavailable
        );
      } else {
        // Only items that need image fixes
        items = allItems.filter(itemNeedsImage);

        // Also detect duplicate images (3+ items sharing same URL = generic placeholder)
        const imgCounts = {};
        for (const item of allItems) {
          if (item.image_url) imgCounts[item.image_url] = (imgCounts[item.image_url] || 0) + 1;
        }
        const itemIds = new Set(items.map(i => i.id));
        for (const item of allItems) {
          if (item.image_url && imgCounts[item.image_url] >= 3 && !itemIds.has(item.id)) {
            if (item.product_url && item.product_url.includes('temu.com') && !item.is_unavailable) {
              items.push(item);
              itemIds.add(item.id);
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
      // Check for cancellation
      if (fixImagesCancelled) {
        console.log('[Judi\'s Wishlist] Image fix cancelled by user');
        break;
      }

      fixImagesStatus.current = (item.title || '').substring(0, 50);

      try {
        const cleanUrl = cleanProductUrl(item.product_url);
        console.log(`[Judi's Wishlist] Opening URL for "${(item.title || '').substring(0, 30)}": ${cleanUrl}`);
        const result = await scrapeImageFromProductPage(cleanUrl);
        const { imageUrl, isSoldOut } = result || {};
        console.log(`[Judi's Wishlist] Scraped image: ${imageUrl ? imageUrl.substring(0, 80) + '...' : 'null'}, soldOut: ${isSoldOut}`);

        // If item is sold out, mark it as unavailable and skip image update
        if (isSoldOut) {
          console.log(`[Judi's Wishlist] ⚠ Item SOLD OUT: ${(item.title || '').substring(0, 40)}`);
          try {
            await fetch(`${API_BASE}/api/items/${item.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ is_unavailable: 1 }),
              signal: AbortSignal.timeout(5000),
            });
            fixImagesStatus.skipped++; // Count as skipped (not failed)
          } catch {
            fixImagesStatus.failed++;
          }
        } else if (imageUrl && imageUrl !== item.image_url) {
          const updateResp = await fetch(`${API_BASE}/api/items/${item.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image_url: imageUrl }),
            signal: AbortSignal.timeout(5000), // 5 second timeout
          });
          if (updateResp.ok) {
            fixImagesStatus.updated++;
            console.log(`[Judi's Wishlist] ✓ Fixed image for: ${(item.title || '').substring(0, 40)}`);
          } else {
            fixImagesStatus.failed++;
          }
        } else if (imageUrl && imageUrl === item.image_url) {
          fixImagesStatus.skipped++; // Already has correct image
        } else {
          fixImagesStatus.failed++;
        }
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
 * scrape the product image, close the tab, and return { imageUrl, isSoldOut }.
 * Retries once if first attempt fails (unless item is sold out).
 */
async function scrapeImageFromProductPage(url) {
  // Open the product page in a VISIBLE tab so Temu renders it fully
  let tab;
  try {
    tab = await chrome.tabs.create({ url, active: true });
  } catch (e) {
    console.log(`[Judi's Wishlist] Failed to create tab for ${url.substring(0, 60)}: ${e.message}`);
    return { imageUrl: null, isSoldOut: false };
  }

  try {
    // Wait for the page to fully load
    await waitForTabLoad(tab.id, 25000);

    // Check if the tab navigated to an error page or was redirected away
    let tabInfo;
    try {
      tabInfo = await chrome.tabs.get(tab.id);
    } catch {
      return { imageUrl: null, isSoldOut: false }; // Tab was closed externally
    }
    const tabUrl = (tabInfo.url || '').toLowerCase();
    if (tabUrl.startsWith('chrome-error://') || tabUrl.startsWith('chrome://') || tabUrl === 'about:blank') {
      console.log(`[Judi's Wishlist] Tab navigated to error/restricted page: ${tabUrl}`);
      return { imageUrl: null, isSoldOut: false };
    }

    // Give Temu's JS time to render images
    await sleep(4000);

    // Check for and wait for security verification (CAPTCHA) if present
    await waitForSecurityCheck(tab.id);

    // Dismiss any popups/overlays that might block the page
    await dismissPopups(tab.id);
    await sleep(800);

    // First scrape attempt
    let result = await executeImageScrape(tab.id);

    // If sold out, return immediately - don't retry
    if (result.isSoldOut) {
      console.log(`[Judi's Wishlist] Item is SOLD OUT - skipping image scrape`);
      return result;
    }

    // If first attempt failed to find image, wait longer and try again
    if (!result.imageUrl) {
      await sleep(3000);
      result = await executeImageScrape(tab.id);
    }

    return result;
  } catch (e) {
    console.log(`[Judi's Wishlist] Scrape error for ${url.substring(0, 60)}: ${e.message}`);
    return { imageUrl: null, isSoldOut: false };
  } finally {
    // Always close the tab when done
    try { await chrome.tabs.remove(tab.id); } catch {}
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function waitForTabLoad(tabId, timeoutMs) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(); // Don't reject — still try to scrape
    }, timeoutMs);

    function listener(id, changeInfo) {
      if (id === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(timeout);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function dismissPopups(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // Close common Temu popups/overlays/modals
        const closeSelectors = [
          '[class*="close-btn"]', '[class*="closeBtn"]', '[class*="CloseBtn"]',
          '[aria-label="Close"]', '[aria-label="close"]',
          '[class*="dismiss"]', '[class*="Dismiss"]',
          '.modal-close', '[data-testid="close"]',
          '[class*="overlay-close"]', '[class*="dialog-close"]',
          // Temu-specific: coupon popup, login prompt
          '[class*="coupon"] [class*="close"]',
          '[class*="login"] [class*="close"]',
          '[class*="popup"] [class*="close"]',
        ];
        for (const sel of closeSelectors) {
          try {
            const btns = document.querySelectorAll(sel);
            for (const btn of btns) {
              if (btn && btn.offsetParent !== null && btn.offsetWidth > 5) {
                btn.click();
              }
            }
          } catch {}
        }
        // Also press Escape key to close modals
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      },
    });
  } catch {} // Ignore errors (tab may have navigated to restricted URL)
}

/**
 * Check if a security verification (CAPTCHA) is present on the page.
 * Returns true if a security check modal is detected.
 */
async function hasSecurityCheck(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // Look for security verification modals/text
        const pageText = document.body?.innerText?.toLowerCase() || '';
        const hasVerificationText = pageText.includes('security verification') ||
          pageText.includes('verify you are human') ||
          pageText.includes('click on the corresponding') ||
          pageText.includes('select all images') ||
          pageText.includes('captcha');

        // Also check for common CAPTCHA container elements
        const captchaSelectors = [
          '[class*="captcha"]', '[class*="Captcha"]', '[class*="CAPTCHA"]',
          '[class*="verification"]', '[class*="Verification"]',
          '[class*="security-check"]', '[class*="SecurityCheck"]',
          '[id*="captcha"]', '[id*="verification"]',
          'iframe[src*="captcha"]', 'iframe[src*="challenge"]',
        ];

        for (const sel of captchaSelectors) {
          try {
            const el = document.querySelector(sel);
            if (el && el.offsetParent !== null) {
              return true;
            }
          } catch {}
        }

        return hasVerificationText;
      },
    });
    return results?.[0]?.result || false;
  } catch {
    return false;
  }
}

/**
 * Wait for the user to complete a security verification if one is present.
 * Polls every 3 seconds for up to 90 seconds.
 */
async function waitForSecurityCheck(tabId) {
  const maxWaitMs = 90000; // 90 seconds to complete CAPTCHA
  const pollIntervalMs = 3000; // Check every 3 seconds
  const startTime = Date.now();

  // First check if there's a security check
  let hasCheck = await hasSecurityCheck(tabId);

  if (!hasCheck) {
    return; // No security check, continue normally
  }

  console.log('[Judi\'s Wishlist] Security verification detected - waiting for user to complete it...');

  // Wait for the security check to be completed
  while (hasCheck && (Date.now() - startTime) < maxWaitMs) {
    await sleep(pollIntervalMs);

    // Check if tab still exists
    try {
      await chrome.tabs.get(tabId);
    } catch {
      return; // Tab was closed
    }

    hasCheck = await hasSecurityCheck(tabId);
  }

  if (!hasCheck) {
    console.log('[Judi\'s Wishlist] Security verification completed - continuing with scrape');
    // Give the page a moment to settle after CAPTCHA completion
    await sleep(2000);
  } else {
    console.log('[Judi\'s Wishlist] Security verification timeout - proceeding anyway');
  }
}

async function executeImageScrape(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // Check we're actually on a product page (not redirected to homepage/login)
        const pageUrl = window.location.href;
        const isProductPage = pageUrl.includes('goods_id') || pageUrl.includes('_p_') ||
          pageUrl.includes('/product/') || pageUrl.includes('goods.html');
        if (!isProductPage) {
          return { imageUrl: null, isSoldOut: false }; // Redirected away from product page
        }

        // Check if item is sold out / unavailable FIRST - before trying to scrape images
        // This prevents picking up images from "similar items" recommendations
        const pageText = (document.body?.innerText || '').toLowerCase();
        const isSoldOut = pageText.includes('this item is sold out') ||
          pageText.includes('item is sold out') ||
          pageText.includes('out of stock') ||
          pageText.includes('unavailable for purchase') ||
          pageText.includes('no longer available') ||
          pageText.includes('item is no longer') ||
          pageText.includes('product is unavailable') ||
          pageText.includes('check out similar items') ||
          document.querySelector('[class*="sold-out"], [class*="soldOut"], [class*="SoldOut"], [class*="out-of-stock"], [class*="outOfStock"], [class*="unavailable"]') !== null;

        // If sold out, return immediately - don't scrape images from recommendations section
        if (isSoldOut) {
          return { imageUrl: null, isSoldOut: true };
        }

        const BAD_PATTERNS = ['/sale', '/banner', '/promo', '/countdown', '/clock', '/timer',
          'sale_banner', 'flash_sale', 'promotion', 'coupon', '/bg/', '/background/',
          'placeholder', 'upload_aimg', '/aimg/', '/splash/', '/event/', '/icon/', '/logo/'];

        function isGoodImage(url) {
          if (!url || typeof url !== 'string' || !url.startsWith('http')) return false;
          const lower = url.toLowerCase();
          for (const p of BAD_PATTERNS) {
            if (lower.includes(p)) return false;
          }
          // Must look like a product image CDN
          const hasCDN = lower.includes('kwcdn') || lower.includes('akamaized') ||
            lower.includes('temu') || lower.includes('cloudfront') ||
            lower.includes('cdn') || lower.includes('img.');
          if (!hasCDN) return false;
          if (url.length < 30) return false;
          return true;
        }

        // Clean a URL found in scripts (unescape unicode, fix slashes)
        function cleanUrl(raw) {
          return raw.replace(/\\u002F/g, '/').replace(/\\\//g, '/').replace(/\\"/g, '');
        }

        // 1. og:image meta tag — most reliable on rendered product pages
        const ogImage = document.querySelector('meta[property="og:image"]');
        if (ogImage?.content && isGoodImage(ogImage.content)) {
          return { imageUrl: ogImage.content, isSoldOut: false };
        }

        // 2. JSON-LD structured data
        for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
          try {
            const data = JSON.parse(script.textContent);
            const candidates = [data.image, data.thumbnailUrl, data.logo];
            for (const candidate of candidates) {
              if (!candidate) continue;
              const imgs = Array.isArray(candidate) ? candidate : [candidate];
              for (const img of imgs) {
                const imgUrl = typeof img === 'string' ? img : img?.url;
                if (isGoodImage(imgUrl)) return { imageUrl: imgUrl, isSoldOut: false };
              }
            }
          } catch {}
        }

        // 3. Search inline scripts for image URL patterns
        for (const script of document.querySelectorAll('script:not([src])')) {
          const text = script.textContent;
          if (!text || text.length < 50) continue;

          const patterns = [
            /"(?:long_thumb_url|hdThumbUrl)"\s*:\s*"(https?:[^"]+)"/,
            /"(?:thumb_url|thumbUrl)"\s*:\s*"(https?:[^"]+)"/,
            /"(?:goods_img|goodsImg)"\s*:\s*"(https?:[^"]+)"/,
            /"(?:image_url|imageUrl)"\s*:\s*"(https?:[^"]+)"/,
            /"(?:originImage|mainImage)"\s*:\s*"(https?:[^"]+)"/,
            /"(?:gallery|images)"\s*:\s*\["(https?:[^"]+)"/,
          ];

          for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match) {
              const found = cleanUrl(match[1]);
              if (isGoodImage(found)) return { imageUrl: found, isSoldOut: false };
            }
          }
        }

        // 4. Visible product images on the page (gallery, main image)
        const gallerySelectors = [
          // High-confidence product image locations
          '[class*="gallery"] img[src*="kwcdn"]',
          '[class*="gallery"] img[src*="akamaized"]',
          '[class*="Gallery"] img[src*="kwcdn"]',
          '[class*="Gallery"] img[src*="akamaized"]',
          '[class*="product-image"] img', '[class*="ProductImage"] img',
          '[class*="goodsImage"] img', '[class*="mainImage"] img',
          '[class*="MainImage"] img', '[class*="detail-gallery"] img',
          'img[data-not-lazy][src*="kwcdn"]',
          'img[data-not-lazy][src*="akamaized"]',
          '.product-img img', '.goods-img img',
        ];

        for (const selector of gallerySelectors) {
          try {
            for (const img of document.querySelectorAll(selector)) {
              const src = img.src || img.dataset?.src || img.getAttribute('data-origin-src') || '';
              if (isGoodImage(src)) return { imageUrl: src, isSoldOut: false };
              // Check srcset for high-res version
              const srcset = img.srcset || '';
              if (srcset) {
                const firstSrc = srcset.split(',')[0]?.trim()?.split(/\s+/)[0];
                if (isGoodImage(firstSrc)) return { imageUrl: firstSrc, isSoldOut: false };
              }
            }
          } catch {}
        }

        // 5. Any visible CDN image on the page with reasonable size
        for (const img of document.querySelectorAll('img')) {
          const src = img.src;
          if (!isGoodImage(src)) continue;
          const w = img.naturalWidth || parseInt(img.width) || 0;
          const h = img.naturalHeight || parseInt(img.height) || 0;
          // Accept if dimensions available and large enough, OR if we can't check
          if ((w > 80 && h > 80) || (w === 0 && h === 0)) return { imageUrl: src, isSoldOut: false };
        }

        // 6. data-src / lazy-loaded images
        for (const img of document.querySelectorAll('img[data-src], img[data-origin-src]')) {
          const src = img.dataset.src || img.getAttribute('data-origin-src') || '';
          if (isGoodImage(src)) return { imageUrl: src, isSoldOut: false };
        }

        // 7. CSS background images from product containers
        const bgSelectors = ['[class*="product"]', '[class*="goods"]', '[class*="gallery"]',
          '[class*="image-container"]', '[class*="thumb"]', '[class*="main-pic"]'];
        for (const sel of bgSelectors) {
          try {
            for (const el of document.querySelectorAll(sel)) {
              const bg = getComputedStyle(el).backgroundImage;
              if (bg && bg !== 'none') {
                const match = bg.match(/url\(["']?(https?:\/\/[^"')]+)/);
                if (match && isGoodImage(match[1])) return { imageUrl: match[1], isSoldOut: false };
              }
            }
          } catch {}
        }

        return { imageUrl: null, isSoldOut: false };
      },
    });

    return results?.[0]?.result || { imageUrl: null, isSoldOut: false };
  } catch (e) {
    // Tab may have navigated to chrome:// or other restricted URL
    return { imageUrl: null, isSoldOut: false };
  }
}

// ============================================================
// IMPORT: Send items to wishlist app, then auto-fix images
// ============================================================
async function handleImport(data) {
  // Retry up to 3 times with exponential backoff for network failures
  let response;
  let lastError;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      response = await fetch(`${API_BASE}/api/items/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        signal: AbortSignal.timeout(30000), // 30 second timeout for imports (can be slow with many items)
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => 'Unknown error');
        throw new Error(`Server error ${response.status}: ${errText}`);
      }

      // Success
      lastError = null;
      break;
    } catch (e) {
      lastError = e;
      console.warn(`[Judi's Wishlist] Import attempt ${attempt} failed: ${e.message}`);
      if (attempt < 3) {
        await sleep(attempt * 2000); // 2s, 4s backoff
      }
    }
  }

  if (lastError) {
    throw new Error(`Import failed after 3 attempts: ${lastError.message}`);
  }

  let result;
  try {
    result = await response.json();
  } catch (e) {
    console.error('[Judi\'s Wishlist] Failed to parse import response:', e);
    throw new Error('Invalid server response');
  }

  // After import, auto-fix images for items that don't have good ones.
  // Filter to only items that actually need fixing (not all imported items).
  const items = Array.isArray(result?.items) ? result.items : [];
  if (items.length > 0) {
    const itemsToFix = items
      .filter(i => {
        if (!i || !i.product_url || !i.product_url.includes('temu.com')) return false;
        const img = i.image_url || '';
        if (!img) return true;
        return !isGoodImageUrl(img);
      })
      .map(i => ({
        id: i.id,
        product_url: i.product_url,
        image_url: i.image_url,
        title: i.title || '',
      }));

    if (itemsToFix.length > 0) {
      console.log(`[Judi's Wishlist] Post-import: ${itemsToFix.length} of ${items.length} items need image fix`);
      // Don't await — let it run in background
      fixMissingImages('import', itemsToFix)
        .then(s => console.log(`[Judi's Wishlist] Post-import image fix done:`, s))
        .catch(e => console.error(`[Judi's Wishlist] Post-import image fix error:`, e));
    } else {
      console.log(`[Judi's Wishlist] Post-import: all ${items.length} items already have good images`);
    }
  }

  return result;
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================
async function fetchLists() {
  const response = await fetch(`${API_BASE}/api/lists`, {
    signal: AbortSignal.timeout(5000), // 5 second timeout
  });
  if (!response.ok) throw new Error('Failed to fetch lists');
  return response.json();
}

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
