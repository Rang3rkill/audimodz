// Amazon content script
// This script runs on Amazon pages and provides scraping utilities

const AMAZON_SELECTORS = {
  // Cart item container - ASIN is on the container
  cartItem: '[data-asin]',

  // Title
  productTitle: '.sc-product-title, .a-truncate-cut, a[href*="/dp/"]',

  // Price
  price: '.sc-product-price, .sc-price, .a-price .a-offscreen',

  // Image
  productImage: '.sc-product-image img, img[src*="images-amazon"]',

  // Quantity
  quantity: '.sc-quantity-textfield, select[name*="quantity"], input[name*="quantity"]',

  // Product link
  productLink: 'a[href*="/dp/"]',
};

// Extract ASIN from URL or data attribute
function extractAmazonAsin(element) {
  // Try data attribute first
  if (element.dataset?.asin) return element.dataset.asin;

  // Try URL (case-insensitive - ASINs can appear in various cases in URLs)
  const link = element.querySelector(AMAZON_SELECTORS.productLink);
  if (link) {
    const match = link.href.match(/\/dp\/([A-Za-z0-9]{10})/i);
    return match ? match[1].toUpperCase() : null;  // Normalize to uppercase
  }
  return null;
}

// Build clean product URL
function buildAmazonProductUrl(asin) {
  return `https://www.amazon.com/dp/${asin}`;
}

// Build add-to-cart URL for multiple items
function buildAmazonCartUrl(items) {
  const params = items.map((item, i) => {
    const n = i + 1;
    return `ASIN.${n}=${item.asin}&Quantity.${n}=${item.quantity}`;
  }).join('&');

  return `https://www.amazon.com/gp/aws/cart/add.html?${params}`;
}

// Scrape all cart items
function scrapeAmazonCart() {
  const items = [];
  const seen = new Set();

  const cartItems = document.querySelectorAll(AMAZON_SELECTORS.cartItem);

  cartItems.forEach(item => {
    const asin = item.dataset.asin;
    if (!asin || asin.length !== 10 || seen.has(asin)) return;
    seen.add(asin);

    // Get title
    const titleEl = item.querySelector(AMAZON_SELECTORS.productTitle);
    let title = titleEl?.textContent?.trim() || 'Unknown Product';
    // Clean up title
    title = title.replace(/\s+/g, ' ').trim();

    // Get image
    const img = item.querySelector(AMAZON_SELECTORS.productImage);
    const imageUrl = img?.src || null;

    // Get price (current and original for sale detection)
    let price = null;
    let originalPrice = null;

    // Current price selectors
    const currentPriceSelectors = [
      '.sc-product-price', '.sc-price',
      '.a-price:not([data-a-strike]) .a-offscreen',
      '.a-color-price',
    ];
    // Original/was price selectors (strikethrough)
    const originalPriceSelectors = [
      '.a-price[data-a-strike] .a-offscreen',
      '.a-text-strike .a-offscreen',
      '.a-text-strike',
    ];

    for (const sel of currentPriceSelectors) {
      const el = item.querySelector(sel);
      if (el) {
        const priceText = el.textContent?.replace(/[^0-9.]/g, '');
        const parsed = parseFloat(priceText);
        if (!isNaN(parsed) && parsed > 0 && parsed < 100000) {
          price = parsed;
          break;
        }
      }
    }

    for (const sel of originalPriceSelectors) {
      const el = item.querySelector(sel);
      if (el) {
        const priceText = el.textContent?.replace(/[^0-9.]/g, '');
        const parsed = parseFloat(priceText);
        if (!isNaN(parsed) && parsed > 0 && parsed < 100000 && parsed > (price || 0)) {
          originalPrice = parsed;
          break;
        }
      }
    }

    // Get quantity (handle input and select elements)
    let quantity = 1;
    const qtyEl = item.querySelector(AMAZON_SELECTORS.quantity);
    if (qtyEl) {
      const parsedQty = parseInt(qtyEl.value);
      if (!isNaN(parsedQty) && parsedQty > 0 && parsedQty < 1000) {
        quantity = parsedQty;
      }
    }

    items.push({
      product_id: asin,
      product_url: buildAmazonProductUrl(asin),
      title: title,
      image_url: imageUrl,
      price: price,
      original_price: originalPrice,
      quantity: quantity,
    });
  });

  return items;
}

// Expose to global scope for popup script
window.scrapeAmazonCart = scrapeAmazonCart;
window.buildAmazonCartUrl = buildAmazonCartUrl;

// Log when loaded
console.log('[Judi\'s Wishlist] Amazon content script loaded');
