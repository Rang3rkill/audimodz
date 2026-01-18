from database import get_db_connection


class List:
    """List model for organizing items into separate 'carts'."""

    @staticmethod
    def get_all():
        """Get all lists ordered by position."""
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute('''
            SELECT id, name, position, is_default
            FROM lists
            ORDER BY position
        ''')
        lists = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return lists

    @staticmethod
    def get_by_id(list_id):
        """Get a list by ID."""
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute('''
            SELECT id, name, position, is_default
            FROM lists
            WHERE id = ?
        ''', (list_id,))
        row = cursor.fetchone()
        conn.close()
        return dict(row) if row else None

    @staticmethod
    def create(name, position=None):
        """Create a new list."""
        conn = get_db_connection()
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
        conn.close()
        return List.get_by_id(list_id)

    @staticmethod
    def update(list_id, name=None, position=None):
        """Update a list."""
        conn = get_db_connection()
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

        conn.close()
        return List.get_by_id(list_id)

    @staticmethod
    def delete(list_id):
        """Delete a list (moves items to Main List)."""
        conn = get_db_connection()
        cursor = conn.cursor()

        # Check if list is default
        cursor.execute(
            'SELECT is_default FROM lists WHERE id = ?',
            (list_id,)
        )
        row = cursor.fetchone()
        if row and row['is_default']:
            conn.close()
            return False, "Cannot delete default list"

        # Get Main List ID
        cursor.execute(
            'SELECT id FROM lists WHERE is_default = 1'
        )
        main_list = cursor.fetchone()
        main_list_id = main_list['id'] if main_list else 1

        # Move items to Main List
        cursor.execute('''
            UPDATE items SET list_id = ? WHERE list_id = ?
        ''', (main_list_id, list_id))

        # Delete the list
        cursor.execute('DELETE FROM lists WHERE id = ?', (list_id,))
        conn.commit()
        conn.close()
        return True, "List deleted"

    @staticmethod
    def reorder(list_positions):
        """Bulk update list positions."""
        conn = get_db_connection()
        cursor = conn.cursor()

        for list_id, position in list_positions.items():
            cursor.execute('''
                UPDATE lists SET position = ? WHERE id = ?
            ''', (position, list_id))

        conn.commit()
        conn.close()
        return True
