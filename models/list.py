from database import get_db_connection


class List:
    """List model for organizing items into separate 'carts'."""

    @staticmethod
    def get_all():
        """Get all lists ordered by position."""
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT id, name, position, is_default
                FROM lists
                ORDER BY position
            ''')
            return [dict(row) for row in cursor.fetchall()]
        finally:
            conn.close()

    @staticmethod
    def get_by_id(list_id):
        """Get a list by ID."""
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT id, name, position, is_default
                FROM lists
                WHERE id = ?
            ''', (list_id,))
            row = cursor.fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    @staticmethod
    def create(name, position=None):
        """Create a new list."""
        conn = get_db_connection()
        try:
            cursor = conn.cursor()

            if position is None:
                cursor.execute('SELECT MAX(position) FROM lists')
                max_pos = cursor.fetchone()[0]
                position = (max_pos or 0) + 1

            cursor.execute('''
                INSERT INTO lists (name, position, is_default)
                VALUES (?, ?, 0)
            ''', (name, position))

            list_id = cursor.lastrowid
            conn.commit()
        finally:
            conn.close()
        return List.get_by_id(list_id)

    @staticmethod
    def update(list_id, name=None, position=None):
        """Update a list."""
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
                values.append(list_id)
                cursor.execute(f'''
                    UPDATE lists
                    SET {', '.join(updates)}
                    WHERE id = ?
                ''', values)
                conn.commit()
        finally:
            conn.close()
        return List.get_by_id(list_id)

    @staticmethod
    def delete(list_id):
        """Delete a list (moves items to Main List, atomic)."""
        conn = get_db_connection()
        try:
            cursor = conn.cursor()

            # Check if list is default
            cursor.execute(
                'SELECT is_default FROM lists WHERE id = ?',
                (list_id,)
            )
            row = cursor.fetchone()
            if row and row['is_default']:
                return False, "Cannot delete default list"

            if not row:
                return False, "List not found"

            # Get Main List ID
            cursor.execute(
                'SELECT id FROM lists WHERE is_default = 1'
            )
            main_list = cursor.fetchone()
            main_list_id = main_list['id'] if main_list else 1

            # Move items and delete list atomically
            cursor.execute('BEGIN')
            cursor.execute('''
                UPDATE items SET list_id = ? WHERE list_id = ?
            ''', (main_list_id, list_id))
            cursor.execute('DELETE FROM lists WHERE id = ?', (list_id,))
            conn.commit()
            return True, "List deleted"
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    @staticmethod
    def reorder(list_positions):
        """Bulk update list positions (atomic transaction)."""
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute('BEGIN')

            for list_id, position in list_positions.items():
                cursor.execute('''
                    UPDATE lists SET position = ? WHERE id = ?
                ''', (position, list_id))

            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()
        return True
