// Bridge between MAIN world interceptor and background service worker.
// Runs in ISOLATED world (has chrome.runtime access).
// Receives postMessage from interceptor.js and forwards to background.js.

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.data?.type !== '__JWL_CART_CAPTURED__') return;

  try {
    chrome.runtime.sendMessage({
      type: 'CART_API_CAPTURED',
      endpoint: event.data.endpoint,
      data: event.data.data,
    });
  } catch (e) {
    // Extension context invalidated, ignore
  }
});
