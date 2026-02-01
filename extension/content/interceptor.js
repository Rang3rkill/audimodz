// Network interceptor for Temu cart pages
// Monkey-patches fetch() and XMLHttpRequest to capture cart API responses
// as they happen. This captures the EXACT data Temu's own UI uses.
//
// Runs in MAIN world (page context) so it can patch fetch/XHR.
// Stores captured data locally (page context) AND forwards to
// the bridge script (ISOLATED world) via postMessage.

(function() {
  'use strict';

  const LOG_PREFIX = '[Judi\'s Wishlist Interceptor]';

  // Local store — popup.js reads this via postMessage request/response
  const capturedEntries = [];

  // ========================
  // DETECTION LOGIC
  // ========================

  function isCartRelatedUrl(url) {
    if (!url) return false;
    const lower = url.toLowerCase();
    return lower.includes('/cart') ||
           lower.includes('/shopping') ||
           lower.includes('listcart') ||
           lower.includes('querycart') ||
           lower.includes('cart_query') ||
           lower.includes('cartgroup') ||
           lower.includes('checkout') ||
           lower.includes('/order/');
  }

  function containsCartItems(obj, depth) {
    if (!obj || typeof obj !== 'object' || depth > 6) return false;
    if (Array.isArray(obj)) {
      return obj.length > 0 && obj.some(item =>
        item && (item.goods_id || item.goodsId || item.product_id)
      );
    }
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      if (['cartGroupList', 'goodsList', 'cartItemList', 'cartGoods',
           'items', 'cartList', 'cartItems', 'shoppingCartList',
           'cart_group_list', 'goods_list'].includes(key)) {
        if (Array.isArray(val) && val.length > 0) return true;
      }
      if (val && typeof val === 'object' && containsCartItems(val, depth + 1)) {
        return true;
      }
    }
    return false;
  }

  // ========================
  // CAPTURE & STORE
  // ========================

  function captureResponse(url, responseText) {
    try {
      const json = JSON.parse(responseText);
      if (!containsCartItems(json, 0)) return;

      const endpoint = new URL(url, window.location.origin).pathname;
      const entry = { endpoint, data: json, timestamp: Date.now() };

      // Store locally for popup.js to retrieve
      capturedEntries.push(entry);
      // Prune old entries
      const cutoff = Date.now() - 5 * 60 * 1000;
      while (capturedEntries.length > 0 && capturedEntries[0].timestamp < cutoff) {
        capturedEntries.shift();
      }

      // Forward to bridge script (ISOLATED world → background.js)
      window.postMessage({ type: '__JWL_CART_CAPTURED__', endpoint, data: json }, '*');

      console.log(`${LOG_PREFIX} Captured cart data from: ${endpoint} (${capturedEntries.length} total captures)`);
    } catch (e) {
      // Not JSON or serialization error, ignore
    }
  }

  // ========================
  // RESPOND TO DATA REQUESTS
  // ========================
  // popup.js (running via executeScript in page context) asks for captured data

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data?.type === '__JWL_CART_DATA_REQUEST__') {
      const cutoff = Date.now() - 5 * 60 * 1000;
      const recent = capturedEntries.filter(e => e.timestamp > cutoff);
      window.postMessage({ type: '__JWL_CART_DATA_RESPONSE__', entries: recent }, '*');
    }
  });

  // ========================
  // PATCH fetch()
  // ========================
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const response = await originalFetch.apply(this, args);
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';

    if (url.includes('temu.com') || url.startsWith('/api') || url.startsWith('/')) {
      try {
        const clone = response.clone();
        const ct = clone.headers.get('content-type') || '';
        if (ct.includes('json') || isCartRelatedUrl(url)) {
          clone.text().then(text => captureResponse(url, text)).catch(() => {});
        }
      } catch (e) { /* Don't break the page */ }
    }

    return response;
  };

  // ========================
  // PATCH XMLHttpRequest
  // ========================
  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this._jwl_url = url;
    return originalXHROpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function(...args) {
    this.addEventListener('load', function() {
      const url = this._jwl_url || '';
      if (url.includes('temu.com') || url.startsWith('/api') || url.startsWith('/')) {
        try {
          const ct = this.getResponseHeader('content-type') || '';
          if (ct.includes('json') || isCartRelatedUrl(url)) {
            captureResponse(url, this.responseText);
          }
        } catch (e) { /* Don't break the page */ }
      }
    });
    return originalXHRSend.apply(this, args);
  };

  console.log(`${LOG_PREFIX} Network interceptor active — capturing Temu API responses`);
})();
