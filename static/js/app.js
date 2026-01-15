// Judi's Wishlist - Frontend Application

const App = {
    // State
    categories: [],
    lists: [],
    items: [],
    currentCategory: null,
    currentList: null,
    showingReadyToBuy: false,

    // DOM Elements
    elements: {},

    // Initialize the app
    async init() {
        this.cacheElements();
        this.bindEvents();
        await this.loadData();
        this.render();
    },

    // Cache DOM elements
    cacheElements() {
        this.elements = {
            categoryTabs: document.getElementById('categoryTabs'),
            listSelect: document.getElementById('listSelect'),
            itemsGrid: document.getElementById('itemsGrid'),
            readyToBuySection: document.getElementById('readyToBuySection'),
            readyToBuyContent: document.getElementById('readyToBuyContent'),
            addItemBtn: document.getElementById('addItemBtn'),
            addItemModal: document.getElementById('addItemModal'),
            closeAddModal: document.getElementById('closeAddModal'),
            addItemForm: document.getElementById('addItemForm'),
            refreshPrices: document.getElementById('refreshPrices'),
            // Form fields
            itemStore: document.getElementById('itemStore'),
            itemTitle: document.getElementById('itemTitle'),
            itemUrl: document.getElementById('itemUrl'),
            itemProductId: document.getElementById('itemProductId'),
            itemImage: document.getElementById('itemImage'),
            itemPrice: document.getElementById('itemPrice'),
            itemQuantity: document.getElementById('itemQuantity'),
            itemCategory: document.getElementById('itemCategory'),
            itemList: document.getElementById('itemList'),
        };
    },

    // Bind event listeners
    bindEvents() {
        // List selector
        this.elements.listSelect.addEventListener('change', () => {
            const value = this.elements.listSelect.value;
            this.currentList = value ? parseInt(value) : null;
            this.showingReadyToBuy = false;
            this.loadItems();
        });

        // Add item button
        this.elements.addItemBtn.addEventListener('click', () => {
            this.showAddModal();
        });

        // Close modal
        this.elements.closeAddModal.addEventListener('click', () => {
            this.hideAddModal();
        });

        // Modal backdrop click
        this.elements.addItemModal.addEventListener('click', (e) => {
            if (e.target === this.elements.addItemModal) {
                this.hideAddModal();
            }
        });

        // Add item form
        this.elements.addItemForm.addEventListener('submit', (e) => {
            e.preventDefault();
            this.addItem();
        });

        // Refresh prices
        this.elements.refreshPrices.addEventListener('click', () => {
            alert('Price refresh will be available once the Chrome extension is installed.');
        });
    },

    // API methods
    async api(endpoint, options = {}) {
        const response = await fetch(endpoint, {
            headers: {
                'Content-Type': 'application/json',
            },
            ...options,
        });
        return response.json();
    },

    // Load all data
    async loadData() {
        const [categories, lists] = await Promise.all([
            this.api('/api/categories'),
            this.api('/api/lists'),
        ]);
        this.categories = categories;
        this.lists = lists;
        await this.loadItems();
    },

    // Load items with current filters
    async loadItems() {
        let params = new URLSearchParams();

        if (this.currentCategory !== null) {
            params.append('category_id', this.currentCategory);
        }
        if (this.currentList !== null) {
            params.append('list_id', this.currentList);
        }

        const queryString = params.toString();
        const endpoint = queryString ? `/api/items?${queryString}` : '/api/items';

        this.items = await this.api(endpoint);
        this.renderItems();
    },

    // Load ready to buy count
    async loadReadyCount() {
        const data = await this.api('/api/items/ready-to-buy/count');
        return data.count;
    },

    // Render methods
    async render() {
        await this.renderCategoryTabs();
        this.renderListDropdown();
        this.renderFormSelects();
        this.renderItems();
    },

    // Render category tabs
    async renderCategoryTabs() {
        const readyCount = await this.loadReadyCount();

        let html = `<button class="tab ${this.currentCategory === null && !this.showingReadyToBuy ? 'active' : ''}" data-category="">All</button>`;

        for (const cat of this.categories) {
            const isActive = this.currentCategory === cat.id && !this.showingReadyToBuy;
            html += `<button class="tab ${isActive ? 'active' : ''}" data-category="${cat.id}">${cat.name}</button>`;
        }

        // Ready to Buy tab
        const readyActive = this.showingReadyToBuy ? 'active' : '';
        html += `<button class="tab ready-tab ${readyActive}" data-ready="true">Ready to Buy (${readyCount})</button>`;

        this.elements.categoryTabs.innerHTML = html;

        // Bind tab events
        this.elements.categoryTabs.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', () => this.handleTabClick(tab));
        });
    },

    // Handle tab click
    handleTabClick(tab) {
        if (tab.dataset.ready === 'true') {
            this.showingReadyToBuy = true;
            this.currentCategory = null;
            this.loadReadyToBuy();
        } else {
            this.showingReadyToBuy = false;
            const catId = tab.dataset.category;
            this.currentCategory = catId ? parseInt(catId) : null;
            this.loadItems();
        }

        // Update active state
        this.elements.categoryTabs.querySelectorAll('.tab').forEach(t => {
            t.classList.remove('active');
        });
        tab.classList.add('active');
    },

    // Render list dropdown
    renderListDropdown() {
        let html = '<option value="">All Lists</option>';
        for (const list of this.lists) {
            html += `<option value="${list.id}">${list.name}</option>`;
        }
        this.elements.listSelect.innerHTML = html;
    },

    // Render form selects
    renderFormSelects() {
        // Categories
        let catHtml = '';
        for (const cat of this.categories) {
            catHtml += `<option value="${cat.id}">${cat.name}</option>`;
        }
        this.elements.itemCategory.innerHTML = catHtml;

        // Lists
        let listHtml = '';
        for (const list of this.lists) {
            listHtml += `<option value="${list.id}">${list.name}</option>`;
        }
        this.elements.itemList.innerHTML = listHtml;
    },

    // Render items grid
    renderItems() {
        this.elements.readyToBuySection.classList.add('hidden');
        this.elements.itemsGrid.classList.remove('hidden');

        if (this.items.length === 0) {
            this.elements.itemsGrid.innerHTML = `
                <div class="empty-state">
                    <h3>No items yet</h3>
                    <p>Click the + button to add items, or use the Chrome extension to import from Temu or Amazon.</p>
                </div>
            `;
            return;
        }

        let html = '';
        for (const item of this.items) {
            html += this.renderItemCard(item);
        }
        this.elements.itemsGrid.innerHTML = html;

        // Bind item events
        this.bindItemEvents();
    },

    // Render single item card
    renderItemCard(item) {
        const imageHtml = item.image_url
            ? `<img src="${item.image_url}" alt="${this.escapeHtml(item.title)}" class="item-image">`
            : '<div class="item-image-placeholder">?</div>';

        const storeClass = item.store.toLowerCase();
        const storeName = item.store.charAt(0).toUpperCase() + item.store.slice(1);

        // Indicators
        let indicators = '';
        if (item.piece_count) {
            indicators += `<span class="indicator">${item.piece_count}pc</span>`;
        }
        if (item.quantity > 1) {
            indicators += `<span class="indicator warning">Qty: ${item.quantity}</span>`;
        }

        const price = item.current_price !== null
            ? `${item.currency || '$'}${item.current_price.toFixed(2)}`
            : 'No price';

        const checked = item.in_ready_to_buy ? 'checked' : '';

        return `
            <div class="item-card" data-id="${item.id}" draggable="true">
                <div class="item-image-container">
                    ${imageHtml}
                    <span class="store-badge ${storeClass}">${storeName}</span>
                    ${indicators ? `<div class="item-indicators">${indicators}</div>` : ''}
                </div>
                <div class="item-details">
                    <h3 class="item-title" title="${this.escapeHtml(item.title)}">${this.escapeHtml(item.title)}</h3>
                    <div class="item-price-row">
                        <span class="item-price">${price}</span>
                        <input type="checkbox" class="item-checkbox" data-id="${item.id}" ${checked}>
                    </div>
                </div>
            </div>
        `;
    },

    // Bind item events (checkboxes, drag and drop)
    bindItemEvents() {
        // Checkboxes
        this.elements.itemsGrid.querySelectorAll('.item-checkbox').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                const itemId = parseInt(e.target.dataset.id);
                this.toggleReadyToBuy(itemId, e.target.checked);
            });
        });

        // Drag and drop
        const cards = this.elements.itemsGrid.querySelectorAll('.item-card');
        cards.forEach(card => {
            card.addEventListener('dragstart', (e) => this.handleDragStart(e, card));
            card.addEventListener('dragend', (e) => this.handleDragEnd(e, card));
            card.addEventListener('dragover', (e) => this.handleDragOver(e, card));
            card.addEventListener('dragleave', (e) => this.handleDragLeave(e, card));
            card.addEventListener('drop', (e) => this.handleDrop(e, card));
        });
    },

    // Drag and drop handlers
    draggedItem: null,

    handleDragStart(e, card) {
        this.draggedItem = card;
        card.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', card.dataset.id);
    },

    handleDragEnd(e, card) {
        card.classList.remove('dragging');
        this.elements.itemsGrid.querySelectorAll('.item-card').forEach(c => {
            c.classList.remove('drag-over');
        });
        this.draggedItem = null;
    },

    handleDragOver(e, card) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (card !== this.draggedItem) {
            card.classList.add('drag-over');
        }
    },

    handleDragLeave(e, card) {
        card.classList.remove('drag-over');
    },

    async handleDrop(e, card) {
        e.preventDefault();
        card.classList.remove('drag-over');

        if (!this.draggedItem || card === this.draggedItem) return;

        const draggedId = parseInt(this.draggedItem.dataset.id);
        const targetId = parseInt(card.dataset.id);

        // Find positions
        const cards = Array.from(this.elements.itemsGrid.querySelectorAll('.item-card'));
        const draggedIndex = cards.indexOf(this.draggedItem);
        const targetIndex = cards.indexOf(card);

        // Reorder in DOM
        if (draggedIndex < targetIndex) {
            card.parentNode.insertBefore(this.draggedItem, card.nextSibling);
        } else {
            card.parentNode.insertBefore(this.draggedItem, card);
        }

        // Update positions in database
        await this.savePositions();
    },

    // Save positions after drag
    async savePositions() {
        const cards = this.elements.itemsGrid.querySelectorAll('.item-card');
        const positions = {};

        cards.forEach((card, index) => {
            positions[card.dataset.id] = index;
        });

        await this.api('/api/items/reorder', {
            method: 'POST',
            body: JSON.stringify({ positions }),
        });

        // Reload to sync state
        await this.loadItems();
    },

    // Toggle ready to buy status
    async toggleReadyToBuy(itemId, inReadyToBuy) {
        await this.api(`/api/items/${itemId}`, {
            method: 'PATCH',
            body: JSON.stringify({ in_ready_to_buy: inReadyToBuy ? 1 : 0 }),
        });

        // Update ready count in tab
        await this.renderCategoryTabs();
    },

    // Load ready to buy view
    async loadReadyToBuy() {
        this.elements.itemsGrid.classList.add('hidden');
        this.elements.readyToBuySection.classList.remove('hidden');

        const data = await this.api('/api/items/ready-to-buy');
        this.renderReadyToBuy(data);
    },

    // Render ready to buy section
    renderReadyToBuy(data) {
        const stores = data.stores;
        const storeNames = Object.keys(stores);

        if (storeNames.length === 0) {
            this.elements.readyToBuyContent.innerHTML = `
                <div class="empty-state">
                    <h3>No items ready to buy</h3>
                    <p>Check the boxes on items you want to purchase.</p>
                </div>
            `;
            return;
        }

        let html = '';

        // Store display config
        const storeConfig = {
            temu: { name: 'TEMU', icon: 'T', btnText: 'Open Temu Items' },
            amazon: { name: 'AMAZON', icon: 'A', btnText: 'Send to Amazon Cart' },
        };

        for (const storeName of storeNames) {
            const store = stores[storeName];
            const config = storeConfig[storeName] || { name: storeName.toUpperCase(), icon: storeName[0].toUpperCase(), btnText: `Open ${storeName}` };

            html += `
                <div class="store-group">
                    <div class="store-group-header">
                        <div class="store-group-title">
                            <span class="store-icon ${storeName}">${config.icon}</span>
                            ${config.name} - ${store.items.length} item${store.items.length !== 1 ? 's' : ''} - $${store.subtotal.toFixed(2)}
                        </div>
                        <button class="checkout-btn ${storeName}" data-store="${storeName}">${config.btnText}</button>
                    </div>
            `;

            for (const item of store.items) {
                const imgHtml = item.image_url
                    ? `<img src="${item.image_url}" alt="" class="ready-item-image">`
                    : '<div class="ready-item-image"></div>';

                const price = item.current_price || 0;
                const qty = item.quantity || 1;
                const total = (price * qty).toFixed(2);

                html += `
                    <div class="ready-item">
                        <input type="checkbox" class="item-checkbox" data-id="${item.id}" checked>
                        ${imgHtml}
                        <div class="ready-item-details">
                            <div class="ready-item-title">${this.escapeHtml(item.title)}</div>
                            <div class="ready-item-price">
                                <span>$${price.toFixed(2)} x ${qty}</span>
                                <span>= $${total}</span>
                            </div>
                        </div>
                    </div>
                `;
            }

            html += '</div>';
        }

        // Grand total
        html += `
            <div class="grand-total">
                <span class="grand-total-label">TOTAL</span>
                <span class="grand-total-value">$${data.grand_total.toFixed(2)}</span>
            </div>
        `;

        this.elements.readyToBuyContent.innerHTML = html;

        // Bind events
        this.elements.readyToBuyContent.querySelectorAll('.item-checkbox').forEach(checkbox => {
            checkbox.addEventListener('change', async (e) => {
                const itemId = parseInt(e.target.dataset.id);
                await this.toggleReadyToBuy(itemId, e.target.checked);
                await this.loadReadyToBuy();
            });
        });

        this.elements.readyToBuyContent.querySelectorAll('.checkout-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const store = btn.dataset.store;
                this.handleCheckout(store);
            });
        });
    },

    // Handle checkout button click
    async handleCheckout(store) {
        if (store === 'amazon') {
            // Build Amazon cart URL
            const data = await this.api('/api/items/ready-to-buy');
            const amazonItems = data.stores.amazon?.items || [];

            if (amazonItems.length === 0) return;

            const params = amazonItems.map((item, i) => {
                const n = i + 1;
                return `ASIN.${n}=${item.product_id}&Quantity.${n}=${item.quantity || 1}`;
            }).join('&');

            const url = `https://www.amazon.com/gp/aws/cart/add.html?${params}`;
            window.open(url, '_blank');
        } else if (store === 'temu') {
            // Open Temu items in tabs
            const data = await this.api('/api/items/ready-to-buy');
            const temuItems = data.stores.temu?.items || [];

            if (temuItems.length === 0) return;

            for (const item of temuItems) {
                window.open(item.product_url, '_blank');
            }
        }
    },

    // Add item modal
    showAddModal() {
        this.elements.addItemModal.classList.remove('hidden');
    },

    hideAddModal() {
        this.elements.addItemModal.classList.add('hidden');
        this.elements.addItemForm.reset();
    },

    // Add item
    async addItem() {
        const item = {
            store: this.elements.itemStore.value,
            title: this.elements.itemTitle.value,
            product_url: this.elements.itemUrl.value,
            product_id: this.elements.itemProductId.value,
            image_url: this.elements.itemImage.value || null,
            current_price: this.elements.itemPrice.value ? parseFloat(this.elements.itemPrice.value) : null,
            quantity: parseInt(this.elements.itemQuantity.value) || 1,
            category_id: parseInt(this.elements.itemCategory.value),
            list_id: parseInt(this.elements.itemList.value),
        };

        try {
            await this.api('/api/items', {
                method: 'POST',
                body: JSON.stringify(item),
            });

            this.hideAddModal();
            await this.loadItems();
            await this.renderCategoryTabs();
        } catch (error) {
            alert('Error adding item: ' + error.message);
        }
    },

    // Helper: escape HTML
    escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },
};

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});
