from flask import Flask
from config import FLASK_HOST, FLASK_PORT, FLASK_DEBUG
from database import init_db
from routes import pages_bp, items_bp, categories_bp, lists_bp

app = Flask(__name__)

# Register blueprints
app.register_blueprint(pages_bp)
app.register_blueprint(items_bp)
app.register_blueprint(categories_bp)
app.register_blueprint(lists_bp)

if __name__ == '__main__':
    # Initialize database
    init_db()
    print(f"Starting Judi's Wishlist at http://{FLASK_HOST}:{FLASK_PORT}")
    app.run(host=FLASK_HOST, port=FLASK_PORT, debug=FLASK_DEBUG)
