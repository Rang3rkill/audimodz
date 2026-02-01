import sqlite3
import os
import config


def get_db_connection():
    """Get a database connection with row factory."""
    conn = sqlite3.connect(config.DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    """Initialize the database with schema and default data."""
    os.makedirs(config.DATA_DIR, exist_ok=True)

    conn = get_db_connection()
    cursor = conn.cursor()

    # Create categories table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            position INTEGER NOT NULL DEFAULT 0,
            is_default BOOLEAN NOT NULL DEFAULT 0
        )
    ''')

    # Create lists table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS lists (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            position INTEGER NOT NULL DEFAULT 0,
            is_default BOOLEAN NOT NULL DEFAULT 0
        )
    ''')

    # Create items table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            store TEXT NOT NULL,
            product_id TEXT NOT NULL,
            product_url TEXT NOT NULL,
            title TEXT NOT NULL,
            image_url TEXT,
            current_price REAL,
            original_price REAL,
            last_price REAL,
            currency TEXT DEFAULT '$',
            quantity INTEGER DEFAULT 1,
            piece_count INTEGER,
            category_id INTEGER NOT NULL DEFAULT 1,
            list_id INTEGER NOT NULL DEFAULT 1,
            position INTEGER NOT NULL DEFAULT 0,
            in_ready_to_buy BOOLEAN DEFAULT 0,
            is_unavailable BOOLEAN DEFAULT 0,
            date_added DATETIME DEFAULT CURRENT_TIMESTAMP,
            date_modified DATETIME DEFAULT CURRENT_TIMESTAMP,
            price_updated_at DATETIME,
            last_checked DATETIME,
            UNIQUE(store, product_id),
            FOREIGN KEY (category_id) REFERENCES categories(id),
            FOREIGN KEY (list_id) REFERENCES lists(id)
        )
    ''')

    # Create purchase history table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS purchase_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            item_id INTEGER,
            store TEXT NOT NULL,
            product_id TEXT NOT NULL,
            product_url TEXT NOT NULL,
            title TEXT NOT NULL,
            image_url TEXT,
            price_paid REAL,
            quantity INTEGER DEFAULT 1,
            purchased_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (item_id) REFERENCES items(id)
        )
    ''')

    # Add last_checked column if it doesn't exist (migration)
    try:
        cursor.execute('ALTER TABLE items ADD COLUMN last_checked DATETIME')
    except sqlite3.OperationalError:
        pass  # Column already exists

    # Add notes column if it doesn't exist (migration)
    try:
        cursor.execute('ALTER TABLE items ADD COLUMN notes TEXT')
    except sqlite3.OperationalError:
        pass  # Column already exists

    # Add is_favorite column if it doesn't exist (migration)
    try:
        cursor.execute('ALTER TABLE items ADD COLUMN is_favorite BOOLEAN DEFAULT 0')
    except sqlite3.OperationalError:
        pass  # Column already exists

    # Create indexes
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_items_category ON items(category_id)
    ''')
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_items_list ON items(list_id)
    ''')
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_items_store ON items(store)
    ''')
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_items_ready ON items(in_ready_to_buy)
    ''')

    # Insert default categories
    default_categories = [
        ('Unsorted', 0, 1),
        ('Flowers', 1, 0),
        ('Clothes', 2, 0),
        ('Decorations', 3, 0),
        ('Kitchen Items', 4, 0),
        ('Misc', 5, 0),
    ]
    for name, position, is_default in default_categories:
        cursor.execute('''
            INSERT OR IGNORE INTO categories (name, position, is_default)
            VALUES (?, ?, ?)
        ''', (name, position, is_default))

    # Insert default list
    cursor.execute('''
        INSERT OR IGNORE INTO lists (name, position, is_default)
        VALUES ('Main List', 0, 1)
    ''')

    # Migration: Fix any lists incorrectly marked as default
    # Only Main List (id=1) should be the default
    cursor.execute('''
        UPDATE lists SET is_default = 0 WHERE id != 1
    ''')

    # Ensure Main List stays as default
    cursor.execute('''
        UPDATE lists SET is_default = 1 WHERE id = 1
    ''')

    conn.commit()
    conn.close()
