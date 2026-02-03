from database import get_db_connection


class Category:
    """Category model for organizing items by type."""

    @staticmethod
    def get_all():
        """Get all categories ordered by position."""
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT id, name, position, is_default
                FROM categories
                ORDER BY position
            ''')
            return [dict(row) for row in cursor.fetchall()]
        finally:
            conn.close()

    @staticmethod
    def get_by_id(category_id):
        """Get a category by ID."""
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT id, name, position, is_default
                FROM categories
                WHERE id = ?
            ''', (category_id,))
            row = cursor.fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    @staticmethod
    def create(name, position=None):
        """Create a new category."""
        conn = get_db_connection()
        try:
            cursor = conn.cursor()

            if position is None:
                cursor.execute('SELECT MAX(position) FROM categories')
                max_pos = cursor.fetchone()[0]
                position = (max_pos or 0) + 1

            cursor.execute('''
                INSERT INTO categories (name, position, is_default)
                VALUES (?, ?, 0)
            ''', (name, position))

            category_id = cursor.lastrowid
            conn.commit()
        finally:
            conn.close()
        return Category.get_by_id(category_id)

    @staticmethod
    def update(category_id, name=None, position=None):
        """Update a category."""
        conn = get_db_connection()
        try:
            cursor = conn.cursor()

            updates = []
            values = []

            if name is not None:
                updates.append('name = ?')
                values.append(name)
            if position is not None:
                updates.append('position = ?')
                values.append(position)

            if updates:
                values.append(category_id)
                cursor.execute(f'''
                    UPDATE categories
                    SET {', '.join(updates)}
                    WHERE id = ?
                ''', values)
                conn.commit()
        finally:
            conn.close()
        return Category.get_by_id(category_id)

    @staticmethod
    def delete(category_id):
        """Delete a category (moves items to Unsorted, atomic)."""
        conn = get_db_connection()
        try:
            cursor = conn.cursor()

            # Check if category is default
            cursor.execute(
                'SELECT is_default FROM categories WHERE id = ?',
                (category_id,)
            )
            row = cursor.fetchone()
            if row and row['is_default']:
                return False, "Cannot delete default category"

            if not row:
                return False, "Category not found"

            # Get Unsorted category ID
            cursor.execute(
                'SELECT id FROM categories WHERE name = ?',
                ('Unsorted',)
            )
            unsorted = cursor.fetchone()
            unsorted_id = unsorted['id'] if unsorted else 1

            # Move items to Unsorted and delete category atomically
            cursor.execute('BEGIN')
            cursor.execute('''
                UPDATE items SET category_id = ? WHERE category_id = ?
            ''', (unsorted_id, category_id))
            cursor.execute('DELETE FROM categories WHERE id = ?', (category_id,))
            conn.commit()
            return True, "Category deleted"
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    @staticmethod
    def reorder(category_positions):
        """Bulk update category positions (atomic transaction)."""
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute('BEGIN')

            for cat_id, position in category_positions.items():
                cursor.execute('''
                    UPDATE categories SET position = ? WHERE id = ?
                ''', (position, cat_id))

            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()
        return True
