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
let fixImagesStatus = { total: 0, processed: 0, updated: 0, failed: 0, current: '' };

async function fixMissingImages() {
  if (fixImagesRunning) return fixImagesStatus;
  fixImagesRunning = true;
  fixImagesStatus = { total: 0, processed: 0, updated: 0, failed: 0, current: '' };

  try {
    // Get ALL items from the server — we'll scrape every single one
    const resp = await fetch(`${API_BASE}/api/items`);
    if (!resp.ok) throw new Error('Failed to get items');
    const allItems = await resp.json();

    // Filter to items with product URLs (temu only for now)
    const items = allItems.filter(i => i.product_url && i.product_url.includes('temu.com'));

    fixImagesStatus.total = items.length;
    if (items.length === 0) {
      fixImagesRunning = false;
      return fixImagesStatus;
    }

    // Process each item: open tab, scrape image, update server
    for (const item of items) {
      fixImagesStatus.current = (item.title || '').substring(0, 50);

      try {
        const imageUrl = await scrapeImageFromProductPage(item.product_url);

        if (imageUrl) {
          // Only update if different from current
          if (imageUrl !== item.image_url) {
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
          }
          // Same image = skip, not a failure
        } else {
          fixImagesStatus.failed++;
        }
      } catch (e) {
        console.log(`[Judi's Wishlist] Failed to scrape image for item ${item.id}: ${e.message}`);
        fixImagesStatus.failed++;
      }

      fixImagesStatus.processed++;

      // Small delay between items
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
  // Open the product page in a background tab
  const tab = await chrome.tabs.create({ url, active: false });

  try {
    // Wait for the page to load
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Tab load timeout')), 20000);

      function listener(tabId, changeInfo) {
        if (tabId === tab.id && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          clearTimeout(timeout);
          // Give JS a moment to render
          setTimeout(resolve, 2000);
        }
      }
      chrome.tabs.onUpdated.addListener(listener);
    });

    // Execute script to grab the product image
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        // Try multiple sources for the product image
        // 1. og:image meta tag (most reliable on product pages)
        const ogImage = document.querySelector('meta[property="og:image"]');
        if (ogImage?.content && ogImage.content.startsWith('http')) {
          return ogImage.content;
        }

        // 2. Look for product image in JSON-LD
        const jsonLd = document.querySelectorAll('script[type="application/ld+json"]');
        for (const script of jsonLd) {
          try {
            const data = JSON.parse(script.textContent);
            if (data.image) {
              const img = Array.isArray(data.image) ? data.image[0] : data.image;
              if (typeof img === 'string' && img.startsWith('http')) return img;
              if (img?.url && img.url.startsWith('http')) return img.url;
            }
          } catch {}
        }

        // 3. Look for thumb_url in page scripts
        const scripts = document.querySelectorAll('script:not([src])');
        for (const script of scripts) {
          const text = script.textContent;
          const match = text.match(/"thumb_url"\s*:\s*"(https?:[^"]+)"/);
          if (match) {
            return match[1].replace(/\\u002F/g, '/').replace(/\\\//g, '/');
          }
        }

        // 4. First large product image on the page
        const imgs = document.querySelectorAll('img[src*="kwcdn"], img[src*="akamaized"]');
        for (const img of imgs) {
          if (img.naturalWidth > 100 && img.naturalHeight > 100 && img.src.startsWith('http')) {
            return img.src;
          }
        }

        // 5. Any img with product-like src
        for (const img of imgs) {
          if (img.src.startsWith('http') && img.src.includes('product')) {
            return img.src;
          }
        }

        return null;
      },
    });

    return results[0]?.result || null;
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
