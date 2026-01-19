from flask import Blueprint, jsonify, request
from models.item import Item
import requests
import re

items_bp = Blueprint('items', __name__, url_prefix='/api/items')


@items_bp.route('', methods=['GET'])
def get_items():
    """Get items with optional filters."""
    category_id = request.args.get('category_id', type=int)
    list_id = request.args.get('list_id', type=int)
    in_ready_to_buy = request.args.get('in_ready_to_buy')

    if in_ready_to_buy is not None:
        in_ready_to_buy = in_ready_to_buy.lower() == 'true'

    items = Item.get_all(
        category_id=category_id,
        list_id=list_id,
        in_ready_to_buy=in_ready_to_buy
    )
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
    return jsonify(stats)


@items_bp.route('/duplicates', methods=['GET'])
def get_duplicates():
    """Get potential duplicate items based on title similarity."""
    threshold = request.args.get('threshold', 0.5, type=float)
    duplicates = Item.find_potential_duplicates(threshold)
    return jsonify(duplicates)


@items_bp.route('/import', methods=['POST'])
def import_items():
    """Bulk import items from extension."""
    from datetime import datetime

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

    for item_data in items_data:
        product_id = item_data.get('product_id')
        new_price = item_data.get('price')

        # Check for existing item
        existing = Item.get_by_product(store, product_id)
        if existing:
            # Check if price changed
            old_price = existing.get('current_price')

            if new_price is not None and old_price != new_price:
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
                # No price change - skip
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
            title=item_data.get('title', ''),
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

    return jsonify({
        'success': True,
        'imported': imported,
        'skipped': skipped,
        'updated': updated,
        'price_drops': price_drops,
        'price_increases': price_increases,
        'items': results
    })


def scrape_temu_product(url):
    """Scrape product data from a Temu product page."""
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
    }

    try:
        response = requests.get(url, headers=headers, timeout=15)
        response.raise_for_status()
        html = response.text

        data = {}

        # Try to extract from JSON in script tags first
        # Look for window.__INITIAL_STATE__ or similar
        json_patterns = [
            r'window\.__INITIAL_STATE__\s*=\s*({.+?});?\s*</script>',
            r'"goods_name"\s*:\s*"([^"]+)"',
        ]

        # Extract title
        title_patterns = [
            r'"goods_name"\s*:\s*"([^"]+)"',
            r'"title"\s*:\s*"([^"]+)"',
            r'<title>([^<]+)</title>',
            r'"name"\s*:\s*"([^"]+)"',
        ]
        for pattern in title_patterns:
            match = re.search(pattern, html)
            if match:
                title = match.group(1)
                # Clean up escaped characters
                title = title.encode().decode('unicode_escape') if '\\u' in title else title
                if len(title) > 5 and len(title) < 500:
                    data['title'] = title
                    break

        # Extract image URL
        image_patterns = [
            r'"thumb_url"\s*:\s*"(https?://[^"]+)"',
            r'"image"\s*:\s*"(https?://[^"]+)"',
            r'"img"\s*:\s*"(https?://[^"]+)"',
            r'"goods_img"\s*:\s*"(https?://[^"]+)"',
            r'<meta property="og:image" content="([^"]+)"',
            r'"image_url"\s*:\s*"(https?://[^"]+)"',
            # Look for product images in img tags
            r'<img[^>]+src="(https://[^"]*kwcdn[^"]*)"[^>]*>',
        ]
        for pattern in image_patterns:
            match = re.search(pattern, html)
            if match:
                img_url = match.group(1)
                # Clean up escaped characters
                img_url = img_url.replace('\\/', '/').replace('\\u002F', '/')
                if 'kwcdn' in img_url or 'akamaized' in img_url or 'temu' in img_url:
                    data['image_url'] = img_url
                    break

        # Extract price
        price_patterns = [
            r'"price"\s*:\s*(\d+\.?\d*)',
            r'"sale_price"\s*:\s*(\d+\.?\d*)',
            r'"current_price"\s*:\s*(\d+\.?\d*)',
            r'"salePrice"\s*:\s*(\d+\.?\d*)',
            r'\$(\d+\.?\d*)',
        ]
        for pattern in price_patterns:
            match = re.search(pattern, html)
            if match:
                try:
                    price = float(match.group(1))
                    # Temu sometimes stores prices in cents
                    if price > 1000:
                        price = price / 100
                    if 0 < price < 10000:
                        data['price'] = price
                        break
                except ValueError:
                    continue

        return data

    except Exception as e:
        print(f"Error scraping {url}: {e}")
        return None


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
        scraped = scrape_temu_product(product_url)
    else:
        return jsonify({'error': f'Refresh not supported for store: {store}'}), 400

    if not scraped:
        return jsonify({'error': 'Could not fetch product data'}), 500

    # Update item with scraped data
    updates = {}
    updated_fields = []

    if scraped.get('image_url') and not item.get('image_url'):
        updates['image_url'] = scraped['image_url']
        updated_fields.append('image')

    if scraped.get('price') and not item.get('current_price'):
        updates['current_price'] = scraped['price']
        updated_fields.append('price')

    if scraped.get('title') and (not item.get('title') or item.get('title') == 'Unknown Product'):
        updates['title'] = scraped['title']
        updated_fields.append('title')

    if updates:
        updated_item = Item.update(item_id, **updates)
        return jsonify({
            'success': True,
            'updated_fields': updated_fields,
            'item': updated_item
        })
    else:
        return jsonify({
            'success': True,
            'updated_fields': [],
            'message': 'No missing data to update'
        })


@items_bp.route('/refresh-missing', methods=['POST'])
def refresh_missing_data():
    """Refresh all items that are missing image or price data."""
    # Get all items missing data
    items = Item.get_all()
    missing_items = [
        i for i in items
        if not i.get('image_url') or not i.get('current_price')
    ]

    if not missing_items:
        return jsonify({
            'success': True,
            'message': 'No items with missing data',
            'refreshed': 0,
            'failed': 0
        })

    refreshed = 0
    failed = 0
    results = []

    for item in missing_items:
        product_url = item.get('product_url')
        if not product_url:
            failed += 1
            continue

        store = item.get('store', '')

        # Scrape based on store
        if 'temu' in store.lower() or 'temu.com' in product_url:
            scraped = scrape_temu_product(product_url)
        else:
            failed += 1
            continue

        if not scraped:
            failed += 1
            continue

        # Update item with scraped data
        updates = {}
        if scraped.get('image_url') and not item.get('image_url'):
            updates['image_url'] = scraped['image_url']
        if scraped.get('price') and not item.get('current_price'):
            updates['current_price'] = scraped['price']
        if scraped.get('title') and (not item.get('title') or item.get('title') == 'Unknown Product'):
            updates['title'] = scraped['title']

        if updates:
            Item.update(item['id'], **updates)
            refreshed += 1
            results.append({'id': item['id'], 'status': 'updated', 'fields': list(updates.keys())})
        else:
            results.append({'id': item['id'], 'status': 'no_updates'})

    return jsonify({
        'success': True,
        'refreshed': refreshed,
        'failed': failed,
        'total_missing': len(missing_items),
        'results': results
    })
