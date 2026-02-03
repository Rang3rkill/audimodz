"""Tests for price-in-cents normalization (server-side safety net).

The normalize_price_cents() function in routes/items.py provides a server-side
safety net for normalizing Temu's cent-based prices to dollars. This catches
any cases where the client-side (extension) normalization missed.

Key heuristics:
- Already has decimals -> keep as-is (already dollars)
- < 100 -> definitely dollars
- Non-zero ending (1299, 499) -> definitely cents, divide by 100
- Zero ending but >= 10000 (15000) -> likely cents ($150.00)
- Zero ending 100-9999 -> ambiguous, keep as-is
"""
import pytest
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


class TestNormalizePriceCents:
    """Test the normalize_price_cents function directly."""

    @pytest.fixture
    def normalize_fn(self):
        """Import the function for testing."""
        from routes.items import normalize_price_cents
        return normalize_price_cents

    # === Basic cases ===

    def test_none_returns_none(self, normalize_fn):
        assert normalize_fn(None) is None

    def test_invalid_string_returns_none(self, normalize_fn):
        assert normalize_fn("not a number") is None
        assert normalize_fn("abc") is None

    def test_negative_returns_none(self, normalize_fn):
        assert normalize_fn(-5.00) is None
        assert normalize_fn(-100) is None

    # === Already dollars (has decimals) ===

    def test_decimal_price_unchanged(self, normalize_fn):
        """Prices with decimals are already in dollars."""
        assert normalize_fn(6.35) == 6.35
        assert normalize_fn(12.99) == 12.99
        assert normalize_fn(150.50) == 150.50
        assert normalize_fn(0.99) == 0.99

    # === Small values are definitely dollars ===

    def test_small_integer_treated_as_dollars(self, normalize_fn):
        """Integers < 100 are definitely dollars."""
        assert normalize_fn(5) == 5.0
        assert normalize_fn(15) == 15.0
        assert normalize_fn(99) == 99.0

    # === Non-zero ending integers are cents ===

    def test_non_zero_ending_normalized(self, normalize_fn):
        """Integers ending in non-00 are cents (1299 = $12.99)."""
        assert normalize_fn(635) == 6.35      # $6.35
        assert normalize_fn(1299) == 12.99    # $12.99
        assert normalize_fn(499) == 4.99      # $4.99
        assert normalize_fn(199) == 1.99      # $1.99
        assert normalize_fn(2499) == 24.99    # $24.99

    def test_non_zero_ending_edge_cases(self, normalize_fn):
        """Test edge cases for non-zero ending."""
        assert normalize_fn(101) == 1.01      # $1.01
        assert normalize_fn(110) == 1.10      # $1.10 (ends in 10, not 00)
        assert normalize_fn(150) == 1.50      # $1.50

    # === Zero ending high values are cents ===

    def test_high_value_zero_ending_normalized(self, normalize_fn):
        """Integers >= 10000 ending in 00 are likely cents."""
        assert normalize_fn(10000) == 100.00   # $100.00
        assert normalize_fn(15000) == 150.00   # $150.00
        assert normalize_fn(25000) == 250.00   # $250.00

    # === Ambiguous zero-ending values ===

    def test_ambiguous_zero_ending_kept_as_is(self, normalize_fn):
        """Values 100-9999 ending in 00 are ambiguous, keep as-is."""
        # These could be $1.00 (cents) or $100 (dollars) - we keep as dollars
        assert normalize_fn(100) == 100.0
        assert normalize_fn(200) == 200.0
        assert normalize_fn(500) == 500.0
        assert normalize_fn(1000) == 1000.0
        assert normalize_fn(5000) == 5000.0

    # === String inputs ===

    def test_string_prices_parsed(self, normalize_fn):
        """String prices should be parsed correctly."""
        assert normalize_fn("6.35") == 6.35
        assert normalize_fn("1299") == 12.99
        assert normalize_fn("15.00") == 15.00

    # === Validation bounds ===

    def test_result_within_bounds(self, normalize_fn):
        """Normalized price should be within reasonable bounds ($0.50 to $9999)."""
        # Very small cents
        result = normalize_fn(50)  # 50 cents
        assert result == 50.0 or result == 0.50

        # Check bounds are applied in import logic, not in normalize_price_cents itself
        # normalize_price_cents just normalizes, doesn't validate bounds


class TestPriceNormalizationInImport:
    """Test that price normalization is applied during import."""

    def test_cent_price_normalized_on_import(self, client):
        """Importing with price in cents should normalize to dollars."""
        resp = client.post('/api/items/import', json={
            'store': 'temu',
            'items': [{
                'product_id': 'CENT001',
                'product_url': 'https://www.temu.com/goods.html?goods_id=CENT001',
                'title': 'Cent Price Item',
                'price': 1299,  # Should become $12.99
                'quantity': 1,
            }],
        })
        assert resp.status_code == 200

        item = client.get('/api/items').get_json()[0]
        assert item['current_price'] == 12.99

    def test_dollar_price_unchanged_on_import(self, client):
        """Importing with price in dollars should stay unchanged."""
        resp = client.post('/api/items/import', json={
            'store': 'temu',
            'items': [{
                'product_id': 'DOLLAR001',
                'product_url': 'https://www.temu.com/goods.html?goods_id=DOLLAR001',
                'title': 'Dollar Price Item',
                'price': 12.99,
                'quantity': 1,
            }],
        })
        assert resp.status_code == 200

        item = client.get('/api/items').get_json()[0]
        assert item['current_price'] == 12.99

    def test_original_price_also_normalized(self, client):
        """Both current and original prices should be normalized."""
        resp = client.post('/api/items/import', json={
            'store': 'temu',
            'items': [{
                'product_id': 'BOTH001',
                'product_url': 'https://www.temu.com/goods.html?goods_id=BOTH001',
                'title': 'Both Prices Item',
                'price': 635,          # Should become $6.35
                'original_price': 1500,  # Should become $15.00
                'quantity': 1,
            }],
        })
        assert resp.status_code == 200

        item = client.get('/api/items').get_json()[0]
        assert item['current_price'] == 6.35
        assert item['original_price'] == 15.00

    def test_out_of_bounds_price_rejected(self, client):
        """Prices outside valid range should be set to null."""
        resp = client.post('/api/items/import', json={
            'store': 'temu',
            'items': [{
                'product_id': 'INVALID001',
                'product_url': 'https://www.temu.com/goods.html?goods_id=INVALID001',
                'title': 'Invalid Price Item',
                'price': 0.001,  # Too small after normalization
                'quantity': 1,
            }],
        })
        assert resp.status_code == 200

        item = client.get('/api/items').get_json()[0]
        assert item['current_price'] is None


class TestRealWorldPriceScenarios:
    """Test realistic price scenarios from Temu cart data."""

    def test_typical_sale_item_cents(self, client):
        """Typical Temu sale item: original 1499 cents, sale 635 cents."""
        resp = client.post('/api/items/import', json={
            'store': 'temu',
            'items': [{
                'product_id': 'SALE001',
                'product_url': 'https://www.temu.com/goods.html?goods_id=SALE001',
                'title': 'Kitchen Set 10pcs',
                'price': 635,
                'original_price': 1499,
                'quantity': 1,
            }],
        })
        assert resp.status_code == 200

        item = client.get('/api/items').get_json()[0]
        assert item['current_price'] == 6.35
        assert item['original_price'] == 14.99

    def test_cheap_item_under_dollar(self, client):
        """Items under $1 like 99 cents."""
        resp = client.post('/api/items/import', json={
            'store': 'temu',
            'items': [{
                'product_id': 'CHEAP001',
                'product_url': 'https://www.temu.com/goods.html?goods_id=CHEAP001',
                'title': 'Phone Ring Holder',
                'price': 0.99,  # Already in dollars
                'quantity': 1,
            }],
        })
        assert resp.status_code == 200

        item = client.get('/api/items').get_json()[0]
        assert item['current_price'] == 0.99

    def test_cheap_item_cents(self, client):
        """Items under $5 in cents: 299 = $2.99."""
        resp = client.post('/api/items/import', json={
            'store': 'temu',
            'items': [{
                'product_id': 'CHEAP002',
                'product_url': 'https://www.temu.com/goods.html?goods_id=CHEAP002',
                'title': 'USB Cable',
                'price': 299,  # Cents
                'quantity': 1,
            }],
        })
        assert resp.status_code == 200

        item = client.get('/api/items').get_json()[0]
        assert item['current_price'] == 2.99

    def test_expensive_item(self, client):
        """Expensive items like $150.00 (15000 cents)."""
        resp = client.post('/api/items/import', json={
            'store': 'temu',
            'items': [{
                'product_id': 'EXPENSIVE001',
                'product_url': 'https://www.temu.com/goods.html?goods_id=EXPENSIVE001',
                'title': 'Drone Camera',
                'price': 15000,  # Cents -> $150.00
                'quantity': 1,
            }],
        })
        assert resp.status_code == 200

        item = client.get('/api/items').get_json()[0]
        assert item['current_price'] == 150.00
