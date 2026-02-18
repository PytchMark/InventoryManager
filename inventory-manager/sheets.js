const { google } = require('googleapis');

// Column indexes (0-based)
const COL = {
  ITEM_NAME: 0,
  QTY_ON_HAND: 1,
  REORDER_LEVEL: 2,
  STOCK_ON_HAND: 3,
  SELLING_PRICE: 4,
  SKU: 5,
  REF_ID: 6,
  PURCHASE_PRICE: 7,
  STATUS: 8,
  UNIT: 9,
  IMAGE_URL: 10,
  CATEGORY: 11,
  PARENT_ID: 12,
  VARIANT_OPTIONS: 13,
  PROMO_PRICE: 14,
  PROMO_START: 15,
  PROMO_END: 16,
  FEATURED: 17,
  VISIBLE: 18,
  SORT_ORDER: 19
};

const DEFAULT_SHEET_NAME = 'WebsiteItems';
const BUNDLES_SHEET_NAME = 'Bundles';
const BUNDLES_HEADERS = ['BundleID', 'Title', 'Description', 'SKUs', 'DiscountType', 'DiscountValue', 'Active', 'StartDate', 'EndDate', 'ImageUrl'];

function parseMoney(value) {
  if (typeof value === 'number') return value;
  if (!value) return 0;
  const cleaned = String(value).replace(/[^\d.-]/g, '');
  const num = Number(cleaned);
  return Number.isNaN(num) ? 0 : num;
}

function toNumber(value) {
  const num = Number(value || 0);
  return Number.isNaN(num) ? 0 : num;
}

function toBool(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n'].includes(normalized)) return false;
  return defaultValue;
}

async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  const authClient = await auth.getClient();
  return google.sheets({ version: 'v4', auth: authClient });
}

function getConfig() {
  const spreadsheetId = process.env.SPREADSHEET_ID;
  const sheetName = process.env.SHEET_NAME || DEFAULT_SHEET_NAME;

  if (!spreadsheetId) {
    throw new Error('Missing required environment variable: SPREADSHEET_ID');
  }

  return { spreadsheetId, sheetName };
}

async function readWebsiteItemsRaw() {
  const sheets = await getSheetsClient();
  const { spreadsheetId, sheetName } = getConfig();

  const result = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A1:T`
  });

  const rows = result.data.values || [];
  if (rows.length === 0) {
    return { headers: [], rows: [] };
  }

  const [headers, ...dataRows] = rows;
  return { headers, rows: dataRows };
}

function transformRowsToInventory(rows) {
  const items = [];
  let totalStockQty = 0;
  let totalStockValue = 0;
  let lowStockCount = 0;

  rows.forEach((row) => {
    const name = row[COL.ITEM_NAME];
    const sku = row[COL.SKU];
    const statusRaw = row[COL.STATUS];

    if (!name && !sku) {
      return;
    }

    const status = String(statusRaw || '').trim();
    if (status && status.toLowerCase() !== 'active') {
      return;
    }

    const qtyOnHand = toNumber(row[COL.QTY_ON_HAND] || row[COL.STOCK_ON_HAND]);
    const reorderLevel = toNumber(row[COL.REORDER_LEVEL]);
    const stockOnHand = toNumber(row[COL.STOCK_ON_HAND]);
    const sellingPrice = parseMoney(row[COL.SELLING_PRICE]);
    const purchasePrice = parseMoney(row[COL.PURCHASE_PRICE]);
    const isLow = reorderLevel > 0 && qtyOnHand <= reorderLevel;
    const imageUrl = row[COL.IMAGE_URL] ? String(row[COL.IMAGE_URL]).trim() : '';
    const category = row[COL.CATEGORY] ? String(row[COL.CATEGORY]).trim() : '';
    const parentId = row[COL.PARENT_ID] ? String(row[COL.PARENT_ID]).trim() : '';
    const variantOptions = row[COL.VARIANT_OPTIONS] ? String(row[COL.VARIANT_OPTIONS]).trim() : '';
    const promoPrice = parseMoney(row[COL.PROMO_PRICE]);
    const promoStart = row[COL.PROMO_START] ? String(row[COL.PROMO_START]).trim() : '';
    const promoEnd = row[COL.PROMO_END] ? String(row[COL.PROMO_END]).trim() : '';
    const featured = toBool(row[COL.FEATURED], false);
    const visible = toBool(row[COL.VISIBLE], true);
    const sortOrder = toNumber(row[COL.SORT_ORDER]);

    totalStockQty += qtyOnHand;
    totalStockValue += qtyOnHand * sellingPrice;
    if (isLow) {
      lowStockCount += 1;
    }

    items.push({
      name: name || '',
      sku: sku || '',
      qtyOnHand,
      reorderLevel,
      stockOnHand,
      sellingPrice,
      purchasePrice,
      unit: row[COL.UNIT] || '',
      status,
      referenceId: row[COL.REF_ID] || '',
      isLow,
      imageUrl,
      category,
      parentId,
      variantOptions,
      promoPrice,
      promoStart,
      promoEnd,
      featured,
      visible,
      sortOrder
    });
  });

  return {
    items,
    summary: {
      totalItems: items.length,
      totalStockQty,
      totalStockValue,
      lowStockCount,
      totalOrders: 0,
      revenue: 0
    }
  };
}

async function getInventoryData() {
  const { rows } = await readWebsiteItemsRaw();
  return transformRowsToInventory(rows);
}

async function findRowBySku(sheets, spreadsheetId, sheetName, sku) {
  const readResult = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!F2:F`
  });

  const skuRows = readResult.data.values || [];
  const targetSku = String(sku || '').trim();
  const offset = skuRows.findIndex((entry) => String((entry && entry[0]) || '').trim() === targetSku);

  if (offset < 0) {
    throw new Error(`SKU not found in sheet: ${sku}`);
  }

  return { rowNumber: offset + 2, targetSku };
}

async function updateImageUrlBySku(sku, imageUrl) {
  if (!sku) {
    throw new Error('Missing SKU');
  }
  if (!imageUrl) {
    throw new Error('Missing imageUrl');
  }

  const sheets = await getSheetsClient();
  const { spreadsheetId, sheetName } = getConfig();
  const { rowNumber, targetSku } = await findRowBySku(sheets, spreadsheetId, sheetName, sku);

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!K${rowNumber}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[String(imageUrl).trim()]]
    }
  });

  return {
    success: true,
    sku: targetSku,
    row: rowNumber,
    imageUrl: String(imageUrl).trim()
  };
}

async function updateClassificationBySku(sku, category, parentId) {
  if (!sku) {
    throw new Error('Missing SKU');
  }

  const sheets = await getSheetsClient();
  const { spreadsheetId, sheetName } = getConfig();
  const { rowNumber, targetSku } = await findRowBySku(sheets, spreadsheetId, sheetName, sku);

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!L${rowNumber}:M${rowNumber}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[String(category || '').trim(), String(parentId || '').trim()]]
    }
  });

  return {
    success: true,
    sku: targetSku,
    row: rowNumber
  };
}

async function updateItemMetaBySku(payload = {}) {
  const { sku } = payload;
  if (!sku) {
    throw new Error('Missing SKU');
  }

  const sheets = await getSheetsClient();
  const { spreadsheetId, sheetName } = getConfig();
  const { rowNumber, targetSku } = await findRowBySku(sheets, spreadsheetId, sheetName, sku);

  const values = [[
    String(payload.category || '').trim(),
    String(payload.parentId || '').trim(),
    String(payload.variantOptions || '').trim(),
    payload.promoPrice === '' || payload.promoPrice === undefined || payload.promoPrice === null ? '' : Number(payload.promoPrice),
    String(payload.promoStart || '').trim(),
    String(payload.promoEnd || '').trim(),
    toBool(payload.featured, false),
    toBool(payload.visible, true),
    payload.sortOrder === '' || payload.sortOrder === undefined || payload.sortOrder === null ? '' : Number(payload.sortOrder)
  ]];

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!L${rowNumber}:T${rowNumber}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values }
  });

  return { success: true, sku: targetSku, row: rowNumber };
}

async function getVariantsByParentSku(parentSku) {
  const data = await getInventoryData();
  const target = String(parentSku || '').trim();
  if (!target) {
    throw new Error('Missing parentSku');
  }

  return data.items
    .filter((item) => String(item.parentId || '').trim() === target)
    .map((item) => ({
      sku: item.sku,
      name: item.name,
      price: item.sellingPrice,
      qty: item.qtyOnHand,
      image: item.imageUrl,
      variantOptions: item.variantOptions
    }));
}

async function getSpreadsheetMeta(sheets, spreadsheetId) {
  const res = await sheets.spreadsheets.get({ spreadsheetId });
  return res.data;
}

async function ensureBundlesSheetExists(spreadsheetId) {
  const sheets = await getSheetsClient();
  const meta = await getSpreadsheetMeta(sheets, spreadsheetId);
  const existing = (meta.sheets || []).find((sheet) => sheet.properties && sheet.properties.title === BUNDLES_SHEET_NAME);

  if (!existing) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: BUNDLES_SHEET_NAME } } }]
      }
    });

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${BUNDLES_SHEET_NAME}!A1:J1`,
      valueInputOption: 'RAW',
      requestBody: { values: [BUNDLES_HEADERS] }
    });

    return { created: true };
  }

  const headerRead = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${BUNDLES_SHEET_NAME}!A1:J1`
  });

  const header = (headerRead.data.values && headerRead.data.values[0]) || [];
  if (header.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${BUNDLES_SHEET_NAME}!A1:J1`,
      valueInputOption: 'RAW',
      requestBody: { values: [BUNDLES_HEADERS] }
    });
  }

  return { created: false };
}

function normalizeBundleRow(row = []) {
  return {
    bundleId: String(row[0] || '').trim(),
    title: String(row[1] || '').trim(),
    description: String(row[2] || '').trim(),
    skus: String(row[3] || '').trim(),
    discountType: String(row[4] || '').trim(),
    discountValue: String(row[5] || '').trim(),
    active: toBool(row[6], true),
    startDate: String(row[7] || '').trim(),
    endDate: String(row[8] || '').trim(),
    imageUrl: String(row[9] || '').trim()
  };
}

function serializeBundle(bundle = {}) {
  return [
    String(bundle.bundleId || '').trim(),
    String(bundle.title || '').trim(),
    String(bundle.description || '').trim(),
    Array.isArray(bundle.skus) ? bundle.skus.join(',') : String(bundle.skus || '').trim(),
    String(bundle.discountType || '').trim(),
    String(bundle.discountValue || '').trim(),
    toBool(bundle.active, true),
    String(bundle.startDate || '').trim(),
    String(bundle.endDate || '').trim(),
    String(bundle.imageUrl || '').trim()
  ];
}

function createBundleId() {
  return `BND_${Date.now()}_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

async function listBundles() {
  const sheets = await getSheetsClient();
  const { spreadsheetId } = getConfig();
  const meta = await getSpreadsheetMeta(sheets, spreadsheetId);
  const exists = (meta.sheets || []).some((sheet) => sheet.properties && sheet.properties.title === BUNDLES_SHEET_NAME);
  if (!exists) return [];

  const read = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${BUNDLES_SHEET_NAME}!A2:J`
  });

  const rows = read.data.values || [];
  return rows
    .map(normalizeBundleRow)
    .filter((bundle) => bundle.bundleId);
}

async function createBundle(bundlePayload = {}) {
  const sheets = await getSheetsClient();
  const { spreadsheetId } = getConfig();
  await ensureBundlesSheetExists(spreadsheetId);

  const bundleId = bundlePayload.bundleId || createBundleId();
  const row = serializeBundle({ ...bundlePayload, bundleId });

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${BUNDLES_SHEET_NAME}!A:J`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] }
  });

  return normalizeBundleRow(row);
}

async function updateBundle(bundleId, bundlePayload = {}) {
  if (!bundleId) {
    throw new Error('Missing bundle ID');
  }

  const sheets = await getSheetsClient();
  const { spreadsheetId } = getConfig();
  await ensureBundlesSheetExists(spreadsheetId);

  const read = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${BUNDLES_SHEET_NAME}!A2:A`
  });
  const rows = read.data.values || [];
  const target = String(bundleId || '').trim();
  const offset = rows.findIndex((entry) => String((entry && entry[0]) || '').trim() === target);

  if (offset < 0) {
    throw new Error(`Bundle not found: ${bundleId}`);
  }

  const rowNumber = offset + 2;
  const row = serializeBundle({ ...bundlePayload, bundleId: target });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${BUNDLES_SHEET_NAME}!A${rowNumber}:J${rowNumber}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [row] }
  });

  return normalizeBundleRow(row);
}

async function deleteBundle(bundleId) {
  if (!bundleId) {
    throw new Error('Missing bundle ID');
  }

  const sheets = await getSheetsClient();
  const { spreadsheetId } = getConfig();
  const meta = await getSpreadsheetMeta(sheets, spreadsheetId);
  const bundlesSheet = (meta.sheets || []).find((sheet) => sheet.properties && sheet.properties.title === BUNDLES_SHEET_NAME);
  if (!bundlesSheet) {
    throw new Error('Bundles sheet does not exist');
  }

  const read = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${BUNDLES_SHEET_NAME}!A2:A`
  });
  const rows = read.data.values || [];
  const target = String(bundleId || '').trim();
  const offset = rows.findIndex((entry) => String((entry && entry[0]) || '').trim() === target);

  if (offset < 0) {
    throw new Error(`Bundle not found: ${bundleId}`);
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{
        deleteDimension: {
          range: {
            sheetId: bundlesSheet.properties.sheetId,
            dimension: 'ROWS',
            startIndex: offset + 1,
            endIndex: offset + 2
          }
        }
      }]
    }
  });

  return { success: true, bundleId: target };
}

module.exports = {
  BUNDLES_HEADERS,
  BUNDLES_SHEET_NAME,
  COL,
  createBundle,
  deleteBundle,
  ensureBundlesSheetExists,
  getConfig,
  getInventoryData,
  getVariantsByParentSku,
  listBundles,
  parseMoney,
  readWebsiteItemsRaw,
  transformRowsToInventory,
  updateBundle,
  updateClassificationBySku,
  updateImageUrlBySku,
  updateItemMetaBySku
};
