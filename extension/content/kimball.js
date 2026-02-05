// Kimball Midwest content script
// This script runs on Kimball Midwest catalog pages and provides scraping utilities
// Supports barcode/part number lookup for industrial parts inventory

const VERBOSE = true;

function log(...args) {
  if (VERBOSE) console.log('[Judi\'s Wishlist - Kimball]', ...args);
}

const KIMBALL_SELECTORS = {
  // Product containers - various patterns for catalog pages
  productItem: '.product-item, .product-card, [data-product-id], .item-row, .catalog-item',

  // Part number - the key identifier for Kimball items
  partNumber: '.part-number, .product-sku, .item-number, [data-part-number], .sku',

  // Title/Description
  productTitle: '.product-title, .product-name, .item-title, .item-name, h1.title, h2.product-title',

  // Price
  price: '.price, .product-price, .item-price, .cost, [data-price]',

  // Image
  productImage: '.product-image img, .item-image img, img[src*="product"], img[src*="item"]',

  // Quantity (for order pages)
  quantity: 'input[name*="qty"], input[name*="quantity"], input[type="number"]',

  // Product link
  productLink: 'a[href*="product"], a[href*="item"], a[href*="detail"]',
};

// Extract part number from element or URL
function extractKimballPartNumber(element) {
  // Try data attribute
  if (element.dataset?.partNumber) return element.dataset.partNumber;
  if (element.dataset?.productId) return element.dataset.productId;
  if (element.dataset?.sku) return element.dataset.sku;

  // Try part number element
  for (const selector of KIMBALL_SELECTORS.partNumber.split(', ')) {
    const el = element.querySelector(selector);
    if (el) {
      const text = el.textContent?.trim();
      if (text && text.length >= 4 && text.length <= 20) {
        return text.replace(/^(Part|Item|SKU|#):?\s*/i, '').trim();
      }
    }
  }

  // Try URL patterns
  const link = element.querySelector(KIMBALL_SELECTORS.productLink);
  if (link) {
    // Pattern: /product/12345 or ?item=12345
    const urlMatch = link.href.match(/(?:\/product[s]?\/|[?&]item[_-]?(?:id)?=)([A-Z0-9\-]+)/i);
    if (urlMatch) return urlMatch[1].toUpperCase();

    // Pattern: KM followed by digits
    const kmMatch = link.href.match(/KM[\-_]?(\d{4,8})/i);
    if (kmMatch) return `KM${kmMatch[1]}`;
  }

  return null;
}

// Build Kimball catalog URL for a part number
function buildKimballProductUrl(partNumber) {
  return `https://catalog.kimballmidwest.com/search?q=${encodeURIComponent(partNumber)}`;
}

// Scrape current page for product info (for single product detail pages)
function scrapeKimballProduct() {
  log('Scraping current Kimball page...');

  // Try to get part number from page
  let partNumber = null;
  const partElements = document.querySelectorAll(KIMBALL_SELECTORS.partNumber);
  for (const el of partElements) {
    const text = el.textContent?.trim();
    if (text && text.length >= 4 && text.length <= 20) {
      partNumber = text.replace(/^(Part|Item|SKU|#):?\s*/i, '').trim();
      log('Found part number:', partNumber);
      break;
    }
  }

  // Also check URL
  if (!partNumber) {
    const urlMatch = window.location.href.match(/(?:\/product[s]?\/|[?&](?:item|q|search)=)([A-Z0-9\-]+)/i);
    if (urlMatch) {
      partNumber = urlMatch[1].toUpperCase();
      log('Found part number in URL:', partNumber);
    }
  }

  if (!partNumber) {
    log('No part number found on page');
    return null;
  }

  // Get title
  let title = null;
  const titleSelectors = KIMBALL_SELECTORS.productTitle.split(', ');
  for (const sel of titleSelectors) {
    const el = document.querySelector(sel);
    if (el) {
      title = el.textContent?.trim();
      if (title && title.length > 3) {
        title = title.replace(/\s+/g, ' ').trim();
        log('Found title:', title);
        break;
      }
    }
  }

  // Get image
  let imageUrl = null;
  const imgSelectors = KIMBALL_SELECTORS.productImage.split(', ');
  for (const sel of imgSelectors) {
    const img = document.querySelector(sel);
    if (img?.src && img.src.startsWith('http')) {
      imageUrl = img.src;
      log('Found image:', imageUrl);
      break;
    }
  }

  // Get price
  let price = null;
  const priceSelectors = KIMBALL_SELECTORS.price.split(', ');
  for (const sel of priceSelectors) {
    const el = document.querySelector(sel);
    if (el) {
      const priceText = el.textContent?.replace(/[^0-9.]/g, '');
      const parsed = parseFloat(priceText);
      if (!isNaN(parsed) && parsed > 0 && parsed < 100000) {
        price = parsed;
        log('Found price:', price);
        break;
      }
    }
  }

  if (!partNumber && !title) {
    log('Could not find product info');
    return null;
  }

  return {
    product_id: partNumber || 'unknown',
    part_number: partNumber,
    product_url: window.location.href,
    title: title || `Kimball Part ${partNumber}`,
    image_url: imageUrl,
    price: price,
    quantity: 1,
  };
}

// Scrape multiple items from a catalog/search page
function scrapeKimballCatalog() {
  const items = [];
  const seen = new Set();

  log('Scraping Kimball catalog page...');

  // Find all product containers
  const productContainers = document.querySelectorAll(KIMBALL_SELECTORS.productItem);
  log('Found', productContainers.length, 'potential product containers');

  productContainers.forEach((container, index) => {
    const partNumber = extractKimballPartNumber(container);
    if (!partNumber || seen.has(partNumber)) return;
    seen.add(partNumber);

    // Get title
    let title = null;
    for (const sel of KIMBALL_SELECTORS.productTitle.split(', ')) {
      const el = container.querySelector(sel);
      if (el) {
        title = el.textContent?.trim().replace(/\s+/g, ' ');
        if (title && title.length > 3) break;
      }
    }

    // Get image
    let imageUrl = null;
    for (const sel of KIMBALL_SELECTORS.productImage.split(', ')) {
      const img = container.querySelector(sel);
      if (img?.src && img.src.startsWith('http')) {
        imageUrl = img.src;
        break;
      }
    }

    // Get price
    let price = null;
    for (const sel of KIMBALL_SELECTORS.price.split(', ')) {
      const el = container.querySelector(sel);
      if (el) {
        const priceText = el.textContent?.replace(/[^0-9.]/g, '');
        const parsed = parseFloat(priceText);
        if (!isNaN(parsed) && parsed > 0 && parsed < 100000) {
          price = parsed;
          break;
        }
      }
    }

    // Get quantity (default 1)
    let quantity = 1;
    for (const sel of KIMBALL_SELECTORS.quantity.split(', ')) {
      const qtyEl = container.querySelector(sel);
      if (qtyEl) {
        const parsedQty = parseInt(qtyEl.value);
        if (!isNaN(parsedQty) && parsedQty > 0 && parsedQty < 1000) {
          quantity = parsedQty;
          break;
        }
      }
    }

    items.push({
      product_id: partNumber,
      part_number: partNumber,
      product_url: buildKimballProductUrl(partNumber),
      title: title || `Kimball Part ${partNumber}`,
      image_url: imageUrl,
      price: price,
      quantity: quantity,
    });

    log('Added item:', partNumber, title);
  });

  // If no items found from containers, try scraping the single product page
  if (items.length === 0) {
    log('No catalog items found, trying single product scrape...');
    const singleProduct = scrapeKimballProduct();
    if (singleProduct) {
      items.push(singleProduct);
    }
  }

  log('Total items scraped:', items.length);
  return items;
}

// Main scrape function - called by popup
function scrapeKimballCart() {
  // Kimball doesn't have a traditional "cart" - scrape catalog/search results instead
  return scrapeKimballCatalog();
}

// Expose to global scope for popup script
window.scrapeKimballCart = scrapeKimballCart;
window.scrapeKimballProduct = scrapeKimballProduct;
window.scrapeKimballCatalog = scrapeKimballCatalog;

// Log when loaded
log('Kimball Midwest content script loaded');
log('Current URL:', window.location.href);
