"""Tests for quantity handling during import.

Covers:
- Valid quantity stored correctly
- Invalid/missing quantity defaults to 1
- Quantity bounds validation (1-9999)
- Quantity updates on re-import
"""
import pytest
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


class TestQuantityImport:
    """Test quantity handling during item import."""

    def test_valid_quantity_stored(self, client):
        """Valid quantity should be stored."""
        resp = client.post('/api/items/import', json={
            'store': 'temu',
            'items': [{
                'product_id': 'QTY001',
                'product_url': 'https://www.temu.com/goods.html?goods_id=QTY001',
                'title': 'Multi-Quantity Item',
                'price': 5.00,
                'quantity': 3,
            }],
        })
        assert resp.status_code == 200

        item = client.get('/api/items').get_json()[0]
        assert item['quantity'] == 3

    def test_missing_quantity_defaults_to_1(self, client):
        """Missing quantity should default to 1."""
        resp = client.post('/api/items/import', json={
            'store': 'temu',
            'items': [{
                'product_id': 'QTY002',
                'product_url': 'https://www.temu.com/goods.html?goods_id=QTY002',
                'title': 'No Quantity Item',
                'price': 5.00,
                # No quantity field
            }],
        })
        assert resp.status_code == 200

        item = client.get('/api/items').get_json()[0]
        assert item['quantity'] == 1

    def test_null_quantity_defaults_to_1(self, client):
        """Null quantity should default to 1."""
        resp = client.post('/api/items/import', json={
            'store': 'temu',
            'items': [{
                'product_id': 'QTY003',
                'product_url': 'https://www.temu.com/goods.html?goods_id=QTY003',
                'title': 'Null Quantity Item',
                'price': 5.00,
                'quantity': None,
            }],
        })
        assert resp.status_code == 200

        item = client.get('/api/items').get_json()[0]
        assert item['quantity'] == 1

    def test_zero_quantity_becomes_1(self, client):
        """Zero quantity should become 1."""
        resp = client.post('/api/items/import', json={
            'store': 'temu',
            'items': [{
                'product_id': 'QTY004',
                'product_url': 'https://www.temu.com/goods.html?goods_id=QTY004',
                'title': 'Zero Quantity Item',
                'price': 5.00,
                'quantity': 0,
            }],
        })
        assert resp.status_code == 200

        item = client.get('/api/items').get_json()[0]
        assert item['quantity'] == 1

    def test_negative_quantity_becomes_1(self, client):
        """Negative quantity should become 1."""
        resp = client.post('/api/items/import', json={
            'store': 'temu',
            'items': [{
                'product_id': 'QTY005',
                'product_url': 'https://www.temu.com/goods.html?goods_id=QTY005',
                'title': 'Negative Quantity Item',
                'price': 5.00,
                'quantity': -5,
            }],
        })
        assert resp.status_code == 200

        item = client.get('/api/items').get_json()[0]
        assert item['quantity'] == 1

    def test_very_high_quantity_capped(self, client):
        """Quantity > 9999 should be capped to 9999."""
        resp = client.post('/api/items/import', json={
            'store': 'temu',
            'items': [{
                'product_id': 'QTY006',
                'product_url': 'https://www.temu.com/goods.html?goods_id=QTY006',
                'title': 'High Quantity Item',
                'price': 5.00,
                'quantity': 99999,
            }],
        })
        assert resp.status_code == 200

        item = client.get('/api/items').get_json()[0]
        assert item['quantity'] == 9999

    def test_string_quantity_parsed(self, client):
        """String quantity should be parsed to int."""
        resp = client.post('/api/items/import', json={
            'store': 'temu',
            'items': [{
                'product_id': 'QTY007',
                'product_url': 'https://www.temu.com/goods.html?goods_id=QTY007',
                'title': 'String Quantity Item',
                'price': 5.00,
                'quantity': "5",
            }],
        })
        assert resp.status_code == 200

        item = client.get('/api/items').get_json()[0]
        assert item['quantity'] == 5

    def test_float_quantity_truncated(self, client):
        """Float quantity should be truncated to int."""
        resp = client.post('/api/items/import', json={
            'store': 'temu',
            'items': [{
                'product_id': 'QTY008',
                'product_url': 'https://www.temu.com/goods.html?goods_id=QTY008',
                'title': 'Float Quantity Item',
                'price': 5.00,
                'quantity': 2.7,
            }],
        })
        assert resp.status_code == 200

        item = client.get('/api/items').get_json()[0]
        assert item['quantity'] == 2


class TestQuantityUpdate:
    """Test quantity can be updated via PATCH."""

    def test_quantity_update_via_patch(self, client):
        """Quantity can be updated via PATCH."""
        # Create item
        resp = client.post('/api/items/import', json={
            'store': 'temu',
            'items': [{
                'product_id': 'QPATCH001',
                'product_url': 'https://www.temu.com/goods.html?goods_id=QPATCH001',
                'title': 'Patchable Item',
                'price': 5.00,
                'quantity': 1,
            }],
        })
        item_id = client.get('/api/items').get_json()[0]['id']

        # Update quantity
        resp = client.patch(f'/api/items/{item_id}', json={'quantity': 5})
        assert resp.status_code == 200

        item = client.get('/api/items').get_json()[0]
        assert item['quantity'] == 5

    def test_quantity_update_validates_bounds(self, client):
        """Quantity update should validate bounds."""
        # Create item
        client.post('/api/items/import', json={
            'store': 'temu',
            'items': [{
                'product_id': 'QPATCH002',
                'product_url': 'https://www.temu.com/goods.html?goods_id=QPATCH002',
                'title': 'Patchable Item 2',
                'price': 5.00,
                'quantity': 1,
            }],
        })
        item_id = client.get('/api/items').get_json()[0]['id']

        # Try to update with invalid quantity
        client.patch(f'/api/items/{item_id}', json={'quantity': -1})

        item = client.get('/api/items').get_json()[0]
        # Should not be negative (validation should reject or clamp)
        assert item['quantity'] >= 1


class TestQuantityInStats:
    """Test quantity affects stats calculations."""

    def test_quantity_affects_total_value(self, client):
        """Items with quantity > 1 should multiply value in stats."""
        # Create item with quantity 3 at $5 = $15 total
        client.post('/api/items/import', json={
            'store': 'temu',
            'items': [{
                'product_id': 'STAT001',
                'product_url': 'https://www.temu.com/goods.html?goods_id=STAT001',
                'title': 'Stat Item',
                'price': 5.00,
                'quantity': 3,
            }],
        })

        # Check stats
        stats = client.get('/api/items/stats').get_json()
        # 5.00 * 3 = 15.00
        assert stats['total_value'] == 15.00

    def test_quantity_in_ready_to_buy_total(self, client):
        """Ready to buy total should include quantity."""
        # Create item and add to ready to buy
        client.post('/api/items/import', json={
            'store': 'temu',
            'items': [{
                'product_id': 'READY001',
                'product_url': 'https://www.temu.com/goods.html?goods_id=READY001',
                'title': 'Ready Item',
                'price': 10.00,
                'quantity': 2,
            }],
        })
        item_id = client.get('/api/items').get_json()[0]['id']

        # Add to ready to buy
        client.patch(f'/api/items/{item_id}', json={'in_ready_to_buy': 1})

        # Check ready to buy
        ready = client.get('/api/items/ready-to-buy').get_json()
        # 10.00 * 2 = 20.00
        assert ready['grand_total'] == 20.00
