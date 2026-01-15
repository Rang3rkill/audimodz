// Temu content script
// This script runs on Temu pages and provides scraping utilities

const TEMU_SELECTORS = {
  // Product link - STABLE (contains goods_id)
  productLink: 'a[href*="goods_id="]',

  // Price - STABLE (uses data attribute)
  priceContainer: '[data-through-self="true"]',

  // Quantity input - STABLE (has aria-label with quantity value)
  quantityInput: 'input[aria-label][value]',

  // Image - STABLE (uses specific CDN domain)
  productImage: 'img[src*="img.kwcdn.com/product"]',
};

// Extract goods_id from URL
function extractTemuProductId(href) {
  const match = href.match(/goods_id=(\d+)/);
  return match ? match[1] : null;
}

// Build clean product URL
function buildTemuProductUrl(goodsId) {
  return `https://www.temu.com/goods.html?goods_id=${goodsId}`;
}

// Parse price from container
function parseTemuPrice(container) {
  if (!container) return null;
  const text = container.textContent?.replace(/[^0-9.]/g, '');
  return parseFloat(text) || null;
}

// Scrape all cart items
function scrapeTemuCart() {
  const items = [];
  const seen = new Set();

  const productLinks = document.querySelectorAll(TEMU_SELECTORS.productLink);

  productLinks.forEach(link => {
    const productId = extractTemuProductId(link.href);
    if (!productId || seen.has(productId)) return;
    seen.add(productId);

    // Find container
    let container = link.closest('div[class]');
    for (let i = 0; i < 5 && container; i++) {
      if (container.querySelector(TEMU_SELECTORS.productImage)) break;
      container = container.parentElement;
    }
    if (!container) return;

    // Get title
    let title = link.textContent?.trim();
    if (!title || title.length < 5) {
      const img = container.querySelector(TEMU_SELECTORS.productImage);
      title = img?.alt || 'Unknown Product';
    }

    // Get image
    const img = container.querySelector(TEMU_SELECTORS.productImage);
    const imageUrl = img?.src || null;

    // Get price
    const priceContainer = container.querySelector(TEMU_SELECTORS.priceContainer);
    const price = parseTemuPrice(priceContainer);

    // Get quantity
    let quantity = 1;
    const qtyInput = container.querySelector(TEMU_SELECTORS.quantityInput);
    if (qtyInput) {
      quantity = parseInt(qtyInput.value) || parseInt(qtyInput.getAttribute('aria-label')) || 1;
    }

    items.push({
      product_id: productId,
      product_url: buildTemuProductUrl(productId),
      title: title,
      image_url: imageUrl,
      price: price,
      quantity: quantity,
    });
  });

  return items;
}

// Expose to global scope for popup script
window.scrapeTemuCart = scrapeTemuCart;

// Log when loaded
console.log('[Judi\'s Wishlist] Temu content script loaded');
