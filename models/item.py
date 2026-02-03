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
        try:
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
            return [dict(row) for row in cursor.fetchall()]
        finally:
            conn.close()

    @staticmethod
    def get_by_id(item_id):
        """Get an item by ID."""
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT i.*, c.name as category_name, l.name as list_name
                FROM items i
                LEFT JOIN categories c ON i.category_id = c.id
                LEFT JOIN lists l ON i.list_id = l.id
                WHERE i.id = ?
            ''', (item_id,))
            row = cursor.fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    @staticmethod
    def get_by_product(store, product_id):
        """Get an item by store and product ID."""
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT * FROM items WHERE store = ? AND product_id = ?
            ''', (store, str(product_id)))
            row = cursor.fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    @staticmethod
    def create(store, product_id, product_url, title, image_url=None,
               current_price=None, quantity=1, category_id=1, list_id=1):
        """Create a new item."""
        conn = get_db_connection()
        try:
            cursor = conn.cursor()

            # Calculate piece count from title
            piece_count = extract_piece_count(title)

            # Get next position
            cursor.execute('''
                SELECT MAX(position) FROM items WHERE category_id = ?
            ''', (category_id,))
            max_pos = cursor.fetchone()[0]
            position = (max_pos or 0) + 1

            now = datetime.now().isoformat()
            cursor.execute('''
                INSERT INTO items (
                    store, product_id, product_url, title, image_url,
                    current_price, original_price, quantity, piece_count,
                    category_id, list_id, position, price_updated_at, last_checked
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                store, str(product_id), product_url, title, image_url,
                current_price, current_price, quantity, piece_count,
                category_id, list_id, position,
                now if current_price is not None else None,
                now
            ))

            item_id = cursor.lastrowid
            conn.commit()
        finally:
            conn.close()
        return Item.get_by_id(item_id)

    @staticmethod
    def update(item_id, **kwargs):
        """Update an item with given fields."""
        conn = get_db_connection()
        try:
            cursor = conn.cursor()

            allowed_fields = {
                'title', 'image_url', 'current_price', 'original_price',
                'quantity', 'category_id', 'list_id', 'position',
                'in_ready_to_buy', 'is_unavailable', 'last_price',
                'price_updated_at', 'last_checked', 'notes', 'is_favorite',
                'product_url', 'scrape_fail_count',
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
        finally:
            conn.close()
        return Item.get_by_id(item_id)

    @staticmethod
    def delete(item_id):
        """Delete an item."""
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute('DELETE FROM items WHERE id = ?', (item_id,))
            deleted = cursor.rowcount > 0
            conn.commit()
            return deleted
        finally:
            conn.close()

    @staticmethod
    def reorder(item_positions):
        """Bulk update item positions (atomic transaction)."""
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute('BEGIN')

            for item_id, position in item_positions.items():
                cursor.execute('''
                    UPDATE items SET position = ?, date_modified = ?
                    WHERE id = ?
                ''', (position, datetime.now().isoformat(), item_id))

            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()
        return True

    @staticmethod
    def get_ready_to_buy_grouped():
        """Get items ready to buy, grouped by store."""
        conn = get_db_connection()
        try:
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
        finally:
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
        try:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT COUNT(*) FROM items WHERE in_ready_to_buy = 1
            ''')
            return cursor.fetchone()[0]
        finally:
            conn.close()

    @staticmethod
    def get_stats():
        """Get statistics about items for dashboard."""
        conn = get_db_connection()
        try:
            cursor = conn.cursor()

            stats = {}

            # Total items
            cursor.execute('SELECT COUNT(*) FROM items')
            stats['total_items'] = cursor.fetchone()[0]

            # Total value
            cursor.execute('''
                SELECT COALESCE(SUM(current_price * quantity), 0) FROM items
            ''')
            stats['total_value'] = cursor.fetchone()[0]

            # By store
            cursor.execute('''
                SELECT store, COUNT(*) as count,
                       COALESCE(SUM(current_price * quantity), 0) as value
                FROM items GROUP BY store
            ''')
            stats['by_store'] = {
                row['store']: {'count': row['count'], 'value': row['value']}
                for row in cursor.fetchall()
            }

            # Favorites count
            cursor.execute('SELECT COUNT(*) FROM items WHERE is_favorite = 1')
            stats['favorites'] = cursor.fetchone()[0]

            # Ready to buy
            cursor.execute('SELECT COUNT(*) FROM items WHERE in_ready_to_buy = 1')
            stats['ready_to_buy'] = cursor.fetchone()[0]

            # Ready to buy value
            cursor.execute('''
                SELECT COALESCE(SUM(current_price * quantity), 0)
                FROM items WHERE in_ready_to_buy = 1
            ''')
            stats['ready_to_buy_value'] = cursor.fetchone()[0]

            # Recently added (last 7 days)
            cursor.execute('''
                SELECT COUNT(*) FROM items
                WHERE date_added >= datetime('now', '-7 days')
            ''')
            stats['recently_added'] = cursor.fetchone()[0]

            # Oldest item age
            cursor.execute('''
                SELECT date_added FROM items
                ORDER BY date_added ASC LIMIT 1
            ''')
            oldest = cursor.fetchone()
            if oldest and oldest[0]:
                try:
                    date_str = oldest[0].replace('Z', '').replace('+00:00', '')
                    oldest_date = datetime.fromisoformat(date_str)
                    now = datetime.now()
                    diff_days = (now - oldest_date).days
                    if diff_days == 0:
                        stats['oldest_item_age'] = 'Today'
                    elif diff_days == 1:
                        stats['oldest_item_age'] = '1 day'
                    elif diff_days < 7:
                        stats['oldest_item_age'] = f'{diff_days} days'
                    elif diff_days < 30:
                        stats['oldest_item_age'] = f'{diff_days // 7} weeks'
                    elif diff_days < 365:
                        stats['oldest_item_age'] = f'{diff_days // 30} months'
                    else:
                        stats['oldest_item_age'] = f'{diff_days // 365} years'
                except (ValueError, TypeError):
                    stats['oldest_item_age'] = '-'
            else:
                stats['oldest_item_age'] = '-'

            # Unavailable count
            cursor.execute('SELECT COUNT(*) FROM items WHERE is_unavailable = 1')
            stats['unavailable'] = cursor.fetchone()[0]

            # Price drops count
            cursor.execute('''
                SELECT COUNT(*) FROM items
                WHERE original_price IS NOT NULL
                AND current_price IS NOT NULL
                AND current_price < original_price
            ''')
            stats['price_drops'] = cursor.fetchone()[0]

            # Missing images count (avoids loading all items into memory)
            cursor.execute('''
                SELECT COUNT(*) FROM items
                WHERE image_url IS NULL OR image_url = ''
            ''')
            stats['missing_images'] = cursor.fetchone()[0]

            # Missing price count
            cursor.execute('''
                SELECT COUNT(*) FROM items
                WHERE current_price IS NULL
            ''')
            stats['missing_price'] = cursor.fetchone()[0]

            return stats
        finally:
            conn.close()

    @staticmethod
    def normalize_title(title):
        """Normalize a title for comparison."""
        if not title:
            return ''
        # Lowercase and remove special characters
        normalized = title.lower()
        normalized = re.sub(r'[^\w\s]', ' ', normalized)
        # Remove extra whitespace
        normalized = ' '.join(normalized.split())
        return normalized

    @staticmethod
    def get_title_tokens(title):
        """Get meaningful tokens from a title."""
        if not title:
            return set()
        normalized = Item.normalize_title(title)
        # Remove common filler words
        stop_words = {'the', 'a', 'an', 'and', 'or', 'for', 'with', 'of', 'to', 'in', 'on', 'set', 'pcs', 'pc', 'pack', 'pieces', 'piece'}
        tokens = set(normalized.split())
        return tokens - stop_words

    @staticmethod
    def calculate_similarity(title1, title2):
        """Calculate similarity score between two titles (0-1)."""
        tokens1 = Item.get_title_tokens(title1)
        tokens2 = Item.get_title_tokens(title2)

        if not tokens1 or not tokens2:
            return 0

        # Jaccard similarity
        intersection = tokens1 & tokens2
        union = tokens1 | tokens2

        if not union:
            return 0

        return len(intersection) / len(union)

    @staticmethod
    def find_potential_duplicates(threshold=0.5):
        """Find potential duplicate items based on title similarity."""
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT id, title, store, image_url, current_price, date_added
                FROM items ORDER BY date_added DESC
            ''')
            items = [dict(row) for row in cursor.fetchall()]
        finally:
            conn.close()

        if len(items) < 2:
            return []

        duplicates = []

        for i in range(len(items)):
            for j in range(i + 1, len(items)):
                item1 = items[i]
                item2 = items[j]

                similarity = Item.calculate_similarity(item1['title'], item2['title'])

                if similarity >= threshold:
                    duplicates.append({
                        'item1': item1,
                        'item2': item2,
                        'similarity': round(similarity * 100),
                        'same_store': item1['store'] == item2['store']
                    })

        # Sort by similarity descending
        duplicates.sort(key=lambda x: x['similarity'], reverse=True)

        return duplicates
