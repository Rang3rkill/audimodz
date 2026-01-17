// Judi's Wishlist - Frontend Application

const App = {
    // State
    categories: [],
    lists: [],
    items: [],
    filteredItems: [],
    stats: {},
    currentCategory: null,
    currentList: null,
    showingReadyToBuy: false,
    searchQuery: '',
    viewMode: 'grid', // 'grid' or 'gallery'
    budget: 0,
    balance: null,
    sessionStartTime: Date.now(),
    breakReminderInterval: 30 * 60 * 1000, // 30 minutes
    breakRemindersEnabled: true,
    lastBreakReminder: Date.now(),
    breakSnoozed: false,

    // DOM Elements
    elements: {},

    // Initialize the app
    async init() {
        this.cacheElements();
        this.loadSettings();
        this.bindEvents();
        await this.loadData();
        this.render();
        this.startDateTime();
        this.startSessionTimer();
    },

    // Load settings from localStorage
    loadSettings() {
        // Load budget
        const savedBudget = localStorage.getItem('wishlist_budget');
        if (savedBudget) {
            this.budget = parseFloat(savedBudget);
            if (this.elements.budgetInput) {
                this.elements.budgetInput.value = this.budget;
            }
        }
        // Load view mode
        const savedView = localStorage.getItem('wishlist_view_mode');
        if (savedView) {
            this.viewMode = savedView;
        }
        // Load balance
        const savedBalance = localStorage.getItem('wishlist_balance');
        if (savedBalance) {
            this.balance = parseFloat(savedBalance);
            if (this.elements.balanceInput) {
                this.elements.balanceInput.value = this.balance;
            }
        }
        // Load break reminder setting
        const breakSetting = localStorage.getItem('wishlist_break_reminders');
        if (breakSetting !== null) {
            this.breakRemindersEnabled = breakSetting === 'true';
        }
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
            // Management modals
            manageCategoriesBtn: document.getElementById('manageCategoriesBtn'),
            manageListsBtn: document.getElementById('manageListsBtn'),
            manageCategoriesModal: document.getElementById('manageCategoriesModal'),
            manageListsModal: document.getElementById('manageListsModal'),
            categoriesList: document.getElementById('categoriesList'),
            listsList: document.getElementById('listsList'),
            newCategoryName: document.getElementById('newCategoryName'),
            newListName: document.getElementById('newListName'),
            addCategoryBtn: document.getElementById('addCategoryBtn'),
            addListBtn: document.getElementById('addListBtn'),
            // Edit item modal
            editItemModal: document.getElementById('editItemModal'),
            editItemForm: document.getElementById('editItemForm'),
            editItemId: document.getElementById('editItemId'),
            editItemCategory: document.getElementById('editItemCategory'),
            editItemList: document.getElementById('editItemList'),
            editItemQuantity: document.getElementById('editItemQuantity'),
            editItemNotes: document.getElementById('editItemNotes'),
            deleteItemBtn: document.getElementById('deleteItemBtn'),
            // Caretaker panel
            caretakerToggle: document.getElementById('caretakerToggle'),
            caretakerPanel: document.getElementById('caretakerPanel'),
            closeCaretaker: document.getElementById('closeCaretaker'),
            // Stats elements
            statTotalItems: document.getElementById('statTotalItems'),
            statTotalValue: document.getElementById('statTotalValue'),
            statReadyToBuy: document.getElementById('statReadyToBuy'),
            statReadyValue: document.getElementById('statReadyValue'),
            statRecentlyAdded: document.getElementById('statRecentlyAdded'),
            statFavorites: document.getElementById('statFavorites'),
            storeStats: document.getElementById('storeStats'),
            // Caretaker action buttons
            manageCategoriesBtn2: document.getElementById('manageCategoriesBtn2'),
            manageListsBtn2: document.getElementById('manageListsBtn2'),
            // Search
            searchInput: document.getElementById('searchInput'),
            clearSearch: document.getElementById('clearSearch'),
            // View toggle
            viewToggle: document.getElementById('viewToggle'),
            viewIcon: document.getElementById('viewIcon'),
            // Budget tracker
            budgetInput: document.getElementById('budgetInput'),
            saveBudget: document.getElementById('saveBudget'),
            budgetDisplay: document.getElementById('budgetDisplay'),
            budgetBar: document.getElementById('budgetBar'),
            budgetSpent: document.getElementById('budgetSpent'),
            budgetTotal: document.getElementById('budgetTotal'),
            budgetRemaining: document.getElementById('budgetRemaining'),
            // Additional stats
            statOldestItem: document.getElementById('statOldestItem'),
            statPriceDrops: document.getElementById('statPriceDrops'),
            // Duplicates
            duplicateCount: document.getElementById('duplicateCount'),
            duplicatesList: document.getElementById('duplicatesList'),
            // Date/Time/Balance
            dateDisplay: document.getElementById('dateDisplay'),
            timeDisplay: document.getElementById('timeDisplay'),
            balanceDisplay: document.getElementById('balanceDisplay'),
            balanceInput: document.getElementById('balanceInput'),
            saveBalance: document.getElementById('saveBalance'),
            // Break reminders
            breakReminder: document.getElementById('breakReminder'),
            sessionTimeDisplay: document.getElementById('sessionTimeDisplay'),
            dismissBreak: document.getElementById('dismissBreak'),
            snoozeBreak: document.getElementById('snoozeBreak'),
            breakRemindersEnabled: document.getElementById('breakRemindersEnabled'),
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
        this.elements.refreshPrices?.addEventListener('click', () => {
            alert('Price refresh will be available once the Chrome extension is installed.');
        });

        // Management modals
        this.elements.manageCategoriesBtn?.addEventListener('click', () => {
            this.showManageCategoriesModal();
        });

        this.elements.manageListsBtn?.addEventListener('click', () => {
            this.showManageListsModal();
        });

        // Caretaker panel buttons (duplicates in panel)
        this.elements.manageCategoriesBtn2?.addEventListener('click', () => {
            this.showManageCategoriesModal();
        });

        this.elements.manageListsBtn2?.addEventListener('click', () => {
            this.showManageListsModal();
        });

        // Caretaker panel toggle
        this.elements.caretakerToggle?.addEventListener('click', () => {
            this.toggleCaretakerPanel();
        });

        this.elements.closeCaretaker?.addEventListener('click', () => {
            this.hideCaretakerPanel();
        });

        // Search functionality
        this.elements.searchInput?.addEventListener('input', (e) => {
            this.handleSearch(e.target.value);
        });

        this.elements.clearSearch?.addEventListener('click', () => {
            this.clearSearch();
        });

        // View toggle
        this.elements.viewToggle?.addEventListener('click', () => {
            this.toggleViewMode();
        });

        // Budget tracker
        this.elements.saveBudget?.addEventListener('click', () => {
            this.saveBudget();
        });

        this.elements.budgetInput?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.saveBudget();
            }
        });

        // Balance
        this.elements.saveBalance?.addEventListener('click', () => {
            this.saveBalance();
        });

        this.elements.balanceInput?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.saveBalance();
            }
        });

        // Break reminders
        this.elements.dismissBreak?.addEventListener('click', () => {
            this.dismissBreakReminder();
        });

        this.elements.snoozeBreak?.addEventListener('click', () => {
            this.snoozeBreakReminder();
        });

        this.elements.breakRemindersEnabled?.addEventListener('change', (e) => {
            this.breakRemindersEnabled = e.target.checked;
            localStorage.setItem('wishlist_break_reminders', this.breakRemindersEnabled.toString());
        });

        // Close buttons for all modals
        document.querySelectorAll('[data-close]').forEach(btn => {
            btn.addEventListener('click', () => {
                const modalId = btn.dataset.close;
                document.getElementById(modalId)?.classList.add('hidden');
            });
        });

        // Modal backdrop clicks
        [this.elements.manageCategoriesModal, this.elements.manageListsModal, this.elements.editItemModal].forEach(modal => {
            modal?.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.classList.add('hidden');
                }
            });
        });

        // Add category
        this.elements.addCategoryBtn?.addEventListener('click', () => {
            this.addCategory();
        });

        this.elements.newCategoryName?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.addCategory();
            }
        });

        // Add list
        this.elements.addListBtn?.addEventListener('click', () => {
            this.addList();
        });

        this.elements.newListName?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.addList();
            }
        });

        // Edit item form
        this.elements.editItemForm?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveItemEdit();
        });

        // Delete item
        this.elements.deleteItemBtn?.addEventListener('click', () => {
            this.deleteItem();
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
        const [categories, lists, stats] = await Promise.all([
            this.api('/api/categories'),
            this.api('/api/lists'),
            this.api('/api/items/stats'),
        ]);
        this.categories = categories;
        this.lists = lists;
        this.stats = stats;
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

    // Load stats
    async loadStats() {
        this.stats = await this.api('/api/items/stats');
        this.renderStats();
    },

    // Render methods
    async render() {
        await this.renderCategoryTabs();
        this.renderListDropdown();
        this.renderFormSelects();
        this.renderItems();
        this.renderStats();
        this.renderBudget();
        this.renderBalance();
        this.applyViewMode();
        // Set break reminder checkbox
        if (this.elements.breakRemindersEnabled) {
            this.elements.breakRemindersEnabled.checked = this.breakRemindersEnabled;
        }
    },

    // Render stats in caretaker panel
    renderStats() {
        if (!this.stats) return;

        // Update stat values
        if (this.elements.statTotalItems) {
            this.elements.statTotalItems.textContent = this.stats.total_items || 0;
        }
        if (this.elements.statTotalValue) {
            this.elements.statTotalValue.textContent = '$' + (this.stats.total_value || 0).toFixed(2);
        }
        if (this.elements.statReadyToBuy) {
            this.elements.statReadyToBuy.textContent = this.stats.ready_to_buy || 0;
        }
        if (this.elements.statReadyValue) {
            this.elements.statReadyValue.textContent = '$' + (this.stats.ready_to_buy_value || 0).toFixed(2);
        }
        if (this.elements.statRecentlyAdded) {
            this.elements.statRecentlyAdded.textContent = (this.stats.recently_added || 0) + ' items';
        }
        if (this.elements.statFavorites) {
            this.elements.statFavorites.textContent = (this.stats.favorites || 0) + ' items';
        }
        if (this.elements.statOldestItem) {
            this.elements.statOldestItem.textContent = this.stats.oldest_item_age || '-';
        }
        if (this.elements.statPriceDrops) {
            this.elements.statPriceDrops.textContent = (this.stats.price_drops || 0) + ' items';
        }

        // Render store stats
        if (this.elements.storeStats && this.stats.by_store) {
            const storeConfig = {
                temu: { name: 'Temu', icon: 'T' },
                amazon: { name: 'Amazon', icon: 'A' },
            };

            let html = '';
            for (const [store, data] of Object.entries(this.stats.by_store)) {
                const config = storeConfig[store] || { name: store, icon: store[0].toUpperCase() };
                html += `
                    <div class="store-stat-row">
                        <span class="store-stat-icon ${store}">${config.icon}</span>
                        <div class="store-stat-info">
                            <div class="store-stat-name">${config.name}</div>
                            <div class="store-stat-details">${data.count} items - $${data.value.toFixed(2)}</div>
                        </div>
                    </div>
                `;
            }
            this.elements.storeStats.innerHTML = html;
        }
    },

    // Caretaker panel
    toggleCaretakerPanel() {
        this.elements.caretakerPanel?.classList.toggle('hidden');
        if (!this.elements.caretakerPanel?.classList.contains('hidden')) {
            this.loadStats();
            this.loadDuplicates();
        }
    },

    hideCaretakerPanel() {
        this.elements.caretakerPanel?.classList.add('hidden');
    },

    // Search functionality
    handleSearch(query) {
        this.searchQuery = query.toLowerCase().trim();

        // Show/hide clear button
        if (this.elements.clearSearch) {
            this.elements.clearSearch.classList.toggle('hidden', !this.searchQuery);
        }

        this.renderItems();
    },

    clearSearch() {
        this.searchQuery = '';
        if (this.elements.searchInput) {
            this.elements.searchInput.value = '';
        }
        if (this.elements.clearSearch) {
            this.elements.clearSearch.classList.add('hidden');
        }
        this.renderItems();
    },

    // Filter items by search query
    getFilteredItems() {
        if (!this.searchQuery) {
            return this.items;
        }
        return this.items.filter(item => {
            const title = (item.title || '').toLowerCase();
            const store = (item.store || '').toLowerCase();
            const notes = (item.notes || '').toLowerCase();
            return title.includes(this.searchQuery) ||
                   store.includes(this.searchQuery) ||
                   notes.includes(this.searchQuery);
        });
    },

    // View mode toggle
    toggleViewMode() {
        this.viewMode = this.viewMode === 'grid' ? 'gallery' : 'grid';
        localStorage.setItem('wishlist_view_mode', this.viewMode);
        this.applyViewMode();
    },

    applyViewMode() {
        // Update icon
        if (this.elements.viewIcon) {
            this.elements.viewIcon.innerHTML = this.viewMode === 'grid' ? '&#9638;' : '&#9783;';
        }

        // Apply class to grid
        if (this.elements.itemsGrid) {
            this.elements.itemsGrid.classList.remove('grid-view', 'gallery-view');
            this.elements.itemsGrid.classList.add(this.viewMode === 'grid' ? 'grid-view' : 'gallery-view');
        }
    },

    // Budget tracker
    saveBudget() {
        const value = parseFloat(this.elements.budgetInput?.value) || 0;
        this.budget = value;
        localStorage.setItem('wishlist_budget', value.toString());
        this.renderBudget();
        this.showToast('Budget saved!');
    },

    renderBudget() {
        if (!this.budget || this.budget <= 0) {
            if (this.elements.budgetDisplay) {
                this.elements.budgetDisplay.style.display = 'none';
            }
            return;
        }

        const spent = this.stats.ready_to_buy_value || 0;
        const percentage = Math.min((spent / this.budget) * 100, 100);
        const remaining = this.budget - spent;

        if (this.elements.budgetDisplay) {
            this.elements.budgetDisplay.style.display = 'block';
        }
        if (this.elements.budgetBar) {
            this.elements.budgetBar.style.width = percentage + '%';
            this.elements.budgetBar.classList.toggle('over-budget', spent > this.budget);
        }
        if (this.elements.budgetSpent) {
            this.elements.budgetSpent.textContent = '$' + spent.toFixed(2);
        }
        if (this.elements.budgetTotal) {
            this.elements.budgetTotal.textContent = '$' + this.budget.toFixed(2);
        }
        if (this.elements.budgetRemaining) {
            if (remaining >= 0) {
                this.elements.budgetRemaining.textContent = '($' + remaining.toFixed(2) + ' left)';
                this.elements.budgetRemaining.className = 'budget-remaining';
            } else {
                this.elements.budgetRemaining.textContent = '($' + Math.abs(remaining).toFixed(2) + ' over!)';
                this.elements.budgetRemaining.className = 'budget-remaining over';
            }
        }
    },

    // Balance management
    saveBalance() {
        const value = parseFloat(this.elements.balanceInput?.value) || 0;
        this.balance = value;
        localStorage.setItem('wishlist_balance', value.toString());
        this.renderBalance();
        this.showToast('Balance updated!');
    },

    renderBalance() {
        if (this.elements.balanceDisplay) {
            if (this.balance !== null && this.balance >= 0) {
                this.elements.balanceDisplay.textContent = '$' + this.balance.toFixed(2);
                this.elements.balanceDisplay.classList.toggle('low-balance', this.balance < 50);
            } else {
                this.elements.balanceDisplay.textContent = '--';
            }
        }
        if (this.elements.balanceInput && this.balance !== null) {
            this.elements.balanceInput.value = this.balance;
        }
    },

    // Date and time display
    startDateTime() {
        this.updateDateTime();
        // Update every second
        setInterval(() => this.updateDateTime(), 1000);
    },

    updateDateTime() {
        const now = new Date();

        // Format date: "Friday, January 17, 2025"
        const dateOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        const dateStr = now.toLocaleDateString('en-US', dateOptions);

        // Format time: "2:30 PM"
        const timeOptions = { hour: 'numeric', minute: '2-digit', hour12: true };
        const timeStr = now.toLocaleTimeString('en-US', timeOptions);

        if (this.elements.dateDisplay) {
            this.elements.dateDisplay.textContent = dateStr;
        }
        if (this.elements.timeDisplay) {
            this.elements.timeDisplay.textContent = timeStr;
        }
    },

    // Session timer and break reminders
    startSessionTimer() {
        this.sessionStartTime = Date.now();
        this.lastBreakReminder = Date.now();

        // Check every minute
        setInterval(() => this.checkBreakReminder(), 60 * 1000);
    },

    checkBreakReminder() {
        if (!this.breakRemindersEnabled) return;

        const timeSinceLastReminder = Date.now() - this.lastBreakReminder;

        if (timeSinceLastReminder >= this.breakReminderInterval) {
            this.showBreakReminder();
        }
    },

    showBreakReminder() {
        if (!this.elements.breakReminder) return;

        // Update session time display
        const sessionMinutes = Math.floor((Date.now() - this.sessionStartTime) / (1000 * 60));
        if (this.elements.sessionTimeDisplay) {
            if (sessionMinutes < 60) {
                this.elements.sessionTimeDisplay.textContent = sessionMinutes + ' minutes';
            } else {
                const hours = Math.floor(sessionMinutes / 60);
                const mins = sessionMinutes % 60;
                this.elements.sessionTimeDisplay.textContent = hours + ' hour' + (hours > 1 ? 's' : '') + (mins > 0 ? ' ' + mins + ' min' : '');
            }
        }

        this.elements.breakReminder.classList.remove('hidden');
    },

    dismissBreakReminder() {
        if (this.elements.breakReminder) {
            this.elements.breakReminder.classList.add('hidden');
        }
        this.lastBreakReminder = Date.now();
        // Reset session time on break
        this.sessionStartTime = Date.now();
    },

    snoozeBreakReminder() {
        if (this.elements.breakReminder) {
            this.elements.breakReminder.classList.add('hidden');
        }
        // Snooze for 10 minutes
        this.lastBreakReminder = Date.now() - this.breakReminderInterval + (10 * 60 * 1000);
    },

    // Duplicates detection
    async loadDuplicates() {
        try {
            const duplicates = await this.api('/api/items/duplicates');
            this.renderDuplicates(duplicates);
        } catch (error) {
            console.error('Error loading duplicates:', error);
        }
    },

    renderDuplicates(duplicates) {
        if (!this.elements.duplicatesList) return;

        // Update count badge
        if (this.elements.duplicateCount) {
            this.elements.duplicateCount.textContent = duplicates.length > 0 ? `(${duplicates.length})` : '';
            this.elements.duplicateCount.classList.toggle('has-duplicates', duplicates.length > 0);
        }

        if (duplicates.length === 0) {
            this.elements.duplicatesList.innerHTML = `
                <p class="no-duplicates">No potential duplicates found</p>
            `;
            return;
        }

        let html = '';
        for (const dup of duplicates) {
            const item1 = dup.item1;
            const item2 = dup.item2;
            const img1 = item1.image_url ? `<img src="${item1.image_url}" alt="">` : '<div class="no-img">?</div>';
            const img2 = item2.image_url ? `<img src="${item2.image_url}" alt="">` : '<div class="no-img">?</div>';
            const storeMatch = dup.same_store ? '<span class="same-store">Same store</span>' : '<span class="diff-store">Different stores</span>';

            html += `
                <div class="duplicate-pair" data-id1="${item1.id}" data-id2="${item2.id}">
                    <div class="duplicate-header">
                        <span class="similarity-badge">${dup.similarity}% match</span>
                        ${storeMatch}
                    </div>
                    <div class="duplicate-items">
                        <div class="duplicate-item">
                            ${img1}
                            <div class="duplicate-item-info">
                                <div class="duplicate-title">${this.escapeHtml(item1.title)}</div>
                                <div class="duplicate-meta">
                                    <span class="store-tag ${item1.store}">${item1.store}</span>
                                    ${item1.current_price ? '$' + item1.current_price.toFixed(2) : ''}
                                </div>
                            </div>
                        </div>
                        <div class="duplicate-vs">VS</div>
                        <div class="duplicate-item">
                            ${img2}
                            <div class="duplicate-item-info">
                                <div class="duplicate-title">${this.escapeHtml(item2.title)}</div>
                                <div class="duplicate-meta">
                                    <span class="store-tag ${item2.store}">${item2.store}</span>
                                    ${item2.current_price ? '$' + item2.current_price.toFixed(2) : ''}
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="duplicate-actions">
                        <button class="btn btn-small btn-danger delete-dup" data-id="${item2.id}" title="Remove newer item">Delete #2</button>
                        <button class="btn btn-small dismiss-dup" data-id1="${item1.id}" data-id2="${item2.id}" title="Not a duplicate">Dismiss</button>
                    </div>
                </div>
            `;
        }

        this.elements.duplicatesList.innerHTML = html;
        this.bindDuplicateEvents();
    },

    bindDuplicateEvents() {
        // Delete duplicate button
        this.elements.duplicatesList.querySelectorAll('.delete-dup').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const itemId = parseInt(btn.dataset.id);
                if (confirm('Delete this item?')) {
                    await this.api(`/api/items/${itemId}`, { method: 'DELETE' });
                    this.showToast('Item deleted');
                    await this.loadItems();
                    await this.loadDuplicates();
                    await this.loadStats();
                }
            });
        });

        // Dismiss duplicate (just removes from view for this session)
        this.elements.duplicatesList.querySelectorAll('.dismiss-dup').forEach(btn => {
            btn.addEventListener('click', () => {
                const pair = btn.closest('.duplicate-pair');
                pair.style.animation = 'slideOut 0.3s ease forwards';
                setTimeout(() => {
                    pair.remove();
                    // Update count
                    const remaining = this.elements.duplicatesList.querySelectorAll('.duplicate-pair').length;
                    if (this.elements.duplicateCount) {
                        this.elements.duplicateCount.textContent = remaining > 0 ? `(${remaining})` : '';
                        this.elements.duplicateCount.classList.toggle('has-duplicates', remaining > 0);
                    }
                    if (remaining === 0) {
                        this.elements.duplicatesList.innerHTML = '<p class="no-duplicates">No potential duplicates found</p>';
                    }
                }, 300);
            });
        });
    },

    // Toast notification
    showToast(message, type = 'success') {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        document.body.appendChild(toast);

        // Trigger animation
        setTimeout(() => toast.classList.add('show'), 10);

        // Remove after 2 seconds
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 2000);
    },

    // Format relative time
    formatRelativeTime(dateString) {
        if (!dateString) return '';
        const date = new Date(dateString);
        const now = new Date();
        const diffMs = now - date;
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

        if (diffDays === 0) return 'Today';
        if (diffDays === 1) return 'Yesterday';
        if (diffDays < 7) return diffDays + ' days ago';
        if (diffDays < 30) return Math.floor(diffDays / 7) + ' weeks ago';
        if (diffDays < 365) return Math.floor(diffDays / 30) + ' months ago';
        return Math.floor(diffDays / 365) + ' years ago';
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
            const selected = this.currentList === list.id ? 'selected' : '';
            html += `<option value="${list.id}" ${selected}>${list.name}</option>`;
        }
        this.elements.listSelect.innerHTML = html;
    },

    // Render form selects
    renderFormSelects() {
        // Categories for add item
        let catHtml = '';
        for (const cat of this.categories) {
            catHtml += `<option value="${cat.id}">${cat.name}</option>`;
        }
        this.elements.itemCategory.innerHTML = catHtml;

        // Lists for add item
        let listHtml = '';
        for (const list of this.lists) {
            listHtml += `<option value="${list.id}">${list.name}</option>`;
        }
        this.elements.itemList.innerHTML = listHtml;

        // Edit item selects
        if (this.elements.editItemCategory) {
            this.elements.editItemCategory.innerHTML = catHtml;
        }
        if (this.elements.editItemList) {
            this.elements.editItemList.innerHTML = listHtml;
        }
    },

    // Render items grid
    renderItems() {
        this.elements.readyToBuySection.classList.add('hidden');
        this.elements.itemsGrid.classList.remove('hidden');

        // Apply view mode class
        this.applyViewMode();

        const filteredItems = this.getFilteredItems();

        if (this.items.length === 0) {
            this.elements.itemsGrid.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">&#128722;</div>
                    <h3>No items here yet!</h3>
                    <p>Use the Chrome extension to import items from Temu or Amazon, or tap the + button to add manually.</p>
                </div>
            `;
            return;
        }

        if (filteredItems.length === 0 && this.searchQuery) {
            this.elements.itemsGrid.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">&#128269;</div>
                    <h3>No matches found</h3>
                    <p>Try a different search term or <button class="btn-link" onclick="App.clearSearch()">clear the search</button>.</p>
                </div>
            `;
            return;
        }

        let html = '';
        for (const item of filteredItems) {
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

        // Price change indicator
        let priceChangeHtml = '';
        if (item.current_price !== null && item.original_price !== null && item.original_price > 0) {
            const priceDiff = item.current_price - item.original_price;
            const percentChange = ((priceDiff / item.original_price) * 100).toFixed(0);

            if (priceDiff < -0.01) {
                // Price dropped
                const savings = Math.abs(priceDiff).toFixed(2);
                priceChangeHtml = `<span class="price-change price-down" title="Was $${item.original_price.toFixed(2)}">-$${savings} (${Math.abs(percentChange)}% off)</span>`;
            } else if (priceDiff > 0.01) {
                // Price increased
                priceChangeHtml = `<span class="price-change price-up" title="Was $${item.original_price.toFixed(2)}">+${percentChange}%</span>`;
            }
        }

        const price = item.current_price !== null
            ? `${item.currency || '$'}${item.current_price.toFixed(2)}`
            : 'No price';

        const checked = item.in_ready_to_buy ? 'checked' : '';
        const favoriteActive = item.is_favorite ? 'active' : '';
        const favoriteIcon = item.is_favorite ? '&#10084;' : '&#9825;';

        // Notes indicator
        const notesHtml = item.notes
            ? `<span class="notes-indicator" title="${this.escapeHtml(item.notes)}">&#128221; ${this.escapeHtml(item.notes)}</span>`
            : '';

        // Item age badge
        const itemAge = this.formatRelativeTime(item.date_added);
        const ageBadge = itemAge ? `<span class="age-badge" title="Added ${itemAge}">${itemAge}</span>` : '';

        // Quick quantity controls
        const qty = item.quantity || 1;
        const qtyControls = `
            <div class="qty-controls">
                <button class="qty-btn qty-minus" data-id="${item.id}" title="Decrease quantity">-</button>
                <span class="qty-value">${qty}</span>
                <button class="qty-btn qty-plus" data-id="${item.id}" title="Increase quantity">+</button>
            </div>
        `;

        return `
            <div class="item-card" data-id="${item.id}" draggable="true">
                <div class="item-image-container">
                    ${imageHtml}
                    <button class="favorite-btn ${favoriteActive}" data-id="${item.id}" title="Favorite">${favoriteIcon}</button>
                    <button class="edit-btn" data-id="${item.id}" title="Edit">&#9998;</button>
                    <span class="store-badge ${storeClass}">${storeName}</span>
                    ${indicators ? `<div class="item-indicators">${indicators}</div>` : ''}
                    ${ageBadge}
                    ${notesHtml}
                </div>
                <div class="item-details">
                    <h3 class="item-title" title="${this.escapeHtml(item.title)}">${this.escapeHtml(item.title)}</h3>
                    <div class="item-price-row">
                        <div class="price-container">
                            <span class="item-price">${price}</span>
                            ${priceChangeHtml}
                        </div>
                        ${qtyControls}
                        <input type="checkbox" class="item-checkbox" data-id="${item.id}" ${checked} title="Add to cart">
                    </div>
                </div>
            </div>
        `;
    },

    // Bind item events (checkboxes, drag and drop, edit, favorites)
    bindItemEvents() {
        // Checkboxes
        this.elements.itemsGrid.querySelectorAll('.item-checkbox').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                const itemId = parseInt(e.target.dataset.id);
                this.toggleReadyToBuy(itemId, e.target.checked);
            });
        });

        // Favorite buttons
        this.elements.itemsGrid.querySelectorAll('.favorite-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const itemId = parseInt(btn.dataset.id);
                this.toggleFavorite(itemId, btn);
            });
        });

        // Edit buttons
        this.elements.itemsGrid.querySelectorAll('.edit-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const itemId = parseInt(btn.dataset.id);
                this.showEditItemModal(itemId);
            });
        });

        // Quick quantity buttons
        this.elements.itemsGrid.querySelectorAll('.qty-minus').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const itemId = parseInt(btn.dataset.id);
                this.adjustQuantity(itemId, -1);
            });
        });

        this.elements.itemsGrid.querySelectorAll('.qty-plus').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const itemId = parseInt(btn.dataset.id);
                this.adjustQuantity(itemId, 1);
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

    // Toggle favorite
    async toggleFavorite(itemId, btn) {
        const item = this.items.find(i => i.id === itemId);
        if (!item) return;

        const newValue = !item.is_favorite;

        // Optimistic UI update
        btn.classList.toggle('active', newValue);
        btn.innerHTML = newValue ? '&#10084;' : '&#9825;';

        await this.api(`/api/items/${itemId}`, {
            method: 'PATCH',
            body: JSON.stringify({ is_favorite: newValue ? 1 : 0 }),
        });

        // Update local state
        item.is_favorite = newValue;
        await this.loadStats();
    },

    // Adjust item quantity
    async adjustQuantity(itemId, delta) {
        const item = this.items.find(i => i.id === itemId);
        if (!item) return;

        const newQty = Math.max(1, (item.quantity || 1) + delta);

        // Update local state immediately for responsive UI
        item.quantity = newQty;

        // Update display
        const card = this.elements.itemsGrid.querySelector(`.item-card[data-id="${itemId}"]`);
        if (card) {
            const qtyDisplay = card.querySelector('.qty-value');
            if (qtyDisplay) {
                qtyDisplay.textContent = newQty;
                qtyDisplay.classList.add('qty-changed');
                setTimeout(() => qtyDisplay.classList.remove('qty-changed'), 200);
            }
        }

        // Save to server
        await this.api(`/api/items/${itemId}`, {
            method: 'PATCH',
            body: JSON.stringify({ quantity: newQty }),
        });

        await this.loadStats();
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

        // Update ready count in tab and stats
        await this.renderCategoryTabs();
        await this.loadStats();
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
                    <div class="empty-state-icon">&#128722;</div>
                    <h3>Your cart is empty!</h3>
                    <p>Tap the checkbox on items you want to buy. They'll appear here ready for checkout.</p>
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

                // Price change indicator for ready-to-buy list
                let priceIndicator = '';
                if (item.original_price !== null && item.original_price > 0) {
                    const priceDiff = price - item.original_price;
                    if (priceDiff < -0.01) {
                        const savings = Math.abs(priceDiff).toFixed(2);
                        priceIndicator = `<span class="price-change price-down">Save $${savings}</span>`;
                    } else if (priceDiff > 0.01) {
                        const increase = priceDiff.toFixed(2);
                        priceIndicator = `<span class="price-change price-up">+$${increase}</span>`;
                    }
                }

                html += `
                    <div class="ready-item">
                        <input type="checkbox" class="item-checkbox" data-id="${item.id}" checked>
                        ${imgHtml}
                        <div class="ready-item-details">
                            <div class="ready-item-title">${this.escapeHtml(item.title)}</div>
                            <div class="ready-item-price">
                                <span>$${price.toFixed(2)} x ${qty}</span>
                                <span>= $${total}</span>
                                ${priceIndicator}
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
            await this.loadStats();
        } catch (error) {
            alert('Error adding item: ' + error.message);
        }
    },

    // Category Management
    showManageCategoriesModal() {
        this.elements.manageCategoriesModal.classList.remove('hidden');
        this.renderCategoriesList();
    },

    renderCategoriesList() {
        let html = '';
        for (const cat of this.categories) {
            const isDefault = cat.is_default ? 'is-default' : '';
            const deleteDisabled = cat.is_default ? 'disabled' : '';

            html += `
                <div class="sortable-item ${isDefault}" data-id="${cat.id}" draggable="true">
                    <span class="drag-handle">&#9776;</span>
                    <span class="item-name">${this.escapeHtml(cat.name)}</span>
                    <div class="item-actions">
                        <button class="btn-icon-small rename-btn" data-id="${cat.id}" title="Rename">&#9998;</button>
                        <button class="btn-icon-small delete ${deleteDisabled}" data-id="${cat.id}" title="Delete" ${deleteDisabled}>&#10005;</button>
                    </div>
                </div>
            `;
        }
        this.elements.categoriesList.innerHTML = html;
        this.bindCategoryListEvents();
    },

    bindCategoryListEvents() {
        // Rename buttons
        this.elements.categoriesList.querySelectorAll('.rename-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = parseInt(btn.dataset.id);
                this.renameCategory(id);
            });
        });

        // Delete buttons
        this.elements.categoriesList.querySelectorAll('.delete:not([disabled])').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = parseInt(btn.dataset.id);
                this.deleteCategory(id);
            });
        });

        // Drag and drop for reordering
        const items = this.elements.categoriesList.querySelectorAll('.sortable-item');
        items.forEach(item => {
            item.addEventListener('dragstart', (e) => {
                item.classList.add('dragging');
                e.dataTransfer.setData('text/plain', item.dataset.id);
            });
            item.addEventListener('dragend', () => {
                item.classList.remove('dragging');
                this.saveCategoryPositions();
            });
            item.addEventListener('dragover', (e) => {
                e.preventDefault();
                const dragging = this.elements.categoriesList.querySelector('.dragging');
                if (dragging && item !== dragging) {
                    const rect = item.getBoundingClientRect();
                    const midY = rect.top + rect.height / 2;
                    if (e.clientY < midY) {
                        item.parentNode.insertBefore(dragging, item);
                    } else {
                        item.parentNode.insertBefore(dragging, item.nextSibling);
                    }
                }
            });
        });
    },

    async addCategory() {
        const name = this.elements.newCategoryName.value.trim();
        if (!name) return;

        try {
            await this.api('/api/categories', {
                method: 'POST',
                body: JSON.stringify({ name }),
            });

            this.elements.newCategoryName.value = '';
            this.categories = await this.api('/api/categories');
            this.renderCategoriesList();
            this.renderCategoryTabs();
            this.renderFormSelects();
        } catch (error) {
            alert('Error adding category');
        }
    },

    async renameCategory(id) {
        const cat = this.categories.find(c => c.id === id);
        if (!cat) return;

        const newName = prompt('Enter new name:', cat.name);
        if (!newName || newName === cat.name) return;

        try {
            await this.api(`/api/categories/${id}`, {
                method: 'PATCH',
                body: JSON.stringify({ name: newName }),
            });

            this.categories = await this.api('/api/categories');
            this.renderCategoriesList();
            this.renderCategoryTabs();
            this.renderFormSelects();
        } catch (error) {
            alert('Error renaming category');
        }
    },

    async deleteCategory(id) {
        const cat = this.categories.find(c => c.id === id);
        if (!cat || cat.is_default) return;

        if (!confirm(`Delete "${cat.name}"? Items will be moved to Unsorted.`)) return;

        try {
            await this.api(`/api/categories/${id}`, {
                method: 'DELETE',
            });

            this.categories = await this.api('/api/categories');
            this.renderCategoriesList();
            this.renderCategoryTabs();
            this.renderFormSelects();
            this.loadItems();
        } catch (error) {
            alert('Error deleting category');
        }
    },

    async saveCategoryPositions() {
        const items = this.elements.categoriesList.querySelectorAll('.sortable-item');
        const positions = {};

        items.forEach((item, index) => {
            positions[item.dataset.id] = index;
        });

        await this.api('/api/categories/reorder', {
            method: 'POST',
            body: JSON.stringify({ positions }),
        });

        this.categories = await this.api('/api/categories');
        this.renderCategoryTabs();
    },

    // List Management
    showManageListsModal() {
        this.elements.manageListsModal.classList.remove('hidden');
        this.renderListsList();
    },

    renderListsList() {
        let html = '';
        for (const list of this.lists) {
            const isDefault = list.is_default ? 'is-default' : '';
            const deleteDisabled = list.is_default ? 'disabled' : '';

            html += `
                <div class="sortable-item ${isDefault}" data-id="${list.id}" draggable="true">
                    <span class="drag-handle">&#9776;</span>
                    <span class="item-name">${this.escapeHtml(list.name)}</span>
                    <div class="item-actions">
                        <button class="btn-icon-small rename-btn" data-id="${list.id}" title="Rename">&#9998;</button>
                        <button class="btn-icon-small delete ${deleteDisabled}" data-id="${list.id}" title="Delete" ${deleteDisabled}>&#10005;</button>
                    </div>
                </div>
            `;
        }
        this.elements.listsList.innerHTML = html;
        this.bindListsListEvents();
    },

    bindListsListEvents() {
        // Rename buttons
        this.elements.listsList.querySelectorAll('.rename-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = parseInt(btn.dataset.id);
                this.renameList(id);
            });
        });

        // Delete buttons
        this.elements.listsList.querySelectorAll('.delete:not([disabled])').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = parseInt(btn.dataset.id);
                this.deleteList(id);
            });
        });

        // Drag and drop for reordering
        const items = this.elements.listsList.querySelectorAll('.sortable-item');
        items.forEach(item => {
            item.addEventListener('dragstart', (e) => {
                item.classList.add('dragging');
                e.dataTransfer.setData('text/plain', item.dataset.id);
            });
            item.addEventListener('dragend', () => {
                item.classList.remove('dragging');
                this.saveListPositions();
            });
            item.addEventListener('dragover', (e) => {
                e.preventDefault();
                const dragging = this.elements.listsList.querySelector('.dragging');
                if (dragging && item !== dragging) {
                    const rect = item.getBoundingClientRect();
                    const midY = rect.top + rect.height / 2;
                    if (e.clientY < midY) {
                        item.parentNode.insertBefore(dragging, item);
                    } else {
                        item.parentNode.insertBefore(dragging, item.nextSibling);
                    }
                }
            });
        });
    },

    async addList() {
        const name = this.elements.newListName.value.trim();
        if (!name) return;

        try {
            await this.api('/api/lists', {
                method: 'POST',
                body: JSON.stringify({ name }),
            });

            this.elements.newListName.value = '';
            this.lists = await this.api('/api/lists');
            this.renderListsList();
            this.renderListDropdown();
            this.renderFormSelects();
        } catch (error) {
            alert('Error adding list');
        }
    },

    async renameList(id) {
        const list = this.lists.find(l => l.id === id);
        if (!list) return;

        const newName = prompt('Enter new name:', list.name);
        if (!newName || newName === list.name) return;

        try {
            await this.api(`/api/lists/${id}`, {
                method: 'PATCH',
                body: JSON.stringify({ name: newName }),
            });

            this.lists = await this.api('/api/lists');
            this.renderListsList();
            this.renderListDropdown();
            this.renderFormSelects();
        } catch (error) {
            alert('Error renaming list');
        }
    },

    async deleteList(id) {
        const list = this.lists.find(l => l.id === id);
        if (!list || list.is_default) return;

        if (!confirm(`Delete "${list.name}"? Items will be moved to Main List.`)) return;

        try {
            await this.api(`/api/lists/${id}`, {
                method: 'DELETE',
            });

            this.lists = await this.api('/api/lists');
            this.renderListsList();
            this.renderListDropdown();
            this.renderFormSelects();

            // Reset filter if deleted list was selected
            if (this.currentList === id) {
                this.currentList = null;
            }
            this.loadItems();
        } catch (error) {
            alert('Error deleting list');
        }
    },

    async saveListPositions() {
        const items = this.elements.listsList.querySelectorAll('.sortable-item');
        const positions = {};

        items.forEach((item, index) => {
            positions[item.dataset.id] = index;
        });

        await this.api('/api/lists/reorder', {
            method: 'POST',
            body: JSON.stringify({ positions }),
        });

        this.lists = await this.api('/api/lists');
        this.renderListDropdown();
    },

    // Edit Item Modal
    showEditItemModal(itemId) {
        const item = this.items.find(i => i.id === itemId);
        if (!item) return;

        this.elements.editItemId.value = item.id;
        this.elements.editItemCategory.value = item.category_id;
        this.elements.editItemList.value = item.list_id;
        this.elements.editItemQuantity.value = item.quantity || 1;
        if (this.elements.editItemNotes) {
            this.elements.editItemNotes.value = item.notes || '';
        }

        this.elements.editItemModal.classList.remove('hidden');
    },

    async saveItemEdit() {
        const itemId = parseInt(this.elements.editItemId.value);
        const updates = {
            category_id: parseInt(this.elements.editItemCategory.value),
            list_id: parseInt(this.elements.editItemList.value),
            quantity: parseInt(this.elements.editItemQuantity.value) || 1,
        };

        if (this.elements.editItemNotes) {
            updates.notes = this.elements.editItemNotes.value || null;
        }

        try {
            await this.api(`/api/items/${itemId}`, {
                method: 'PATCH',
                body: JSON.stringify(updates),
            });

            this.elements.editItemModal.classList.add('hidden');
            await this.loadItems();
        } catch (error) {
            alert('Error updating item');
        }
    },

    async deleteItem() {
        const itemId = parseInt(this.elements.editItemId.value);
        if (!confirm('Delete this item?')) return;

        try {
            await this.api(`/api/items/${itemId}`, {
                method: 'DELETE',
            });

            this.elements.editItemModal.classList.add('hidden');
            await this.loadItems();
            await this.renderCategoryTabs();
            await this.loadStats();
        } catch (error) {
            alert('Error deleting item');
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
