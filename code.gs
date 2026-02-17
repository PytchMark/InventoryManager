/***********************************
 * CONFIG
 ***********************************/
const INVENTORY_SHEET_NAME = 'WebsiteItems';

// Column indexes (0-based):
//
// A Item Name
// B CF.Quantity on Hand
// C Reorder Level
// D Stock On Hand
// E Selling Price ("JMD 8000.00")
// F SKU
// G Reference ID
// H Purchase Price
// I Status
// J Unit
// K Image URL (FULL image link we can use directly in <img src>)
const COL = {
  ITEM_NAME:      0,
  QTY_ON_HAND:    1,
  REORDER_LEVEL:  2,
  STOCK_ON_HAND:  3,
  SELLING_PRICE:  4,
  SKU:            5,
  REF_ID:         6,
  PURCHASE_PRICE: 7,
  STATUS:         8,
  UNIT:           9,
  IMAGE_URL:     10, // column K now treated as full URL
};

/***********************************
 * WEB APP ENTRY
 ***********************************/
function doGet(e) {
  var action = e && e.parameter && e.parameter.action;

  // ---- JSON FEED FOR WIX SHOP ----
  if (action === 'inventoryProducts') {
    return getInventoryProductsJson_();
  }

  // ---- DEFAULT: DASHBOARD UI ----
  return HtmlService
    .createTemplateFromFile('dashboard')   // dashboard.html
    .evaluate()
    .setTitle('Website Inventory Dashboard')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL); // so Wix iframe can show it
}

// Helper to include extra HTML files if you ever split things up
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/***********************************
 * MAIN DATA FUNCTION FOR DASHBOARD
 ***********************************/
function getInventoryData() {
  const ss = SpreadsheetApp.getActive(); // container-bound to the sheet
  const sh = ss.getSheetByName(INVENTORY_SHEET_NAME);
  if (!sh) {
    return emptyInventory_();
  }

  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 2) {
    return emptyInventory_();
  }

  const values = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();

  const items = [];
  let totalStockQty   = 0;
  let totalStockValue = 0;
  let lowStockCount   = 0;

  values.forEach(row => {
    const name   = row[COL.ITEM_NAME];
    const status = row[COL.STATUS];

    // Skip completely empty rows
    if (!name && !row[COL.SKU]) return;

    // Only show Active by default (you can change this rule)
    if (status && String(status).toLowerCase() !== 'active') return;

    const qtyOnHand   = Number(row[COL.QTY_ON_HAND]   || row[COL.STOCK_ON_HAND] || 0);
    const reorderLvl  = Number(row[COL.REORDER_LEVEL] || 0);
    const selling     = parseMoney_(row[COL.SELLING_PRICE]);
    const purchase    = parseMoney_(row[COL.PURCHASE_PRICE]);
    const isLow       = reorderLvl > 0 && qtyOnHand <= reorderLvl;

    // Column K is now *already* the full image URL we want to use
    const imageUrl = row[COL.IMAGE_URL] ? String(row[COL.IMAGE_URL]).trim() : '';

    totalStockQty   += qtyOnHand;
    totalStockValue += qtyOnHand * selling;
    if (isLow) lowStockCount++;

    items.push({
      name:          name || '',
      sku:           row[COL.SKU] || '',
      qtyOnHand:     qtyOnHand,
      reorderLevel:  reorderLvl,
      stockOnHand:   Number(row[COL.STOCK_ON_HAND] || 0),
      sellingPrice:  selling,
      purchasePrice: purchase,
      unit:          row[COL.UNIT] || '',
      status:        status || '',
      referenceId:   row[COL.REF_ID] || '',
      isLow:         isLow,
      imageUrl:      imageUrl       // <--- pass through to dashboard + API
    });
  });

  const summary = {
    totalItems:      items.length,
    totalStockQty:   totalStockQty,
    totalStockValue: totalStockValue,
    lowStockCount:   lowStockCount,
    // placeholders for later when you wire real website orders:
    totalOrders:     0,
    revenue:         0
  };

  return { items: items, summary: summary };
}

function emptyInventory_() {
  return {
    items: [],
    summary: {
      totalItems: 0,
      totalStockQty: 0,
      totalStockValue: 0,
      lowStockCount: 0,
      totalOrders: 0,
      revenue: 0
    }
  };
}

/***********************************
 * JSON FEED FOR WIX SHOP
 *  -> /exec?action=inventoryProducts
 ***********************************/
function getInventoryProductsJson_() {
  var data  = getInventoryData();
  var items = data.items || [];

  var products = items.map(function(item) {
    var badges = [];
    if (item.isLow) badges.push('Low stock');

    // Just use the URL we already stored in the sheet
    var imageUrl = item.imageUrl || '';

    return {
      sku:         item.sku,
      name:        item.name,
      price:       item.sellingPrice,
      image:       imageUrl,           // <-- Wix front-end reads this directly
      description: '',
      category:    deriveCategory_(item.name),
      badges:      badges,
      tiers:       []                  // placeholder for bulk discounts if you add them
    };
  });

  var payload = { products: products };

  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

/***********************************
 * CATEGORY HELPER (for filters on shop)
 ***********************************/
function deriveCategory_(name) {
  if (!name) return 'All Décor';
  var n = String(name).toLowerCase();

  if (n.indexOf('lamp') > -1 || n.indexOf('sconce') > -1 || n.indexOf('light') > -1) {
    return 'Lamps & Lighting';
  }
  if (n.indexOf('mirror') > -1 || n.indexOf('frame') > -1 || n.indexOf('art') > -1 || n.indexOf('picture') > -1) {
    return 'Mirrors & Wall Art';
  }
  if (n.indexOf('vase') > -1 || n.indexOf('floral') > -1 || n.indexOf('flower') > -1 || n.indexOf('plant') > -1) {
    return 'Vases & Florals';
  }
  if (n.indexOf('tray') > -1 || n.indexOf('decor') > -1 || n.indexOf('figurine') > -1 || n.indexOf('bowl') > -1) {
    return 'Accents & Decor';
  }

  return 'All Décor';
}

/***********************************
 * IMAGE URL UPDATE ENDPOINT
 * Called from dashboard.html with google.script.run
 * After the browser uploads to Cloudinary, it sends:
 *    uploadItemImage(sku, imageUrl)
 ***********************************/
function uploadItemImage(sku, imageUrl) {
  if (!sku) {
    throw new Error('Missing SKU');
  }
  if (!imageUrl) {
    throw new Error('Missing imageUrl');
  }

  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(INVENTORY_SHEET_NAME);
  if (!sh) {
    throw new Error('Sheet not found: ' + INVENTORY_SHEET_NAME);
  }

  var lastRow = sh.getLastRow();
  if (lastRow < 2) {
    throw new Error('No data rows in sheet');
  }

  // Find row by SKU (column F)
  var skuRange = sh.getRange(2, COL.SKU + 1, lastRow - 1, 1); // +1 because Range is 1-based
  var skuValues = skuRange.getValues();
  var rowIndex = -1;

  var targetSku = String(sku).trim();
  for (var i = 0; i < skuValues.length; i++) {
    if (String(skuValues[i][0]).trim() === targetSku) {
      rowIndex = i + 2; // account for header row
      break;
    }
  }

  if (rowIndex === -1) {
    throw new Error('SKU not found in sheet: ' + sku);
  }

  // Store the FULL image URL in column K (IMAGE_URL)
  sh.getRange(rowIndex, COL.IMAGE_URL + 1).setValue(String(imageUrl).trim());

  return {
    success:  true,
    sku:      sku,
    row:      rowIndex,
    imageUrl: imageUrl
  };
}

/***********************************
 * UTIL
 ***********************************/
function parseMoney_(value) {
  if (typeof value === 'number') return value;
  if (!value) return 0;
  const cleaned = String(value).replace(/[^\d.-]/g, ''); // strips "JMD " etc
  const num = Number(cleaned);
  return isNaN(num) ? 0 : num;
}
