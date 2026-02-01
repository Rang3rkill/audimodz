/**
 * Tests for extension price extraction logic.
 *
 * Run with: node tests/test_price_extraction.js
 *
 * Tests the pickBestPrice() function which is the core of correct
 * sale price handling. Temu data objects have multiple price fields:
 *   - price/priceCent = original full price (e.g., $15.00 or 1500)
 *   - salePrice/salePriceCent = discounted price (e.g., $6.35 or 635)
 *   - promoPrice, discountPrice = other discount fields
 *
 * The bug was: code checked `price` first (original $15), so sale price
 * ($6.35) was never used. pickBestPrice fixes this by checking sale fields first.
 */

// Copy of pickBestPrice from popup.js for isolated testing
function pickBestPrice(obj) {
  const candidates = [
    obj.sale_price, obj.salePrice, obj.salePriceCent,
    obj.promo_price, obj.promoPrice,
    obj.discount_price, obj.discountPrice,
    obj.current_price, obj.currentPrice,
    obj.price, obj.priceCent,
  ];
  let best = null;
  let original = null;
  for (const v of candidates) {
    const n = parseFloat(v);
    if (!isNaN(n) && n > 0) {
      if (best === null) best = n;
      if (original === null || n > original) original = n;
    }
  }
  if (best !== null && best > 100 && Number.isInteger(best)) best = best / 100;
  if (original !== null && original > 100 && Number.isInteger(original)) original = original / 100;
  if (best !== null && (best < 0.01 || best > 99999)) best = null;
  if (original !== null && (original < 0.01 || original > 99999)) original = null;
  return { salePrice: best, originalPrice: original };
}

// Simple test runner
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`  FAIL: ${message}`);
    failed++;
  } else {
    console.log(`  PASS: ${message}`);
    passed++;
  }
}

function assertApprox(actual, expected, message) {
  if (expected === null) {
    assert(actual === null, `${message} (expected null, got ${actual})`);
  } else {
    assert(Math.abs(actual - expected) < 0.01, `${message} (expected ${expected}, got ${actual})`);
  }
}

// ========== TEST CASES ==========

console.log('\n=== Sale price vs original price priority ===');

(function testSalePricePreferredOverOriginal() {
  // This is THE bug: Temu sends price=$15 and salePrice=$6.35
  const result = pickBestPrice({ price: 15.00, salePrice: 6.35 });
  assertApprox(result.salePrice, 6.35, 'Sale price ($6.35) used as current price');
  assertApprox(result.originalPrice, 15.00, 'Original price ($15.00) preserved');
})();

(function testSalePriceFieldVariants() {
  // sale_price (underscore variant)
  let r = pickBestPrice({ price: 20.00, sale_price: 8.50 });
  assertApprox(r.salePrice, 8.50, 'sale_price field recognized');

  // promoPrice
  r = pickBestPrice({ price: 20.00, promoPrice: 5.99 });
  assertApprox(r.salePrice, 5.99, 'promoPrice field recognized');

  // discountPrice
  r = pickBestPrice({ price: 20.00, discountPrice: 7.25 });
  assertApprox(r.salePrice, 7.25, 'discountPrice field recognized');
})();

console.log('\n=== Price-in-cents normalization ===');

(function testCentsNormalization() {
  // Temu sometimes returns 1299 meaning $12.99
  const r = pickBestPrice({ salePrice: 635, price: 1500 });
  assertApprox(r.salePrice, 6.35, 'Sale price 635 cents -> $6.35');
  assertApprox(r.originalPrice, 15.00, 'Original price 1500 cents -> $15.00');
})();

(function testDecimalPriceNotNormalized() {
  // $150.00 should NOT be divided by 100
  const r = pickBestPrice({ price: 150.50 });
  assertApprox(r.salePrice, 150.50, '$150.50 not treated as cents (has decimal)');
})();

(function testSmallCentsValue() {
  // 299 cents = $2.99
  const r = pickBestPrice({ salePrice: 299 });
  assertApprox(r.salePrice, 2.99, '299 cents -> $2.99');
})();

console.log('\n=== Edge cases ===');

(function testNoPriceReturnsNull() {
  const r = pickBestPrice({});
  assert(r.salePrice === null, 'No price fields -> salePrice null');
  assert(r.originalPrice === null, 'No price fields -> originalPrice null');
})();

(function testZeroPriceIgnored() {
  const r = pickBestPrice({ price: 0, salePrice: 0 });
  assert(r.salePrice === null, 'Zero prices ignored');
})();

(function testNegativePriceIgnored() {
  const r = pickBestPrice({ price: -5.00 });
  assert(r.salePrice === null, 'Negative price ignored');
})();

(function testOnlyOriginalPrice() {
  // If only `price` exists (no sale), use it as both
  const r = pickBestPrice({ price: 12.99 });
  assertApprox(r.salePrice, 12.99, 'price-only used as sale price');
  assertApprox(r.originalPrice, 12.99, 'price-only used as original price');
})();

(function testStringPricesParsed() {
  const r = pickBestPrice({ price: '15.00', salePrice: '6.35' });
  assertApprox(r.salePrice, 6.35, 'String sale price parsed correctly');
  assertApprox(r.originalPrice, 15.00, 'String original price parsed correctly');
})();

(function testCurrentPriceField() {
  // Some Temu responses use current_price
  const r = pickBestPrice({ current_price: 9.99, price: 14.99 });
  assertApprox(r.salePrice, 9.99, 'current_price preferred over price');
  assertApprox(r.originalPrice, 14.99, 'price stored as original');
})();

console.log('\n=== Realistic Temu cart API response objects ===');

(function testRealisticTemuItem() {
  // Simulates actual Temu cart API response structure
  const temuItem = {
    goods_id: '601234567890',
    goods_name: 'Silicone Kitchen Utensil Set 10pcs',
    thumb_url: 'https://img.kwcdn.com/product/fancy/abc123.jpg',
    price: 1499,         // $14.99 in cents (original)
    salePrice: 635,      // $6.35 in cents (what customer pays)
    quantity: 1,
  };
  const r = pickBestPrice(temuItem);
  assertApprox(r.salePrice, 6.35, 'Temu item: sale price $6.35');
  assertApprox(r.originalPrice, 14.99, 'Temu item: original price $14.99');
})();

(function testTemuItemNoSale() {
  // Item not on sale — only price field
  const temuItem = {
    goods_id: '601234567891',
    goods_name: 'Phone Case',
    price: 3.99,
    quantity: 2,
  };
  const r = pickBestPrice(temuItem);
  assertApprox(r.salePrice, 3.99, 'Non-sale item: price used as current');
  assertApprox(r.originalPrice, 3.99, 'Non-sale item: price used as original');
})();

(function testTemuItemWithPromoPriceCents() {
  // promo_price in cents
  const temuItem = {
    price: 2499,
    promo_price: 899,
  };
  const r = pickBestPrice(temuItem);
  assertApprox(r.salePrice, 8.99, 'Promo cents: $8.99');
  assertApprox(r.originalPrice, 24.99, 'Original cents: $24.99');
})();

// ========== RESULTS ==========
console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log(`${'='.repeat(50)}`);
process.exit(failed > 0 ? 1 : 0);
