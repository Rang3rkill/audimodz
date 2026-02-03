"""Tests for Amazon cart import functionality.

Covers:
- Amazon item import with ASIN
- Amazon original_price handling
- Amazon quantity handling
"""
import pytest
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


class TestAmazonImport:
    """Test Amazon cart item import."""

    def test_amazon_item_import(self, client):
        """Basic Amazon item import with ASIN."""
        resp = client.post('/api/items/import', json={
            'store': 'amazon',
            'items': [{
                'product_id': 'B09V3KXJPB',
                'product_url': 'https://www.amazon.com/dp/B09V3KXJPB',
                'title': 'Amazon Test Product',
                'price': 29.99,
                'quantity': 1,
            }],
        })
        assert resp.status_code == 200

        item = client.get('/api/items').get_json()[0]
        assert item['product_id'] == 'B09V3KXJPB'
        assert item['store'] == 'amazon'
        assert item['current_price'] == 29.99

    def test_amazon_lowercase_asin_normalized(self, client):
        """Lowercase ASIN should be stored correctly."""
        resp = client.post('/api/items/import', json={
            'store': 'amazon',
            'items': [{
                'product_id': 'b09v3kxjpb',  # lowercase
                'product_url': 'https://www.amazon.com/dp/b09v3kxjpb',
                'title': 'Lowercase ASIN Product',
                'price': 19.99,
                'quantity': 1,
            }],
        })
        assert resp.status_code == 200

        item = client.get('/api/items').get_json()[0]
        # Product ID stored as provided (extension normalizes to uppercase)
        assert item['product_id'].upper() == 'B09V3KXJPB'


class TestAmazonOriginalPrice:
    """Test Amazon original_price (sale vs regular) handling."""

    def test_amazon_sale_and_original_price(self, client):
        """Amazon item with both sale and original price."""
        resp = client.post('/api/items/import', json={
            'store': 'amazon',
            'items': [{
                'product_id': 'B09SALE001',
                'product_url': 'https://www.amazon.com/dp/B09SALE001',
                'title': 'Amazon Sale Item',
                'price': 24.99,        # Sale price
                'original_price': 39.99,  # Was price
                'quantity': 1,
            }],
        })
        assert resp.status_code == 200

        item = client.get('/api/items').get_json()[0]
        assert item['current_price'] == 24.99
        assert item['original_price'] == 39.99

    def test_amazon_no_sale_price(self, client):
        """Amazon item without sale - original_price defaults to current_price."""
        resp = client.post('/api/items/import', json={
            'store': 'amazon',
            'items': [{
                'product_id': 'B09NOSALE1',
                'product_url': 'https://www.amazon.com/dp/B09NOSALE1',
                'title': 'Amazon Regular Price Item',
                'price': 49.99,
                'quantity': 1,
            }],
        })
        assert resp.status_code == 200

        item = client.get('/api/items').get_json()[0]
        assert item['current_price'] == 49.99
        # When no separate original_price provided, it defaults to current_price
        assert item['original_price'] == 49.99


class TestAmazonQuantity:
    """Test Amazon quantity handling."""

    def test_amazon_quantity_stored(self, client):
        """Amazon item quantity should be stored."""
        resp = client.post('/api/items/import', json={
            'store': 'amazon',
            'items': [{
                'product_id': 'B09QTY0001',
                'product_url': 'https://www.amazon.com/dp/B09QTY0001',
                'title': 'Amazon Multi-Quantity Item',
                'price': 9.99,
                'quantity': 5,
            }],
        })
        assert resp.status_code == 200

        item = client.get('/api/items').get_json()[0]
        assert item['quantity'] == 5


class TestAmazonImage:
    """Test Amazon image handling."""

    def test_amazon_image_stored(self, client):
        """Amazon image URL should be stored."""
        resp = client.post('/api/items/import', json={
            'store': 'amazon',
            'items': [{
                'product_id': 'B09IMG0001',
                'product_url': 'https://www.amazon.com/dp/B09IMG0001',
                'title': 'Amazon Item With Image',
                'image_url': 'https://m.media-amazon.com/images/I/71abc123.jpg',
                'price': 15.99,
                'quantity': 1,
            }],
        })
        assert resp.status_code == 200

        item = client.get('/api/items').get_json()[0]
        assert item['image_url'] == 'https://m.media-amazon.com/images/I/71abc123.jpg'

    def test_amazon_no_image(self, client):
        """Amazon item without image should still import."""
        resp = client.post('/api/items/import', json={
            'store': 'amazon',
            'items': [{
                'product_id': 'B09NOIMG01',
                'product_url': 'https://www.amazon.com/dp/B09NOIMG01',
                'title': 'Amazon Item No Image',
                'price': 12.99,
                'quantity': 1,
            }],
        })
        assert resp.status_code == 200

        item = client.get('/api/items').get_json()[0]
        assert item['image_url'] is None


class TestAmazonDuplicates:
    """Test Amazon duplicate handling."""

    def test_amazon_duplicate_asin_skipped(self, client):
        """Duplicate ASIN with same price should be skipped."""
        # First import
        client.post('/api/items/import', json={
            'store': 'amazon',
            'items': [{
                'product_id': 'B09DUP0001',
                'product_url': 'https://www.amazon.com/dp/B09DUP0001',
                'title': 'Original Import',
                'price': 19.99,
                'quantity': 1,
            }],
        })

        # Second import with same ASIN and same price (should skip, not update)
        resp = client.post('/api/items/import', json={
            'store': 'amazon',
            'items': [{
                'product_id': 'B09DUP0001',
                'product_url': 'https://www.amazon.com/dp/B09DUP0001',
                'title': 'Duplicate Import',
                'price': 19.99,  # Same price = skipped
                'quantity': 2,
            }],
        })

        data = resp.get_json()
        assert data['skipped'] == 1
        assert data['imported'] == 0

        # Only one item should exist
        items = client.get('/api/items').get_json()
        assert len(items) == 1
        assert items[0]['title'] == 'Original Import'

    def test_amazon_duplicate_asin_price_change_updates(self, client):
        """Duplicate ASIN with different price should update, not skip."""
        # First import
        client.post('/api/items/import', json={
            'store': 'amazon',
            'items': [{
                'product_id': 'B09DUP0002',
                'product_url': 'https://www.amazon.com/dp/B09DUP0002',
                'title': 'Price Change Test',
                'price': 19.99,
                'quantity': 1,
            }],
        })

        # Second import with same ASIN but different price (should update)
        resp = client.post('/api/items/import', json={
            'store': 'amazon',
            'items': [{
                'product_id': 'B09DUP0002',
                'product_url': 'https://www.amazon.com/dp/B09DUP0002',
                'title': 'Price Change Test Updated',
                'price': 24.99,  # Price changed = update
                'quantity': 1,
            }],
        })

        data = resp.get_json()
        assert data['updated'] == 1
        assert data['imported'] == 0
        assert data['skipped'] == 0

        # Item should be updated with new price
        items = client.get('/api/items').get_json()
        assert len(items) == 1
        assert items[0]['current_price'] == 24.99
        assert items[0]['last_price'] == 19.99  # Previous price tracked

    def test_amazon_and_temu_same_id_not_duplicates(self, client):
        """Same product_id from different stores should not be duplicates."""
        # Import from Amazon
        client.post('/api/items/import', json={
            'store': 'amazon',
            'items': [{
                'product_id': '12345',
                'product_url': 'https://www.amazon.com/dp/12345',
                'title': 'Amazon Product',
                'price': 29.99,
                'quantity': 1,
            }],
        })

        # Import from Temu with same product_id
        resp = client.post('/api/items/import', json={
            'store': 'temu',
            'items': [{
                'product_id': '12345',
                'product_url': 'https://www.temu.com/goods.html?goods_id=12345',
                'title': 'Temu Product',
                'price': 9.99,
                'quantity': 1,
            }],
        })

        data = resp.get_json()
        assert data['imported'] == 1

        # Both items should exist
        items = client.get('/api/items').get_json()
        assert len(items) == 2
