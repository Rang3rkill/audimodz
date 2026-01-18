// Temu content script
// This script runs on Temu pages and provides scraping utilities

const VERBOSE = true; // Enable verbose logging

function log(...args) {
  if (VERBOSE) console.log('[Judi\'s Wishlist]', ...args);
}

function warn(...args) {
  console.warn('[Judi\'s Wishlist]', ...args);
}

const TEMU_SELECTORS = {
  // Product link - STABLE (contains goods_id)
  productLink: 'a[href*="goods_id="]',

  // Price selectors to try (in order)
  priceSelectors: [
    '[data-through-self="true"]',
    'span[class*="price"]',
    'div[class*="price"]',
    '[class*="Price"]',
  ],

  // Quantity input selectors to try
  quantitySelectors: [
    'input[aria-label][value]',
    'input[type="text"][value]',
    'span[class*="quantity"]',
    'span[class*="Quantity"]',
  ],

  // Image selectors to try
  imageSelectors: [
    'img[src*="img.kwcdn.com/product"]',
    'img[src*="img.kwcdn.com"]',
    'img[src*="akamaized"]',
    'img[class*="product"]',
    'img[class*="Product"]',
  ],
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

// Try multiple selectors and return first match
function trySelectors(container, selectors, description) {
  for (const selector of selectors) {
    const el = container.querySelector(selector);
    if (el) {
      log(`  Found ${description} with selector: ${selector}`);
      return el;
    }
  }
  log(`  Could not find ${description} with any selector`);
  return null;
}

// Parse price from element
function parsePrice(element) {
  if (!element) return null;
  const text = element.textContent?.replace(/[^0-9.]/g, '');
  const price = parseFloat(text) || null;
  log(`  Price text: "${element.textContent?.trim()}" -> ${price}`);
  return price;
}

// Find the cart item container by walking up the DOM
function findCartItemContainer(link) {
  let container = link.parentElement;
  let depth = 0;
  const maxDepth = 10;

  while (container && depth < maxDepth) {
    // Check if this container has an image (likely the cart item wrapper)
    for (const selector of TEMU_SELECTORS.imageSelectors) {
      if (container.querySelector(selector)) {
        log(`  Found container at depth ${depth} with image selector: ${selector}`);
        return container;
      }
    }

    // Check if container has a reasonable size (cart items are usually wider)
    const rect = container.getBoundingClientRect();
    if (rect.width > 200 && rect.height > 50) {
      // Check if it looks like a cart item (has price or quantity)
      for (const selector of TEMU_SELECTORS.priceSelectors) {
        if (container.querySelector(selector)) {
          log(`  Found container at depth ${depth} with price selector: ${selector}`);
          return container;
        }
      }
    }

    container = container.parentElement;
    depth++;
  }

  warn(`  Could not find suitable container (searched ${depth} levels)`);
  return link.parentElement?.parentElement?.parentElement;
}

// Scrape all cart items with verbose logging
function scrapeTemuCart() {
  log('='.repeat(60));
  log('Starting Temu cart scrape...');
  log('Current URL:', window.location.href);
  log('='.repeat(60));

  const items = [];
  const seen = new Set();
  const skipped = { duplicate: 0, noContainer: 0, noTitle: 0 };

  // Find all product links
  const productLinks = document.querySelectorAll(TEMU_SELECTORS.productLink);
  log(`Found ${productLinks.length} product links with selector: ${TEMU_SELECTORS.productLink}`);

  // Also try to find cart item containers directly
  const cartContainers = document.querySelectorAll('[class*="cart"], [class*="Cart"], [data-testid*="cart"]');
  log(`Found ${cartContainers.length} potential cart containers`);

  // Log all unique class names containing "cart" or "item" for debugging
  const allElements = document.querySelectorAll('*');
  const cartClasses = new Set();
  allElements.forEach(el => {
    if (el.className && typeof el.className === 'string') {
      el.className.split(' ').forEach(cls => {
        if (cls.toLowerCase().includes('cart') || cls.toLowerCase().includes('item')) {
          cartClasses.add(cls);
        }
      });
    }
  });
  log('Classes containing "cart" or "item":', Array.from(cartClasses).slice(0, 20));

  productLinks.forEach((link, index) => {
    log('-'.repeat(40));
    log(`Processing link ${index + 1}/${productLinks.length}`);
    log(`  HREF: ${link.href.substring(0, 100)}...`);

    const productId = extractTemuProductId(link.href);
    if (!productId) {
      log(`  SKIP: Could not extract product ID`);
      return;
    }
    log(`  Product ID: ${productId}`);

    if (seen.has(productId)) {
      log(`  SKIP: Duplicate product ID`);
      skipped.duplicate++;
      return;
    }
    seen.add(productId);

    // Find container
    const container = findCartItemContainer(link);
    if (!container) {
      log(`  SKIP: No container found`);
      skipped.noContainer++;
      return;
    }
    log(`  Container classes: ${container.className?.substring(0, 100)}`);

    // Get title
    let title = link.textContent?.trim();
    log(`  Link text: "${title?.substring(0, 50)}..."`);

    if (!title || title.length < 5) {
      // Try to find title from image alt
      for (const selector of TEMU_SELECTORS.imageSelectors) {
        const img = container.querySelector(selector);
        if (img?.alt && img.alt.length > 5) {
          title = img.alt;
          log(`  Title from image alt: "${title?.substring(0, 50)}..."`);
          break;
        }
      }
    }

    if (!title || title.length < 3) {
      // Try any text content in container
      const textEls = container.querySelectorAll('span, div, p');
      for (const el of textEls) {
        const text = el.textContent?.trim();
        if (text && text.length > 10 && text.length < 200 && !text.includes('$')) {
          title = text;
          log(`  Title from text element: "${title?.substring(0, 50)}..."`);
          break;
        }
      }
    }

    if (!title || title.length < 3) {
      title = 'Unknown Product';
      log(`  WARN: Using default title`);
    }

    // Get image
    const img = trySelectors(container, TEMU_SELECTORS.imageSelectors, 'image');
    const imageUrl = img?.src || null;
    log(`  Image URL: ${imageUrl?.substring(0, 80)}...`);

    // Get price
    const priceEl = trySelectors(container, TEMU_SELECTORS.priceSelectors, 'price');
    const price = parsePrice(priceEl);

    // Get quantity
    let quantity = 1;
    const qtyEl = trySelectors(container, TEMU_SELECTORS.quantitySelectors, 'quantity');
    if (qtyEl) {
      quantity = parseInt(qtyEl.value) || parseInt(qtyEl.textContent) || 1;
      log(`  Quantity: ${quantity}`);
    }

    const item = {
      product_id: productId,
      product_url: buildTemuProductUrl(productId),
      title: title,
      image_url: imageUrl,
      price: price,
      quantity: quantity,
    };

    log(`  SUCCESS: Added item "${title.substring(0, 30)}..." @ $${price}`);
    items.push(item);
  });

  log('='.repeat(60));
  log(`SCRAPE COMPLETE`);
  log(`  Total items found: ${items.length}`);
  log(`  Skipped - Duplicates: ${skipped.duplicate}`);
  log(`  Skipped - No container: ${skipped.noContainer}`);
  log(`  Unique product IDs seen: ${seen.size}`);
  log('='.repeat(60));

  // If we found very few items, log more debug info
  if (items.length < 20 && productLinks.length > 0) {
    warn('LOW ITEM COUNT - Additional debug info:');
    warn('Page title:', document.title);
    warn('Body classes:', document.body.className);

    // Log first few product links in detail
    productLinks.forEach((link, i) => {
      if (i < 5) {
        warn(`Link ${i}:`, link.outerHTML.substring(0, 300));
      }
    });
  }

  return items;
}

// Expose to global scope for popup script
window.scrapeTemuCart = scrapeTemuCart;

// Log when loaded
console.log('[Judi\'s Wishlist] Temu content script loaded (verbose mode ON)');
console.log('[Judi\'s Wishlist] To manually test, run: scrapeTemuCart()');
