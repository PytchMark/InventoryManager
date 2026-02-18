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
  PARENT_ID: 12
};

const DEFAULT_SHEET_NAME = 'WebsiteItems';

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
    range: `${sheetName}!A1:M`
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
      parentId
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

module.exports = {
  COL,
  getInventoryData,
  parseMoney,
  readWebsiteItemsRaw,
  transformRowsToInventory,
  updateImageUrlBySku,
  updateClassificationBySku
};
