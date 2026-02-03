import logging
from flask import Blueprint, jsonify, request
from models.item import Item
from models.category import Category
import requests
import re

logger = logging.getLogger(__name__)
import time
import threading
from datetime import datetime
from functools import wraps

items_bp = Blueprint('items', __name__, url_prefix='/api/items')

# Patterns that indicate a placeholder/generic image rather than an actual product photo
BAD_IMAGE_PATTERNS = [
    '/sale', '/banner', '/promo', '/countdown', '/clock', '/timer',
    'sale_banner', 'flash_sale', 'promotion', 'coupon',
    '/bg/', '/background/', 'placeholder',
    'upload_aimg',  # Temu advertising/marketing images, not product photos
    '/aimg/',        # Advertising image CDN path
    '/splash/',      # Splash/landing page images
    '/event/',       # Event promo images
]


def is_valid_product_image(url):
    """Check if an image URL looks like a real product image vs a generic placeholder."""
    if not url:
        return False
    url_lower = url.lower()
    for pattern in BAD_IMAGE_PATTERNS:
        if pattern in url_lower:
            return False
    # Must be from a known CDN with product-like path
    if not any(domain in url_lower for domain in ['kwcdn', 'akamaized', 'temu', 'cloudfront']):
        return False
    # Product images typically have dimensions or product identifiers
    # Very short URLs are suspicious
    if len(url) < 30:
        return False
    return True


def has_valid_image(item):
    """Check if an item has a valid (non-placeholder) product image."""
    url = item.get('image_url', '')
    if not url:
        return False
    # Check for embedded thumb_url as a sign the extension provided a real image
    product_url = item.get('product_url', '')
    if 'thumb_url=' in product_url:
        from urllib.parse import urlparse, parse_qs, unquote
        try:
            parsed = urlparse(product_url)
            params = parse_qs(parsed.query)
            if 'thumb_url' in params:
                embedded = unquote(params['thumb_url'][0])
                # If current image matches the extension-provided one, it's valid
                if url == embedded:
                    return True
        except Exception:
            pass
    return is_valid_product_image(url)


def extract_goods_id(url):
    """Extract goods_id from any Temu URL format (web, app, share links)."""
    if not url:
        return None
    for pattern in [r'goods_id=(\d+)', r'_p_(\d+)\.html', r'/product/(\d+)', r'subject_id=(\d+)']:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    return None


def ensure_thumb_url(product_url, image_url):
    """Ensure product_url has thumb_url parameter for server-side image recovery."""
    if not product_url or not image_url:
        return product_url
    if 'thumb_url=' in (product_url or ''):
        return product_url
    from urllib.parse import quote
    separator = '&' if '?' in product_url else '?'
    return f"{product_url}{separator}thumb_url={quote(image_url, safe='')}"


# Rate limiting for scraping
SCRAPE_DELAY = 1.0  # seconds between scrape requests
_scrape_lock = threading.Lock()
_last_scrape_time = 0


def rate_limit_scrape():
    """Ensure we don't hit Temu too fast."""
    global _last_scrape_time
    with _scrape_lock:
        elapsed = time.time() - _last_scrape_time
        if elapsed < SCRAPE_DELAY:
            time.sleep(SCRAPE_DELAY - elapsed)
        _last_scrape_time = time.time()


def retry_on_failure(max_retries=3, delay=2):
    """Decorator for retrying failed requests with exponential backoff."""
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            last_error = None
            for attempt in range(max_retries):
                try:
                    return func(*args, **kwargs)
                except Exception as e:
                    last_error = e
                    if attempt < max_retries - 1:
                        wait_time = delay * (2 ** attempt)
                        print(f"Attempt {attempt + 1} failed: {e}. Retrying in {wait_time}s...")
                        time.sleep(wait_time)
            print(f"All {max_retries} attempts failed: {last_error}")
            return None
        return wrapper
    return decorator


@items_bp.route('', methods=['GET'])
def get_items():
    """Get items with optional filters."""
    category_id = request.args.get('category_id', type=int)
    list_id = request.args.get('list_id', type=int)
    in_ready_to_buy = request.args.get('in_ready_to_buy')

    # New filters
    missing_data = request.args.get('missing_data')  # 'image', 'price', 'any'
    has_price_drop = request.args.get('has_price_drop')
    is_favorite = request.args.get('is_favorite')
    sort_by = request.args.get('sort_by', 'position')  # position, price, date_added, title
    sort_order = request.args.get('sort_order', 'asc')

    if in_ready_to_buy is not None:
        in_ready_to_buy = in_ready_to_buy.lower() == 'true'

    items = Item.get_all(
        category_id=category_id,
        list_id=list_id,
        in_ready_to_buy=in_ready_to_buy
    )

    # Apply additional filters
    if missing_data:
        if missing_data == 'image':
            items = [i for i in items if not i.get('image_url')]
        elif missing_data == 'price':
            items = [i for i in items if i.get('current_price') is None]
        elif missing_data == 'any':
            items = [i for i in items if not i.get('image_url') or i.get('current_price') is None]

    if has_price_drop and has_price_drop.lower() == 'true':
        items = [i for i in items if i.get('last_price') and i.get('current_price')
                 and i['current_price'] < i['last_price']]

    if is_favorite and is_favorite.lower() == 'true':
        items = [i for i in items if i.get('is_favorite')]

    # Apply sorting
    if sort_by == 'price':
        items = sorted(items, key=lambda x: x.get('current_price') or 999999,
                      reverse=(sort_order == 'desc'))
    elif sort_by == 'date_added':
        items = sorted(items, key=lambda x: x.get('date_added') or '',
                      reverse=(sort_order == 'desc'))
    elif sort_by == 'title':
        items = sorted(items, key=lambda x: (x.get('title') or '').lower(),
                      reverse=(sort_order == 'desc'))

    return jsonify(items)


@items_bp.route('', methods=['POST'])
def create_item():
    """Create a new item."""
    data = request.get_json()

    required = ['store', 'product_id', 'product_url', 'title']
    for field in required:
        if not data.get(field):
            return jsonify({'error': f'{field} is required'}), 400

    try:
        item = Item.create(
            store=data['store'],
            product_id=data['product_id'],
            product_url=data['product_url'],
            title=data['title'],
            image_url=data.get('image_url'),
            current_price=data.get('current_price'),
            quantity=data.get('quantity', 1),
            category_id=data.get('category_id', 1),
            list_id=data.get('list_id', 1)
        )
        return jsonify(item), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 400


@items_bp.route('/<int:item_id>', methods=['GET'])
def get_item(item_id):
    """Get an item by ID."""
    item = Item.get_by_id(item_id)
    if not item:
        return jsonify({'error': 'Item not found'}), 404
    return jsonify(item)


@items_bp.route('/<int:item_id>', methods=['PATCH'])
def update_item(item_id):
    """Update an item."""
    data = request.get_json()

    # Track price changes
    if 'current_price' in data:
        existing = Item.get_by_id(item_id)
        if existing and existing.get('current_price') != data['current_price']:
            data['last_price'] = existing.get('current_price')
            data['price_updated_at'] = datetime.now().isoformat()

    item = Item.update(item_id, **data)
    if not item:
        return jsonify({'error': 'Item not found'}), 404
    return jsonify(item)


@items_bp.route('/<int:item_id>', methods=['DELETE'])
def delete_item(item_id):
    """Delete an item."""
    deleted = Item.delete(item_id)
    if not deleted:
        return jsonify({'error': 'Item not found'}), 404
    return jsonify({'message': 'Item deleted'})


@items_bp.route('/batch', methods=['POST'])
def batch_operations():
    """Perform batch operations on multiple items."""
    data = request.get_json()
    operation = data.get('operation')
    item_ids = data.get('item_ids', [])

    if not operation:
        return jsonify({'error': 'operation is required'}), 400
    if not item_ids:
        return jsonify({'error': 'item_ids is required'}), 400

    results = {'success': 0, 'failed': 0, 'errors': []}

    if operation == 'delete':
        for item_id in item_ids:
            try:
                if Item.delete(item_id):
                    results['success'] += 1
                else:
                    results['failed'] += 1
                    results['errors'].append(f'Item {item_id} not found')
            except Exception as e:
                results['failed'] += 1
                results['errors'].append(f'Item {item_id}: {str(e)}')

    elif operation == 'move_to_list':
        list_id = data.get('list_id')
        if not list_id:
            return jsonify({'error': 'list_id is required for move_to_list'}), 400
        for item_id in item_ids:
            try:
                if Item.update(item_id, list_id=list_id):
                    results['success'] += 1
                else:
                    results['failed'] += 1
            except Exception as e:
                results['failed'] += 1
                results['errors'].append(f'Item {item_id}: {str(e)}')

    elif operation == 'move_to_category':
        category_id = data.get('category_id')
        if not category_id:
            return jsonify({'error': 'category_id is required for move_to_category'}), 400
        for item_id in item_ids:
            try:
                if Item.update(item_id, category_id=category_id):
                    results['success'] += 1
                else:
                    results['failed'] += 1
            except Exception as e:
                results['failed'] += 1
                results['errors'].append(f'Item {item_id}: {str(e)}')

    elif operation == 'toggle_ready':
        value = data.get('value', True)
        for item_id in item_ids:
            try:
                if Item.update(item_id, in_ready_to_buy=1 if value else 0):
                    results['success'] += 1
                else:
                    results['failed'] += 1
            except Exception as e:
                results['failed'] += 1
                results['errors'].append(f'Item {item_id}: {str(e)}')

    elif operation == 'toggle_favorite':
        value = data.get('value', True)
        for item_id in item_ids:
            try:
                if Item.update(item_id, is_favorite=1 if value else 0):
                    results['success'] += 1
                else:
                    results['failed'] += 1
            except Exception as e:
                results['failed'] += 1
                results['errors'].append(f'Item {item_id}: {str(e)}')

    else:
        return jsonify({'error': f'Unknown operation: {operation}'}), 400

    return jsonify(results)


@items_bp.route('/reorder', methods=['POST'])
def reorder_items():
    """Bulk update item positions."""
    data = request.get_json()
    positions = data.get('positions', {})

    # Convert string keys to int
    positions = {int(k): v for k, v in positions.items()}

    Item.reorder(positions)
    return jsonify({'success': True})


@items_bp.route('/ready-to-buy', methods=['GET'])
def get_ready_to_buy():
    """Get items ready to buy, grouped by store."""
    grouped = Item.get_ready_to_buy_grouped()

    # Calculate grand total
    grand_total = sum(g['subtotal'] for g in grouped.values())

    return jsonify({
        'stores': grouped,
        'grand_total': grand_total
    })


@items_bp.route('/ready-to-buy/count', methods=['GET'])
def get_ready_count():
    """Get count of items ready to buy."""
    count = Item.get_count_by_ready_status()
    return jsonify({'count': count})


@items_bp.route('/stats', methods=['GET'])
def get_stats():
    """Get item statistics for dashboard."""
    stats = Item.get_stats()

    # Add missing data counts
    items = Item.get_all()
    stats['missing_image'] = len([i for i in items if not has_valid_image(i)])
    stats['missing_price'] = len([i for i in items if i.get('current_price') is None])
    stats['missing_any'] = len([i for i in items if not has_valid_image(i) or i.get('current_price') is None])

    return jsonify(stats)


@items_bp.route('/duplicates', methods=['GET'])
def get_duplicates():
    """Get potential duplicate items based on title similarity."""
    threshold = request.args.get('threshold', 0.5, type=float)
    duplicates = Item.find_potential_duplicates(threshold)
    return jsonify(duplicates)


@items_bp.route('/export', methods=['GET'])
def export_items():
    """Export items as JSON for backup/sharing."""
    format_type = request.args.get('format', 'json')
    list_id = request.args.get('list_id', type=int)

    items = Item.get_all(list_id=list_id) if list_id else Item.get_all()

    if format_type == 'csv':
        import csv
        import io
        # Build CSV string using csv module for proper escaping
        output = io.StringIO()
        writer = csv.writer(output)
        headers = ['id', 'store', 'product_id', 'title', 'current_price', 'image_url', 'product_url', 'quantity', 'is_favorite', 'in_ready_to_buy']
        writer.writerow(headers)
        for item in items:
            writer.writerow([
                item.get('id', ''),
                item.get('store', ''),
                item.get('product_id', ''),
                item.get('title', ''),
                item.get('current_price', ''),
                item.get('image_url', '') or '',
                item.get('product_url', ''),
                item.get('quantity', 1),
                item.get('is_favorite', 0),
                item.get('in_ready_to_buy', 0),
            ])
        csv_content = output.getvalue()

        from flask import Response
        return Response(
            csv_content,
            mimetype='text/csv',
            headers={'Content-Disposition': 'attachment; filename=wishlist_export.csv'}
        )

    return jsonify({
        'exported_at': datetime.now().isoformat(),
        'count': len(items),
        'items': items
    })


@items_bp.route('/backup', methods=['POST'])
def create_backup():
    """Create a database backup on demand."""
    from database import backup_db
    try:
        path = backup_db()
        return jsonify({'success': True, 'path': path})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@items_bp.route('/import', methods=['POST'])
def import_items():
    """Bulk import items from extension."""
    data = request.get_json()
    store = data.get('store')
    items_data = data.get('items', [])
    list_id = data.get('list_id', 1)

    if not store:
        return jsonify({'error': 'store is required'}), 400

    results = []
    imported = 0
    skipped = 0
    updated = 0
    price_drops = 0
    price_increases = 0
    errors = []

    # Load categories once for auto-categorization
    all_categories = Category.get_all()

    for item_data in items_data:
        try:
            product_id = item_data.get('product_id')
            if not product_id:
                errors.append('Item missing product_id')
                continue
            product_id = str(product_id)

            new_price = item_data.get('price')

            # Check for existing item
            existing = Item.get_by_product(store, product_id)
            if existing:
                # Check if price changed
                old_price = existing.get('current_price')

                if new_price is not None and (old_price is None or abs((old_price or 0) - new_price) > 0.001):
                    # Price changed - update the item
                    price_update = dict(
                        last_price=old_price,
                        current_price=new_price,
                        price_updated_at=datetime.now().isoformat()
                    )
                    # Update image if extension has a better one
                    ext_img = item_data.get('image_url')
                    if ext_img and isinstance(ext_img, str) and ext_img.startswith('http'):
                        if not existing.get('image_url') or ext_img != existing.get('image_url'):
                            price_update['image_url'] = ext_img
                    # Backfill thumb_url into product_url if missing
                    ex_url = existing.get('product_url', '')
                    ex_img = ext_img or existing.get('image_url')
                    if ex_img and 'thumb_url=' not in (ex_url or ''):
                        price_update['product_url'] = ensure_thumb_url(ex_url, ex_img)
                    Item.update(existing['id'], **price_update)
                    results.append({
                        'id': existing['id'],
                        'product_id': product_id,
                        'product_url': existing.get('product_url', ''),
                        'image_url': existing.get('image_url', ''),
                        'title': existing.get('title', ''),
                        'status': 'updated',
                        'old_price': old_price,
                        'new_price': new_price
                    })
                    updated += 1

                    # Track price direction
                    if old_price and new_price < old_price:
                        price_drops += 1
                    elif old_price and new_price > old_price:
                        price_increases += 1
                else:
                    # No price change - but update image if missing/bad, set original_price if unset
                    reimport_updates = {}
                    ext_image = item_data.get('image_url')
                    if ext_image and isinstance(ext_image, str) and ext_image.startswith('http'):
                        cur_image = existing.get('image_url', '')
                        # Always prefer extension image - it comes from Temu's live API
                        if not cur_image or ext_image != cur_image:
                            reimport_updates['image_url'] = ext_image
                    if existing.get('original_price') is None and new_price is not None:
                        reimport_updates['original_price'] = new_price
                    # Backfill thumb_url into product_url if missing
                    existing_url = existing.get('product_url', '')
                    backfill_image = item_data.get('image_url') or existing.get('image_url')
                    if backfill_image and 'thumb_url=' not in (existing_url or ''):
                        reimport_updates['product_url'] = ensure_thumb_url(existing_url, backfill_image)
                    if reimport_updates:
                        Item.update(existing['id'], **reimport_updates)

                    results.append({
                        'id': existing['id'],
                        'product_id': product_id,
                        'product_url': existing.get('product_url', ''),
                        'image_url': existing.get('image_url', ''),
                        'title': existing.get('title', ''),
                        'status': 'skipped'
                    })
                    skipped += 1
                continue

            # Create new item - ensure thumb_url is embedded in product_url
            import_url = item_data.get('product_url', '')
            import_image = item_data.get('image_url')
            import_url = ensure_thumb_url(import_url, import_image)

            item = Item.create(
                store=store,
                product_id=product_id,
                product_url=import_url,
                title=item_data.get('title', 'Unknown Product'),
                image_url=import_image,
                current_price=new_price,
                quantity=item_data.get('quantity', 1),
                list_id=list_id
            )

            # If extension sent a separate original_price (higher than sale),
            # update it so price drop display works correctly
            ext_original = item_data.get('original_price')
            if ext_original and new_price and ext_original > new_price:
                Item.update(item['id'], original_price=ext_original)

            # Auto-categorize based on title keywords
            title = item_data.get('title', '')
            cat_id = categorize_item_title(title, all_categories)
            if cat_id:
                Item.update(item['id'], category_id=cat_id)

            results.append({
                'id': item['id'],
                'product_id': product_id,
                'product_url': import_url,
                'image_url': import_image,
                'title': item_data.get('title', 'Unknown Product'),
                'status': 'imported'
            })
            imported += 1

        except Exception as e:
            errors.append(f'Error importing {item_data.get("product_id", "unknown")}: {str(e)}')

    return jsonify({
        'success': True,
        'imported': imported,
        'skipped': skipped,
        'updated': updated,
        'price_drops': price_drops,
        'price_increases': price_increases,
        'errors': errors if errors else None,
        'items': results
    })


@retry_on_failure(max_retries=3, delay=2)
def scrape_temu_product(url):
    """Scrape product data from a Temu product page with retry logic."""
    rate_limit_scrape()

    # Check if thumb_url is embedded in the product URL (set by extension)
    embedded_thumb = None
    from urllib.parse import urlparse, parse_qs, unquote
    try:
        parsed = urlparse(url)
        params = parse_qs(parsed.query)
        if 'thumb_url' in params:
            embedded_thumb = unquote(params['thumb_url'][0])
    except Exception:
        pass

    # Handle app-style URLs: follow redirects for share links and normalize URLs
    if 'share.temu.com' in url:
        try:
            resp = requests.head(url, allow_redirects=True, timeout=10,
                                 headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'})
            url = resp.url
        except Exception:
            pass

    # Extract goods_id for API-based scraping
    goods_id = None
    if 'goods_id=' in url:
        gid_match = re.search(r'goods_id=(\d+)', url)
        if gid_match:
            goods_id = gid_match.group(1)
    if not goods_id:
        id_match = re.search(r'_p_(\d+)\.html', url)
        if not id_match:
            id_match = re.search(r'/product/(\d+)', url)
        if not id_match:
            id_match = re.search(r'subject_id=(\d+)', url)
        if id_match:
            goods_id = id_match.group(1)

    # Normalize URL
    if goods_id and 'goods_id=' not in url:
        url = f'https://www.temu.com/goods.html?goods_id={goods_id}'

    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Cache-Control': 'max-age=0',
    }

    data = {}

    # METHOD 1: Try Temu's API endpoint for structured data (more reliable than HTML scraping)
    if goods_id:
        try:
            api_url = f'https://www.temu.com/api/poppy/v1/opt/get?goods_id={goods_id}'
            api_headers = {
                'User-Agent': headers['User-Agent'],
                'Accept': 'application/json',
                'Referer': f'https://www.temu.com/goods.html?goods_id={goods_id}',
            }
            api_resp = requests.get(api_url, headers=api_headers, timeout=15)
            if api_resp.status_code == 200:
                try:
                    api_data = api_resp.json()
                    # Navigate common Temu API response structures
                    result = api_data.get('result', api_data.get('data', api_data))
                    if isinstance(result, dict):
                        goods = result.get('goods', result)
                        if isinstance(goods, dict):
                            # Title
                            title = goods.get('goods_name') or goods.get('goodsName') or goods.get('title', '')
                            if title and len(title) > 5:
                                data['title'] = title
                            # Image - filter to strings only (image field can be an object)
                            img_candidates = [goods.get('thumb_url'), goods.get('thumbUrl'), goods.get('hdThumbUrl')]
                            img = next((u for u in img_candidates if isinstance(u, str) and u.startswith('http')), '')
                            if img and is_valid_product_image(img):
                                data['image_url'] = img.replace('\\/', '/')
                            # Price - prefer sale/discount price over original price
                            price_info = goods.get('priceInfo', goods)
                            if isinstance(price_info, dict):
                                # Sale price fields first (what customer actually pays)
                                sale_val = (price_info.get('salePrice') or price_info.get('sale_price')
                                           or price_info.get('promoPrice') or price_info.get('discountPrice'))
                                orig_val = price_info.get('price') or price_info.get('originalPrice')

                                # Use sale price if available, otherwise fall back to price
                                price_val = sale_val or orig_val
                                if price_val:
                                    p = float(price_val)
                                    if p > 100 and '.' not in str(price_val):
                                        p = p / 100
                                    if 0.01 <= p <= 9999:
                                        data['price'] = round(p, 2)
                                # Also store original price if both exist
                                if sale_val and orig_val:
                                    op = float(orig_val)
                                    if op > 100 and '.' not in str(orig_val):
                                        op = op / 100
                                    if 0.01 <= op <= 9999:
                                        data['original_price'] = round(op, 2)
                except (ValueError, KeyError):
                    pass
        except Exception:
            pass

    # METHOD 2: Scrape HTML page (fallback if API didn't get everything)
    if not data.get('image_url') or not data.get('title') or not data.get('price'):
        try:
            response = requests.get(url, headers=headers, timeout=20)
            response.raise_for_status()
            html = response.text

            # Extract title - multiple patterns for reliability
            if not data.get('title'):
                title_patterns = [
                    r'"goods_name"\s*:\s*"([^"]+)"',
                    r'"goodsName"\s*:\s*"([^"]+)"',
                    r'"title"\s*:\s*"([^"]+)"',
                    r'"productName"\s*:\s*"([^"]+)"',
                    r'<meta property="og:title" content="([^"]+)"',
                    r'<title>([^<|]+)',
                    r'"name"\s*:\s*"([^"]+)"',
                ]
                for pattern in title_patterns:
                    match = re.search(pattern, html)
                    if match:
                        title = match.group(1)
                        try:
                            if '\\u' in title:
                                title = title.encode().decode('unicode_escape')
                        except (UnicodeDecodeError, UnicodeEncodeError):
                            pass
                        title = title.strip()
                        if len(title) > 5 and len(title) < 500 and 'Temu' not in title:
                            data['title'] = title
                            break

            # Extract image URL - multiple patterns
            if not data.get('image_url'):
                image_patterns = [
                    r'"thumb_url"\s*:\s*"(https?:[^"]+)"',
                    r'"thumbUrl"\s*:\s*"(https?:[^"]+)"',
                    r'"image"\s*:\s*"(https?:[^"]+)"',
                    r'"img"\s*:\s*"(https?:[^"]+)"',
                    r'"goods_img"\s*:\s*"(https?:[^"]+)"',
                    r'"goodsImg"\s*:\s*"(https?:[^"]+)"',
                    r'"hdThumbUrl"\s*:\s*"(https?:[^"]+)"',
                    r'<meta property="og:image" content="([^"]+)"',
                    r'"image_url"\s*:\s*"(https?:[^"]+)"',
                    r'<img[^>]+src="(https://[^"]*kwcdn[^"]*)"[^>]*>',
                    r'<img[^>]+src="(https://[^"]*akamaized[^"]*)"[^>]*>',
                ]
                for pattern in image_patterns:
                    match = re.search(pattern, html)
                    if match:
                        img_url = match.group(1)
                        img_url = img_url.replace('\\/', '/').replace('\\u002F', '/')
                        if is_valid_product_image(img_url):
                            data['image_url'] = img_url
                            break

            # Extract price - sale/discount price patterns first, then original
            if not data.get('price'):
                price_patterns = [
                    r'"salePrice"\s*:\s*(\d+\.?\d*)',
                    r'"sale_price"\s*:\s*(\d+\.?\d*)',
                    r'"promoPrice"\s*:\s*(\d+\.?\d*)',
                    r'"discountPrice"\s*:\s*(\d+\.?\d*)',
                    r'"displayPrice"\s*:\s*"?\$?(\d+\.?\d*)"?',
                    r'"priceInfo"[^}]*"salePrice"\s*:\s*(\d+)',
                    r'"priceInfo"[^}]*"price"\s*:\s*(\d+)',
                    r'"current_price"\s*:\s*(\d+\.?\d*)',
                    r'"price"\s*:\s*(\d+\.?\d*)',
                    r'<meta property="product:price:amount" content="(\d+\.?\d*)"',
                    r'\$(\d+\.?\d{2})',
                ]
                for pattern in price_patterns:
                    matches = re.findall(pattern, html)
                    for match in matches:
                        try:
                            price = float(match)
                            if price > 100 and '.' not in str(match):
                                price = price / 100
                            if 0.01 <= price <= 9999:
                                data['price'] = round(price, 2)
                                break
                        except ValueError:
                            continue
                    if 'price' in data:
                        break
        except Exception:
            pass

    # Fall back to embedded thumb_url from product URL if scrape didn't find an image
    if not data.get('image_url') and embedded_thumb:
        data['image_url'] = embedded_thumb

    return data if data else None


@items_bp.route('/<int:item_id>/refresh', methods=['POST'])
def refresh_item(item_id):
    """Refresh item data by scraping its product URL."""
    item = Item.get_by_id(item_id)
    if not item:
        return jsonify({'error': 'Item not found'}), 404

    product_url = item.get('product_url')
    if not product_url:
        return jsonify({'error': 'Item has no product URL'}), 400

    store = item.get('store', '')

    # Scrape based on store
    if 'temu' in store.lower() or 'temu.com' in product_url:
        try:
            scraped = scrape_temu_product(product_url)
        except Exception as e:
            return jsonify({'error': f'Scraping failed: {str(e)}'}), 500
    else:
        return jsonify({'error': f'Refresh not supported for store: {store}'}), 400

    if not scraped:
        # Track consecutive scrape failures — auto-mark unavailable after 3
        fail_count = (item.get('scrape_fail_count') or 0) + 1
        fail_updates = {'scrape_fail_count': fail_count, 'last_checked': datetime.now().isoformat()}
        if fail_count >= 3:
            fail_updates['is_unavailable'] = 1
        Item.update(item_id, **fail_updates)
        return jsonify({'error': 'Could not fetch product data. The page may be unavailable or the product removed.'}), 500

    # Update item with scraped data - update ALL fields, not just missing ones
    updates = {}
    updated_fields = []

    # Update image if scraped and either missing or different
    if scraped.get('image_url'):
        if not item.get('image_url') or not is_valid_product_image(item.get('image_url', '')):
            updates['image_url'] = scraped['image_url']
            updated_fields.append('image')
            # Embed thumb_url in product_url for future recovery
            if product_url and 'thumb_url=' not in product_url:
                updates['product_url'] = ensure_thumb_url(product_url, scraped['image_url'])
        elif scraped['image_url'] != item.get('image_url'):
            updates['image_url'] = scraped['image_url']
            updated_fields.append('image')
            if product_url and 'thumb_url=' not in product_url:
                updates['product_url'] = ensure_thumb_url(product_url, scraped['image_url'])

    # Update price - always update if different, track price history
    if scraped.get('price') is not None:
        old_price = item.get('current_price')
        new_price = scraped['price']
        if old_price is None:
            updates['current_price'] = new_price
            if item.get('original_price') is None:
                updates['original_price'] = new_price
            updated_fields.append('price')
        elif abs(old_price - new_price) > 0.001:
            updates['last_price'] = old_price
            updates['current_price'] = new_price
            updates['price_updated_at'] = datetime.now().isoformat()
            if new_price < old_price:
                updated_fields.append(f'price (dropped ${old_price:.2f} → ${new_price:.2f})')
            else:
                updated_fields.append(f'price (changed ${old_price:.2f} → ${new_price:.2f})')

    # Update title if scraped and either missing or placeholder
    if scraped.get('title'):
        if not item.get('title') or item.get('title') in ['Unknown Product', '']:
            updates['title'] = scraped['title']
            updated_fields.append('title')

    # Track last refresh time and reset fail counter on success
    updates['last_checked'] = datetime.now().isoformat()
    updates['scrape_fail_count'] = 0
    if item.get('is_unavailable') and scraped:
        updates['is_unavailable'] = 0  # Product is back!

    if len(updated_fields) > 0:
        updated_item = Item.update(item_id, **updates)
        return jsonify({
            'success': True,
            'updated_fields': updated_fields,
            'item': updated_item
        })
    else:
        Item.update(item_id, last_checked=datetime.now().isoformat())
        return jsonify({
            'success': True,
            'updated_fields': [],
            'message': 'Data is already up to date'
        })


@items_bp.route('/refresh-missing', methods=['POST'])
def refresh_missing_data():
    """Refresh all items that are missing image or price data."""
    data = request.get_json() or {}
    limit = data.get('limit', 50)  # Limit to prevent long-running requests

    # Get all items missing data (including items with bad/placeholder images)
    items = Item.get_all()
    missing_items = [
        i for i in items
        if not has_valid_image(i) or i.get('current_price') is None
    ][:limit]

    if not missing_items:
        return jsonify({
            'success': True,
            'message': 'No items with missing data',
            'refreshed': 0,
            'failed': 0,
            'total_missing': 0
        })

    refreshed = 0
    failed = 0
    results = []

    for idx, item in enumerate(missing_items):
        product_url = item.get('product_url')
        if not product_url:
            failed += 1
            results.append({'id': item['id'], 'status': 'no_url'})
            continue

        store = item.get('store', '')

        # Scrape based on store
        try:
            if 'temu' in store.lower() or 'temu.com' in product_url:
                scraped = scrape_temu_product(product_url)
            else:
                failed += 1
                results.append({'id': item['id'], 'status': 'unsupported_store'})
                continue
        except Exception as e:
            failed += 1
            results.append({'id': item['id'], 'status': 'error', 'error': str(e)})
            continue

        if not scraped:
            failed += 1
            results.append({'id': item['id'], 'status': 'no_data'})
            continue

        # Update item with scraped data - update all fields, not just missing ones
        updates = {'last_checked': datetime.now().isoformat()}
        updated_fields = []

        if scraped.get('image_url') and is_valid_product_image(scraped['image_url']):
            # Only set image if item has NO image - never overwrite with server-scraped data
            if not item.get('image_url'):
                updates['image_url'] = scraped['image_url']
                updated_fields.append('image')

        if scraped.get('price') is not None:
            old_price = item.get('current_price')
            new_price = scraped['price']
            if old_price is None:
                updates['current_price'] = new_price
                if item.get('original_price') is None:
                    updates['original_price'] = new_price
                updated_fields.append('price')
            elif abs(old_price - new_price) > 0.001:
                updates['last_price'] = old_price
                updates['current_price'] = new_price
                updates['price_updated_at'] = datetime.now().isoformat()
                updated_fields.append('price')

        if scraped.get('title') and (not item.get('title') or item.get('title') in ['Unknown Product', '']):
            updates['title'] = scraped['title']
            updated_fields.append('title')

        if updated_fields:
            Item.update(item['id'], **updates)
            refreshed += 1
            results.append({'id': item['id'], 'status': 'updated', 'fields': updated_fields})
        else:
            Item.update(item['id'], **updates)
            results.append({'id': item['id'], 'status': 'no_updates'})

    total_missing = len([i for i in items if not has_valid_image(i) or i.get('current_price') is None])

    return jsonify({
        'success': True,
        'refreshed': refreshed,
        'failed': failed,
        'processed': len(missing_items),
        'total_missing': total_missing,
        'remaining': total_missing - len(missing_items),
        'results': results
    })


# Background refresh state
_refresh_all_status = {
    'running': False,
    'total': 0,
    'processed': 0,
    'updated': 0,
    'failed': 0,
    'skipped': 0,
    'current_item': '',
    'results': [],
}


def _do_refresh_all(item_ids=None, force_images=False):
    """Background worker: scrape every item's product URL and update data."""
    global _refresh_all_status
    try:
        items = Item.get_all()
        targets = [i for i in items if i.get('product_url')]
        if item_ids:
            id_set = set(item_ids)
            targets = [i for i in targets if i['id'] in id_set]

        _refresh_all_status['total'] = len(targets)
        _refresh_all_status['processed'] = 0
        _refresh_all_status['updated'] = 0
        _refresh_all_status['failed'] = 0
        _refresh_all_status['skipped'] = 0
        _refresh_all_status['results'] = []

        for item in targets:
            _refresh_all_status['current_item'] = item.get('title', '')[:60]
            product_url = item.get('product_url', '')
            store = item.get('store', '')

            if not ('temu' in store.lower() or 'temu.com' in product_url):
                _refresh_all_status['skipped'] += 1
                _refresh_all_status['processed'] += 1
                continue

            try:
                scraped = scrape_temu_product(product_url)
            except Exception as e:
                _refresh_all_status['failed'] += 1
                _refresh_all_status['processed'] += 1
                _refresh_all_status['results'].append({
                    'id': item['id'], 'status': 'error', 'error': str(e)[:100]
                })
                continue

            if not scraped:
                _refresh_all_status['failed'] += 1
                _refresh_all_status['processed'] += 1
                _refresh_all_status['results'].append({
                    'id': item['id'], 'status': 'no_data'
                })
                continue

            updates = {'last_checked': datetime.now().isoformat()}
            updated_fields = []

            # Image: try scraped image, then embedded thumb_url from product URL
            best_img = None
            if scraped.get('image_url') and is_valid_product_image(scraped['image_url']):
                best_img = scraped['image_url']
            if not best_img and 'thumb_url=' in product_url:
                from urllib.parse import urlparse, parse_qs, unquote
                try:
                    parsed = urlparse(product_url)
                    params = parse_qs(parsed.query)
                    if 'thumb_url' in params:
                        embedded = unquote(params['thumb_url'][0])
                        if embedded and is_valid_product_image(embedded):
                            best_img = embedded
                except Exception:
                    pass

            if best_img:
                current_img = item.get('image_url')
                if best_img != current_img:
                    if not current_img or force_images or not is_valid_product_image(current_img):
                        updates['image_url'] = best_img
                        updated_fields.append('image')

            # Price: always update if different
            if scraped.get('price') is not None:
                old_price = item.get('current_price')
                new_price = scraped['price']
                if old_price is None:
                    updates['current_price'] = new_price
                    if item.get('original_price') is None:
                        updates['original_price'] = new_price
                    updated_fields.append('price')
                elif abs(old_price - new_price) > 0.001:
                    updates['last_price'] = old_price
                    updates['current_price'] = new_price
                    updates['price_updated_at'] = datetime.now().isoformat()
                    updated_fields.append('price')

            # Title: update if missing or placeholder
            if scraped.get('title'):
                cur_title = item.get('title', '')
                if not cur_title or cur_title in ['Unknown Product', 'Unknown', '']:
                    updates['title'] = scraped['title']
                    updated_fields.append('title')

            # Original price
            if scraped.get('original_price') and item.get('original_price') is None:
                updates['original_price'] = scraped['original_price']
                updated_fields.append('original_price')

            Item.update(item['id'], **updates)

            if updated_fields:
                _refresh_all_status['updated'] += 1
                _refresh_all_status['results'].append({
                    'id': item['id'], 'status': 'updated', 'fields': updated_fields
                })
            else:
                _refresh_all_status['results'].append({
                    'id': item['id'], 'status': 'no_changes'
                })

            _refresh_all_status['processed'] += 1

    finally:
        _refresh_all_status['running'] = False
        _refresh_all_status['current_item'] = ''


@items_bp.route('/refresh-all', methods=['POST'])
def refresh_all():
    """Start a background refresh of ALL items by scraping each product URL."""
    global _refresh_all_status
    if _refresh_all_status['running']:
        return jsonify({'error': 'Refresh already in progress', 'status': _refresh_all_status}), 409

    data = request.get_json() or {}
    item_ids = data.get('item_ids', None)
    force_images = data.get('force_images', False)

    _refresh_all_status['running'] = True
    thread = threading.Thread(target=_do_refresh_all, args=(item_ids, force_images), daemon=True)
    thread.start()

    return jsonify({'success': True, 'message': 'Refresh started in background'})


@items_bp.route('/refresh-all/status', methods=['GET'])
def refresh_all_status():
    """Get the current status of a background refresh-all operation."""
    return jsonify(_refresh_all_status)


@items_bp.route('/refresh-pictures', methods=['POST'])
def refresh_pictures():
    """Bulk refresh pictures for all items by re-scraping product pages (images only)."""
    data = request.get_json() or {}
    limit = data.get('limit', 50)
    offset = data.get('offset', 0)
    item_ids = data.get('item_ids', None)

    items = Item.get_all()
    # Filter to items with product URLs
    all_with_url = [i for i in items if i.get('product_url')]

    # If specific IDs provided, filter to those
    if item_ids:
        id_set = set(item_ids)
        all_with_url = [i for i in all_with_url if i['id'] in id_set]

    # Prioritize items with bad/missing images first
    bad_image_items = [i for i in all_with_url if not has_valid_image(i)]
    good_image_items = [i for i in all_with_url if has_valid_image(i)]
    sorted_items = bad_image_items + good_image_items
    target_items = sorted_items[offset:offset + limit]

    if not target_items:
        return jsonify({'success': True, 'message': 'No items to refresh', 'refreshed': 0, 'failed': 0})

    refreshed = 0
    failed = 0
    skipped = 0

    # Build a set of image URLs already used by other items to detect generic/shared images
    all_image_urls = {}
    for i in items:
        url = i.get('image_url', '')
        if url:
            all_image_urls[url] = all_image_urls.get(url, 0) + 1

    for item in target_items:
        product_url = item.get('product_url', '')
        store = item.get('store', '')

        # Primary: check for embedded thumb_url from extension (most reliable source)
        if 'thumb_url=' in product_url:
            from urllib.parse import urlparse, parse_qs, unquote
            try:
                parsed = urlparse(product_url)
                params = parse_qs(parsed.query)
                if 'thumb_url' in params:
                    embedded = unquote(params['thumb_url'][0])
                    if embedded and embedded != item.get('image_url'):
                        Item.update(item['id'], image_url=embedded, last_checked=datetime.now().isoformat())
                        refreshed += 1
                        continue
                    elif embedded == item.get('image_url'):
                        # Already has the correct extension-provided image
                        skipped += 1
                        continue
            except Exception:
                pass

        # Only attempt server-side scrape for items with NO image at all.
        # Server-side scraping is unreliable because Temu renders product images
        # via JavaScript - the static HTML only contains generic sale/promo images.
        # NEVER overwrite an existing image with a server-scraped one.
        if item.get('image_url'):
            skipped += 1
            continue

        # Cap server-side scrapes per batch to avoid long-running requests
        # (each scrape can take 15s+ with retries if Temu rate-limits)
        if (failed + refreshed) >= 5:
            skipped += 1
            continue

        try:
            if 'temu' in store.lower() or 'temu.com' in product_url:
                scraped = scrape_temu_product(product_url)
            else:
                failed += 1
                continue
        except Exception:
            failed += 1
            continue

        if not scraped or not scraped.get('image_url'):
            failed += 1
            continue

        new_image = scraped['image_url']
        # Reject if this same URL is already used by 3+ other items (it's generic)
        if all_image_urls.get(new_image, 0) >= 3:
            failed += 1
            continue

        if is_valid_product_image(new_image):
            Item.update(item['id'], image_url=new_image, last_checked=datetime.now().isoformat())
            all_image_urls[new_image] = all_image_urls.get(new_image, 0) + 1
            refreshed += 1
        else:
            failed += 1

    total_bad = len([i for i in items if i.get('product_url') and not has_valid_image(i)])

    return jsonify({
        'success': True,
        'refreshed': refreshed,
        'failed': failed,
        'processed': len(target_items),
        'total': len(all_with_url),
        'bad_images_remaining': total_bad
    })


@items_bp.route('/needs-images', methods=['GET'])
def needs_images():
    """Return items that need images (missing or bad placeholder images).
    Used by the extension's background tab-scraper to know which product pages to visit.
    Auto-fixes items that have a thumb_url embedded in their product_url before returning."""
    from urllib.parse import urlparse, parse_qs, unquote

    items = Item.get_all()

    # Count image usage for duplicate detection
    image_counts = {}
    for item in items:
        url = item.get('image_url', '')
        if url:
            image_counts[url] = image_counts.get(url, 0) + 1

    needs = []
    auto_fixed = 0
    for item in items:
        if not item.get('product_url'):
            continue
        image_url = item.get('image_url', '')
        needs_image = False
        if not image_url:
            needs_image = True
        elif not is_valid_product_image(image_url):
            needs_image = True
        elif image_counts.get(image_url, 0) >= 3:
            needs_image = True  # Shared by 3+ items = generic placeholder

        if needs_image:
            # Try to auto-fix using embedded thumb_url before sending to extension
            product_url = item.get('product_url', '')
            if 'thumb_url=' in product_url:
                try:
                    parsed = urlparse(product_url)
                    params = parse_qs(parsed.query)
                    if 'thumb_url' in params:
                        embedded = unquote(params['thumb_url'][0])
                        if embedded.startswith('http') and is_valid_product_image(embedded):
                            # Auto-fix: update the item's image directly
                            Item.update(item['id'], image_url=embedded)
                            auto_fixed += 1
                            continue
                except Exception:
                    pass

            needs.append({
                'id': item['id'],
                'product_url': item['product_url'],
                'title': item.get('title', ''),
                'current_image': image_url,
            })

    return jsonify({ 'items': needs, 'count': len(needs), 'auto_fixed': auto_fixed })


@items_bp.route('/<int:item_id>', methods=['PATCH'])
def patch_item(item_id):
    """Update specific fields on an item (used by extension to push scraped images)."""
    item = Item.get_by_id(item_id)
    if not item:
        return jsonify({'error': 'Item not found'}), 404

    data = request.get_json() or {}
    updates = {}

    if 'image_url' in data:
        new_img = data['image_url']
        if isinstance(new_img, str) and new_img.startswith('http') and is_valid_product_image(new_img):
            updates['image_url'] = new_img
            # Also embed thumb_url in product_url for future recovery
            current_url = item.get('product_url', '')
            if current_url and 'thumb_url=' not in current_url:
                updates['product_url'] = ensure_thumb_url(current_url, new_img)

    if 'title' in data and data['title']:
        updates['title'] = data['title']

    if 'current_price' in data and data['current_price'] is not None:
        updates['current_price'] = float(data['current_price'])

    if not updates:
        return jsonify({'error': 'No valid fields to update'}), 400

    updated = Item.update(item_id, **updates)
    return jsonify({'success': True, 'item': updated})


@items_bp.route('/bad-images', methods=['GET'])
def list_bad_images():
    """List all items with bad/suspect images for manual review."""
    items = Item.get_all()
    bad_items = []

    # Count image usage for duplicate detection
    image_counts = {}
    for item in items:
        url = item.get('image_url', '')
        if url:
            image_counts[url] = image_counts.get(url, 0) + 1

    for item in items:
        image_url = item.get('image_url', '')
        if not image_url:
            bad_items.append({
                'id': item['id'],
                'title': item.get('title', ''),
                'image_url': None,
                'product_url': item.get('product_url', ''),
                'reason': 'missing'
            })
            continue

        reasons = []
        if not is_valid_product_image(image_url):
            reasons.append('bad_pattern')
        if image_counts.get(image_url, 0) >= 2:
            reasons.append(f'duplicate_{image_counts[image_url]}x')
        if not has_valid_image(item):
            reasons.append('failed_validation')

        if reasons:
            bad_items.append({
                'id': item['id'],
                'title': item.get('title', ''),
                'image_url': image_url,
                'product_url': item.get('product_url', ''),
                'reason': ', '.join(reasons)
            })

    return jsonify({
        'success': True,
        'total_items': len(items),
        'bad_count': len(bad_items),
        'items': bad_items
    })


@items_bp.route('/clean-bad-images', methods=['POST'])
def clean_bad_images():
    """Detect and clear duplicate/generic images that were set by server-side scraping.

    Images shared by 3+ items are almost certainly generic placeholders from Temu's
    static HTML, not real product photos. This endpoint clears them so the extension
    can re-provide the correct images.
    """
    items = Item.get_all()

    # Count how many items share each image URL
    image_counts = {}
    for item in items:
        url = item.get('image_url', '')
        if url:
            image_counts[url] = image_counts.get(url, 0) + 1

    # Find duplicate images (used by 2+ items = likely generic)
    duplicate_urls = {url for url, count in image_counts.items() if count >= 2}

    # Also check for items where image doesn't match embedded thumb_url
    cleared = 0
    mismatched = 0
    for item in items:
        current_image = item.get('image_url', '')
        if not current_image:
            continue

        should_clear = False

        # Clear if image is shared across many items (generic placeholder)
        if current_image in duplicate_urls:
            should_clear = True

        # Clear if image matches known bad patterns
        if not is_valid_product_image(current_image):
            should_clear = True

        # Clear if item has embedded thumb_url that doesn't match current image
        product_url = item.get('product_url', '')
        if 'thumb_url=' in product_url:
            from urllib.parse import urlparse, parse_qs, unquote
            try:
                parsed = urlparse(product_url)
                params = parse_qs(parsed.query)
                if 'thumb_url' in params:
                    embedded = unquote(params['thumb_url'][0])
                    if embedded and embedded != current_image:
                        # Replace with the correct extension-provided image
                        Item.update(item['id'], image_url=embedded)
                        mismatched += 1
                        continue
            except Exception:
                pass

        if should_clear:
            Item.update(item['id'], image_url='')
            cleared += 1

    return jsonify({
        'success': True,
        'cleared': cleared,
        'restored_from_extension': mismatched,
        'duplicate_image_urls': len(duplicate_urls),
        'duplicate_url_list': list(duplicate_urls)[:10]  # Show first 10 for debugging
    })


@items_bp.route('/update-images', methods=['POST'])
def update_images():
    """Accept image URL updates pushed from the browser extension.

    Expects JSON: { "updates": [ { "goods_id": "123", "image_url": "https://..." }, ... ] }
    Matches items by goods_id in their product_url and updates the image.
    """
    data = request.get_json() or {}
    updates = data.get('updates', [])

    if not updates:
        return jsonify({'success': True, 'updated': 0, 'message': 'No updates provided'})

    items = Item.get_all()

    # Build a lookup: goods_id -> item (support both web and app URL formats)
    goods_id_map = {}
    for item in items:
        gid = extract_goods_id(item.get('product_url', ''))
        if gid:
            goods_id_map[gid] = item

    updated = 0
    for update in updates:
        goods_id = str(update.get('goods_id', ''))
        new_image = update.get('image_url', '')
        if not goods_id or not new_image:
            continue

        item = goods_id_map.get(goods_id)
        if not item:
            continue

        # Update image and also embed thumb_url in product_url for future refreshes
        item_updates = {'image_url': new_image, 'last_checked': datetime.now().isoformat()}

        # Update product_url to include thumb_url if not already there
        product_url = item.get('product_url', '')
        if 'thumb_url=' not in product_url:
            from urllib.parse import urlencode, quote
            item_updates['product_url'] = product_url + '&thumb_url=' + quote(new_image, safe='')

        Item.update(item['id'], **item_updates)
        updated += 1

    return jsonify({
        'success': True,
        'updated': updated,
        'total': len(updates)
    })


@items_bp.route('/price-check', methods=['POST'])
def check_prices():
    """Check current prices for items and update if changed."""
    data = request.get_json() or {}
    item_ids = data.get('item_ids', [])
    limit = data.get('limit', 20)

    if item_ids:
        items = [item for item in (Item.get_by_id(id) for id in item_ids) if item]
    else:
        # Get items that haven't been checked recently
        all_items = Item.get_all()
        items = sorted(all_items, key=lambda x: x.get('last_checked') or '')[:limit]

    results = {
        'checked': 0,
        'updated': 0,
        'price_drops': 0,
        'price_increases': 0,
        'failed': 0,
        'changes': []
    }

    for item in items:
        product_url = item.get('product_url')
        if not product_url:
            results['failed'] += 1
            continue

        store = item.get('store', '')

        try:
            if 'temu' in store.lower() or 'temu.com' in product_url:
                scraped = scrape_temu_product(product_url)
            else:
                results['failed'] += 1
                continue
        except Exception:
            results['failed'] += 1
            continue

        results['checked'] += 1

        if scraped and scraped.get('price'):
            old_price = item.get('current_price')
            new_price = scraped['price']

            if old_price is not None and abs(old_price - new_price) > 0.001:
                Item.update(item['id'],
                           last_price=old_price,
                           current_price=new_price,
                           price_updated_at=datetime.now().isoformat(),
                           last_checked=datetime.now().isoformat())

                results['updated'] += 1
                change = {
                    'id': item['id'],
                    'title': item.get('title'),
                    'old_price': old_price,
                    'new_price': new_price,
                    'difference': round(new_price - old_price, 2)
                }
                results['changes'].append(change)

                if new_price < old_price:
                    results['price_drops'] += 1
                else:
                    results['price_increases'] += 1
            elif old_price is None:
                # Item had no price before - fill it in
                Item.update(item['id'],
                           current_price=new_price,
                           original_price=new_price,
                           price_updated_at=datetime.now().isoformat(),
                           last_checked=datetime.now().isoformat())
                results['updated'] += 1
            else:
                Item.update(item['id'], last_checked=datetime.now().isoformat())

    return jsonify(results)


@items_bp.route('/import-link', methods=['POST'])
def import_from_link():
    """Import a single item from a Temu product URL."""
    data = request.get_json()
    url = (data.get('url') or '').strip()
    list_id = data.get('list_id', 1)

    if not url:
        return jsonify({'error': 'URL is required'}), 400

    # Validate it's a Temu URL
    if 'temu.com' not in url:
        return jsonify({'error': 'Only Temu links are supported right now'}), 400

    # Extract product ID from URL
    product_id = extract_goods_id(url)

    # Also try share.temu.com short links - follow redirect
    if 'share.temu.com' in url or not product_id:
        try:
            resp = requests.head(url, allow_redirects=True, timeout=10,
                                 headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'})
            url = resp.url
            product_id = extract_goods_id(url) or product_id
        except Exception:
            pass

    if not product_id:
        # Try scraping the page to find the product ID
        try:
            scraped = scrape_temu_product(url)
        except Exception as e:
            return jsonify({'error': f'Could not load page: {str(e)}'}), 400

        if not scraped:
            return jsonify({'error': 'Could not find product info from this link'}), 400

        # Generate a product ID from the URL
        product_id = re.sub(r'[^a-zA-Z0-9]', '', url)[-20:]
    else:
        # Scrape product details
        try:
            scraped = scrape_temu_product(url)
        except Exception as e:
            scraped = {}

    if not scraped:
        scraped = {}

    # Check if already exists
    existing = Item.get_by_product('temu', product_id)
    if existing:
        return jsonify({
            'success': True,
            'status': 'exists',
            'message': 'This item is already in your wishlist!',
            'item': existing
        })

    # Create the item
    item = Item.create(
        store='temu',
        product_id=product_id,
        product_url=url,
        title=scraped.get('title', 'Temu Product'),
        image_url=scraped.get('image_url'),
        current_price=scraped.get('price'),
        quantity=1,
        list_id=list_id
    )

    return jsonify({
        'success': True,
        'status': 'imported',
        'message': 'Item added to your wishlist!',
        'item': item
    })


# ============================================================
# AUTO-CATEGORIZATION
# ============================================================
# Keyword-based category matching. Maps item titles to categories
# by scanning for known keywords. Works with existing categories
# and can create new ones when enough items cluster together.

# Category keyword rules: { category_name: [keywords] }
# Keywords are matched case-insensitively against item titles.
# More specific keywords should come first within each category.
CATEGORY_RULES = {
    'Clothes': [
        'dress', 'shirt', 'blouse', 'jacket', 'coat', 'pants', 'jeans',
        'leggings', 'skirt', 'sweater', 'hoodie', 'cardigan', 'vest',
        'romper', 'jumpsuit', 'bodysuit', 'lingerie', 'bra', 'underwear',
        'panties', 'socks', 'stockings', 'tights', 'pajama', 'nightgown',
        'robe', 'kimono', 'tunic', 'polo', 'tank top', 'camisole',
        'shorts', 'sweatpants', 'jogger', 'tracksuit', 'sportswear',
        'athletic wear', 'activewear', 'swimsuit', 'bikini', 'swimwear',
        'bathing suit', 'cover up', 'sarong', 'scarf', 'shawl',
        'hat', 'cap', 'beanie', 'headband', 'belt', 'suspender',
        'tie', 'bow tie', 'glove', 'mitten', 'apron',
        'clothing', 'outfit', 'costume', 'uniform', 't-shirt', 'tee',
        'women dress', 'men shirt', 'plus size', 'maternity',
    ],
    'Garden': [
        'garden', 'planter', 'flower pot', 'plant', 'seed', 'soil',
        'fertilizer', 'watering can', 'hose', 'sprinkler', 'lawn',
        'mower', 'trimmer', 'pruner', 'shear', 'trowel', 'rake',
        'shovel', 'wheelbarrow', 'compost', 'mulch', 'greenhouse',
        'raised bed', 'trellis', 'garden gnome', 'bird feeder',
        'bird bath', 'outdoor decor', 'patio', 'yard', 'landscape',
        'weed', 'herbicide', 'pest control', 'insecticide',
        'hanging basket', 'succulent', 'cactus', 'bonsai',
        'artificial flower', 'fake plant', 'silk flower',
    ],
    'Kitchen': [
        'kitchen', 'cooking', 'baking', 'cookware', 'bakeware',
        'pan', 'pot', 'skillet', 'wok', 'saucepan', 'dutch oven',
        'casserole', 'roasting', 'griddle', 'grill',
        'knife', 'cutting board', 'chopping', 'peeler', 'grater',
        'slicer', 'mandoline', 'can opener', 'bottle opener',
        'corkscrew', 'whisk', 'spatula', 'ladle', 'tongs',
        'rolling pin', 'measuring cup', 'measuring spoon',
        'mixing bowl', 'colander', 'strainer', 'sieve',
        'food processor', 'blender', 'mixer', 'juicer',
        'toaster', 'air fryer', 'instant pot', 'slow cooker',
        'rice cooker', 'coffee maker', 'kettle', 'teapot',
        'plate', 'bowl', 'mug', 'cup', 'glass', 'tumbler',
        'utensil', 'silverware', 'flatware', 'chopstick',
        'food storage', 'container', 'tupperware', 'lunch box',
        'water bottle', 'thermos', 'flask', 'pitcher',
        'oven mitt', 'pot holder', 'trivet', 'dish rack',
        'sponge', 'dish soap', 'kitchen towel',
        'spice rack', 'seasoning', 'condiment',
        'cookie cutter', 'cake mold', 'muffin tin', 'pie dish',
        'cupcake', 'frosting', 'piping', 'fondant',
        'silicone mold', 'baking mat', 'parchment',
    ],
    'Stained Glass': [
        'stained glass', 'suncatcher', 'sun catcher',
        'glass panel', 'window hanging', 'glass art',
        'tiffany', 'leaded glass', 'glass paint',
        'glass cutter', 'copper foil', 'soldering',
        'fusing glass', 'dichroic', 'glass mosaic',
    ],
    'Hearing Aids': [
        'hearing aid', 'hearing amplifier', 'ear amplifier',
        'sound amplifier', 'hearing device', 'hearing assist',
        'ear piece', 'hearing enhancement', 'audiphone',
    ],
    'Makeup': [
        'makeup', 'cosmetic', 'lipstick', 'lip gloss', 'lip liner',
        'foundation', 'concealer', 'primer', 'setting spray',
        'blush', 'bronzer', 'highlighter', 'contour',
        'eyeshadow', 'eye shadow', 'eyeliner', 'mascara',
        'eyebrow', 'brow pencil', 'brow gel',
        'nail polish', 'nail art', 'manicure', 'pedicure',
        'false eyelash', 'fake lash', 'lash extension',
        'beauty blender', 'makeup brush', 'brush set',
        'makeup bag', 'cosmetic bag', 'vanity', 'mirror',
        'face mask', 'sheet mask', 'peel', 'serum',
        'moisturizer', 'cleanser', 'toner', 'exfoliant',
        'skincare', 'skin care', 'face cream', 'eye cream',
        'sunscreen', 'spf', 'anti-aging', 'retinol',
        'perfume', 'fragrance', 'cologne', 'body spray',
    ],
    'Dog Stuff': [
        'dog', 'puppy', 'canine', 'pet collar', 'pet leash',
        'pet bed', 'pet toy', 'pet treat', 'pet food',
        'pet bowl', 'pet feeder', 'pet water', 'pet carrier',
        'pet crate', 'pet gate', 'pet door', 'pet clothes',
        'pet costume', 'pet harness', 'pet tag', 'pet grooming',
        'pet shampoo', 'pet brush', 'pet nail', 'pet paw',
        'chew toy', 'squeaky toy', 'fetch', 'frisbee',
        'dog house', 'kennel', 'dog bed', 'dog crate',
        'dog food', 'dog treat', 'dog bone', 'dog collar',
        'dog leash', 'dog harness', 'dog sweater', 'dog coat',
        'dog bowl', 'dog feeder', 'dog toy', 'dog brush',
    ],
    'Jewelry': [
        'necklace', 'bracelet', 'ring', 'earring', 'pendant',
        'chain', 'anklet', 'brooch', 'pin', 'charm',
        'jewelry', 'jewellery', 'gemstone', 'crystal',
        'diamond', 'gold plated', 'silver plated', 'sterling',
        'stainless steel', 'titanium', 'cubic zirconia',
        'pearl', 'bead', 'choker', 'locket', 'cuff',
        'bangles', 'hoop earring', 'stud earring',
    ],
    'Electronics': [
        'bluetooth', 'wireless', 'usb', 'charger', 'cable',
        'headphone', 'earphone', 'earbud', 'speaker',
        'phone case', 'screen protector', 'phone holder',
        'tablet', 'laptop', 'computer', 'keyboard', 'mouse',
        'monitor', 'webcam', 'microphone', 'camera',
        'led light', 'led strip', 'smart light', 'smart plug',
        'power bank', 'battery', 'adapter', 'converter',
        'hdmi', 'ethernet', 'wifi', 'router',
        'drone', 'rc car', 'remote control',
        'game', 'gaming', 'controller', 'joystick',
        'vr', 'virtual reality', 'smart watch', 'fitness tracker',
    ],
    'Home Decor': [
        'wall art', 'wall decor', 'canvas', 'painting', 'poster',
        'picture frame', 'photo frame', 'mirror',
        'curtain', 'drape', 'blinds', 'valance',
        'throw pillow', 'cushion', 'pillow cover', 'pillow case',
        'blanket', 'throw', 'quilt', 'bedspread', 'comforter',
        'rug', 'carpet', 'mat', 'doormat', 'floor',
        'candle', 'candle holder', 'incense', 'diffuser',
        'vase', 'figurine', 'statue', 'sculpture',
        'clock', 'wall clock', 'alarm clock',
        'shelf', 'bookshelf', 'storage', 'organizer',
        'lamp', 'table lamp', 'floor lamp', 'night light',
        'chandelier', 'pendant light', 'fairy light', 'string light',
        'tapestry', 'macrame', 'wind chime', 'dreamcatcher',
        'decoration', 'ornament', 'seasonal', 'holiday',
        'christmas', 'halloween', 'easter', 'valentine',
    ],
    'Toys': [
        'toy', 'puzzle', 'lego', 'building block', 'playset',
        'doll', 'action figure', 'stuffed animal', 'plush',
        'board game', 'card game', 'dice', 'fidget',
        'slime', 'play dough', 'craft kit', 'coloring',
        'sticker', 'balloon', 'party supplies',
        'kids', 'children', 'baby toy', 'toddler',
        'educational toy', 'learning', 'stem',
    ],
    'Tools': [
        'tool', 'drill', 'screwdriver', 'wrench', 'plier',
        'hammer', 'saw', 'level', 'tape measure',
        'socket', 'ratchet', 'hex key', 'allen key',
        'clamp', 'vise', 'sandpaper', 'putty',
        'paint brush', 'roller', 'caulk', 'adhesive',
        'glue gun', 'heat gun', 'soldering iron',
        'multimeter', 'voltage', 'wire stripper',
        'toolbox', 'tool bag', 'tool set',
    ],
    'Bathroom': [
        'bathroom', 'shower', 'bath', 'towel', 'washcloth',
        'soap dispenser', 'toothbrush', 'toothpaste',
        'toilet', 'bidet', 'plunger', 'brush holder',
        'shower curtain', 'bath mat', 'bath rug',
        'shampoo', 'conditioner', 'body wash', 'loofah',
        'razor', 'shaving', 'hair dryer', 'hair straightener',
        'hair curler', 'hair clip', 'hair tie', 'comb',
    ],
    'Car Accessories': [
        'car', 'vehicle', 'auto', 'automotive',
        'car seat', 'car cover', 'steering wheel',
        'car charger', 'car mount', 'phone mount',
        'dash cam', 'dashcam', 'gps', 'car organizer',
        'trunk', 'windshield', 'wiper', 'car wash',
        'air freshener', 'car perfume', 'car decal',
        'license plate', 'car mat', 'car floor',
    ],
    'Arts & Crafts': [
        'craft', 'diy', 'handmade', 'crochet', 'knitting',
        'yarn', 'needle', 'thread', 'sewing', 'fabric',
        'embroidery', 'cross stitch', 'quilt',
        'paint', 'acrylic', 'watercolor', 'oil paint',
        'canvas', 'easel', 'palette', 'paintbrush',
        'sketch', 'drawing', 'pencil', 'charcoal', 'pastel',
        'clay', 'pottery', 'ceramic', 'resin', 'epoxy',
        'scrapbook', 'stamp', 'washi tape', 'stencil',
        'bead', 'jewelry making', 'wire wrapping',
        'diamond painting', 'paint by number',
    ],
}


def categorize_item_title(title, categories):
    """
    Match an item title to a category using keyword rules.

    Args:
        title: The item title string
        categories: List of category dicts from the database [{'id': 1, 'name': 'Clothes', ...}]

    Returns:
        category_id if matched, None if no match (stays in current category)
    """
    if not title:
        return None

    title_lower = title.lower()

    # Build a lookup from category name (lowercased) -> category id
    cat_lookup = {}
    for cat in categories:
        cat_lookup[cat['name'].lower()] = cat['id']

    # Check each rule
    for cat_name, keywords in CATEGORY_RULES.items():
        cat_name_lower = cat_name.lower()
        if cat_name_lower not in cat_lookup:
            continue  # Skip rules for categories that don't exist yet

        for keyword in keywords:
            if keyword in title_lower:
                return cat_lookup[cat_name_lower]

    return None


@items_bp.route('/auto-categorize', methods=['POST'])
def auto_categorize():
    """
    Auto-categorize items based on title keywords.
    Optionally creates missing categories if enough items would go there.
    """
    data = request.get_json() or {}
    dry_run = data.get('dry_run', False)
    create_categories = data.get('create_categories', True)
    only_unsorted = data.get('only_unsorted', False)

    categories = Category.get_all()
    all_items = Item.get_all()

    # Build lookup of category names
    cat_names = {cat['name'].lower() for cat in categories}

    # Get the "Unsorted" category ID
    unsorted_id = None
    for cat in categories:
        if cat['name'] == 'Unsorted' or cat.get('is_default'):
            unsorted_id = cat['id']
            break

    # First pass: count items per proposed category (for categories that don't exist yet)
    proposed_counts = {}
    for item in all_items:
        title_lower = (item.get('title') or '').lower()
        for cat_name, keywords in CATEGORY_RULES.items():
            if cat_name.lower() in cat_names:
                continue  # Already exists
            for keyword in keywords:
                if keyword in title_lower:
                    proposed_counts[cat_name] = proposed_counts.get(cat_name, 0) + 1
                    break

    # Create categories that have 3+ items
    created_categories = []
    if create_categories and not dry_run:
        for cat_name, count in proposed_counts.items():
            if count >= 3:
                new_cat = Category.create(cat_name)
                created_categories.append({'name': cat_name, 'id': new_cat['id'], 'item_count': count})
        # Reload categories after creating new ones
        if created_categories:
            categories = Category.get_all()

    # Second pass: categorize items
    moves = []
    for item in all_items:
        # Skip items not in Unsorted if only_unsorted is set
        if only_unsorted and unsorted_id and item.get('category_id') != unsorted_id:
            continue

        new_cat_id = categorize_item_title(item.get('title', ''), categories)

        if new_cat_id and new_cat_id != item.get('category_id'):
            # Find category name for reporting
            cat_name = next((c['name'] for c in categories if c['id'] == new_cat_id), 'Unknown')
            moves.append({
                'item_id': item['id'],
                'title': item.get('title', ''),
                'from_category_id': item.get('category_id'),
                'to_category_id': new_cat_id,
                'to_category_name': cat_name,
            })

    # Apply moves if not dry run
    if not dry_run:
        for move in moves:
            Item.update(move['item_id'], category_id=move['to_category_id'])

    return jsonify({
        'success': True,
        'dry_run': dry_run,
        'moved': len(moves),
        'created_categories': created_categories,
        'proposed_categories': [
            {'name': name, 'count': count}
            for name, count in proposed_counts.items()
            if count >= 3
        ] if dry_run else [],
        'moves': moves[:100],  # Limit response size
        'total_items': len(all_items),
    })
