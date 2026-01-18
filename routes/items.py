from flask import Blueprint, jsonify, request
from models.item import Item

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
