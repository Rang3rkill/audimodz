from flask import Blueprint, render_template

pages_bp = Blueprint('pages', __name__)


@pages_bp.route('/')
def index():
    """Main wishlist page."""
    return render_template('index.html')


@pages_bp.route('/admin')
def admin():
    """Admin console for data management and diagnostics."""
    return render_template('admin.html')
