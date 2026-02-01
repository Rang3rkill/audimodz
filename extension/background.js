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
});

// Clean up captured data when tabs are closed
chrome.tabs.onRemoved.addListener((tabId) => {
  capturedCartData.delete(tabId);
});

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
