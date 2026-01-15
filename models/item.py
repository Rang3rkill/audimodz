import re
from datetime import datetime
from database import get_db_connection


def extract_piece_count(title):
    """Extract piece count from product title."""
    if not title:
        return None

    patterns = [
        r'(\d+)\s*pc\b',
        r'(\d+)\s*pcs\b',
        r'(\d+)\s*piece',
        r'(\d+)\s*pack\b',
        r'set\s*of\s*(\d+)',
        r'pack\s*of\s*(\d+)',
        r'(\d+)\s*count\b',
    ]

    title_lower = title.lower()
    for pattern in patterns:
        match = re.search(pattern, title_lower)
        if match:
            count = int(match.group(1))
            if count > 1:
                return count
    return None


class Item:
    """Item model for wishlist products."""

    @staticmethod
    def get_all(category_id=None, list_id=None, in_ready_to_buy=None):
        """Get items with optional filters."""
        conn = get_db_connection()
        cursor = conn.cursor()

        query = '''
            SELECT i.*, c.name as category_name, l.name as list_name
            FROM items i
            LEFT JOIN categories c ON i.category_id = c.id
            LEFT JOIN lists l ON i.list_id = l.id
            WHERE 1=1
        '''
        params = []

        if category_id is not None:
            query += ' AND i.category_id = ?'
            params.append(category_id)

        if list_id is not None:
            query += ' AND i.list_id = ?'
            params.append(list_id)

        if in_ready_to_buy is not None:
            query += ' AND i.in_ready_to_buy = ?'
            params.append(1 if in_ready_to_buy else 0)

        query += ' ORDER BY i.position, i.date_added DESC'

        cursor.execute(query, params)
        items = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return items

    @staticmethod
    def get_by_id(item_id):
        """Get an item by ID."""
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute('''
            SELECT i.*, c.name as category_name, l.name as list_name
            FROM items i
            LEFT JOIN categories c ON i.category_id = c.id
            LEFT JOIN lists l ON i.list_id = l.id
            WHERE i.id = ?
        ''', (item_id,))
        row = cursor.fetchone()
        conn.close()
        return dict(row) if row else None

    @staticmethod
    def get_by_product(store, product_id):
        """Get an item by store and product ID."""
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute('''
            SELECT * FROM items WHERE store = ? AND product_id = ?
        ''', (store, product_id))
        row = cursor.fetchone()
        conn.close()
        return dict(row) if row else None

    @staticmethod
    def create(store, product_id, product_url, title, image_url=None,
               current_price=None, quantity=1, category_id=1, list_id=1):
        """Create a new item."""
        conn = get_db_connection()
        cursor = conn.cursor()

        # Calculate piece count from title
        piece_count = extract_piece_count(title)

        # Get next position
        cursor.execute('''
            SELECT MAX(position) FROM items WHERE category_id = ?
        ''', (category_id,))
        max_pos = cursor.fetchone()[0]
        position = (max_pos or 0) + 1

        cursor.execute('''
            INSERT INTO items (
                store, product_id, product_url, title, image_url,
                current_price, original_price, quantity, piece_count,
                category_id, list_id, position
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            store, product_id, product_url, title, image_url,
            current_price, current_price, quantity, piece_count,
            category_id, list_id, position
        ))

        item_id = cursor.lastrowid
        conn.commit()
        conn.close()
        return Item.get_by_id(item_id)

    @staticmethod
    def update(item_id, **kwargs):
        """Update an item with given fields."""
        conn = get_db_connection()
        cursor = conn.cursor()

        allowed_fields = {
            'title', 'image_url', 'current_price', 'quantity',
            'category_id', 'list_id', 'position', 'in_ready_to_buy',
            'is_unavailable', 'last_price', 'price_updated_at'
        }

        updates = []
        values = []

        for field, value in kwargs.items():
            if field in allowed_fields:
                updates.append(f'{field} = ?')
                values.append(value)

        if updates:
            updates.append('date_modified = ?')
            values.append(datetime.now().isoformat())

            # Update piece_count if title changed
            if 'title' in kwargs:
                piece_count = extract_piece_count(kwargs['title'])
                updates.append('piece_count = ?')
                values.append(piece_count)

            values.append(item_id)
            cursor.execute(f'''
                UPDATE items
                SET {', '.join(updates)}
                WHERE id = ?
            ''', values)
            conn.commit()

        conn.close()
        return Item.get_by_id(item_id)

    @staticmethod
    def delete(item_id):
        """Delete an item."""
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute('DELETE FROM items WHERE id = ?', (item_id,))
        deleted = cursor.rowcount > 0
        conn.commit()
        conn.close()
        return deleted

    @staticmethod
    def reorder(item_positions):
        """Bulk update item positions."""
        conn = get_db_connection()
        cursor = conn.cursor()

        for item_id, position in item_positions.items():
            cursor.execute('''
                UPDATE items SET position = ?, date_modified = ?
                WHERE id = ?
            ''', (position, datetime.now().isoformat(), item_id))

        conn.commit()
        conn.close()
        return True

    @staticmethod
    def get_ready_to_buy_grouped():
        """Get items ready to buy, grouped by store."""
        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute('''
            SELECT i.*, c.name as category_name, l.name as list_name
            FROM items i
            LEFT JOIN categories c ON i.category_id = c.id
            LEFT JOIN lists l ON i.list_id = l.id
            WHERE i.in_ready_to_buy = 1
            ORDER BY i.store, i.position
        ''')

        items = [dict(row) for row in cursor.fetchall()]
        conn.close()

        # Group by store
        grouped = {}
        for item in items:
            store = item['store']
            if store not in grouped:
                grouped[store] = {'items': [], 'subtotal': 0}
            grouped[store]['items'].append(item)
            price = item['current_price'] or 0
            qty = item['quantity'] or 1
            grouped[store]['subtotal'] += price * qty

        return grouped

    @staticmethod
    def get_count_by_ready_status():
        """Get count of items ready to buy."""
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute('''
            SELECT COUNT(*) FROM items WHERE in_ready_to_buy = 1
        ''')
        count = cursor.fetchone()[0]
        conn.close()
        return count
