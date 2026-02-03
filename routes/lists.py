from flask import Blueprint, jsonify, request
from models.list import List

lists_bp = Blueprint('lists', __name__, url_prefix='/api/lists')


@lists_bp.route('', methods=['GET'])
def get_lists():
    """Get all lists."""
    lists = List.get_all()
    return jsonify(lists)


@lists_bp.route('', methods=['POST'])
def create_list():
    """Create a new list."""
    data = request.get_json() or {}
    name = data.get('name')

    if not name:
        return jsonify({'error': 'Name is required'}), 400

    try:
        list_obj = List.create(name, data.get('position'))
        return jsonify(list_obj), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 400


@lists_bp.route('/<int:list_id>', methods=['GET'])
def get_list(list_id):
    """Get a list by ID."""
    list_obj = List.get_by_id(list_id)
    if not list_obj:
        return jsonify({'error': 'List not found'}), 404
    return jsonify(list_obj)


@lists_bp.route('/<int:list_id>', methods=['PATCH'])
def update_list(list_id):
    """Update a list."""
    data = request.get_json() or {}
    list_obj = List.update(
        list_id,
        name=data.get('name'),
        position=data.get('position')
    )
    if not list_obj:
        return jsonify({'error': 'List not found'}), 404
    return jsonify(list_obj)


@lists_bp.route('/<int:list_id>', methods=['DELETE'])
def delete_list(list_id):
    """Delete a list."""
    success, message = List.delete(list_id)
    if not success:
        return jsonify({'error': message}), 400
    return jsonify({'message': message})


@lists_bp.route('/reorder', methods=['POST'])
def reorder_lists():
    """Bulk update list positions."""
    data = request.get_json() or {}
    positions = data.get('positions', {})

    if not positions or not isinstance(positions, dict):
        return jsonify({'error': 'positions dict is required'}), 400

    try:
        positions = {int(k): int(v) for k, v in positions.items()}
    except (ValueError, TypeError):
        return jsonify({'error': 'positions must be {id: position} with numeric values'}), 400

    List.reorder(positions)
    return jsonify({'success': True})
