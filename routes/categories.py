from flask import Blueprint, jsonify, request
from models.category import Category

categories_bp = Blueprint('categories', __name__, url_prefix='/api/categories')


@categories_bp.route('', methods=['GET'])
def get_categories():
    """Get all categories."""
    categories = Category.get_all()
    return jsonify(categories)


@categories_bp.route('', methods=['POST'])
def create_category():
    """Create a new category."""
    data = request.get_json()
    name = data.get('name')

    if not name:
        return jsonify({'error': 'Name is required'}), 400

    try:
        category = Category.create(name, data.get('position'))
        return jsonify(category), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 400


@categories_bp.route('/<int:category_id>', methods=['GET'])
def get_category(category_id):
    """Get a category by ID."""
    category = Category.get_by_id(category_id)
    if not category:
        return jsonify({'error': 'Category not found'}), 404
    return jsonify(category)


@categories_bp.route('/<int:category_id>', methods=['PATCH'])
def update_category(category_id):
    """Update a category."""
    data = request.get_json()
    category = Category.update(
        category_id,
        name=data.get('name'),
        position=data.get('position')
    )
    if not category:
        return jsonify({'error': 'Category not found'}), 404
    return jsonify(category)


@categories_bp.route('/<int:category_id>', methods=['DELETE'])
def delete_category(category_id):
    """Delete a category."""
    success, message = Category.delete(category_id)
    if not success:
        return jsonify({'error': message}), 400
    return jsonify({'message': message})


@categories_bp.route('/reorder', methods=['POST'])
def reorder_categories():
    """Bulk update category positions."""
    data = request.get_json()
    positions = data.get('positions', {})

    # Convert string keys to int
    positions = {int(k): v for k, v in positions.items()}

    Category.reorder(positions)
    return jsonify({'success': True})
