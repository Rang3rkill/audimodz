// Admin Console - Judi's Wishlist
// Dedicated admin page for data management, diagnostics, and bulk operations

const Admin = {
    items: [],
    categories: [],
    lists: [],
    stats: {},

    elements: {},

    async init() {
        this.cacheElements();
        this.bindEvents();
        await this.loadData();
        this.render();
    },

    cacheElements() {
        this.elements = {
            // Stats
            statTotalItems: document.getElementById('adminStatTotalItems'),
            statTotalValue: document.getElementById('adminStatTotalValue'),
            statReadyToBuy: document.getElementById('adminStatReadyToBuy'),
            statReadyValue: document.getElementById('adminStatReadyValue'),
            statRecentlyAdded: document.getElementById('adminStatRecentlyAdded'),
            statFavorites: document.getElementById('adminStatFavorites'),
            statOldestItem: document.getElementById('adminStatOldestItem'),
            statPriceDrops: document.getElementById('adminStatPriceDrops'),
            storeStats: document.getElementById('adminStoreStats'),
            // Actions
            refreshMissing: document.getElementById('adminRefreshMissing'),
            refreshPictures: document.getElementById('adminRefreshPictures'),
            cleanBadImages: document.getElementById('adminCleanBadImages'),
            refreshPrices: document.getElementById('adminRefreshPrices'),
            refreshAll: document.getElementById('adminRefreshAll'),
            refreshAllProgress: document.getElementById('refreshAllProgress'),
            refreshAllBar: document.getElementById('refreshAllBar'),
            refreshAllText: document.getElementById('refreshAllText'),
            manageCategories: document.getElementById('adminManageCategories'),
            manageLists: document.getElementById('adminManageLists'),
            exportData: document.getElementById('adminExportData'),
            priceCheck: document.getElementById('adminPriceCheck'),
            autoCategories: document.getElementById('adminAutoCategories'),
            // Missing data
            missingCount: document.getElementById('adminMissingCount'),
            missingDataList: document.getElementById('adminMissingDataList'),
            // Duplicates
            duplicateCount: document.getElementById('adminDuplicateCount'),
            duplicatesList: document.getElementById('adminDuplicatesList'),
            // Modals
            manageCategoriesModal: document.getElementById('manageCategoriesModal'),
            manageListsModal: document.getElementById('manageListsModal'),
            categoriesList: document.getElementById('categoriesList'),
            listsList: document.getElementById('listsList'),
            newCategoryName: document.getElementById('newCategoryName'),
            newListName: document.getElementById('newListName'),
            addCategoryBtn: document.getElementById('addCategoryBtn'),
            addListBtn: document.getElementById('addListBtn'),
            // Confirm delete
            confirmDeleteModal: document.getElementById('confirmDeleteModal'),
            confirmDeleteMessage: document.getElementById('confirmDeleteMessage'),
            confirmDeleteCancel: document.getElementById('confirmDeleteCancel'),
            confirmDeleteConfirm: document.getElementById('confirmDeleteConfirm'),
            // Status
            status: document.getElementById('adminStatus'),
        };
    },

    bindEvents() {
        // Data tools
        this.elements.refreshMissing?.addEventListener('click', () => this.refreshAllMissingData());
        this.elements.refreshPictures?.addEventListener('click', () => this.bulkRefreshPictures());
        this.elements.cleanBadImages?.addEventListener('click', () => this.cleanBadImages());
        this.elements.refreshPrices?.addEventListener('click', () => this.bulkRefreshPrices());
        this.elements.refreshAll?.addEventListener('click', () => this.refreshAllData());

        // Manage
        this.elements.manageCategories?.addEventListener('click', () => this.showManageCategoriesModal());
        this.elements.manageLists?.addEventListener('click', () => this.showManageListsModal());
        this.elements.exportData?.addEventListener('click', () => this.exportData());
        this.elements.priceCheck?.addEventListener('click', () => this.checkPrices());
        this.elements.autoCategories?.addEventListener('click', () => this.autoCategories());

        // Category/list add
        this.elements.addCategoryBtn?.addEventListener('click', () => this.addCategory());
        this.elements.newCategoryName?.addEventListener('keypress', (e) => { if (e.key === 'Enter') this.addCategory(); });
        this.elements.addListBtn?.addEventListener('click', () => this.addList());
        this.elements.newListName?.addEventListener('keypress', (e) => { if (e.key === 'Enter') this.addList(); });

        // Close buttons
        document.querySelectorAll('[data-close]').forEach(btn => {
            btn.addEventListener('click', () => {
                document.getElementById(btn.dataset.close)?.classList.add('hidden');
            });
        });

        // Modal backdrop clicks
        [this.elements.manageCategoriesModal, this.elements.manageListsModal].forEach(modal => {
            modal?.addEventListener('click', (e) => {
                if (e.target === modal) modal.classList.add('hidden');
            });
        });
    },

    // API helper
    async api(endpoint, options = {}) {
        const response = await fetch(endpoint, {
            headers: { 'Content-Type': 'application/json' },
            ...options,
        });
        return response.json();
    },

    async loadData() {
        const [categories, lists, items, stats] = await Promise.all([
            this.api('/api/categories'),
            this.api('/api/lists'),
            this.api('/api/items'),
            this.api('/api/items/stats'),
        ]);
        this.categories = categories;
        this.lists = lists;
        this.items = items;
        this.stats = stats;
    },

    render() {
        this.renderStats();
        this.renderMissingData();
        this.loadDuplicates();
    },

    // ==========================================
    // STATS
    // ==========================================

    renderStats() {
        if (!this.stats) return;

        const s = this.stats;
        this.setText('statTotalItems', s.total_items || 0);
        this.setText('statTotalValue', '$' + (s.total_value || 0).toFixed(2));
        this.setText('statReadyToBuy', s.ready_to_buy || 0);
        this.setText('statReadyValue', '$' + (s.ready_to_buy_value || 0).toFixed(2));
        this.setText('statRecentlyAdded', (s.recently_added || 0) + ' items');
        this.setText('statFavorites', (s.favorites || 0) + ' items');
        this.setText('statOldestItem', s.oldest_item_age || '-');
        this.setText('statPriceDrops', (s.price_drops || 0) + ' items');

        // Store stats
        if (this.elements.storeStats && s.by_store) {
            const storeConfig = { temu: { name: 'Temu', icon: 'T' }, amazon: { name: 'Amazon', icon: 'A' } };
            let html = '';
            for (const [store, data] of Object.entries(s.by_store)) {
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

    setText(key, value) {
        if (this.elements[key]) this.elements[key].textContent = value;
    },

    // ==========================================
    // MISSING DATA
    // ==========================================

    renderMissingData() {
        if (!this.elements.missingDataList) return;

        const missingItems = this.items.filter(item => !item.image_url || item.current_price === null);

        if (this.elements.missingCount) {
            this.elements.missingCount.textContent = missingItems.length > 0 ? `(${missingItems.length})` : '';
            this.elements.missingCount.classList.toggle('has-missing', missingItems.length > 0);
        }

        if (missingItems.length === 0) {
            this.elements.missingDataList.innerHTML = '<p class="no-missing">All items have complete data!</p>';
            return;
        }

        const itemsToShow = missingItems.slice(0, 30);
        let html = '';
        for (const item of itemsToShow) {
            const storeBadge = item.store.charAt(0).toUpperCase() + item.store.slice(1);
            const missingWhat = [];
            if (!item.image_url) missingWhat.push('image');
            if (item.current_price === null) missingWhat.push('price');

            html += `
                <div class="missing-item" data-id="${item.id}">
                    <div class="missing-item-placeholder">?</div>
                    <div class="missing-item-info">
                        <div class="missing-item-title">${this.escapeHtml(item.title)}</div>
                        <div class="missing-item-meta">
                            <span class="missing-item-store">${storeBadge}</span>
                            <span class="missing-what">Missing: ${missingWhat.join(', ')}</span>
                        </div>
                    </div>
                    <button class="missing-item-refresh" data-id="${item.id}" title="Fetch data from product page">&#8635;</button>
                    ${item.product_url ? `<a href="${item.product_url}" target="_blank" class="missing-item-link">View</a>` : ''}
                </div>
            `;
        }

        if (missingItems.length > 30) {
            html += `<p style="text-align:center;color:var(--text-muted);font-size:13px;">...and ${missingItems.length - 30} more</p>`;
        }

        this.elements.missingDataList.innerHTML = html;

        // Bind refresh buttons
        this.elements.missingDataList.querySelectorAll('.missing-item-refresh').forEach(btn => {
            btn.addEventListener('click', async () => {
                const itemId = parseInt(btn.dataset.id);
                btn.innerHTML = '&#8987;';
                btn.disabled = true;
                try {
                    const result = await this.api(`/api/items/${itemId}/refresh`, { method: 'POST' });
                    if (result.success && result.updated_fields.length > 0) {
                        const item = this.items.find(i => i.id === itemId);
                        if (item && result.item) Object.assign(item, result.item);
                        this.renderMissingData();
                        this.showToast(`Updated: ${result.updated_fields.join(', ')}`, 'success');
                    } else {
                        this.showToast('No data found', 'warning');
                        btn.innerHTML = '&#8635;';
                        btn.disabled = false;
                    }
                } catch {
                    this.showToast('Refresh failed', 'error');
                    btn.innerHTML = '&#8635;';
                    btn.disabled = false;
                }
            });
        });
    },

    // ==========================================
    // DUPLICATES
    // ==========================================

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

        if (this.elements.duplicateCount) {
            this.elements.duplicateCount.textContent = duplicates.length > 0 ? `(${duplicates.length})` : '';
            this.elements.duplicateCount.classList.toggle('has-duplicates', duplicates.length > 0);
        }

        if (duplicates.length === 0) {
            this.elements.duplicatesList.innerHTML = '<p class="no-duplicates">No potential duplicates found</p>';
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
                        <button class="btn btn-small btn-danger delete-dup" data-id="${item2.id}">Delete #2</button>
                        <button class="btn btn-small dismiss-dup" data-id1="${item1.id}" data-id2="${item2.id}">Dismiss</button>
                    </div>
                </div>
            `;
        }

        this.elements.duplicatesList.innerHTML = html;
        this.bindDuplicateEvents();
    },

    bindDuplicateEvents() {
        this.elements.duplicatesList.querySelectorAll('.delete-dup').forEach(btn => {
            btn.addEventListener('click', async () => {
                const itemId = parseInt(btn.dataset.id);
                if (confirm('Delete this item?')) {
                    await this.api(`/api/items/${itemId}`, { method: 'DELETE' });
                    this.showToast('Item deleted');
                    this.items = await this.api('/api/items');
                    this.stats = await this.api('/api/items/stats');
                    this.renderStats();
                    this.renderMissingData();
                    await this.loadDuplicates();
                }
            });
        });

        this.elements.duplicatesList.querySelectorAll('.dismiss-dup').forEach(btn => {
            btn.addEventListener('click', () => {
                const pair = btn.closest('.duplicate-pair');
                pair.style.animation = 'slideOut 0.3s ease forwards';
                setTimeout(() => {
                    pair.remove();
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

    // ==========================================
    // BULK OPERATIONS
    // ==========================================

    async refreshAllMissingData() {
        const btn = this.elements.refreshMissing;
        if (!btn) return;

        let missingCount = 0;
        try {
            const stats = await this.api('/api/items/stats');
            missingCount = stats.missing_any || 0;
        } catch {
            missingCount = this.items.filter(i => !i.image_url || i.current_price === null).length;
        }

        if (missingCount === 0) {
            this.showToast('All items have complete data!', 'success');
            return;
        }

        if (!confirm(`${missingCount} items have missing or bad data.\n\nThis will attempt to refresh prices and fill in missing images.\n\nContinue?`)) return;

        const originalHtml = btn.innerHTML;
        btn.innerHTML = '<span>&#8987;</span> Refreshing...';
        btn.disabled = true;

        try {
            const result = await this.api('/api/items/refresh-missing', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ limit: 50 })
            });

            this.items = await this.api('/api/items');
            this.stats = await this.api('/api/items/stats');
            this.renderStats();
            this.renderMissingData();

            if (result.refreshed > 0) {
                this.showToast(`Updated ${result.refreshed} items, ${result.failed} failed`, 'success');
            } else {
                this.showToast('Could not find new data for any items', 'warning');
            }
        } catch (error) {
            this.showToast('Failed to refresh items', 'error');
        } finally {
            btn.innerHTML = originalHtml;
            btn.disabled = false;
        }
    },

    async bulkRefreshPictures() {
        const btn = this.elements.refreshPictures;
        if (!btn) return;

        const totalWithUrl = this.items.filter(i => i.product_url).length;
        if (totalWithUrl === 0) {
            this.showToast('No items with product URLs to refresh', 'warning');
            return;
        }

        if (!confirm(`Refresh pictures for ${totalWithUrl} items?\n\nThis will process all items in batches.\n\nContinue?`)) return;

        const originalHtml = btn.innerHTML;
        btn.disabled = true;

        let totalRefreshed = 0, totalFailed = 0, totalProcessed = 0;
        let remaining = totalWithUrl, batch = 0;
        const BATCH_SIZE = 20;

        try {
            while (remaining > 0) {
                batch++;
                btn.innerHTML = `<span>&#8987;</span> Batch ${batch} (${totalProcessed}/${totalWithUrl})...`;

                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 120000);

                let result;
                try {
                    const response = await fetch('/api/items/refresh-pictures', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ limit: BATCH_SIZE, offset: totalProcessed }),
                        signal: controller.signal,
                    });
                    result = await response.json();
                } catch (e) {
                    clearTimeout(timeoutId);
                    if (e.name === 'AbortError') {
                        this.showToast(`Batch ${batch} timed out - Temu may be rate-limiting`, 'warning');
                        break;
                    }
                    throw e;
                }
                clearTimeout(timeoutId);

                totalRefreshed += result.refreshed || 0;
                totalFailed += result.failed || 0;
                totalProcessed += result.processed || 0;
                remaining = (result.total || 0) - totalProcessed;

                if ((result.processed || 0) === 0) break;
                if (remaining > 0) await new Promise(r => setTimeout(r, 1000));
            }

            this.items = await this.api('/api/items');
            this.renderMissingData();

            if (totalRefreshed > 0) {
                this.showToast(`Updated ${totalRefreshed} pictures across ${batch} batches`, 'success');
            } else {
                this.showToast(`All ${totalProcessed} pictures checked - no updates found`, 'info');
            }
        } catch (error) {
            this.showToast(`Error on batch ${batch}: ${error.message}`, 'error');
        } finally {
            btn.innerHTML = originalHtml;
            btn.disabled = false;
        }
    },

    async cleanBadImages() {
        const btn = this.elements.cleanBadImages;
        if (!btn) return;

        if (!confirm('This will:\n\n1. Find images shared by 3+ items (generic placeholders) and clear them\n2. Restore correct images from the Chrome extension where available\n\nContinue?')) return;

        const originalHtml = btn.innerHTML;
        btn.innerHTML = '<span>&#8987;</span> Cleaning...';
        btn.disabled = true;

        try {
            const result = await this.api('/api/items/clean-bad-images', { method: 'POST' });

            this.items = await this.api('/api/items');
            this.renderMissingData();

            const msg = `Cleaned ${result.cleared} bad images, restored ${result.restored_from_extension} from extension.`;
            this.showToast(msg, result.cleared > 0 || result.restored_from_extension > 0 ? 'success' : 'info');
        } catch (error) {
            this.showToast('Failed to clean bad images', 'error');
        } finally {
            btn.innerHTML = originalHtml;
            btn.disabled = false;
        }
    },

    async bulkRefreshPrices() {
        const btn = this.elements.refreshPrices;
        if (!btn) return;

        const totalWithUrl = this.items.filter(i => i.product_url).length;
        if (totalWithUrl === 0) {
            this.showToast('No items with product URLs to check', 'warning');
            return;
        }

        if (!confirm(`Check prices for ${totalWithUrl} items?\n\nThis will process items in batches.`)) return;

        const originalHtml = btn.innerHTML;
        btn.disabled = true;

        let totalChecked = 0, totalUpdated = 0, totalDrops = 0, totalIncreases = 0, totalFailed = 0;
        let batch = 0, remaining = totalWithUrl;
        const BATCH_SIZE = 20;

        try {
            while (remaining > 0) {
                batch++;
                btn.innerHTML = `<span>&#8987;</span> Batch ${batch} (${totalChecked}/${totalWithUrl})...`;

                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 120000);

                let result;
                try {
                    const response = await fetch('/api/items/price-check', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ limit: BATCH_SIZE }),
                        signal: controller.signal,
                    });
                    result = await response.json();
                } catch (e) {
                    clearTimeout(timeoutId);
                    if (e.name === 'AbortError') {
                        this.showToast(`Batch ${batch} timed out - Temu may be rate-limiting`, 'warning');
                        break;
                    }
                    throw e;
                }
                clearTimeout(timeoutId);

                totalChecked += result.checked || 0;
                totalUpdated += result.updated || 0;
                totalDrops += result.price_drops || 0;
                totalIncreases += result.price_increases || 0;
                totalFailed += result.failed || 0;
                remaining = totalWithUrl - totalChecked - totalFailed;

                if ((result.checked || 0) === 0 && (result.failed || 0) === 0) break;
                if (remaining > 0) await new Promise(r => setTimeout(r, 1000));
            }

            this.items = await this.api('/api/items');
            this.stats = await this.api('/api/items/stats');
            this.renderStats();

            if (totalUpdated > 0) {
                this.showToast(`Checked ${totalChecked}: ${totalDrops} drops, ${totalIncreases} increases`, 'success');
            } else {
                this.showToast(`Checked ${totalChecked} prices - no changes found`, 'info');
            }
        } catch (error) {
            this.showToast(`Price check error on batch ${batch}: ${error.message}`, 'error');
        } finally {
            btn.innerHTML = originalHtml;
            btn.disabled = false;
        }
    },

    async refreshAllData() {
        const btn = this.elements.refreshAll;
        if (!btn) return;

        const totalWithUrl = this.items.filter(i => i.product_url).length;
        if (totalWithUrl === 0) {
            this.showToast('No items with product URLs', 'warning');
            return;
        }

        if (!confirm(`Refresh ALL ${totalWithUrl} items by scraping each product page?\n\nThis will take a while (~1 second per item) but runs in the background.\nYou can close this page and come back to check progress.\n\nContinue?`)) return;

        const originalHtml = btn.innerHTML;
        btn.disabled = true;

        const progress = this.elements.refreshAllProgress;
        const bar = this.elements.refreshAllBar;
        const text = this.elements.refreshAllText;

        try {
            // Start the background refresh
            const startResult = await this.api('/api/items/refresh-all', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ force_images: false }),
            });

            if (startResult.error) {
                this.showToast(startResult.error, 'error');
                return;
            }

            // Show progress bar
            progress.classList.remove('hidden');

            // Poll for status
            const poll = async () => {
                try {
                    const status = await this.api('/api/items/refresh-all/status');
                    const pct = status.total > 0 ? Math.round((status.processed / status.total) * 100) : 0;
                    bar.style.width = `${pct}%`;
                    text.textContent = `${status.processed}/${status.total} processed — ${status.updated} updated, ${status.failed} failed${status.current_item ? ' — ' + status.current_item : ''}`;

                    if (status.running) {
                        setTimeout(poll, 2000);
                    } else {
                        // Done
                        btn.innerHTML = originalHtml;
                        btn.disabled = false;
                        bar.style.width = '100%';
                        text.textContent = `Done! ${status.updated} updated, ${status.failed} failed out of ${status.total} items`;

                        this.items = await this.api('/api/items');
                        this.stats = await this.api('/api/items/stats');
                        this.renderStats();

                        if (status.updated > 0) {
                            this.showToast(`Refreshed ${status.updated} items`, 'success');
                        } else {
                            this.showToast('All items already up to date', 'info');
                        }

                        setTimeout(() => progress.classList.add('hidden'), 10000);
                    }
                } catch (e) {
                    text.textContent = `Error polling status: ${e.message}`;
                    setTimeout(poll, 5000);
                }
            };

            setTimeout(poll, 2000);

        } catch (error) {
            this.showToast(`Refresh error: ${error.message}`, 'error');
            btn.innerHTML = originalHtml;
            btn.disabled = false;
            progress.classList.add('hidden');
        }
    },

    // ==========================================
    // EXPORT & PRICE CHECK
    // ==========================================

    async exportData() {
        const format = prompt('Export format:\n1. JSON\n2. CSV\n\nEnter 1 or 2:', '1');
        if (!format) return;

        const formatType = format === '2' ? 'csv' : 'json';
        const url = `/api/items/export?format=${formatType}`;

        if (formatType === 'csv') {
            window.location.href = url;
            this.showToast('Exporting CSV...', 'success');
        } else {
            try {
                const data = await this.api(url);
                const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                const downloadUrl = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = downloadUrl;
                a.download = `wishlist_export_${new Date().toISOString().split('T')[0]}.json`;
                a.click();
                URL.revokeObjectURL(downloadUrl);
                this.showToast(`Exported ${data.count} items`, 'success');
            } catch {
                this.showToast('Export failed', 'error');
            }
        }
    },

    async checkPrices() {
        if (!confirm('Check prices for all items?\n\nThis may take a while.')) return;

        const btn = this.elements.priceCheck;
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<span>&#8987;</span> Checking...';
        }

        try {
            const result = await this.api('/api/items/price-check', {
                method: 'POST',
                body: JSON.stringify({ limit: 30 })
            });

            let msg = `Checked ${result.checked} items`;
            if (result.price_drops > 0) msg += `, ${result.price_drops} price drops!`;
            if (result.price_increases > 0) msg += `, ${result.price_increases} increased`;
            this.showToast(msg, result.price_drops > 0 ? 'success' : 'info');

            if (result.updated > 0) {
                this.items = await this.api('/api/items');
                this.stats = await this.api('/api/items/stats');
                this.renderStats();
            }
        } catch {
            this.showToast('Price check failed', 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<span>&#36;</span> Check Prices';
            }
        }
    },

    // ==========================================
    // CATEGORY MANAGEMENT
    // ==========================================

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
        this.elements.categoriesList.querySelectorAll('.rename-btn').forEach(btn => {
            btn.addEventListener('click', () => this.renameCategory(parseInt(btn.dataset.id)));
        });
        this.elements.categoriesList.querySelectorAll('.delete:not([disabled])').forEach(btn => {
            btn.addEventListener('click', () => this.deleteCategory(parseInt(btn.dataset.id)));
        });

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
            await this.api('/api/categories', { method: 'POST', body: JSON.stringify({ name }) });
            this.elements.newCategoryName.value = '';
            this.categories = await this.api('/api/categories');
            this.renderCategoriesList();
        } catch { alert('Error adding category'); }
    },

    async renameCategory(id) {
        const cat = this.categories.find(c => c.id === id);
        if (!cat) return;
        const newName = prompt('Enter new name:', cat.name);
        if (!newName || newName === cat.name) return;
        try {
            await this.api(`/api/categories/${id}`, { method: 'PATCH', body: JSON.stringify({ name: newName }) });
            this.categories = await this.api('/api/categories');
            this.renderCategoriesList();
        } catch { alert('Error renaming category'); }
    },

    async deleteCategory(id) {
        const cat = this.categories.find(c => c.id === id);
        if (!cat || cat.is_default) return;
        if (!confirm(`Delete "${cat.name}"? Items will move to Unsorted.`)) return;
        try {
            await this.api(`/api/categories/${id}`, { method: 'DELETE' });
            this.categories = await this.api('/api/categories');
            this.renderCategoriesList();
            this.showToast(`Category "${cat.name}" deleted`);
        } catch { this.showToast('Error deleting category', 'error'); }
    },

    async saveCategoryPositions() {
        const items = this.elements.categoriesList.querySelectorAll('.sortable-item');
        const positions = {};
        items.forEach((item, index) => { positions[item.dataset.id] = index; });
        await this.api('/api/categories/reorder', { method: 'POST', body: JSON.stringify({ positions }) });
        this.categories = await this.api('/api/categories');
    },

    // ==========================================
    // LIST MANAGEMENT
    // ==========================================

    showManageListsModal() {
        this.elements.manageListsModal.classList.remove('hidden');
        this.renderListsList();
    },

    renderListsList() {
        let html = '';
        for (const list of this.lists) {
            const isMainList = list.name === 'Main List' || list.id === 1;
            const isDefault = isMainList ? 'is-default' : '';
            html += `
                <div class="sortable-item ${isDefault}" data-id="${list.id}" draggable="true">
                    <span class="drag-handle">&#9776;</span>
                    <span class="item-name">${this.escapeHtml(list.name)}</span>
                    <div class="item-actions">
                        <button class="btn-icon-small rename-btn" data-id="${list.id}" title="Rename">&#9998;</button>
                        <button class="btn-icon-small delete" data-id="${list.id}" title="Delete">&#10005;</button>
                    </div>
                </div>
            `;
        }
        this.elements.listsList.innerHTML = html;
        this.bindListsListEvents();
    },

    bindListsListEvents() {
        this.elements.listsList.querySelectorAll('.rename-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.renameList(parseInt(btn.dataset.id));
            });
        });
        this.elements.listsList.querySelectorAll('.delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.deleteList(parseInt(btn.dataset.id));
            });
        });

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
            await this.api('/api/lists', { method: 'POST', body: JSON.stringify({ name }) });
            this.elements.newListName.value = '';
            this.lists = await this.api('/api/lists');
            this.renderListsList();
        } catch { alert('Error adding list'); }
    },

    async renameList(id) {
        const list = this.lists.find(l => l.id === id);
        if (!list) return;
        const newName = prompt('Enter new name:', list.name);
        if (!newName || newName === list.name) return;
        try {
            await this.api(`/api/lists/${id}`, { method: 'PATCH', body: JSON.stringify({ name: newName }) });
            this.lists = await this.api('/api/lists');
            this.renderListsList();
        } catch { alert('Error renaming list'); }
    },

    async deleteList(id) {
        const list = this.lists.find(l => l.id === id);
        if (!list) return;
        if (!confirm(`Delete "${list.name}"? Items will move to Main List.`)) return;
        try {
            const response = await fetch(`/api/lists/${id}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
            });
            const data = await response.json();
            if (!response.ok) {
                this.showToast(data.error || 'Cannot delete this list', 'error');
                return;
            }
            this.lists = await this.api('/api/lists');
            this.renderListsList();
            this.showToast(`List "${list.name}" deleted`);
        } catch { this.showToast('Error deleting list', 'error'); }
    },

    async saveListPositions() {
        const items = this.elements.listsList.querySelectorAll('.sortable-item');
        const positions = {};
        items.forEach((item, index) => { positions[item.dataset.id] = index; });
        await this.api('/api/lists/reorder', { method: 'POST', body: JSON.stringify({ positions }) });
        this.lists = await this.api('/api/lists');
    },

    // ==========================================
    // AUTO-CATEGORIZE
    // ==========================================

    async autoCategories() {
        const btn = this.elements.autoCategories;
        if (!btn) return;

        const originalHtml = btn.innerHTML;
        btn.innerHTML = '<span>&#8987;</span> Scanning...';
        btn.disabled = true;

        try {
            // Dry run first to preview
            const preview = await this.api('/api/items/auto-categorize', {
                method: 'POST',
                body: JSON.stringify({ dry_run: true, create_categories: true, only_unsorted: false }),
            });

            if (preview.moved === 0) {
                this.showToast('All items are already categorized or no matches found', 'info');
                return;
            }

            // Build summary
            let msg = `AI Sort Preview:\n\n${preview.moved} items can be categorized.\n`;
            if (preview.created_categories && preview.created_categories.length > 0) {
                msg += `\nNew categories to create: ${preview.created_categories.join(', ')}\n`;
            }

            // Show category breakdown
            const breakdown = {};
            for (const move of preview.moves) {
                const cat = move.to_category;
                breakdown[cat] = (breakdown[cat] || 0) + 1;
            }
            msg += '\nBreakdown:\n';
            for (const [cat, count] of Object.entries(breakdown).sort((a, b) => b[1] - a[1])) {
                msg += `  ${cat}: ${count} items\n`;
            }
            msg += '\nApply these changes?';

            if (!confirm(msg)) return;

            // Apply
            btn.innerHTML = '<span>&#8987;</span> Sorting...';
            const result = await this.api('/api/items/auto-categorize', {
                method: 'POST',
                body: JSON.stringify({ dry_run: false, create_categories: true, only_unsorted: false }),
            });

            // Reload data
            this.items = await this.api('/api/items');
            this.categories = await this.api('/api/categories');
            this.stats = await this.api('/api/items/stats');
            this.renderStats();

            let resultMsg = `Sorted ${result.moved} items into categories`;
            if (result.created_categories && result.created_categories.length > 0) {
                resultMsg += ` (created: ${result.created_categories.join(', ')})`;
            }
            this.showToast(resultMsg, 'success');
        } catch (error) {
            this.showToast('Auto-categorize failed: ' + error.message, 'error');
        } finally {
            btn.innerHTML = originalHtml;
            btn.disabled = false;
        }
    },

    // ==========================================
    // UTILITIES
    // ==========================================

    showToast(message, type = 'success') {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => toast.classList.add('show'), 10);
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    },

    escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },
};

document.addEventListener('DOMContentLoaded', () => {
    Admin.init();
});
