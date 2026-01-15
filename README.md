# Judi's Wishlist

A local Windows application for maintaining a stable, organized wishlist of items from Temu and Amazon. Unlike store carts which constantly rearrange items, this app keeps items exactly where they are placed.

## Features

- View items organized by category (Flowers, Clothes, Kitchen Items, etc.)
- Filter by custom lists (Christmas Gifts, House Stuff, etc.)
- Drag and drop to reorder items - they stay where you put them
- Check items to add them to "Ready to Buy" list
- Items grouped by store with estimated totals
- Send Amazon items directly to cart with one click
- Open Temu items in tabs for manual cart adding
- Dementia-friendly design with large buttons and high contrast

## Quick Start

### First Time Setup

1. Open Command Prompt in this folder
2. Create a virtual environment:
   ```
   python -m venv venv
   ```
3. Activate it:
   ```
   venv\Scripts\activate
   ```
4. Install dependencies:
   ```
   pip install -r requirements.txt
   ```
5. Run the app:
   ```
   python app.py
   ```
6. Open Chrome to http://localhost:5000

### Daily Use

Double-click `start-wishlist.vbs` (or `start-wishlist.bat`) to launch the app and open Chrome.

## Project Structure

```
judis-wishlist/
├── app.py                  # Flask app entry point
├── config.py               # Configuration settings
├── database.py             # SQLite setup and connection
├── models/
│   ├── item.py             # Item model and queries
│   ├── category.py         # Category model and queries
│   └── list.py             # List model and queries
├── routes/
│   ├── pages.py            # HTML page routes
│   ├── items.py            # Item API endpoints
│   ├── categories.py       # Category API endpoints
│   └── lists.py            # List API endpoints
├── static/
│   ├── css/style.css       # Styles
│   └── js/app.js           # Frontend logic
├── templates/
│   ├── base.html           # Base template
│   └── index.html          # Main wishlist page
├── data/
│   └── wishlist.db         # SQLite database (auto-created)
├── requirements.txt        # Python dependencies
├── start-wishlist.bat      # Windows launcher (shows console)
└── start-wishlist.vbs      # Windows launcher (hidden console)
```

## API Endpoints

### Items
- `GET /api/items` - List items (optional: `?category_id=X&list_id=Y`)
- `POST /api/items` - Add item
- `PATCH /api/items/<id>` - Update item
- `DELETE /api/items/<id>` - Delete item
- `POST /api/items/reorder` - Bulk update positions
- `GET /api/items/ready-to-buy` - Get checked items grouped by store
- `POST /api/import` - Bulk import items from extension

### Categories
- `GET /api/categories` - List categories
- `POST /api/categories` - Create category
- `PATCH /api/categories/<id>` - Update category
- `DELETE /api/categories/<id>` - Delete category

### Lists
- `GET /api/lists` - List lists
- `POST /api/lists` - Create list
- `PATCH /api/lists/<id>` - Update list
- `DELETE /api/lists/<id>` - Delete list

## Default Categories

- Unsorted (default, cannot be deleted)
- Flowers
- Clothes
- Decorations
- Kitchen Items
- Misc

## Default Lists

- Main List (default, cannot be deleted)

## Chrome Extension

The Chrome extension (coming soon) will allow importing items directly from Temu and Amazon cart pages.

## Tech Stack

- **Backend**: Flask (Python)
- **Database**: SQLite
- **Frontend**: HTML + Vanilla JS + CSS
- **Import Tool**: Chrome Extension (Manifest V3)
