"""Tests for URL handling and image validation.

Covers:
- ensure_thumb_url() function for embedding thumbnail URLs
- extract_goods_id() function for parsing Temu URLs
- is_valid_product_image() function for filtering bad images
- URL handling during import (thumb_url embedding)
"""
import pytest
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


class TestExtractGoodsId:
    """Test extracting goods_id from various Temu URL formats."""

    @pytest.fixture
    def extract_fn(self):
        from routes.items import extract_goods_id
        return extract_goods_id

    def test_standard_goods_id_param(self, extract_fn):
        """Standard browser URL: goods_id=12345."""
        url = "https://www.temu.com/goods.html?goods_id=601234567890"
        assert extract_fn(url) == "601234567890"

    def test_goods_id_with_other_params(self, extract_fn):
        """URL with multiple query params."""
        url = "https://www.temu.com/goods.html?goods_id=12345&thumb_url=http%3A%2F%2Fimg.jpg"
        assert extract_fn(url) == "12345"

    def test_app_style_url(self, extract_fn):
        """App-style URL: product-name_p_12345.html."""
        url = "https://www.temu.com/cool-product-name_p_601234567890.html"
        assert extract_fn(url) == "601234567890"

    def test_product_path_url(self, extract_fn):
        """Deep link style: /product/12345."""
        url = "https://www.temu.com/product/12345"
        assert extract_fn(url) == "12345"

    def test_subject_id_param(self, extract_fn):
        """Alternative param: subject_id=12345."""
        url = "https://www.temu.com/goods.html?subject_id=12345"
        assert extract_fn(url) == "12345"

    def test_none_url_returns_none(self, extract_fn):
        assert extract_fn(None) is None
        assert extract_fn("") is None

    def test_no_match_returns_none(self, extract_fn):
        url = "https://www.temu.com/"
        assert extract_fn(url) is None


class TestEnsureThumbUrl:
    """Test embedding thumb_url in product URLs."""

    @pytest.fixture
    def ensure_fn(self):
        from routes.items import ensure_thumb_url
        return ensure_thumb_url

    def test_adds_thumb_url_with_question_mark(self, ensure_fn):
        """URL without query params gets ?thumb_url=..."""
        from routes.items import ensure_thumb_url
        url = "https://www.temu.com/goods.html"
        image = "https://img.kwcdn.com/product/abc.jpg"
        result = ensure_thumb_url(url, image)
        assert "?thumb_url=" in result
        assert "abc.jpg" in result

    def test_adds_thumb_url_with_ampersand(self, ensure_fn):
        """URL with existing query params gets &thumb_url=..."""
        from routes.items import ensure_thumb_url
        url = "https://www.temu.com/goods.html?goods_id=12345"
        image = "https://img.kwcdn.com/product/abc.jpg"
        result = ensure_thumb_url(url, image)
        assert "&thumb_url=" in result
        assert "goods_id=12345" in result

    def test_does_not_double_embed(self, ensure_fn):
        """Don't add thumb_url if already present."""
        from routes.items import ensure_thumb_url
        url = "https://www.temu.com/goods.html?goods_id=12345&thumb_url=existing.jpg"
        image = "https://img.kwcdn.com/product/new.jpg"
        result = ensure_thumb_url(url, image)
        assert result.count("thumb_url=") == 1
        assert "existing.jpg" in result

    def test_handles_url_with_fragment(self, ensure_fn):
        """URL with fragment (#section) should put params before fragment."""
        from routes.items import ensure_thumb_url
        url = "https://www.temu.com/goods.html?goods_id=12345#reviews"
        image = "https://img.kwcdn.com/product/abc.jpg"
        result = ensure_thumb_url(url, image)
        # Query params must come before fragment
        assert result.index("thumb_url=") < result.index("#reviews")

    def test_returns_original_if_no_image(self, ensure_fn):
        """No image URL -> return original product URL unchanged."""
        from routes.items import ensure_thumb_url
        url = "https://www.temu.com/goods.html?goods_id=12345"
        result = ensure_thumb_url(url, None)
        assert result == url

    def test_returns_original_if_no_url(self, ensure_fn):
        """No product URL -> return None."""
        from routes.items import ensure_thumb_url
        result = ensure_thumb_url(None, "https://img.jpg")
        assert result is None


class TestIsValidProductImage:
    """Test image URL validation."""

    @pytest.fixture
    def validate_fn(self):
        from routes.items import is_valid_product_image
        return is_valid_product_image

    # === Valid images ===

    def test_kwcdn_product_image_valid(self, validate_fn):
        from routes.items import is_valid_product_image
        url = "https://img.kwcdn.com/product/fancy/abc123.jpg"
        assert is_valid_product_image(url) is True

    def test_akamaized_image_valid(self, validate_fn):
        from routes.items import is_valid_product_image
        url = "https://images.temu.akamaized.net/product/abc.jpg"
        assert is_valid_product_image(url) is True

    def test_cloudfront_image_valid(self, validate_fn):
        from routes.items import is_valid_product_image
        url = "https://d123.cloudfront.net/images/product.jpg"
        assert is_valid_product_image(url) is True

    # === Invalid images (bad patterns) ===

    def test_sale_banner_rejected(self, validate_fn):
        from routes.items import is_valid_product_image
        url = "https://img.kwcdn.com/sale/banner.jpg"
        assert is_valid_product_image(url) is False

    def test_promo_image_rejected(self, validate_fn):
        from routes.items import is_valid_product_image
        url = "https://img.kwcdn.com/promo/countdown.jpg"
        assert is_valid_product_image(url) is False

    def test_placeholder_rejected(self, validate_fn):
        from routes.items import is_valid_product_image
        url = "https://img.kwcdn.com/placeholder.jpg"
        assert is_valid_product_image(url) is False

    def test_aimg_rejected(self, validate_fn):
        from routes.items import is_valid_product_image
        url = "https://img.kwcdn.com/upload_aimg/banner.jpg"
        assert is_valid_product_image(url) is False

    def test_event_image_rejected(self, validate_fn):
        from routes.items import is_valid_product_image
        url = "https://img.kwcdn.com/event/flash_sale.jpg"
        assert is_valid_product_image(url) is False

    # === Edge cases ===

    def test_none_url_rejected(self, validate_fn):
        from routes.items import is_valid_product_image
        assert is_valid_product_image(None) is False

    def test_empty_string_rejected(self, validate_fn):
        from routes.items import is_valid_product_image
        assert is_valid_product_image("") is False

    def test_short_url_rejected(self, validate_fn):
        from routes.items import is_valid_product_image
        url = "https://a.b/c.jpg"  # Too short
        assert is_valid_product_image(url) is False

    def test_non_cdn_url_rejected(self, validate_fn):
        from routes.items import is_valid_product_image
        url = "https://example.com/random/image.jpg"  # Not a known CDN
        assert is_valid_product_image(url) is False


class TestImageHandlingInImport:
    """Test image handling during cart import."""

    def test_valid_image_stored(self, client):
        """Valid product image should be stored."""
        resp = client.post('/api/items/import', json={
            'store': 'temu',
            'items': [{
                'product_id': 'IMG001',
                'product_url': 'https://www.temu.com/goods.html?goods_id=IMG001',
                'title': 'Item With Image',
                'image_url': 'https://img.kwcdn.com/product/abc.jpg',
                'price': 5.00,
                'quantity': 1,
            }],
        })
        assert resp.status_code == 200

        item = client.get('/api/items').get_json()[0]
        assert item['image_url'] == 'https://img.kwcdn.com/product/abc.jpg'

    def test_bad_image_rejected(self, client):
        """Bad pattern images should be rejected."""
        resp = client.post('/api/items/import', json={
            'store': 'temu',
            'items': [{
                'product_id': 'IMG002',
                'product_url': 'https://www.temu.com/goods.html?goods_id=IMG002',
                'title': 'Item With Bad Image',
                'image_url': 'https://img.kwcdn.com/sale/banner.jpg',
                'price': 5.00,
                'quantity': 1,
            }],
        })
        assert resp.status_code == 200

        item = client.get('/api/items').get_json()[0]
        assert item['image_url'] is None  # Bad image rejected

    def test_thumb_url_embedded_on_import(self, client):
        """thumb_url should be embedded in product_url during import."""
        resp = client.post('/api/items/import', json={
            'store': 'temu',
            'items': [{
                'product_id': 'IMG003',
                'product_url': 'https://www.temu.com/goods.html?goods_id=IMG003',
                'title': 'Item For Thumb URL',
                'image_url': 'https://img.kwcdn.com/product/thumb.jpg',
                'price': 5.00,
                'quantity': 1,
            }],
        })
        assert resp.status_code == 200

        item = client.get('/api/items').get_json()[0]
        assert 'thumb_url=' in item['product_url']
        assert 'thumb.jpg' in item['product_url']


class TestUrlParsingInImport:
    """Test URL handling during import for various formats."""

    def test_standard_url_parsed(self, client):
        """Standard goods_id URL parsed correctly."""
        resp = client.post('/api/items/import', json={
            'store': 'temu',
            'items': [{
                'product_id': '12345',
                'product_url': 'https://www.temu.com/goods.html?goods_id=12345',
                'title': 'Standard URL Item',
                'price': 5.00,
                'quantity': 1,
            }],
        })
        assert resp.status_code == 200

        item = client.get('/api/items').get_json()[0]
        assert item['product_id'] == '12345'

    def test_app_style_url_handled(self, client):
        """App-style _p_ URL should work."""
        resp = client.post('/api/items/import', json={
            'store': 'temu',
            'items': [{
                'product_id': '67890',
                'product_url': 'https://www.temu.com/cool-item_p_67890.html',
                'title': 'App Style URL Item',
                'price': 5.00,
                'quantity': 1,
            }],
        })
        assert resp.status_code == 200

        item = client.get('/api/items').get_json()[0]
        assert item['product_id'] == '67890'
