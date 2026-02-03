#!/usr/bin/env python3
"""
Judi's Wishlist - Main Application
A dementia-friendly wishlist app for Temu and Amazon items.
"""

import sys
import traceback
import logging
from datetime import datetime

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler('wishlist.log', encoding='utf-8')
    ]
)
logger = logging.getLogger(__name__)


def main():
    """Main entry point with error handling."""
    try:
        logger.info("=" * 50)
        logger.info("Starting Judi's Wishlist...")
        logger.info(f"Python version: {sys.version}")
        logger.info(f"Time: {datetime.now()}")
        logger.info("=" * 50)

        # Import Flask and dependencies
        logger.info("Loading Flask...")
        from flask import Flask

        logger.info("Loading configuration...")
        from config import FLASK_HOST, FLASK_PORT, FLASK_DEBUG

        logger.info("Initializing database...")
        from database import init_db, backup_db
        init_db()
        logger.info("Database initialized successfully.")

        # Auto-backup on startup
        backup_path = backup_db()
        if backup_path:
            logger.info(f"Database backed up to: {backup_path}")

        logger.info("Loading routes...")
        from routes import pages_bp, items_bp, categories_bp, lists_bp

        # Create app
        logger.info("Creating Flask application...")
        app = Flask(__name__)

        # Register blueprints
        app.register_blueprint(pages_bp)
        app.register_blueprint(items_bp)
        app.register_blueprint(categories_bp)
        app.register_blueprint(lists_bp)

        logger.info(f"Server starting at http://{FLASK_HOST}:{FLASK_PORT}")
        print("\n" + "=" * 50)
        print("  Judi's Wishlist is running!")
        print(f"  Open in browser: http://{FLASK_HOST}:{FLASK_PORT}")
        print("=" * 50)
        print("\nPress Ctrl+C to stop the server.\n")

        app.run(host=FLASK_HOST, port=FLASK_PORT, debug=FLASK_DEBUG)

    except ImportError as e:
        logger.error(f"Import error - missing module: {e}")
        print("\n" + "=" * 50)
        print("ERROR: Missing Python module!")
        print("=" * 50)
        print(f"\nDetails: {e}")
        print("\nTry running: pip install Flask")
        print("\nPress Enter to exit...")
        input()
        sys.exit(1)

    except Exception as e:
        logger.error(f"Startup error: {e}")
        logger.error(traceback.format_exc())
        print("\n" + "=" * 50)
        print("ERROR: Failed to start Judi's Wishlist")
        print("=" * 50)
        print(f"\nError type: {type(e).__name__}")
        print(f"Error message: {e}")
        print("\nFull error details:")
        print("-" * 50)
        traceback.print_exc()
        print("-" * 50)
        print("\nCheck 'wishlist.log' for more details.")
        print("\nPress Enter to exit...")
        input()
        sys.exit(1)


if __name__ == '__main__':
    main()
