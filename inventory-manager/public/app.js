const CLOUDINARY_CLOUD_NAME = 'dd8pjjxsm';
const CLOUDINARY_UPLOAD_PRESET = 'media_upload_preset';
const CLOUDINARY_FOLDER = 'mediaexclusive';

const PR = new Intl.NumberFormat('en-JM', { style: 'currency', currency: 'JMD', maximumFractionDigits: 0 });
const NF = new Intl.NumberFormat('en-US');

let ALL_ITEMS = [];
let ALL_BUNDLES = [];
let pendingSkuForImage = null;
let editingMetaSku = null;
let editingBundleId = null;

const UI_STATE = {
  tab: 'products',
  search: '',
  category: 'ALL',
  mainOnly: true,
  featuredOnly: false,
  visibleOnly: false,
  onSaleNow: false
};

const CELL_STATE = new Map();

google.charts.load('current', { packages: ['corechart'] });
google.charts.setOnLoadCallback(loadProducts);

async function apiFetch(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    ...options
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed (${response.status})`);
  }

  return response.json();
}

async function loadProducts() {
  try {
    const data = await apiFetch('/api/inventory');
    drawDashboard(data);
    await loadBundles();
  } catch (err) {
    console.error('Failed to load inventory', err);
    alert(`Failed to load inventory data: ${err.message}`);
  }
}

async function loadBundles() {
  try {
    const data = await apiFetch('/api/bundles');
    ALL_BUNDLES = data.bundles || [];
    renderBundles();
  } catch (err) {
    console.error('Failed to load bundles', err);
    ALL_BUNDLES = [];
    renderBundles();
  }
}

function drawDashboard(data) {
  if (!data || !data.items) return;

  ALL_ITEMS = data.items || [];
  const summary = data.summary || {};

  document.getElementById('totalItems').textContent = NF.format(summary.totalItems || 0);
  document.getElementById('totalStockQty').textContent = NF.format(summary.totalStockQty || 0);
  document.getElementById('totalStockValue').textContent = PR.format(summary.totalStockValue || 0);
  document.getElementById('lowStockCount').textContent = NF.format(summary.lowStockCount || 0);

  drawStatusChart(ALL_ITEMS);
  drawTopQtyChart(ALL_ITEMS);
  drawTopValueChart(ALL_ITEMS);
  drawReorderChart(ALL_ITEMS);
  renderCategoryOptions();
  renderBundleSkuOptions();
  bindControls();
  renderTable();
}

function bindControls() {
  const controls = [
    ['searchBox', 'input', (e) => { UI_STATE.search = (e.target.value || '').trim().toLowerCase(); renderTable(); }],
    ['categoryFilter', 'change', (e) => { UI_STATE.category = e.target.value || 'ALL'; renderTable(); }],
    ['mainOnlyToggle', 'change', (e) => { UI_STATE.mainOnly = Boolean(e.target.checked); renderTable(); }],
    ['featuredOnlyToggle', 'change', (e) => { UI_STATE.featuredOnly = Boolean(e.target.checked); renderTable(); }],
    ['visibleOnlyToggle', 'change', (e) => { UI_STATE.visibleOnly = Boolean(e.target.checked); renderTable(); }],
    ['saleNowToggle', 'change', (e) => { UI_STATE.onSaleNow = Boolean(e.target.checked); renderTable(); }],
    ['tabProducts', 'click', () => switchTab('products')],
    ['tabBundles', 'click', () => switchTab('bundles')],
    ['closeMetaModal', 'click', closeMetaModal],
    ['saveMetaModal', 'click', saveMetaModal],
    ['createBundleBtn', 'click', () => openBundleModal()],
    ['closeBundleModal', 'click', closeBundleModal],
    ['saveBundleModal', 'click', saveBundleModal],
    ['deleteBundleBtn', 'click', deleteCurrentBundle]
  ];

  controls.forEach(([id, event, handler]) => {
    const el = document.getElementById(id);
    if (el && !el.dataset.bound) {
      el.addEventListener(event, handler);
      el.dataset.bound = '1';
    }
  });

  const clearBtn = document.getElementById('clearFiltersBtn');
  if (!clearBtn.dataset.bound) {
    clearBtn.addEventListener('click', () => {
      UI_STATE.search = '';
      UI_STATE.category = 'ALL';
      UI_STATE.mainOnly = true;
      UI_STATE.featuredOnly = false;
      UI_STATE.visibleOnly = false;
      UI_STATE.onSaleNow = false;
      document.getElementById('searchBox').value = '';
      document.getElementById('categoryFilter').value = 'ALL';
      document.getElementById('mainOnlyToggle').checked = true;
      document.getElementById('featuredOnlyToggle').checked = false;
      document.getElementById('visibleOnlyToggle').checked = false;
      document.getElementById('saleNowToggle').checked = false;
      renderTable();
    });
    clearBtn.dataset.bound = '1';
  }

  const tbody = document.querySelector('#itemsTable tbody');
  if (!tbody.dataset.bound) {
    tbody.addEventListener('click', onTableClick);
    tbody.dataset.bound = '1';
  }

  const bundlesBody = document.querySelector('#bundlesTable tbody');
  if (!bundlesBody.dataset.bound) {
    bundlesBody.addEventListener('click', onBundlesTableClick);
    bundlesBody.dataset.bound = '1';
  }
}

function switchTab(tab) {
  UI_STATE.tab = tab;
  document.getElementById('tabProducts').classList.toggle('active', tab === 'products');
  document.getElementById('tabBundles').classList.toggle('active', tab === 'bundles');
  document.getElementById('productsPanel').classList.toggle('active', tab === 'products');
  document.getElementById('bundlesPanel').classList.toggle('active', tab === 'bundles');
}

function renderCategoryOptions() {
  const select = document.getElementById('categoryFilter');
  const unique = Array.from(new Set(ALL_ITEMS.map((it) => String(it.category || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  const prev = UI_STATE.category;
  select.innerHTML = '<option value="ALL">All categories</option>';
  unique.forEach((cat) => {
    const option = document.createElement('option');
    option.value = cat;
    option.textContent = cat;
    select.appendChild(option);
  });
  UI_STATE.category = unique.includes(prev) || prev === 'ALL' ? prev : 'ALL';
  select.value = UI_STATE.category;
}

function isSaleActive(item) {
  const price = Number(item.promoPrice || 0);
  if (price <= 0) return false;
  const today = new Date();
  const start = item.promoStart ? new Date(`${item.promoStart}T00:00:00`) : null;
  const end = item.promoEnd ? new Date(`${item.promoEnd}T23:59:59`) : null;
  if (start && today < start) return false;
  if (end && today > end) return false;
  return true;
}

function getDisplayedItems() {
  let items = ALL_ITEMS.slice();

  if (UI_STATE.mainOnly) items = items.filter((it) => !String(it.parentId || '').trim());
  if (UI_STATE.category !== 'ALL') items = items.filter((it) => String(it.category || '').trim() === UI_STATE.category);
  if (UI_STATE.featuredOnly) items = items.filter((it) => Boolean(it.featured));
  if (UI_STATE.visibleOnly) items = items.filter((it) => Boolean(it.visible));
  if (UI_STATE.onSaleNow) items = items.filter((it) => isSaleActive(it));
  if (UI_STATE.search) {
    items = items.filter((it) => {
      const name = String(it.name || '').toLowerCase();
      const sku = String(it.sku || '').toLowerCase();
      return name.includes(UI_STATE.search) || sku.includes(UI_STATE.search);
    });
  }

  items.sort((a, b) => {
    const sa = Number(a.sortOrder || 0);
    const sb = Number(b.sortOrder || 0);
    if (sa !== sb) return sa - sb;
    return String(a.name || '').localeCompare(String(b.name || ''));
  });

  return items;
}

function renderTable() {
  const tbody = document.querySelector('#itemsTable tbody');
  const countEl = document.getElementById('visibleCount');
  const items = getDisplayedItems();
  tbody.innerHTML = '';

  items.forEach((it) => {
    const tr = document.createElement('tr');
    if (it.isLow) tr.classList.add('low');

    const stockValue = Number(it.qtyOnHand || 0) * Number(it.sellingPrice || 0);
    const imgSrc = it.imageUrl || it.image || '';
    const parentId = String(it.parentId || '').trim();
    const typeBadge = parentId ? '<span class="type-badge variant">Variant</span>' : '<span class="type-badge main">Main</span>';

    tr.innerHTML = `
      <td>
        <div class="cell-main">
          ${imgSrc ? `<img src="${imgSrc}" alt="" class="thumb-img">` : '<div class="img-placeholder">No<br>image</div>'}
          <div class="item-main-text">
            <span class="item-name">${escapeHtml(it.name || '')}${it.isLow ? '<span class="badge-low">Low stock</span>' : ''}</span>
            <div class="item-meta-inline">
              ${typeBadge}
              <button type="button" class="img-btn" data-sku="${escapeHtml(it.sku || '')}">${imgSrc ? 'Change image' : 'Upload image'}</button>
            </div>
          </div>
        </div>
      </td>
      <td>${escapeHtml(it.sku || '')}</td>
      <td>${NF.format(it.qtyOnHand || 0)}</td>
      <td>${NF.format(it.reorderLevel || 0)}</td>
      <td>${NF.format(it.stockOnHand || 0)}</td>
      <td>${PR.format(it.sellingPrice || 0)}</td>
      <td>${PR.format(stockValue)}</td>
      <td>${statusPill(it.status)}</td>
      <td>${escapeHtml(it.unit || '')}</td>
      <td>${escapeHtml(it.referenceId || '')}</td>
      <td>${editableTextCellHtml(it, 'category', 'Category')}</td>
      <td>${editableTextCellHtml(it, 'parentId', 'Parent ID')}</td>
      <td>${toggleCellHtml(it, 'featured')}</td>
      <td>${toggleCellHtml(it, 'visible')}</td>
      <td>${editableTextCellHtml(it, 'sortOrder', 'Sort')}</td>
      <td><button type="button" class="meta-btn" data-meta-sku="${escapeHtml(it.sku || '')}">Edit options & promo</button></td>
    `;

    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('.img-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const sku = btn.getAttribute('data-sku');
      if (!sku) return;
      pendingSkuForImage = sku;
      const picker = document.getElementById('imagePicker');
      picker.value = '';
      picker.click();
    });
  });

  countEl.textContent = `${items.length} ${items.length === 1 ? 'item' : 'items'}`;
  refreshGlobalSaveStatus();
}

function editableTextCellHtml(item, field, placeholder) {
  const sku = String(item.sku || '');
  const key = `${sku}:${field}`;
  const state = CELL_STATE.get(key) || { status: 'saved' };
  const rawValue = item[field] === undefined || item[field] === null ? '' : String(item[field]);
  const value = escapeHtml(rawValue);
  const classes = ['editable-cell'];
  if (state.status === 'saving') classes.push('saving');
  else if (state.status === 'error') classes.push('error');
  else if (state.status === 'saved') classes.push('saved');

  return `<div class="${classes.join(' ')}" data-sku="${escapeHtml(sku)}" data-field="${field}">
      <button type="button" class="editable-display">${value || `<span class="muted">${placeholder}</span>`}</button>
      <span class="cell-state">${state.status === 'saving' ? 'Saving…' : state.status === 'error' ? 'Error' : 'Saved'}</span>
      ${state.status === 'error' ? '<button type="button" class="retry-btn">Retry</button>' : ''}
    </div>`;
}

function toggleCellHtml(item, field) {
  const on = Boolean(item[field]);
  return `<button type="button" class="toggle-chip ${on ? 'on' : ''}" data-toggle-field="${field}" data-sku="${escapeHtml(item.sku || '')}">${on ? 'ON' : 'OFF'}</button>`;
}

function onTableClick(event) {
  const display = event.target.closest('.editable-display');
  if (display) {
    const wrapper = display.closest('.editable-cell');
    if (wrapper) startInlineEdit(wrapper);
    return;
  }

  const retry = event.target.closest('.retry-btn');
  if (retry) {
    const wrapper = retry.closest('.editable-cell');
    if (!wrapper) return;
    const sku = wrapper.getAttribute('data-sku');
    const field = wrapper.getAttribute('data-field');
    saveItemMetaField(sku, field, findItemBySku(sku)?.[field]);
    return;
  }

  const toggle = event.target.closest('.toggle-chip');
  if (toggle) {
    const sku = toggle.getAttribute('data-sku');
    const field = toggle.getAttribute('data-toggle-field');
    const item = findItemBySku(sku);
    if (!item) return;
    saveItemMetaField(sku, field, !Boolean(item[field]));
    return;
  }

  const metaBtn = event.target.closest('.meta-btn');
  if (metaBtn) {
    openMetaModal(metaBtn.getAttribute('data-meta-sku'));
  }
}

function startInlineEdit(wrapper) {
  if (!wrapper || wrapper.classList.contains('saving')) return;
  const sku = wrapper.getAttribute('data-sku');
  const field = wrapper.getAttribute('data-field');
  const item = findItemBySku(sku);
  if (!item) return;

  const input = document.createElement('input');
  input.type = field === 'sortOrder' ? 'number' : 'text';
  input.className = 'cell-input';
  input.value = item[field] === undefined || item[field] === null ? '' : String(item[field]);

  wrapper.innerHTML = '';
  wrapper.appendChild(input);
  input.focus();
  input.select();

  const commit = () => {
    const nextValue = field === 'sortOrder'
      ? (input.value.trim() === '' ? '' : Number(input.value))
      : input.value.trim();
    saveItemMetaField(sku, field, nextValue);
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      input.blur();
    }
    if (e.key === 'Escape') {
      renderTable();
    }
  });

  input.addEventListener('blur', commit, { once: true });
}

function findItemBySku(sku) {
  return ALL_ITEMS.find((it) => String(it.sku || '').trim() === String(sku || '').trim());
}

function buildMetaPayload(item) {
  return {
    sku: item.sku,
    category: item.category || '',
    parentId: item.parentId || '',
    variantOptions: item.variantOptions || '',
    promoPrice: item.promoPrice === '' || item.promoPrice === null || item.promoPrice === undefined ? '' : Number(item.promoPrice),
    promoStart: item.promoStart || '',
    promoEnd: item.promoEnd || '',
    featured: Boolean(item.featured),
    visible: item.visible === undefined ? true : Boolean(item.visible),
    sortOrder: item.sortOrder === '' || item.sortOrder === null || item.sortOrder === undefined ? '' : Number(item.sortOrder)
  };
}

async function saveItemMetaField(sku, field, value) {
  const item = findItemBySku(sku);
  if (!item) return;

  const prev = item[field];
  item[field] = value;
  setCellState(sku, field, { status: 'saving' });
  renderCategoryOptions();
  renderTable();

  try {
    await apiFetch('/api/items/meta', {
      method: 'POST',
      body: JSON.stringify(buildMetaPayload(item))
    });
    setCellState(sku, field, { status: 'saved' });
  } catch (err) {
    console.error('Meta save failed', err);
    item[field] = prev;
    setCellState(sku, field, { status: 'error', message: err.message || 'Save failed' });
  } finally {
    renderCategoryOptions();
    renderTable();
  }
}

function setCellState(sku, field, state) {
  CELL_STATE.set(`${sku}:${field}`, state);
}

function refreshGlobalSaveStatus() {
  const statusEl = document.getElementById('saveStatus');
  const values = Array.from(CELL_STATE.values());
  const hasSaving = values.some((v) => v.status === 'saving');
  const hasError = values.some((v) => v.status === 'error');

  if (hasSaving) {
    statusEl.textContent = 'Saving…';
    statusEl.className = 'save-pill saving';
  } else if (hasError) {
    statusEl.textContent = 'Error';
    statusEl.className = 'save-pill error';
  } else {
    statusEl.textContent = 'Saved';
    statusEl.className = 'save-pill saved';
  }
}

function openMetaModal(sku) {
  const item = findItemBySku(sku);
  if (!item) return;
  editingMetaSku = sku;
  document.getElementById('metaSku').value = item.sku || '';
  document.getElementById('metaVariantOptions').value = item.variantOptions || '';
  document.getElementById('metaPromoPrice').value = item.promoPrice || '';
  document.getElementById('metaPromoStart').value = item.promoStart || '';
  document.getElementById('metaPromoEnd').value = item.promoEnd || '';
  document.getElementById('metaModal').classList.add('open');
}

function closeMetaModal() {
  editingMetaSku = null;
  document.getElementById('metaModal').classList.remove('open');
}

async function saveMetaModal() {
  if (!editingMetaSku) return;
  const item = findItemBySku(editingMetaSku);
  if (!item) return;

  item.variantOptions = document.getElementById('metaVariantOptions').value.trim();
  item.promoPrice = document.getElementById('metaPromoPrice').value.trim();
  item.promoStart = document.getElementById('metaPromoStart').value;
  item.promoEnd = document.getElementById('metaPromoEnd').value;

  try {
    await apiFetch('/api/items/meta', { method: 'POST', body: JSON.stringify(buildMetaPayload(item)) });
    closeMetaModal();
    renderTable();
  } catch (err) {
    alert(`Failed to save metadata: ${err.message}`);
  }
}

function renderBundleSkuOptions() {
  const select = document.getElementById('bundleSkus');
  if (!select) return;
  select.innerHTML = '';
  ALL_ITEMS.forEach((item) => {
    const option = document.createElement('option');
    option.value = item.sku;
    option.textContent = `${item.sku} — ${item.name}`;
    select.appendChild(option);
  });
}

function renderBundles() {
  const tbody = document.querySelector('#bundlesTable tbody');
  const empty = document.getElementById('bundlesEmpty');
  tbody.innerHTML = '';

  if (!ALL_BUNDLES.length) {
    empty.style.display = 'block';
    return;
  }

  empty.style.display = 'none';
  ALL_BUNDLES.forEach((bundle) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(bundle.bundleId || '')}</td>
      <td>${escapeHtml(bundle.title || '')}</td>
      <td>${escapeHtml(bundle.skus || '')}</td>
      <td>${escapeHtml(bundle.discountType || '')} ${escapeHtml(bundle.discountValue || '')}</td>
      <td>${bundle.active ? '<span class="pill-flag">Active</span>' : '<span class="muted">Inactive</span>'}</td>
      <td>${escapeHtml(bundle.startDate || '')}</td>
      <td>${escapeHtml(bundle.endDate || '')}</td>
      <td>${bundle.imageUrl ? `<a href="${escapeHtml(bundle.imageUrl)}" target="_blank" rel="noreferrer">Image</a>` : '<span class="muted">—</span>'}</td>
      <td><button type="button" class="secondary-btn" data-edit-bundle="${escapeHtml(bundle.bundleId || '')}">Edit</button></td>
    `;
    tbody.appendChild(tr);
  });
}

function onBundlesTableClick(event) {
  const editBtn = event.target.closest('[data-edit-bundle]');
  if (!editBtn) return;
  openBundleModal(editBtn.getAttribute('data-edit-bundle'));
}

function openBundleModal(bundleId = null) {
  editingBundleId = bundleId;
  const bundle = ALL_BUNDLES.find((b) => b.bundleId === bundleId) || {};
  const selectedSkus = String(bundle.skus || '').split(',').map((s) => s.trim()).filter(Boolean);

  document.getElementById('bundleModalTitle').textContent = bundleId ? 'Edit bundle' : 'Create bundle';
  document.getElementById('bundleTitle').value = bundle.title || '';
  document.getElementById('bundleDescription').value = bundle.description || '';
  document.getElementById('bundleDiscountType').value = bundle.discountType || 'percent';
  document.getElementById('bundleDiscountValue').value = bundle.discountValue || '';
  document.getElementById('bundleStartDate').value = bundle.startDate || '';
  document.getElementById('bundleEndDate').value = bundle.endDate || '';
  document.getElementById('bundleImageUrl').value = bundle.imageUrl || '';
  document.getElementById('bundleActive').checked = bundle.active !== false;

  const skuSelect = document.getElementById('bundleSkus');
  Array.from(skuSelect.options).forEach((opt) => {
    opt.selected = selectedSkus.includes(opt.value);
  });

  document.getElementById('deleteBundleBtn').style.display = bundleId ? 'inline-flex' : 'none';
  document.getElementById('bundleModal').classList.add('open');
}

function closeBundleModal() {
  editingBundleId = null;
  document.getElementById('bundleModal').classList.remove('open');
}

function getBundlePayload() {
  const skuSelect = document.getElementById('bundleSkus');
  const selectedSkus = Array.from(skuSelect.selectedOptions).map((opt) => opt.value);
  return {
    title: document.getElementById('bundleTitle').value.trim(),
    description: document.getElementById('bundleDescription').value.trim(),
    skus: selectedSkus,
    discountType: document.getElementById('bundleDiscountType').value,
    discountValue: document.getElementById('bundleDiscountValue').value.trim(),
    active: document.getElementById('bundleActive').checked,
    startDate: document.getElementById('bundleStartDate').value,
    endDate: document.getElementById('bundleEndDate').value,
    imageUrl: document.getElementById('bundleImageUrl').value.trim()
  };
}

async function saveBundleModal() {
  const payload = getBundlePayload();
  try {
    if (editingBundleId) {
      await apiFetch(`/api/bundles/${encodeURIComponent(editingBundleId)}`, { method: 'PUT', body: JSON.stringify(payload) });
    } else {
      await apiFetch('/api/bundles', { method: 'POST', body: JSON.stringify(payload) });
    }
    closeBundleModal();
    await loadBundles();
  } catch (err) {
    alert(`Failed to save bundle: ${err.message}`);
  }
}

async function deleteCurrentBundle() {
  if (!editingBundleId) return;
  if (!window.confirm('Delete this bundle?')) return;
  try {
    await apiFetch(`/api/bundles/${encodeURIComponent(editingBundleId)}`, { method: 'DELETE' });
    closeBundleModal();
    await loadBundles();
  } catch (err) {
    alert(`Failed to delete bundle: ${err.message}`);
  }
}

async function uploadToCloudinary(file) {
  const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;
  const fd = new FormData();
  fd.append('file', file);
  fd.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
  fd.append('folder', CLOUDINARY_FOLDER);

  const res = await fetch(url, { method: 'POST', body: fd });
  if (!res.ok) throw new Error(`Cloudinary upload failed (${res.status})`);
  const json = await res.json();
  return json.secure_url || json.url;
}

const imgPicker = document.getElementById('imagePicker');
imgPicker.addEventListener('change', async () => {
  const file = imgPicker.files && imgPicker.files[0];
  if (!file || !pendingSkuForImage) return;

  try {
    const secureUrl = await uploadToCloudinary(file);
    await apiFetch('/api/items/image', {
      method: 'POST',
      body: JSON.stringify({ sku: pendingSkuForImage, imageUrl: secureUrl })
    });
    await loadProducts();
  } catch (err) {
    alert(`Image upload/save failed: ${err.message}`);
  } finally {
    pendingSkuForImage = null;
    imgPicker.value = '';
  }
});

function truncateLabel(str, max) {
  const value = str || '';
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function statusPill(status) {
  const s = (status || '').toString().toLowerCase();
  if (!s) return '';
  if (s === 'active') return '<span class="pill-status active">Active</span>';
  return `<span class="pill-status inactive">${escapeHtml(status)}</span>`;
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

window.addEventListener('resize', () => {
  if (ALL_ITEMS.length) {
    drawStatusChart(ALL_ITEMS);
    drawTopQtyChart(ALL_ITEMS);
    drawTopValueChart(ALL_ITEMS);
    drawReorderChart(ALL_ITEMS);
  }
});

function drawStatusChart(items) {
  let healthy = 0; let low = 0; let out = 0;
  items.forEach((it) => {
    const qty = Number(it.qtyOnHand || 0);
    const reorder = Number(it.reorderLevel || 0);
    if (qty <= 0) out += 1;
    else if (reorder > 0 && qty <= reorder) low += 1;
    else healthy += 1;
  });

  const dataTable = new google.visualization.DataTable();
  dataTable.addColumn('string', 'Status');
  dataTable.addColumn('number', 'Items');
  dataTable.addRows([['Healthy', healthy], ['Low Stock', low], ['Out of Stock', out]]);
  new google.visualization.PieChart(document.getElementById('chartStatus')).draw(dataTable, { legend: { position: 'right' }, pieHole: 0.45, chartArea: { left: 10, top: 10, width: '80%', height: '80%' } });
}

function drawTopQtyChart(items) {
  const rows = items.slice().sort((a, b) => (b.qtyOnHand || 0) - (a.qtyOnHand || 0)).slice(0, 10).map((it) => [truncateLabel(it.name || it.sku || 'Item', 22), Number(it.qtyOnHand || 0)]);
  const dataTable = new google.visualization.DataTable();
  dataTable.addColumn('string', 'Item');
  dataTable.addColumn('number', 'Qty');
  dataTable.addRows(rows);
  new google.visualization.ColumnChart(document.getElementById('chartTopQty')).draw(dataTable, { legend: { position: 'none' }, chartArea: { left: 40, top: 20, width: '80%', height: '70%' }, hAxis: { minValue: 0 } });
}

function drawTopValueChart(items) {
  const rows = items
    .map((it) => ({ label: truncateLabel(it.name || it.sku || 'Item', 22), value: Number(it.qtyOnHand || 0) * Number(it.sellingPrice || 0) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10)
    .map((r) => [r.label, r.value]);
  const dataTable = new google.visualization.DataTable();
  dataTable.addColumn('string', 'Item');
  dataTable.addColumn('number', 'Value');
  dataTable.addRows(rows);
  new google.visualization.ColumnChart(document.getElementById('chartTopValue')).draw(dataTable, { legend: { position: 'none' }, chartArea: { left: 40, top: 20, width: '80%', height: '70%' }, hAxis: { minValue: 0 }, vAxis: { format: 'short' } });
}

function drawReorderChart(items) {
  const candidates = items.filter((it) => Number(it.reorderLevel || 0) > 0).map((it) => ({ label: truncateLabel(it.name || it.sku || 'Item', 22), qty: Number(it.qtyOnHand || 0), reorder: Number(it.reorderLevel || 0), ratio: Number(it.reorderLevel || 0) === 0 ? 999 : Number(it.qtyOnHand || 0) / Number(it.reorderLevel || 0) })).sort((a, b) => a.ratio - b.ratio).slice(0, 10);
  const dataTable = new google.visualization.DataTable();
  dataTable.addColumn('string', 'Item');
  dataTable.addColumn('number', 'On Hand');
  dataTable.addColumn('number', 'Reorder Level');
  candidates.forEach((c) => dataTable.addRow([c.label, c.qty, c.reorder]));
  new google.visualization.BarChart(document.getElementById('chartReorder')).draw(dataTable, { legend: { position: 'top' }, chartArea: { left: 80, top: 30, width: '70%', height: '65%' }, hAxis: { textPosition: 'none' }, isStacked: false });
}
