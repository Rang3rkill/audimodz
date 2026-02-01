"""Shared test fixtures for Judi's Wishlist tests."""
import os
import sys
import pytest

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Pre-import config so we can patch it
import config


@pytest.fixture(autouse=True)
def fresh_db(tmp_path):
    """Create a fresh isolated database for each test."""
    db_path = str(tmp_path / 'test.db')
    config.DATABASE_PATH = db_path
    config.DATA_DIR = str(tmp_path)

    from database import init_db
    init_db()
    yield db_path


@pytest.fixture
def client(fresh_db):
    """Create a Flask test client with fresh app."""
    from flask import Flask
    from routes.items import items_bp
    from routes.categories import categories_bp
    from routes.lists import lists_bp

    app = Flask(__name__)
    # Use unique blueprint names per test to avoid re-registration errors
    import copy
    for bp in [items_bp, categories_bp, lists_bp]:
        app.register_blueprint(bp)
    app.config['TESTING'] = True
    return app.test_client()
