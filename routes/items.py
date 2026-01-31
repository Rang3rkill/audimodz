from flask import Blueprint, jsonify, request
from models.item import Item
import requests
import re
import time
from datetime import datetime
from functools import wraps

items_bp = Blueprint('items', __name__, url_prefix='/api/items')

# Patterns that indicate a placeholder/generic image rather than an actual product photo
BAD_IMAGE_PATTERNS = [
    '/sale', '/banner', '/promo', '/countdown', '/clock', '/timer',
    'sale_banner', 'flash_sale', 'promotion', 'coupon',
    '/bg/', '/background/', 'placeholder',
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


# Rate limiting for scraping
SCRAPE_DELAY = 1.0  # seconds between scrape requests
last_scrape_time = 0


def rate_limit_scrape():
    """Ensure we don't hit Temu too fast."""
    global last_scrape_time
    elapsed = time.time() - last_scrape_time
    if elapsed < SCRAPE_DELAY:
        time.sleep(SCRAPE_DELAY - elapsed)
    last_scrape_time = time.time()


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
        # Build CSV string
        headers = ['id', 'store', 'product_id', 'title', 'current_price', 'image_url', 'product_url', 'quantity', 'is_favorite', 'in_ready_to_buy']
        lines = [','.join(headers)]
        for item in items:
            row = [
                str(item.get('id', '')),
                item.get('store', ''),
                item.get('product_id', ''),
                f'"{item.get("title", "").replace('"', '""')}"',
                str(item.get('current_price', '')),
                item.get('image_url', '') or '',
                item.get('product_url', ''),
                str(item.get('quantity', 1)),
                str(item.get('is_favorite', 0)),
                str(item.get('in_ready_to_buy', 0)),
            ]
            lines.append(','.join(row))

        from flask import Response
        return Response(
            '\n'.join(lines),
            mimetype='text/csv',
            headers={'Content-Disposition': 'attachment; filename=wishlist_export.csv'}
        )

    return jsonify({
        'exported_at': datetime.now().isoformat(),
        'count': len(items),
        'items': items
    })


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
                    Item.update(
                        existing['id'],
                        last_price=old_price,
                        current_price=new_price,
                        price_updated_at=datetime.now().isoformat()
                    )
                    results.append({
                        'id': existing['id'],
                        'product_id': product_id,
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
                    # No price change - but update image if missing, set original_price if unset
                    reimport_updates = {}
                    if not existing.get('image_url') and item_data.get('image_url'):
                        reimport_updates['image_url'] = item_data.get('image_url')
                    if existing.get('original_price') is None and new_price is not None:
                        reimport_updates['original_price'] = new_price
                    if reimport_updates:
                        Item.update(existing['id'], **reimport_updates)

                    results.append({
                        'id': existing['id'],
                        'product_id': product_id,
                        'status': 'skipped'
                    })
                    skipped += 1
                continue

            # Create new item
            item = Item.create(
                store=store,
                product_id=product_id,
                product_url=item_data.get('product_url', ''),
                title=item_data.get('title', 'Unknown Product'),
                image_url=item_data.get('image_url'),
                current_price=new_price,
                quantity=item_data.get('quantity', 1),
                list_id=list_id
            )

            results.append({
                'id': item['id'],
                'product_id': product_id,
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

    # Extract goods_id from app-style URLs like /product-name_p_12345.html
    if 'goods_id=' not in url:
        id_match = re.search(r'_p_(\d+)\.html', url)
        if not id_match:
            id_match = re.search(r'/product/(\d+)', url)
        if not id_match:
            id_match = re.search(r'subject_id=(\d+)', url)
        if id_match:
            # Normalize to standard goods_id URL for reliable scraping
            goods_id = id_match.group(1)
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

    response = requests.get(url, headers=headers, timeout=20)
    response.raise_for_status()
    html = response.text

    data = {}

    # Extract title - multiple patterns for reliability
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
            # Clean up escaped characters
            try:
                if '\\u' in title:
                    title = title.encode().decode('unicode_escape')
            except:
                pass
            title = title.strip()
            # Filter out generic titles
            if len(title) > 5 and len(title) < 500 and 'Temu' not in title:
                data['title'] = title
                break

    # Extract image URL - multiple patterns
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
            # Clean up escaped characters
            img_url = img_url.replace('\\/', '/').replace('\\u002F', '/')
            # Validate it's a real product image (not a placeholder/banner)
            if is_valid_product_image(img_url):
                data['image_url'] = img_url
                break

    # Extract price - multiple patterns with validation
    price_patterns = [
        r'"priceInfo"[^}]*"price"\s*:\s*(\d+)',  # Price in cents
        r'"salePrice"\s*:\s*(\d+\.?\d*)',
        r'"price"\s*:\s*(\d+\.?\d*)',
        r'"sale_price"\s*:\s*(\d+\.?\d*)',
        r'"current_price"\s*:\s*(\d+\.?\d*)',
        r'"displayPrice"\s*:\s*"?\$?(\d+\.?\d*)"?',
        r'<meta property="product:price:amount" content="(\d+\.?\d*)"',
        r'\$(\d+\.?\d{2})',  # Standard price format
    ]
    for pattern in price_patterns:
        matches = re.findall(pattern, html)
        for match in matches:
            try:
                price = float(match)
                # Temu often stores prices in cents
                if price > 100 and '.' not in str(match):
                    price = price / 100
                # Validate reasonable price
                if 0.01 <= price <= 9999:
                    data['price'] = round(price, 2)
                    break
            except ValueError:
                continue
        if 'price' in data:
            break

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
        return jsonify({'error': 'Could not fetch product data. The page may be unavailable or the product removed.'}), 500

    # Update item with scraped data - update ALL fields, not just missing ones
    updates = {}
    updated_fields = []

    # Update image if scraped and either missing or different
    if scraped.get('image_url'):
        if not item.get('image_url'):
            updates['image_url'] = scraped['image_url']
            updated_fields.append('image')
        elif scraped['image_url'] != item.get('image_url'):
            updates['image_url'] = scraped['image_url']
            updated_fields.append('image')

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

    # Track last refresh time
    updates['last_checked'] = datetime.now().isoformat()

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

        if scraped.get('image_url'):
            if not item.get('image_url') or scraped['image_url'] != item.get('image_url'):
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
    skipped_has_thumb = 0

    for item in target_items:
        product_url = item.get('product_url', '')
        store = item.get('store', '')

        # First: check for embedded thumb_url from extension (most reliable source)
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
                        skipped_has_thumb += 1
                        continue
            except Exception:
                pass

        # Fallback: server-side scrape
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
        if new_image != item.get('image_url') and is_valid_product_image(new_image):
            Item.update(item['id'], image_url=new_image, last_checked=datetime.now().isoformat())
            refreshed += 1
        else:
            Item.update(item['id'], last_checked=datetime.now().isoformat())

    total_bad = len([i for i in items if i.get('product_url') and not has_valid_image(i)])

    return jsonify({
        'success': True,
        'refreshed': refreshed,
        'failed': failed,
        'processed': len(target_items),
        'total': len(all_with_url),
        'bad_images_remaining': total_bad
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

    # Build a lookup: goods_id -> item
    goods_id_map = {}
    for item in items:
        product_url = item.get('product_url', '')
        match = re.search(r'goods_id=(\d+)', product_url)
        if match:
            goods_id_map[match.group(1)] = item

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
        items = [Item.get_by_id(id) for id in item_ids if Item.get_by_id(id)]
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
        except:
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

    # Extract product ID from URL - try multiple patterns (browser + app URLs)
    product_id = None
    id_patterns = [
        r'goods_id=(\d+)',
        r'_p_(\d+)\.html',
        r'/product/(\d+)',
        r'subject_id=(\d+)',
    ]
    for pattern in id_patterns:
        id_match = re.search(pattern, url)
        if id_match:
            product_id = id_match.group(1)
            break

    # Also try share.temu.com short links - follow redirect
    if 'share.temu.com' in url or not product_id:
        try:
            resp = requests.head(url, allow_redirects=True, timeout=10,
                                 headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'})
            url = resp.url
            for pattern in id_patterns:
                id_match = re.search(pattern, url)
                if id_match:
                    product_id = id_match.group(1)
                    break
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
