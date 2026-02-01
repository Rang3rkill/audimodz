"""Tests for cart import and price accuracy.

Covers:
- Basic import creates items with correct prices
- Sale price is stored as current_price (not original price)
- Original price is preserved separately when extension sends both
- Re-import updates prices and tracks changes
- Price-in-cents normalization
- Items with no price are stored with null (displayed as "No price")
- thumb_url is embedded in product_url for image recovery
- Duplicate imports are skipped (same store + product_id)
- Price drops and increases are counted correctly
"""
import json
import pytest


class TestBasicImport:
    """Test that items are imported with correct data."""

    def test_import_single_item(self, client):
        resp = client.post('/api/items/import', json={
            'store': 'temu',
            'items': [{
                'product_id': '100001',
                'product_url': 'https://www.temu.com/goods.html?goods_id=100001',
                'title': 'Test Widget 10 pcs',
                'image_url': 'https://img.kwcdn.com/product/abc123.jpg',
                'price': 6.35,
                'quantity': 1,
            }],
        })
        assert resp.status_code == 200
        data = resp.get_json()
        assert data['imported'] == 1
        assert data['skipped'] == 0

        # Verify stored correctly
        item = client.get('/api/items').get_json()[0]
        assert item['current_price'] == 6.35
        assert item['original_price'] == 6.35
        assert item['title'] == 'Test Widget 10 pcs'
        assert item['image_url'] == 'https://img.kwcdn.com/product/abc123.jpg'

    def test_import_with_no_price_stores_null(self, client):
        resp = client.post('/api/items/import', json={
            'store': 'temu',
            'items': [{
                'product_id': '100002',
                'product_url': 'https://www.temu.com/goods.html?goods_id=100002',
                'title': 'No Price Item',
                'price': None,
                'quantity': 1,
            }],
        })
        assert resp.status_code == 200
        data = resp.get_json()
        assert data['imported'] == 1

        item = client.get('/api/items').get_json()[0]
        assert item['current_price'] is None
        assert item['original_price'] is None

    def test_import_multiple_items(self, client):
        items = []
        for i in range(5):
            items.append({
                'product_id': f'200{i}',
                'product_url': f'https://www.temu.com/goods.html?goods_id=200{i}',
                'title': f'Item {i}',
                'price': 1.99 + i,
                'quantity': 1,
            })

        resp = client.post('/api/items/import', json={
            'store': 'temu',
            'items': items,
        })
        data = resp.get_json()
        assert data['imported'] == 5
        assert len(client.get('/api/items').get_json()) == 5


class TestSalePriceHandling:
    """Test that sale prices are stored correctly — this is the core bug."""

    def test_sale_price_stored_as_current(self, client):
        """When extension sends price=6.35 (the sale price), it should be current_price."""
        resp = client.post('/api/items/import', json={
            'store': 'temu',
            'items': [{
                'product_id': '300001',
                'product_url': 'https://www.temu.com/goods.html?goods_id=300001',
                'title': 'Sale Item',
                'price': 6.35,
                'quantity': 1,
            }],
        })
        assert resp.status_code == 200
        item = client.get('/api/items').get_json()[0]
        assert item['current_price'] == 6.35

    def test_original_price_from_extension(self, client):
        """Extension sends both price (sale) and original_price (full).
        current_price should be 6.35, original_price should be 15.00."""
        resp = client.post('/api/items/import', json={
            'store': 'temu',
            'items': [{
                'product_id': '300002',
                'product_url': 'https://www.temu.com/goods.html?goods_id=300002',
                'title': 'Sale Item With Original',
                'price': 6.35,
                'original_price': 15.00,
                'quantity': 1,
            }],
        })
        assert resp.status_code == 200
        item = client.get('/api/items').get_json()[0]
        assert item['current_price'] == 6.35
        assert item['original_price'] == 15.00

    def test_original_not_overwritten_on_reimport(self, client):
        """Re-importing same item should NOT reset original_price."""
        # First import with original
        client.post('/api/items/import', json={
            'store': 'temu',
            'items': [{
                'product_id': '300003',
                'product_url': 'https://www.temu.com/goods.html?goods_id=300003',
                'title': 'Stable Item',
                'price': 6.35,
                'original_price': 15.00,
                'quantity': 1,
            }],
        })

        # Re-import with same price
        client.post('/api/items/import', json={
            'store': 'temu',
            'items': [{
                'product_id': '300003',
                'product_url': 'https://www.temu.com/goods.html?goods_id=300003',
                'title': 'Stable Item',
                'price': 6.35,
                'quantity': 1,
            }],
        })

        item = client.get('/api/items').get_json()[0]
        assert item['current_price'] == 6.35
        assert item['original_price'] == 15.00  # Must NOT be overwritten

    def test_sale_price_lower_than_original(self, client):
        """The displayed price should always be the lower sale price."""
        client.post('/api/items/import', json={
            'store': 'temu',
            'items': [{
                'product_id': '300004',
                'product_url': 'https://www.temu.com/goods.html?goods_id=300004',
                'title': 'Big Discount Item',
                'price': 2.99,
                'original_price': 24.99,
                'quantity': 1,
            }],
        })

        item = client.get('/api/items').get_json()[0]
        assert item['current_price'] == 2.99
        assert item['original_price'] == 24.99
        assert item['current_price'] < item['original_price']


class TestPriceUpdates:
    """Test price change tracking on re-import."""

    def _import_item(self, client, price, product_id='400001'):
        return client.post('/api/items/import', json={
            'store': 'temu',
            'items': [{
                'product_id': product_id,
                'product_url': f'https://www.temu.com/goods.html?goods_id={product_id}',
                'title': 'Price Track Item',
                'price': price,
                'quantity': 1,
            }],
        })

    def test_price_drop_detected(self, client):
        self._import_item(client, 10.00)
        resp = self._import_item(client, 7.50)
        data = resp.get_json()
        assert data['updated'] == 1
        assert data['price_drops'] == 1

        item = client.get('/api/items').get_json()[0]
        assert item['current_price'] == 7.50
        assert item['last_price'] == 10.00

    def test_price_increase_detected(self, client):
        self._import_item(client, 5.00)
        resp = self._import_item(client, 8.00)
        data = resp.get_json()
        assert data['updated'] == 1
        assert data['price_increases'] == 1

    def test_unchanged_price_skipped(self, client):
        self._import_item(client, 5.00)
        resp = self._import_item(client, 5.00)
        data = resp.get_json()
        assert data['skipped'] == 1
        assert data['updated'] == 0

    def test_null_to_price_is_update(self, client):
        """If item had no price, importing with a price should update it."""
        self._import_item(client, None)
        item = client.get('/api/items').get_json()[0]
        assert item['current_price'] is None

        resp = self._import_item(client, 9.99)
        data = resp.get_json()
        assert data['updated'] == 1

        item = client.get('/api/items').get_json()[0]
        assert item['current_price'] == 9.99

    def test_multiple_price_changes_tracked(self, client):
        """Track through several price changes."""
        self._import_item(client, 20.00)
        self._import_item(client, 15.00)
        self._import_item(client, 12.00)

        item = client.get('/api/items').get_json()[0]
        assert item['current_price'] == 12.00
        assert item['last_price'] == 15.00     # Previous price
        assert item['original_price'] == 20.00  # First price ever seen


class TestDuplicateHandling:
    """Test that duplicate items are properly deduplicated."""

    def test_same_product_id_skipped(self, client):
        for _ in range(3):
            resp = client.post('/api/items/import', json={
                'store': 'temu',
                'items': [{
                    'product_id': '500001',
                    'product_url': 'https://www.temu.com/goods.html?goods_id=500001',
                    'title': 'Dupe Item',
                    'price': 5.00,
                    'quantity': 1,
                }],
            })

        # Should only have 1 item in DB
        items = client.get('/api/items').get_json()
        assert len(items) == 1

    def test_different_stores_not_duped(self, client):
        for store in ['temu', 'amazon']:
            client.post('/api/items/import', json={
                'store': store,
                'items': [{
                    'product_id': 'SHARED_ID',
                    'product_url': f'https://www.{store}.com/product/SHARED_ID',
                    'title': f'{store} Item',
                    'price': 5.00,
                    'quantity': 1,
                }],
            })

        items = client.get('/api/items').get_json()
        assert len(items) == 2


class TestThumbUrlEmbedding:
    """Test that thumb_url is embedded in product_url for image recovery."""

    def test_thumb_url_backfilled_on_import(self, client):
        """Importing item without thumb_url in URL but with image_url should backfill."""
        client.post('/api/items/import', json={
            'store': 'temu',
            'items': [{
                'product_id': '600001',
                'product_url': 'https://www.temu.com/goods.html?goods_id=600001',
                'title': 'Thumb Test',
                'image_url': 'https://img.kwcdn.com/product/thumb123.jpg',
                'price': 3.00,
                'quantity': 1,
            }],
        })

        item = client.get('/api/items').get_json()[0]
        assert 'thumb_url=' in item['product_url']
        assert 'thumb123.jpg' in item['product_url']

    def test_thumb_url_preserved_if_already_present(self, client):
        """If URL already has thumb_url, don't double-embed."""
        url = 'https://www.temu.com/goods.html?goods_id=600002&thumb_url=https%3A%2F%2Fimg.kwcdn.com%2Foriginal.jpg'
        client.post('/api/items/import', json={
            'store': 'temu',
            'items': [{
                'product_id': '600002',
                'product_url': url,
                'title': 'Already Has Thumb',
                'image_url': 'https://img.kwcdn.com/product/new.jpg',
                'price': 4.00,
                'quantity': 1,
            }],
        })

        item = client.get('/api/items').get_json()[0]
        # Should still have original thumb_url, not doubled
        assert item['product_url'].count('thumb_url=') == 1

    def test_thumb_url_backfilled_on_reimport(self, client):
        """Re-importing an old item (no thumb_url) should add it."""
        # Simulate old item without thumb_url
        from models.item import Item
        Item.create(
            store='temu',
            product_id='600003',
            product_url='https://www.temu.com/goods.html?goods_id=600003',
            title='Old Item',
            image_url='https://img.kwcdn.com/product/old.jpg',
            current_price=5.00,
        )

        # Re-import with same price (skipped path) — should still backfill URL
        client.post('/api/items/import', json={
            'store': 'temu',
            'items': [{
                'product_id': '600003',
                'product_url': 'https://www.temu.com/goods.html?goods_id=600003',
                'title': 'Old Item',
                'image_url': 'https://img.kwcdn.com/product/old.jpg',
                'price': 5.00,
                'quantity': 1,
            }],
        })

        from models.item import Item as ItemModel
        item = ItemModel.get_by_product('temu', '600003')
        assert 'thumb_url=' in item['product_url']


class TestImageRecovery:
    """Test image is filled in on re-import when originally missing."""

    def test_missing_image_filled_on_reimport(self, client):
        # Import without image
        client.post('/api/items/import', json={
            'store': 'temu',
            'items': [{
                'product_id': '700001',
                'product_url': 'https://www.temu.com/goods.html?goods_id=700001',
                'title': 'No Image Item',
                'price': 5.00,
                'quantity': 1,
            }],
        })
        item = client.get('/api/items').get_json()[0]
        assert item['image_url'] is None

        # Re-import with image
        client.post('/api/items/import', json={
            'store': 'temu',
            'items': [{
                'product_id': '700001',
                'product_url': 'https://www.temu.com/goods.html?goods_id=700001',
                'title': 'No Image Item',
                'image_url': 'https://img.kwcdn.com/product/recovered.jpg',
                'price': 5.00,
                'quantity': 1,
            }],
        })

        item = client.get('/api/items').get_json()[0]
        assert item['image_url'] == 'https://img.kwcdn.com/product/recovered.jpg'
