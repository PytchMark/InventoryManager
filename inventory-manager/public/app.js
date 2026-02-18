// ===== Cloudinary config (front-end only) =====
const CLOUDINARY_CLOUD_NAME = 'dd8pjjxsm';
const CLOUDINARY_UPLOAD_PRESET = 'media_upload_preset';
const CLOUDINARY_FOLDER = 'mediaexclusive';

const PR = new Intl.NumberFormat('en-JM', { style: 'currency', currency: 'JMD', maximumFractionDigits: 0 });
const NF = new Intl.NumberFormat('en-US');

let ALL_ITEMS = [];
let pendingSkuForImage = null;
const UI_STATE = { search: '', category: 'ALL', showVariants: false };
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
  } catch (err) {
    console.error('Failed to load inventory', err);
    alert(`Failed to load inventory data: ${err.message}`);
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
  bindControls();
  renderTable();
}

function bindControls() {
  const searchBox = document.getElementById('searchBox');
  if (!searchBox.dataset.bound) {
    searchBox.addEventListener('input', (e) => {
      UI_STATE.search = (e.target.value || '').trim().toLowerCase();
      renderTable();
    });
    searchBox.dataset.bound = '1';
  }

  const categoryFilter = document.getElementById('categoryFilter');
  if (!categoryFilter.dataset.bound) {
    categoryFilter.addEventListener('change', (e) => {
      UI_STATE.category = e.target.value || 'ALL';
      renderTable();
    });
    categoryFilter.dataset.bound = '1';
  }

  const variantsToggle = document.getElementById('showVariants');
  if (!variantsToggle.dataset.bound) {
    variantsToggle.addEventListener('change', (e) => {
      UI_STATE.showVariants = Boolean(e.target.checked);
      renderTable();
    });
    variantsToggle.dataset.bound = '1';
  }

  const clearBtn = document.getElementById('clearFiltersBtn');
  if (!clearBtn.dataset.bound) {
    clearBtn.addEventListener('click', () => {
      UI_STATE.search = '';
      UI_STATE.category = 'ALL';
      UI_STATE.showVariants = false;
      searchBox.value = '';
      categoryFilter.value = 'ALL';
      variantsToggle.checked = false;
      renderTable();
    });
    clearBtn.dataset.bound = '1';
  }

  const tbody = document.querySelector('#itemsTable tbody');
  if (!tbody.dataset.bound) {
    tbody.addEventListener('click', onTableClick);
    tbody.dataset.bound = '1';
  }
}

function renderCategoryOptions() {
  const select = document.getElementById('categoryFilter');
  const unique = Array.from(new Set(
    ALL_ITEMS
      .map((it) => String(it.category || '').trim())
      .filter(Boolean)
  )).sort((a, b) => a.localeCompare(b));

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

function getDisplayedItems() {
  let items = ALL_ITEMS.slice();

  if (!UI_STATE.showVariants) {
    items = items.filter((it) => !String(it.parentId || '').trim());
  }

  if (UI_STATE.category !== 'ALL') {
    items = items.filter((it) => String(it.category || '').trim() === UI_STATE.category);
  }

  if (UI_STATE.search) {
    items = items.filter((it) => {
      const name = String(it.name || '').toLowerCase();
      const sku = String(it.sku || '').toLowerCase();
      return name.includes(UI_STATE.search) || sku.includes(UI_STATE.search);
    });
  }

  if (UI_STATE.showVariants) {
    items.sort((a, b) => {
      const pa = String(a.parentId || '').trim();
      const pb = String(b.parentId || '').trim();
      if (pa !== pb) return pa.localeCompare(pb);
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
  } else {
    items.sort((a, b) => {
      const ca = String(a.category || '').trim();
      const cb = String(b.category || '').trim();
      if (ca !== cb) return ca.localeCompare(cb);
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
  }

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
            <span class="item-name">
              ${escapeHtml(it.name || '')}
              ${it.isLow ? '<span class="badge-low">Low stock</span>' : ''}
            </span>
            <div class="item-meta-inline">
              ${typeBadge}
              <button type="button" class="img-btn" data-sku="${escapeHtml(it.sku || '')}">
                ${imgSrc ? 'Change image' : 'Upload image'}
              </button>
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
      <td>${editableCellHtml(it, 'category')}</td>
      <td>${editableCellHtml(it, 'parentId')}</td>
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

  const label = items.length === 1 ? 'item' : 'items';
  countEl.textContent = `${items.length} ${label}`;
  refreshGlobalSaveStatus();
}

function editableCellHtml(item, field) {
  const sku = String(item.sku || '');
  const key = `${sku}:${field}`;
  const state = CELL_STATE.get(key) || { status: 'saved' };
  const rawValue = String(item[field] || '');
  const value = escapeHtml(rawValue);
  const classes = ['editable-cell'];
  if (state.status === 'saving') classes.push('saving');
  if (state.status === 'error') classes.push('error');

  return `
    <div class="${classes.join(' ')}" data-sku="${escapeHtml(sku)}" data-field="${field}">
      <button type="button" class="editable-display">${value || '<span class="muted">Click to edit</span>'}</button>
      <span class="cell-state">${state.status === 'saving' ? 'Saving…' : state.status === 'error' ? 'Error' : ''}</span>
      ${state.status === 'error' ? '<button type="button" class="retry-btn">Retry</button>' : ''}
    </div>
  `;
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
    saveClassification(sku, field, String(findItemBySku(sku)?.[field] || ''), true);
  }
}

function startInlineEdit(wrapper) {
  if (!wrapper || wrapper.classList.contains('saving')) return;
  const sku = wrapper.getAttribute('data-sku');
  const field = wrapper.getAttribute('data-field');
  const item = findItemBySku(sku);
  if (!item) return;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'cell-input';
  input.value = String(item[field] || '');
  input.placeholder = field === 'category' ? 'Category' : 'ParentID';

  wrapper.innerHTML = '';
  wrapper.appendChild(input);
  input.focus();
  input.select();

  const commit = () => {
    const nextValue = input.value.trim();
    saveClassification(sku, field, nextValue, false);
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

async function saveClassification(sku, field, value, fromRetry) {
  const item = findItemBySku(sku);
  if (!item) return;

  if (field !== 'category' && field !== 'parentId') return;

  if (!fromRetry && String(item[field] || '') === value) {
    renderTable();
    return;
  }

  item[field] = value;
  setCellState(sku, field, { status: 'saving' });
  renderCategoryOptions();
  renderTable();

  try {
    await apiFetch('/api/items/classify', {
      method: 'POST',
      body: JSON.stringify({
        sku,
        category: String(item.category || ''),
        parentId: String(item.parentId || '')
      })
    });
    setCellState(sku, field, { status: 'saved' });
  } catch (err) {
    console.error('Classification save failed', err);
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
    return;
  }
  if (hasError) {
    statusEl.textContent = 'Error';
    statusEl.className = 'save-pill error';
    return;
  }
  statusEl.textContent = 'Saved';
  statusEl.className = 'save-pill saved';
}

async function uploadToCloudinary(file) {
  const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;
  const fd = new FormData();
  fd.append('file', file);
  fd.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
  fd.append('folder', CLOUDINARY_FOLDER);

  const res = await fetch(url, { method: 'POST', body: fd });
  if (!res.ok) {
    throw new Error(`Cloudinary upload failed (${res.status})`);
  }

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
  if (s === 'active') {
    return '<span class="pill-status active">Active</span>';
  }
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
  let healthy = 0;
  let low = 0;
  let out = 0;

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
  dataTable.addRows([
    ['Healthy', healthy],
    ['Low Stock', low],
    ['Out of Stock', out]
  ]);

  const chart = new google.visualization.PieChart(document.getElementById('chartStatus'));
  chart.draw(dataTable, {
    legend: { position: 'right' },
    pieHole: 0.45,
    chartArea: { left: 10, top: 10, width: '80%', height: '80%' }
  });
}

function drawTopQtyChart(items) {
  const rows = items
    .slice()
    .sort((a, b) => (b.qtyOnHand || 0) - (a.qtyOnHand || 0))
    .slice(0, 10)
    .map((it) => [truncateLabel(it.name || it.sku || 'Item', 22), Number(it.qtyOnHand || 0)]);

  const dataTable = new google.visualization.DataTable();
  dataTable.addColumn('string', 'Item');
  dataTable.addColumn('number', 'Qty');
  dataTable.addRows(rows);

  const chart = new google.visualization.ColumnChart(document.getElementById('chartTopQty'));
  chart.draw(dataTable, {
    legend: { position: 'none' },
    chartArea: { left: 40, top: 20, width: '80%', height: '70%' },
    hAxis: { minValue: 0 }
  });
}

function drawTopValueChart(items) {
  const rows = items
    .map((it) => {
      const qty = Number(it.qtyOnHand || 0);
      const price = Number(it.sellingPrice || 0);
      return { label: truncateLabel(it.name || it.sku || 'Item', 22), value: qty * price };
    })
    .sort((a, b) => b.value - a.value)
    .slice(0, 10)
    .map((r) => [r.label, r.value]);

  const dataTable = new google.visualization.DataTable();
  dataTable.addColumn('string', 'Item');
  dataTable.addColumn('number', 'Value');
  dataTable.addRows(rows);

  const chart = new google.visualization.ColumnChart(document.getElementById('chartTopValue'));
  chart.draw(dataTable, {
    legend: { position: 'none' },
    chartArea: { left: 40, top: 20, width: '80%', height: '70%' },
    hAxis: { minValue: 0 },
    vAxis: { format: 'short' }
  });
}

function drawReorderChart(items) {
  const candidates = items
    .filter((it) => Number(it.reorderLevel || 0) > 0)
    .map((it) => {
      const qty = Number(it.qtyOnHand || 0);
      const reorder = Number(it.reorderLevel || 0);
      const ratio = reorder === 0 ? 999 : qty / reorder;
      return { label: truncateLabel(it.name || it.sku || 'Item', 22), qty, reorder, ratio };
    })
    .sort((a, b) => a.ratio - b.ratio)
    .slice(0, 10);

  const dataTable = new google.visualization.DataTable();
  dataTable.addColumn('string', 'Item');
  dataTable.addColumn('number', 'On Hand');
  dataTable.addColumn('number', 'Reorder Level');
  candidates.forEach((c) => dataTable.addRow([c.label, c.qty, c.reorder]));

  const chart = new google.visualization.BarChart(document.getElementById('chartReorder'));
  chart.draw(dataTable, {
    legend: { position: 'top' },
    chartArea: { left: 80, top: 30, width: '70%', height: '65%' },
    hAxis: { textPosition: 'none' },
    isStacked: false
  });
}
