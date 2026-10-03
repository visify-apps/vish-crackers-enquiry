/**
 * Vish Fireworks Store — Google Apps Script (hardened v3 — order sheet)
 *
 * SOURCE OF TRUTH:
 *   Enquiries = the only enquiry / order book (website submit + bill desk read).
 *   Enquiry_Log is obsolete — do not dual-write. After redeploy + a test enquiry
 *   loads correctly on /bill, you may delete the Enquiry_Log tab manually.
 *
 * SECURITY:
 * 1. Sheet sharing = Restricted (only you). NEVER "Anyone with the link".
 * 2. Deploy → Web app: Execute as Me, Who has access: Anyone.
 * 3. Set Script property ENQUIRY_INGEST_KEY to the same value as js/config.js enquiryIngestKey.
 * 4. Optional: Script property NOTIFY_EMAIL (defaults to visifyapps@gmail.com).
 * 5. Bill desk reads enquiry rows only with BILL_PAGE_PASSWORD (not public).
 *
 * SHEET UI:
 * Keep your formatted Enquiries Google Table as-is (dropdowns / colors).
 * This script only APPENDS values by matching header names — it does not
 * recreate the tab or change data validations.
 *
 * After pasting:
 * 1. Set ENQUIRY_INGEST_KEY if not already set.
 * 2. Set BILL_PAGE_PASSWORD in Script properties (bill.html asks for this; not stored in site files).
 * 3. Deploy → Manage deployments → Edit → Version: New version → Deploy.
 * 4. Test one enquiry from the website → confirm row in Enquiries.
 * 5. Change Order Status in Enquiries → Load that S.No on /bill → status matches.
 * 6. Confirm bill lines load (needs Items Json on the Enquiries row).
 * 7. Only then delete Enquiry_Log if you still have that tab.
 * 8. Profit analysis: run setupProfitSheets() once, then rebuildProfitAnalysis()
 *    after price changes. New enquiries also append to Enquiry_Profit.
 * 9. Ignite → Products_v2 (incl. image column like Products). Ensure column via menu
 *    or seedProductsV2(); site loads productsIgnite; /ignite-images writes image paths.
 */

var PRODUCTS_SHEET = 'Products';
var PRODUCTS_V2_SHEET = 'Products_v2';
var PRODUCTS_V2_HEADERS = [
  'id',
  'category',
  'name',
  'originalPrice',
  'price',
  'sellingPrice',
  'active',
  'limited',
  'image'
];
/** Sole enquiry / order book — website writes here; bill desk reads here only */
var ENQUIRIES_SHEET = 'Enquiries';
/** Buy vs sell profit (Products × PDF seller costs in SELLER_COST_SEED) */
var PROFIT_ANALYSIS_SHEET = 'Profit_Analysis';
/** One row per enquiry — total profit from Profit_Analysis × qty */
var ENQUIRY_PROFIT_SHEET = 'Enquiry_Profit';
var PROFIT_HEADERS = [
  'id',
  'category',
  'name',
  'Buying price',
  'Selling price',
  'Profit rupees',
  'Profit percent'
];
var ENQUIRY_PROFIT_HEADERS = [
  'Sl.No',
  'Date',
  'Time',
  'Name',
  'Phone',
  'Sell total',
  'Profit total',
  'Missing cost items'
];
var MAX_CART_ITEMS = 120;
var MAX_BODY_CHARS = 80000;
var RATE_LIMIT_PER_PHONE = 25;
var RATE_WINDOW_SECONDS = 3600;
var SUBMISSION_TTL_SECONDS = 86400;
/** Fallback if Script property NOTIFY_EMAIL is not set */
var DEFAULT_NOTIFY_EMAIL = 'visifyapps@gmail.com';

var ORDER_STATUSES = [
  'UnderEnquiry',
  'Requested Address',
  'Order Confirmed',
  'Dispatched',
  'Delivered'
];
var PAYMENT_STATUSES = ['Paid', 'Partially Paid', 'Pending'];

/** Expected Enquiries columns (matched by header name; order may differ on your table) */
var ENQUIRY_HEADERS = [
  'Sl.No',
  'Date',
  'Time',
  'Name',
  'Phone',
  'Area',
  'City',
  'State',
  'Pincode',
  'Items',
  'Total Price',
  'Address',
  'Order Status',
  'Payment Status',
  'Paid Amount',
  'WhatsApp',
  'Items Json',
  'Submission Id',
  'Fulfill Vendor'
];

function setupSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var products = ss.getSheetByName(PRODUCTS_SHEET) || ss.insertSheet(PRODUCTS_SHEET);
  if (products.getLastRow() === 0) {
    products.appendRow([
      'id',
      'category',
      'name',
      'originalPrice',
      'price',
      'unit',
      'image',
      'active',
      'limited'
    ]);
  }

  ensureEnquiriesSheet_();
  ensureEnquiriesBillColumns_();

  var sheet1 = ss.getSheetByName('Sheet1');
  if (sheet1 && ss.getSheets().length > 1) {
    ss.deleteSheet(sheet1);
  }
}

/** Enquiries tab only — never recreate / wipe an existing beautified table. */
function ensureEnquiriesSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(ENQUIRIES_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(ENQUIRIES_SHEET);
    sheet.appendRow(ENQUIRY_HEADERS);
    sheet.setFrozenRows(1);
  } else if (sheet.getLastRow() === 0) {
    sheet.appendRow(ENQUIRY_HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/** Append missing bill-critical headers on Enquiries (does not reorder existing cols). */
function ensureEnquiryColumn_(sheet, headerNames, writeAs) {
  var meta = readEnquiryHeaderMap_(sheet);
  if (headerCol_(meta.map, headerNames)) return sheet;
  var col = Math.max(meta.colCount, 0) + 1;
  sheet.getRange(1, col).setValue(writeAs);
  return sheet;
}

function ensureEnquiriesBillColumns_() {
  var sheet = ensureEnquiriesSheet_();
  ensureEnquiryColumn_(sheet, ['Items Json', 'ItemsJSON', 'Cart Json', 'Cart'], 'Items Json');
  ensureEnquiryColumn_(
    sheet,
    ['Fulfill Vendor', 'Fulfill', 'Vendor', 'Source Vendor'],
    'Fulfill Vendor'
  );
  ensureEnquiryColumn_(sheet, ['Submission Id', 'SubmissionID', 'Ref'], 'Submission Id');
  return sheet;
}

/** Read header row → { normalizedName: columnIndex1Based } */
function readEnquiryHeaderMap_(sheet) {
  var lastCol = Math.max(sheet.getLastColumn(), ENQUIRY_HEADERS.length, 24);
  var headers = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  var map = {};
  var colCount = 0;
  for (var c = 0; c < headers.length; c++) {
    var raw = String(headers[c] || '').trim();
    if (raw) colCount = c + 1;
    var key = normalizeHeader_(raw);
    if (key && map[key] == null) map[key] = c + 1;
  }
  if (colCount < 1) colCount = ENQUIRY_HEADERS.length;
  return { map: map, colCount: colCount, headers: headers };
}

function normalizeHeader_(h) {
  return String(h || '')
    .replace(/\u00a0/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/[._]/g, ' ')
    .replace(/\s+/g, ' ');
}

function headerCol_(map, names) {
  for (var i = 0; i < names.length; i++) {
    var key = normalizeHeader_(names[i]);
    if (map[key] != null) return map[key];
  }
  return 0;
}

function rowFromHeaderMap_(map, colCount, fields) {
  var valuesByCol = {};
  function put(names, value) {
    var col = headerCol_(map, names);
    if (col) valuesByCol[col] = value;
  }

  put(['Sl.No', 'S.No', 'S No', 'Serial No', 'Sno'], fields.serialNo);
  put(['Date'], fields.date);
  put(['Time'], fields.time);
  put(['Name'], fields.name);
  put(['Phone'], fields.phone);
  put(['Area', 'Office', 'Office Name'], fields.area);
  put(['City'], fields.city);
  put(['State'], fields.state);
  put(['Pincode', 'Pin code', 'Pin'], fields.pincode);
  put(['Items'], fields.items);
  put(['Total Price', 'Total', 'Amount'], fields.totalPrice);
  put(['Address'], fields.address);
  put(['Order Status'], fields.orderStatus);
  put(['Payment Status'], fields.paymentStatus);
  put(['Paid Amount', 'Paid'], fields.paidAmount);
  put(['WhatsApp', 'Whatsapp', 'WA'], fields.whatsapp);
  put(['Items Json', 'ItemsJSON', 'Cart Json', 'Cart'], fields.itemsJson);
  put(['Submission Id', 'SubmissionID', 'Ref'], fields.submissionId);
  put(['Fulfill Vendor', 'Fulfill', 'Vendor', 'Source Vendor'], fields.fulfillVendor);

  var row = [];
  for (var c = 1; c <= colCount; c++) {
    row.push(valuesByCol[c] != null ? valuesByCol[c] : '');
  }
  return row;
}

/** Normalize vendor id from sheet / payload / legacy Area·Items tags. */
function normalizeFulfillVendor_(value) {
  var s = String(value || '')
    .trim()
    .toLowerCase();
  if (s === 'ignite' || s.indexOf('ignite') === 0) return 'ignite';
  if (s === 'sri' || s.indexOf('sri') === 0) return 'sri';
  return '';
}

function fulfillLabel_(vendor) {
  return vendor === 'ignite' ? 'Ignite' : vendor === 'sri' ? 'Sri' : '';
}

/** Strip legacy “Fulfill:Ignite · ” prefix so Area stays hub-only for bills. */
function cleanAreaHub_(area) {
  return String(area || '')
    .replace(/^Fulfill\s*:\s*(Ignite|Sri)\s*[·\-–—]\s*/i, '')
    .replace(/^Fulfill\s*:\s*(Ignite|Sri)\s*/i, '')
    .trim();
}

/**
 * Resolve fulfill vendor for bill desk:
 * 1) dedicated column  2) Area “Fulfill:…”  3) Items “[Ignite]”  4) cart id ≥ 10000
 */
function resolveFulfillVendor_(cellVendor, area, itemsSummary, cart) {
  var fromCell = normalizeFulfillVendor_(cellVendor);
  if (fromCell) return fromCell;

  var areaStr = String(area || '');
  var areaMatch = areaStr.match(/Fulfill\s*:\s*(Ignite|Sri)/i);
  if (areaMatch) return normalizeFulfillVendor_(areaMatch[1]);

  var itemsStr = String(itemsSummary || '');
  var itemsMatch = itemsStr.match(/^\s*\[(Ignite|Sri)\]/i);
  if (itemsMatch) return normalizeFulfillVendor_(itemsMatch[1]);

  var keys = Object.keys(cart || {});
  for (var i = 0; i < keys.length; i++) {
    var n = Number(keys[i]);
    if (!isNaN(n) && n >= 10000) return 'ignite';
  }
  if (keys.length) return 'sri';
  return '';
}

function nextSerialNumber_() {
  var props = PropertiesService.getScriptProperties();
  var fromProp = Number(props.getProperty('ENQUIRY_NEXT_SNO') || '0');
  var fromSheets = 0;

  function scanSheet(name) {
    try {
      var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
      if (!sh) return;
      var meta = readEnquiryHeaderMap_(sh);
      var col = headerCol_(meta.map, ['Sl.No', 'S.No', 'S No', 'Serial No', 'Sno']) || 1;
      var values = sh.getRange(2, col, 1000, col).getValues();
      for (var i = 0; i < values.length; i++) {
        var n = Number(values[i][0]);
        if (!isNaN(n) && n > fromSheets) fromSheets = n;
      }
    } catch (e) {
      Logger.log('serial scan ' + name + ': ' + e);
    }
  }

  scanSheet(ENQUIRIES_SHEET);

  var next = Math.max(fromProp, fromSheets) + 1;
  if (next < 1) next = 1;
  return next;
}

function rememberSerial_(serialNo) {
  PropertiesService.getScriptProperties().setProperty('ENQUIRY_NEXT_SNO', String(serialNo));
}

/**
 * Append one enquiry to Enquiries only (sole source of truth).
 * Throws if the Enquiries tab is missing or append fails.
 */
function saveEnquiryRows_(fields) {
  var serialNo = nextSerialNumber_();
  fields.serialNo = serialNo;

  var sheet = ensureEnquiriesBillColumns_();
  var meta = readEnquiryHeaderMap_(sheet);
  var row = rowFromHeaderMap_(meta.map, Math.max(meta.colCount, ENQUIRY_HEADERS.length), fields);

  try {
    sheet.appendRow(row);
  } catch (e) {
    throw new Error('Could not save to Enquiries sheet: ' + e);
  }

  rememberSerial_(serialNo);
  return { serialNo: serialNo, uiOk: true };
}

function doGet(e) {
  var action = e && e.parameter && e.parameter.action;
  if (action === 'products') {
    return jsonOutput({
      status: 'ok',
      products: readProducts(),
      productsIgnite: readProductsV2()
    });
  }
  return jsonOutput({ status: 'ok' });
}

function billPasswordOk_(password) {
  var expected = PropertiesService.getScriptProperties().getProperty('BILL_PAGE_PASSWORD');
  if (!expected) return false;
  return String(password || '') === String(expected);
}

function snoEquals_(cell, want) {
  var a = String(cell == null ? '' : cell).trim();
  var b = String(want == null ? '' : want).trim();
  if (!a || !b) return false;
  if (a === b) return true;
  var na = Number(a);
  var nb = Number(b);
  return !isNaN(na) && !isNaN(nb) && na === nb;
}

/** Find enquiry by S.No. on Enquiries only (sole source of truth). */
function findEnquiryBySno_(sno) {
  var want = String(sno || '').trim();
  if (!want) return null;

  try {
    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ENQUIRIES_SHEET);
    if (!sh) return null;
    var meta = readEnquiryHeaderMap_(sh);
    var snoCol = headerCol_(meta.map, ['Sl.No', 'S.No', 'S No', 'Serial No', 'Sno']);
    if (!snoCol) return null;

    var lastRow = sheetScanBounds_(sh);

    // Fast path: only S.No column, then load the matching row
    var snoVals = sh.getRange(2, snoCol, lastRow, snoCol).getDisplayValues();
    var matchAt = -1;
    for (var r = 0; r < snoVals.length; r++) {
      if (snoEquals_(snoVals[r][0], want)) {
        matchAt = r;
        break;
      }
    }
    if (matchAt < 0) return null;

    var rowIndex = matchAt + 2;
    var colCount = Math.max(meta.colCount, 1);
    var row = sh.getRange(rowIndex, 1, rowIndex, colCount).getDisplayValues()[0];
    return rowToEnquiry_(ENQUIRIES_SHEET, meta, row, want);
  } catch (err) {
    Logger.log('findEnquiryBySno_ Enquiries: ' + err);
    return null;
  }
}

function normalizePhoneDigits_(phone) {
  var digits = String(phone || '').replace(/\D/g, '');
  if (digits.length > 10) digits = digits.slice(-10);
  return digits;
}

function phoneEquals_(cell, wantDigits) {
  var a = normalizePhoneDigits_(cell);
  var b = normalizePhoneDigits_(wantDigits);
  return a && b && a === b;
}

function rowToEnquiry_(sheetName, meta, row, serialOverride) {
  function cell(names) {
    var c = headerCol_(meta.map, names);
    return c ? String(row[c - 1] || '').trim() : '';
  }
  var itemsJson = cell(['Items Json', 'ItemsJSON', 'Cart Json', 'Cart']);
  var cart = {};
  try {
    cart = itemsJson ? JSON.parse(itemsJson) : {};
  } catch (parseErr) {
    cart = {};
  }
  var sno = serialOverride || cell(['Sl.No', 'S.No', 'S No', 'Serial No', 'Sno']);
  var rawArea = cell(['Area', 'Office', 'Office Name']);
  var itemsSummary = cell(['Items']);
  var fulfillVendor = resolveFulfillVendor_(
    cell(['Fulfill Vendor', 'Fulfill', 'Vendor', 'Source Vendor']),
    rawArea,
    itemsSummary,
    cart
  );
  return {
    serialNo: String(sno || '').trim(),
    name: cell(['Name']),
    phone: cell(['Phone']),
    area: cleanAreaHub_(rawArea),
    city: cell(['City']),
    state: cell(['State']),
    pincode: cell(['Pincode', 'Pin code', 'Pin']),
    address: cell(['Address']),
    itemsSummary: itemsSummary,
    totalPrice: cell(['Total Price', 'Total', 'Amount']),
    orderStatus: cell(['Order Status']),
    paymentStatus: cell(['Payment Status']),
    date: cell(['Date']),
    time: cell(['Time']),
    fulfillVendor: fulfillVendor,
    fulfillLabel: fulfillLabel_(fulfillVendor),
    cart: cart,
    source: sheetName
  };
}

function sheetScanBounds_(sh) {
  var lastRow = sh.getLastRow();
  if (lastRow < 2) lastRow = 500;
  return Math.min(Math.max(lastRow, 2), 2000);
}

/** Find all enquiries matching phone (last 10 digits) on Enquiries only. */
function findEnquiriesByPhone_(phone) {
  var want = normalizePhoneDigits_(phone);
  if (want.length !== 10) return [];

  var bySno = {};
  try {
    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ENQUIRIES_SHEET);
    if (!sh) return [];
    var meta = readEnquiryHeaderMap_(sh);
    var phoneCol = headerCol_(meta.map, ['Phone']);
    if (!phoneCol) return [];
    var lastRow = sheetScanBounds_(sh);
    var phoneVals = sh.getRange(2, phoneCol, lastRow, phoneCol).getDisplayValues();
    var colCount = Math.max(meta.colCount, 1);
    for (var r = 0; r < phoneVals.length; r++) {
      if (!phoneEquals_(phoneVals[r][0], want)) continue;
      var row = sh.getRange(r + 2, 1, r + 2, colCount).getDisplayValues()[0];
      var enq = rowToEnquiry_(ENQUIRIES_SHEET, meta, row);
      if (!enq.serialNo) continue;
      bySno[enq.serialNo] = enq;
    }
  } catch (err) {
    Logger.log('findEnquiriesByPhone_ Enquiries: ' + err);
  }

  var list = Object.keys(bySno).map(function (k) {
    return bySno[k];
  });
  list.sort(function (a, b) {
    return Number(b.serialNo) - Number(a.serialNo);
  });
  return list;
}

/** Recent enquiry summaries for bill desk (from Enquiries). */
function listRecentEnquiries_(limit) {
  var max = Math.min(Math.max(Number(limit) || 20, 1), 40);
  var out = [];
  try {
    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ENQUIRIES_SHEET);
    if (!sh) return out;
    var meta = readEnquiryHeaderMap_(sh);
    var lastRow = sheetScanBounds_(sh);
    var start = Math.max(2, lastRow - max + 1);
    var colCount = Math.max(meta.colCount, 1);
    var values = sh.getRange(start, 1, lastRow, colCount).getDisplayValues();
    for (var i = values.length - 1; i >= 0; i--) {
      var enq = rowToEnquiry_(ENQUIRIES_SHEET, meta, values[i]);
      if (!enq.serialNo && !enq.name) continue;
      out.push({
        serialNo: enq.serialNo,
        name: enq.name,
        phone: enq.phone,
        totalPrice: enq.totalPrice,
        date: enq.date,
        time: enq.time,
        orderStatus: enq.orderStatus,
        paymentStatus: enq.paymentStatus,
        fulfillVendor: enq.fulfillVendor,
        fulfillLabel: enq.fulfillLabel
      });
      if (out.length >= max) break;
    }
  } catch (err) {
    Logger.log('listRecentEnquiries_: ' + err);
  }
  return out;
}

/** CSV export of Enquiries (optional date filter dd/MM/yyyy IST). */
function exportEnquiryLogCsv_(dateFilter) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ENQUIRIES_SHEET);
  if (!sh) return { csv: '', filename: 'Enquiries-empty.csv', rows: 0 };
  var meta = readEnquiryHeaderMap_(sh);
  var lastRow = sh.getLastRow();
  var wantDate = String(dateFilter || '').trim();
  var headers = [];
  for (var h = 0; h < meta.colCount; h++) {
    headers.push(String(meta.headers[h] || '').trim() || 'Col' + (h + 1));
  }
  var lines = [headers.map(csvEscape_).join(',')];
  var count = 0;
  if (lastRow >= 2) {
    var values = sh.getRange(2, 1, lastRow, Math.max(meta.colCount, 1)).getDisplayValues();
    var dateCol = headerCol_(meta.map, ['Date']);
    for (var r = 0; r < values.length; r++) {
      var row = values[r];
      if (wantDate && dateCol) {
        if (String(row[dateCol - 1] || '').trim() !== wantDate) continue;
      }
      lines.push(row.map(csvEscape_).join(','));
      count++;
    }
  }
  var stamp = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyyMMdd-HHmm');
  var filename = wantDate
    ? 'Enquiries-' + wantDate.replace(/\//g, '-') + '.csv'
    : 'Enquiries-' + stamp + '.csv';
  return { csv: lines.join('\n'), filename: filename, rows: count };
}

function csvEscape_(v) {
  var s = String(v == null ? '' : v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

/** Phones with enquiries in the last N days (for REPEAT flag). */
function findRecentSerialsByPhone_(phone, withinDays) {
  var want = normalizePhoneDigits_(phone);
  if (want.length !== 10) return [];
  var days = Math.max(1, Number(withinDays) || 7);
  var cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  var found = [];
  try {
    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ENQUIRIES_SHEET);
    if (!sh) return found;
    var meta = readEnquiryHeaderMap_(sh);
    var phoneCol = headerCol_(meta.map, ['Phone']);
    var snoCol = headerCol_(meta.map, ['Sl.No', 'S.No', 'S No', 'Serial No', 'Sno']);
    var dateCol = headerCol_(meta.map, ['Date']);
    if (!phoneCol || !snoCol) return found;
    var lastRow = sheetScanBounds_(sh);
    var width = Math.max(meta.colCount, 1);
    var values = sh.getRange(2, 1, lastRow, width).getDisplayValues();
    for (var r = 0; r < values.length; r++) {
      var row = values[r];
      if (!phoneEquals_(row[phoneCol - 1], want)) continue;
      var sno = String(row[snoCol - 1] || '').trim();
      if (!sno) continue;
      if (dateCol) {
        var dStr = String(row[dateCol - 1] || '').trim();
        var parsed = parseIstDate_(dStr);
        if (parsed && parsed < cutoff) continue;
      }
      found.push(sno);
    }
  } catch (err) {
    Logger.log('findRecentSerialsByPhone_: ' + err);
  }
  return found;
}

function parseIstDate_(dStr) {
  // expects dd/MM/yyyy
  var m = String(dStr || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  var d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return isNaN(d.getTime()) ? null : d;
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonOutput({ status: 'error', message: 'Empty body' });
    }
    if (String(e.postData.contents).length > MAX_BODY_CHARS) {
      return jsonOutput({ status: 'error', message: 'Payload too large' });
    }

    var data = JSON.parse(e.postData.contents);

    // Bill desk — handle before any sheet / lock work
    if (data.action === 'checkBillPassword') {
      if (!billPasswordOk_(data.billPassword)) {
        return jsonOutput({ status: 'error', message: 'Unauthorized' });
      }
      return jsonOutput({ status: 'ok' });
    }

    if (data.action === 'updateIgniteImage') {
      if (!billPasswordOk_(data.billPassword)) {
        return jsonOutput({ status: 'error', message: 'Unauthorized' });
      }
      var updated = updateIgniteImage_(data.sourceId || data.id, data.image);
      if (!updated.ok) {
        return jsonOutput({ status: 'error', message: updated.message || 'Update failed' });
      }
      return jsonOutput({ status: 'ok', sourceId: updated.sourceId, image: updated.image });
    }

    if (data.action === 'setIgniteImages') {
      if (!billPasswordOk_(data.billPassword)) {
        return jsonOutput({ status: 'error', message: 'Unauthorized' });
      }
      var batch = setIgniteImages_(data.images || {});
      return jsonOutput({
        status: 'ok',
        updated: batch.updated,
        skipped: batch.skipped
      });
    }

    if (data.action === 'getEnquiry') {
      if (!billPasswordOk_(data.billPassword)) {
        return jsonOutput({ status: 'error', message: 'Unauthorized' });
      }
      var found = findEnquiryBySno_(data.sno);
      if (!found) {
        return jsonOutput({ status: 'error', message: 'Enquiry not found' });
      }
      return jsonOutput({ status: 'ok', enquiry: found });
    }

    if (data.action === 'findByPhone') {
      if (!billPasswordOk_(data.billPassword)) {
        return jsonOutput({ status: 'error', message: 'Unauthorized' });
      }
      var matches = findEnquiriesByPhone_(data.phone);
      if (!matches.length) {
        return jsonOutput({ status: 'error', message: 'No enquiry for this phone' });
      }
      if (matches.length === 1) {
        return jsonOutput({ status: 'ok', enquiry: matches[0], matches: matches });
      }
      return jsonOutput({
        status: 'ok',
        matches: matches.map(function (m) {
          return {
            serialNo: m.serialNo,
            name: m.name,
            phone: m.phone,
            totalPrice: m.totalPrice,
            date: m.date,
            time: m.time,
            orderStatus: m.orderStatus,
            fulfillVendor: m.fulfillVendor,
            fulfillLabel: m.fulfillLabel
          };
        })
      });
    }

    if (data.action === 'listRecent') {
      if (!billPasswordOk_(data.billPassword)) {
        return jsonOutput({ status: 'error', message: 'Unauthorized' });
      }
      return jsonOutput({
        status: 'ok',
        enquiries: listRecentEnquiries_(data.limit || 20)
      });
    }

    if (data.action === 'exportCsv') {
      if (!billPasswordOk_(data.billPassword)) {
        return jsonOutput({ status: 'error', message: 'Unauthorized' });
      }
      var exported = exportEnquiryLogCsv_(data.date || '');
      return jsonOutput({
        status: 'ok',
        csv: exported.csv,
        filename: exported.filename,
        rows: exported.rows
      });
    }

    var honeypot = String(data.website || data.company || data.url || '').trim();
    if (honeypot && /https?:\/\//i.test(honeypot)) {
      return jsonOutput({ status: 'ok' });
    }

    if (!ingestKeyOk(data)) {
      return jsonOutput({ status: 'error', message: 'Unauthorized' });
    }

    var contact = validateEnquiry(data);
    if (contact.error) {
      return jsonOutput({ status: 'error', message: contact.error });
    }

    var submissionId = String(data.submissionId || '').trim().slice(0, 80);

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) {
      return jsonOutput({ status: 'error', message: 'Busy. Please retry.' });
    }

    try {
      if (submissionId && isDuplicateSubmission(submissionId)) {
        return jsonOutput({ status: 'ok', duplicate: true });
      }

      if (!rateLimitAllow(contact.phone)) {
        return jsonOutput({ status: 'error', message: 'Too many requests. Try again later.' });
      }

      var priced = priceCartFromCatalog(data.cart || {});
      if (priced.error) {
        return jsonOutput({ status: 'error', message: priced.error });
      }

      var fulfillVendor =
        normalizeFulfillVendor_(data.fulfillVendor) ||
        resolveFulfillVendor_('', '', '', priced.cart) ||
        'sri';
      var fulfillLabel = fulfillLabel_(fulfillVendor) || 'Sri';

      var priorSnos = findRecentSerialsByPhone_(contact.phone, 7);

      var when = istParts_(data.submittedAt);
      var saved = saveEnquiryRows_({
        date: when.date,
        time: when.time,
        name: contact.name,
        phone: contact.phone,
        area: contact.officeName || '',
        city: contact.city || '',
        state: contact.state || '',
        pincode: contact.pincode,
        items: '[' + fulfillLabel + '] ' + itemsSummaryText_(priced),
        totalPrice: priced.total,
        address: '',
        orderStatus: 'UnderEnquiry',
        paymentStatus: 'Pending',
        paidAmount: '',
        whatsapp: 'https://wa.me/91' + contact.phone,
        itemsJson: JSON.stringify(priced.cart),
        submissionId: submissionId,
        fulfillVendor: fulfillLabel
      });

      try {
        appendEnquiryProfitRow_({
          serialNo: saved.serialNo,
          date: when.date,
          time: when.time,
          name: contact.name,
          phone: contact.phone,
          sellTotal: priced.total,
          cart: priced.cart
        });
      } catch (profitErr) {
        Logger.log('Enquiry_Profit append failed: ' + profitErr);
      }

      if (submissionId) markSubmission(submissionId);
      rateLimitBump(contact.phone);
      SpreadsheetApp.flush();

      try {
        queueEnquiryEmail(contact, priced, submissionId, saved.serialNo, priorSnos, fulfillLabel);
      } catch (mailErr) {
        Logger.log('Enquiry mail queue failed: ' + mailErr);
        try {
          sendEnquiryEmail(contact, priced, submissionId, saved.serialNo, priorSnos, fulfillLabel);
        } catch (inlineErr) {
          Logger.log('Inline enquiry mail failed: ' + inlineErr);
        }
      }

      return jsonOutput({
        status: 'ok',
        total: priced.total,
        saved: priced.saved,
        serialNo: saved.serialNo,
        fulfillVendor: fulfillVendor,
        uiSynced: !!saved.uiOk,
        repeat: priorSnos.length > 0,
        priorSerialNos: priorSnos
      });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    Logger.log('doPost failed: ' + err);
    var msg = String((err && err.message) || err || 'Rejected').slice(0, 160);
    return jsonOutput({ status: 'error', message: msg });
  }
}

/** India time parts for sheet Date / Time columns */
function istParts_(submittedAt) {
  var d = submittedAt ? new Date(submittedAt) : new Date();
  if (isNaN(d.getTime())) d = new Date();
  var date = Utilities.formatDate(d, 'Asia/Kolkata', 'dd/MM/yyyy');
  var time = Utilities.formatDate(d, 'Asia/Kolkata', 'HH:mm');
  return { date: date, time: time };
}

function itemsSummaryText_(priced) {
  var cart = priced.cart || {};
  var ids = Object.keys(cart);
  var productCount = ids.length;
  var qtyTotal = 0;
  for (var i = 0; i < ids.length; i++) {
    qtyTotal += Number(cart[ids[i]].quantity) || 0;
  }
  return productCount + ' products___' + qtyTotal + ' pcs';
}

function notifyEmail() {
  var fromProp = PropertiesService.getScriptProperties().getProperty('NOTIFY_EMAIL');
  return String(fromProp || DEFAULT_NOTIFY_EMAIL).trim();
}

/**
 * Save mail payload and schedule a near-immediate flush.
 * Keeps doPost fast so the website does not hang or show a false network error.
 */
function queueEnquiryEmail(contact, priced, submissionId, serialNo, priorSnos, fulfillLabel) {
  var item = {
    contact: contact,
    priced: {
      cart: priced.cart,
      total: priced.total,
      saved: priced.saved
    },
    submissionId: submissionId || '',
    serialNo: serialNo,
    priorSnos: priorSnos || [],
    fulfillLabel: fulfillLabel || ''
  };

  var props = PropertiesService.getScriptProperties();
  var queue = [];
  try {
    queue = JSON.parse(props.getProperty('MAIL_QUEUE') || '[]');
  } catch (e) {
    queue = [];
  }
  if (!Array.isArray(queue)) queue = [];
  queue.push(item);
  if (queue.length > 40) queue = queue.slice(-40);
  props.setProperty('MAIL_QUEUE', JSON.stringify(queue));
  scheduleMailFlush();
}

function scheduleMailFlush() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'flushEnquiryMailQueue') return;
  }
  ScriptApp.newTrigger('flushEnquiryMailQueue').timeBased().after(1000).create();
}

/** Runs ~1 second after an enquiry — sends any queued owner emails. */
function flushEnquiryMailQueue() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;

  var leftover = [];
  try {
    var props = PropertiesService.getScriptProperties();
    var queue = [];
    try {
      queue = JSON.parse(props.getProperty('MAIL_QUEUE') || '[]');
    } catch (e) {
      queue = [];
    }
    props.setProperty('MAIL_QUEUE', '[]');

    for (var i = 0; i < queue.length; i++) {
      var item = queue[i];
      if (!item || !item.contact) continue;
      try {
        sendEnquiryEmail(
          item.contact,
          item.priced || {},
          item.submissionId,
          item.serialNo,
          item.priorSnos || [],
          item.fulfillLabel || ''
        );
      } catch (mailErr) {
        Logger.log('Queued enquiry mail failed: ' + mailErr);
        leftover.push(item);
      }
    }

    if (leftover.length) {
      var again = [];
      try {
        again = JSON.parse(props.getProperty('MAIL_QUEUE') || '[]');
      } catch (e2) {
        again = [];
      }
      props.setProperty('MAIL_QUEUE', JSON.stringify(again.concat(leftover).slice(-40)));
    }
  } finally {
    lock.releaseLock();
  }

  var triggers = ScriptApp.getProjectTriggers();
  for (var t = 0; t < triggers.length; t++) {
    if (triggers[t].getHandlerFunction() === 'flushEnquiryMailQueue') {
      try {
        ScriptApp.deleteTrigger(triggers[t]);
      } catch (delErr) {}
    }
  }

  try {
    var pending = JSON.parse(
      PropertiesService.getScriptProperties().getProperty('MAIL_QUEUE') || '[]'
    );
    if (pending && pending.length) scheduleMailFlush();
  } catch (e3) {}
}

/**
 * Run this ONCE from the Apps Script editor (▶ Run).
 * Click Allow when Google asks for Gmail permission.
 */
function testNotifyEmail() {
  var to = notifyEmail();
  MailApp.sendEmail({
    to: to,
    subject: 'VishCrackers - New Order [Id : 0, TEST, 0]',
    body:
      'New enquiry\n\n' +
      'Name___Test\n' +
      'Pincode___626123\n' +
      'Area___Test Area\n' +
      'City___Sivakasi\n' +
      'State___Tamil Nadu\n\n' +
      'ENQUIRED_PRODUCT_LIST\n' +
      'Sparklers\n' +
      'Gold Sparkler___2\n\n' +
      'Flower Pots\n' +
      'Flower Pot Big___1\n\n' +
      'Total Products___2\n' +
      'Total Items___3\n\n' +
      'REFERENCE\n' +
      'Gold Sparkler___2___@₹10___=₹20\n' +
      'Flower Pot Big___1___@₹80___=₹80\n\n' +
      'Order Total___₹100\n'
  });
  Logger.log('Test mail sent to ' + to);
}

/**
 * Owner email — pack list by category, ___ separators, no product ids.
 */
function sendEnquiryEmail(contact, priced, submissionId, serialNo, priorSnos, fulfillLabel) {
  var to = notifyEmail();
  if (!to) return;

  var built = buildCategorizedLists_(priced.cart || {});
  var isRepeat = priorSnos && priorSnos.length > 0;
  var fulfill =
    fulfillLabel ||
    fulfillLabel_(resolveFulfillVendor_('', '', '', (priced && priced.cart) || {})) ||
    'Sri';
  var subject =
    'VishCrackers - New Order [Id : ' +
    serialNo +
    ', ' +
    contact.name +
    ', ' +
    priced.total +
    ', →' +
    fulfill +
    ']' +
    (isRepeat ? ' REPEAT' : '');

  var lines = [];
  lines.push(isRepeat ? 'New enquiry (REPEAT phone)' : 'New enquiry');
  if (isRepeat) {
    lines.push('Prior S.Nos (7 days)___' + priorSnos.join(', '));
  }
  lines.push('');
  lines.push('Send enquiry to___' + fulfill + ' Crackers');
  lines.push('Name___' + contact.name);
  lines.push('Phone___' + contact.phone);
  lines.push('Pincode___' + contact.pincode);
  lines.push('Area___' + (contact.officeName || '-'));
  lines.push('City___' + (contact.city || '-'));
  lines.push('State___' + (contact.state || '-'));
  lines.push('');
  lines.push('ENQUIRED_PRODUCT_LIST');

  if (!built.packBlocks.length) {
    lines.push('(no items)');
  } else {
    for (var b = 0; b < built.packBlocks.length; b++) {
      if (b > 0) lines.push(''); // extra blank line between categories
      var block = built.packBlocks[b];
      lines.push(block.category);
      for (var L = 0; L < block.lines.length; L++) {
        lines.push(block.lines[L]);
      }
    }
  }

  lines.push('');
  lines.push('Total Products___' + built.productCount);
  lines.push('Total Items___' + built.qtyTotal);
  lines.push('');
  lines.push('REFERENCE');
  if (!built.priceLines.length) {
    lines.push('(no items)');
  } else {
    for (var r = 0; r < built.priceLines.length; r++) {
      lines.push(built.priceLines[r]);
    }
  }
  lines.push('');
  lines.push('Order Total___₹' + priced.total);
  if (submissionId) {
    lines.push('');
    lines.push('Submission Id___' + submissionId);
  }

  MailApp.sendEmail({
    to: to,
    subject: subject,
    body: lines.join('\n')
  });
}

/** Group cart lines by Products.category (fallback Other). */
function buildCategorizedLists_(cart) {
  var map = loadProductPriceMap();
  var ids = Object.keys(cart || {}).sort(function (a, b) {
    return Number(a) - Number(b) || String(a).localeCompare(String(b));
  });

  var byCat = {};
  var catOrder = [];
  var productCount = 0;
  var qtyTotal = 0;
  var priceLines = [];

  for (var i = 0; i < ids.length; i++) {
    var item = cart[ids[i]] || {};
    var name = String(item.name || '').trim() || 'Item';
    var qty = Number(item.quantity) || 1;
    var price = Number(item.price) || 0;
    var live = map[String(ids[i])] || map[String(item.id)] || null;
    var category = (live && live.category) || item.category || 'Other';
    category = String(category).trim() || 'Other';

    if (!byCat[category]) {
      byCat[category] = [];
      catOrder.push(category);
    }
    byCat[category].push(name + '___' + qty);
    priceLines.push(name + '___' + qty + '___@₹' + price + '___=₹' + price * qty);
    productCount += 1;
    qtyTotal += qty;
  }

  var packBlocks = catOrder.map(function (cat) {
    return { category: cat, lines: byCat[cat] };
  });

  return {
    packBlocks: packBlocks,
    priceLines: priceLines,
    productCount: productCount,
    qtyTotal: qtyTotal
  };
}

/**
 * When Payment Status is set to Paid, auto-fill Paid Amount with Total Price
 * (user can still edit Paid Amount afterwards).
 */
function onEdit(e) {
  try {
    if (!e || !e.range) return;
    var sheet = e.range.getSheet();
    if (sheet.getName() !== ENQUIRIES_SHEET) return;
    if (e.range.getRow() < 2) return;

    var meta = readEnquiryHeaderMap_(sheet);
    var payCol = headerCol_(meta.map, ['Payment Status']);
    var totalCol = headerCol_(meta.map, ['Total Price', 'Total', 'Amount']);
    var paidCol = headerCol_(meta.map, ['Paid Amount', 'Paid']);
    if (!payCol || e.range.getColumn() !== payCol) return;

    var value = String(e.value || '').trim();
    if (value !== 'Paid') return;
    if (!totalCol || !paidCol) return;

    var row = e.range.getRow();
    var totalPrice = sheet.getRange(row, totalCol).getValue();
    sheet.getRange(row, paidCol).setValue(totalPrice);
  } catch (err) {
    Logger.log('onEdit paid fill failed: ' + err);
  }
}

function ingestKeyOk(data) {
  var expected = PropertiesService.getScriptProperties().getProperty('ENQUIRY_INGEST_KEY');
  if (!expected) return true;
  return data && data.ingestKey && String(data.ingestKey) === String(expected);
}

function isDuplicateSubmission(submissionId) {
  var cache = CacheService.getScriptCache();
  return !!cache.get('sub_' + submissionId);
}

function markSubmission(submissionId) {
  CacheService.getScriptCache().put('sub_' + submissionId, '1', SUBMISSION_TTL_SECONDS);
}

function rateLimitAllow(phone) {
  var cache = CacheService.getScriptCache();
  var key = 'enq_' + phone;
  var raw = cache.get(key);
  var count = raw ? Number(raw) : 0;
  return count < RATE_LIMIT_PER_PHONE;
}

function rateLimitBump(phone) {
  var cache = CacheService.getScriptCache();
  var key = 'enq_' + phone;
  var raw = cache.get(key);
  var count = raw ? Number(raw) : 0;
  cache.put(key, String(count + 1), RATE_WINDOW_SECONDS);
}

/** Clears rate limit for a phone — run once from the editor if testing blocked you. */
function clearRateLimitForPhone() {
  var phone = '9994376845'; // change if needed
  CacheService.getScriptCache().remove('enq_' + phone);
  Logger.log('Cleared rate limit for ' + phone);
}

function validateEnquiry(data) {
  var name = String(data.name || '').trim().slice(0, 80);
  var phone = String(data.phone || '').replace(/\s+/g, '');
  var pincode = String(data.pincode || '').trim();
  var city = String(data.city || '').trim().slice(0, 80);
  var state = String(data.state || '').trim().slice(0, 80);
  var officeName = String(data.officeName || '').trim().slice(0, 120);
  var address = String(data.address || '').trim().slice(0, 200);

  if (!name || name.length < 2) return { error: 'Invalid name' };
  if (!/^[6-9]\d{9}$/.test(phone)) return { error: 'Invalid phone' };
  if (!/^\d{6}$/.test(pincode)) return { error: 'Invalid pincode' };

  var cart = data.cart || {};
  var keys = Object.keys(cart);
  if (!keys.length) return { error: 'Empty cart' };
  if (keys.length > MAX_CART_ITEMS) return { error: 'Cart too large' };

  return {
    name: name,
    phone: phone,
    pincode: pincode,
    city: city,
    state: state,
    officeName: officeName,
    address: address
  };
}

function loadProductPriceMap() {
  var map = {};
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(PRODUCTS_SHEET);
  if (sheet) {
    var values = sheet.getDataRange().getValues();
    if (values.length >= 2) {
      var headers = values[0];
      var idIdx = headers.indexOf('id');
      var priceIdx = headers.indexOf('price');
      var mrpIdx = headers.indexOf('originalPrice');
      var nameIdx = headers.indexOf('name');
      var unitIdx = headers.indexOf('unit');
      var activeIdx = headers.indexOf('active');
      var catIdx = headers.indexOf('category');
      if (idIdx >= 0 && priceIdx >= 0) {
        values.slice(1).forEach(function (row) {
          var id = String(row[idIdx]);
          var active = activeIdx < 0 ? true : row[activeIdx];
          if (String(active).toLowerCase() === 'false' || active === false || active === 0) return;
          map[id] = {
            id: row[idIdx],
            name: nameIdx >= 0 ? String(row[nameIdx] || '') : '',
            unit: unitIdx >= 0 ? String(row[unitIdx] || '') : '',
            category: catIdx >= 0 ? String(row[catIdx] || 'Other') : 'Other',
            price: Number(row[priceIdx]) || 0,
            originalPrice: mrpIdx >= 0 ? Number(row[mrpIdx]) || 0 : Number(row[priceIdx]) || 0,
            vendor: 'sri'
          };
        });
      }
    }
  }

  /** Ignite Products_v2 — site ids are 10000 + sheet id; sell from sellingPrice */
  var v2 = ss.getSheetByName(PRODUCTS_V2_SHEET);
  if (v2) {
    var v2values = v2.getDataRange().getValues();
    if (v2values.length >= 2) {
      var h2 = v2values[0];
      var iId = h2.indexOf('id');
      var iSell = h2.indexOf('sellingPrice');
      var iPrice = h2.indexOf('price');
      var iMrp = h2.indexOf('originalPrice');
      var iName = h2.indexOf('name');
      var iActive = h2.indexOf('active');
      var iCat = h2.indexOf('category');
      if (iId >= 0 && (iSell >= 0 || iPrice >= 0)) {
        v2values.slice(1).forEach(function (row) {
          var sourceId = Number(row[iId]);
          if (!sourceId) return;
          var active = iActive < 0 ? true : row[iActive];
          if (String(active).toLowerCase() === 'false' || active === false || active === 0) return;
          var sell =
            iSell >= 0 && row[iSell] !== '' && row[iSell] != null
              ? Number(row[iSell]) || 0
              : Number(row[iPrice]) || 0;
          if (!sell) return;
          var mrp =
            iMrp >= 0 && row[iMrp] !== '' && row[iMrp] != null ? Number(row[iMrp]) || sell : sell;
          var sid = String(10000 + sourceId);
          map[sid] = {
            id: 10000 + sourceId,
            name: iName >= 0 ? String(row[iName] || '') : '',
            unit: '1 Pack',
            category: iCat >= 0 ? String(row[iCat] || 'Other') : 'Other',
            price: sell,
            originalPrice: mrp || sell,
            vendor: 'ignite'
          };
        });
      }
    }
  }
  return map;
}

/** Recompute money from Products sheet — never trust client totals/prices. */
function priceCartFromCatalog(cart) {
  var map = loadProductPriceMap();
  var useCatalog = Object.keys(map).length > 0;
  var out = {};
  var total = 0;
  var saved = 0;
  var keys = Object.keys(cart || {}).slice(0, MAX_CART_ITEMS);
  if (!keys.length) return { error: 'Empty cart' };

  for (var i = 0; i < keys.length; i++) {
    var id = String(keys[i]).slice(0, 24);
    var item = cart[keys[i]] || {};
    var qty = Math.min(999, Math.max(1, parseInt(item.quantity, 10) || 1));
    var live = useCatalog ? map[id] : null;
    var price = live ? live.price : Number(item.price) || 0;
    var mrp = live ? live.originalPrice || price : Number(item.originalPrice) || price;
    var name = live ? live.name : String(item.name || '').slice(0, 120);
    var unit = live ? live.unit : String(item.unit || '').slice(0, 40);
    var category = live ? live.category : String(item.category || 'Other');

    out[id] = {
      id: live ? live.id : item.id,
      name: name,
      unit: unit,
      category: category || 'Other',
      price: price,
      originalPrice: mrp,
      quantity: qty
    };
    total += price * qty;
    saved += Math.max(0, mrp - price) * qty;
  }

  return {
    cart: out,
    total: Math.round(total),
    saved: Math.round(saved)
  };
}

function sanitizeCart(cart) {
  var priced = priceCartFromCatalog(cart);
  return priced.cart || {};
}

function readProducts() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PRODUCTS_SHEET);
  if (!sheet) return [];
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  var headers = values[0];
  var rows = values.slice(1);
  var byCategory = {};

  rows.forEach(function (row) {
    var item = {};
    headers.forEach(function (h, i) {
      item[h] = row[i];
    });
    if (String(item.active).toLowerCase() === 'false' || item.active === false || item.active === 0) {
      return;
    }
    var cat = item.category || 'Other';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push({
      id: Number(item.id),
      name: String(item.name),
      originalPrice: Number(item.originalPrice),
      price: Number(item.price),
      unit: String(item.unit),
      image: String(item.image || 'assets/optimized/placeholder.jpg'),
      active: true,
      limited:
        String(item.limited).toLowerCase() === 'true' ||
        item.limited === true ||
        item.limited === 1
    });
  });

  return Object.keys(byCategory).map(function (category) {
    return { category: category, items: byCategory[category] };
  });
}

/** Ensure Products_v2 has an image column (does not wipe existing data). */
function ensureProductsV2ImageColumn_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(PRODUCTS_V2_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(PRODUCTS_V2_SHEET);
    sheet.appendRow(PRODUCTS_V2_HEADERS);
    sheet.setFrozenRows(1);
    return sheet;
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(PRODUCTS_V2_HEADERS);
    sheet.setFrozenRows(1);
    return sheet;
  }
  var meta = readEnquiryHeaderMap_(sheet);
  if (headerCol_(meta.map, ['image', 'Image', 'photo', 'Photo'])) return sheet;
  var col = Math.max(meta.colCount, 0) + 1;
  sheet.getRange(1, col).setValue('image');
  return sheet;
}

/**
 * Ignite catalogue for the website — same shape as readProducts().
 * Site ids = 10000 + Products_v2 id. Sell from sellingPrice. Image from image column.
 */
function readProductsV2() {
  ensureProductsV2ImageColumn_();
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PRODUCTS_V2_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var values = sheet.getDataRange().getValues();
  var headers = values[0];
  var idx = {};
  for (var h = 0; h < headers.length; h++) {
    idx[normalizeHeader_(headers[h])] = h;
  }
  function col_(names) {
    for (var i = 0; i < names.length; i++) {
      var k = normalizeHeader_(names[i]);
      if (idx[k] != null) return idx[k];
    }
    return -1;
  }
  var idCol = col_(['id', 'product id', 'sno']);
  var catCol = col_(['category']);
  var nameCol = col_(['name', 'product', 'item']);
  var mrpCol = col_(['mrp', 'originalprice', 'original price']);
  var sellCol = col_(['sellingprice', 'selling price', 'price']);
  var imageCol = col_(['image', 'photo']);
  var activeCol = col_(['active']);
  var limitedCol = col_(['limited']);
  var unitCol = col_(['unit']);
  if (idCol < 0 || nameCol < 0) return [];

  var byCategory = {};
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var sourceId = Number(row[idCol]);
    if (!sourceId) continue;
    if (activeCol >= 0) {
      var active = row[activeCol];
      if (String(active).toLowerCase() === 'false' || active === false || active === 0) continue;
    }
    var sell = sellCol >= 0 ? Number(row[sellCol]) || 0 : 0;
    var mrp = mrpCol >= 0 && row[mrpCol] !== '' && row[mrpCol] != null ? Number(row[mrpCol]) || sell : sell;
    var image =
      imageCol >= 0 && row[imageCol]
        ? String(row[imageCol]).trim()
        : 'assets/optimized/placeholder.jpg';
    if (!image) image = 'assets/optimized/placeholder.jpg';
    var cat = catCol >= 0 ? String(row[catCol] || 'Other') : 'Other';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push({
      id: 10000 + sourceId,
      sourceId: sourceId,
      name: String(row[nameCol] || ''),
      originalPrice: mrp,
      price: sell,
      unit: unitCol >= 0 && row[unitCol] ? String(row[unitCol]) : '1 Pack',
      image: image,
      active: true,
      limited:
        limitedCol >= 0 &&
        (String(row[limitedCol]).toLowerCase() === 'true' ||
          row[limitedCol] === true ||
          row[limitedCol] === 1),
      vendor: 'ignite'
    });
  }

  return Object.keys(byCategory).map(function (category) {
    return { category: category, vendor: 'ignite', items: byCategory[category] };
  });
}

/** Write one Ignite image path onto Products_v2 (by sheet id / sourceId). */
function updateIgniteImage_(sourceIdOrSiteId, imagePath) {
  var n = Number(sourceIdOrSiteId);
  if (!n) return { ok: false, message: 'Missing product id' };
  var sourceId = n >= 10000 ? n - 10000 : n;
  var image = String(imagePath || '').trim();
  if (!image) image = 'assets/optimized/placeholder.jpg';
  if (image.indexOf('assets/optimized/') !== 0) {
    return { ok: false, message: 'Image must be under assets/optimized/' };
  }

  var sheet = ensureProductsV2ImageColumn_();
  var meta = readEnquiryHeaderMap_(sheet);
  var idCol = headerCol_(meta.map, ['id', 'product id', 'sno']);
  var imageCol = headerCol_(meta.map, ['image', 'Image', 'photo', 'Photo']);
  if (!idCol || !imageCol) return { ok: false, message: 'Products_v2 id/image columns missing' };

  var lastRow = Math.max(sheet.getLastRow(), 2);
  var ids = sheet.getRange(2, idCol, lastRow, idCol).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (Number(ids[i][0]) === sourceId) {
      sheet.getRange(i + 2, imageCol).setValue(image);
      return { ok: true, sourceId: sourceId, image: image };
    }
  }
  return { ok: false, message: 'Product id ' + sourceId + ' not found on Products_v2' };
}

/** Batch set images: { "1": "assets/optimized/47.jpg", ... } keyed by Products_v2 id */
function setIgniteImages_(images) {
  var sheet = ensureProductsV2ImageColumn_();
  var meta = readEnquiryHeaderMap_(sheet);
  var idCol = headerCol_(meta.map, ['id', 'product id', 'sno']);
  var imageCol = headerCol_(meta.map, ['image', 'Image', 'photo', 'Photo']);
  var updated = 0;
  var skipped = 0;
  if (!idCol || !imageCol || !images || typeof images !== 'object') {
    return { updated: 0, skipped: 0 };
  }
  var lastRow = Math.max(sheet.getLastRow(), 2);
  var ids = sheet.getRange(2, idCol, lastRow, idCol).getValues();
  var rowById = {};
  for (var i = 0; i < ids.length; i++) {
    var sid = Number(ids[i][0]);
    if (sid) rowById[sid] = i + 2;
  }
  Object.keys(images).forEach(function (key) {
    var sourceId = Number(key);
    if (sourceId >= 10000) sourceId = sourceId - 10000;
    var row = rowById[sourceId];
    var image = String(images[key] || '').trim();
    if (!row || !image || image.indexOf('assets/optimized/') !== 0) {
      skipped++;
      return;
    }
    sheet.getRange(row, imageCol).setValue(image);
    updated++;
  });
  return { updated: updated, skipped: skipped };
}

function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

function importProductsFromJson(jsonText) {
  var data = JSON.parse(jsonText);
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PRODUCTS_SHEET);
  if (!sheet) {
    setupSheet();
    sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PRODUCTS_SHEET);
  }
  sheet.clear();
  sheet.appendRow(['id', 'category', 'name', 'originalPrice', 'price', 'unit', 'image', 'active', 'limited']);
  data.forEach(function (cat) {
    (cat.items || []).forEach(function (item) {
      sheet.appendRow([
        item.id,
        cat.category,
        item.name,
        item.originalPrice,
        item.price,
        item.unit,
        item.image || '',
        item.active !== false,
        !!item.limited
      ]);
    });
  });
}
/** Auto-generated from Sri Crackers PDF — seller wholesale rates */
var SELLER_COST_SEED = [
  [1, '2 ¾” Kuruvi', 10, '1 Packet', 'Single Sound'],
  [2, '3 ½” Lakshmi', 16, '1 packet', 'Single Sound'],
  [3, '4” Lakshmi', 23, '1 packet', 'Single Sound'],
  [4, '4” Lakshmi Deluxe / Gold', 32, '1 packet', 'Single Sound'],
  [5, '5” Tiger', 45, '1 Packet', 'Single Sound'],
  [6, '6” Mega Jallikattu / Tiger - Machine Fuse', 70, '1 Packet', 'Single Sound'],
  [7, '2 Sound', 36, '1 Packet', 'Single Sound'],
  [8, 'Red Bijili Premium 100 Pcs', 40, '1 packet', 'Bijili/Twin Star'],
  [9, 'Stripped Bijili Extra Power 100 Pcs', 45, '1 packet', 'Bijili/Twin Star'],
  [10, '1.5” Twin Star 10 pcs', 30, '1 box', 'Bijili/Twin Star'],
  [11, '4” Deluxe Twin Stars 10 pcs', 75, '1 box', 'Bijili/Twin Star'],
  [12, 'Amazing Pencil R&G (3 Piece Pack)', 80, '1 box', 'Pencil Varieties'],
  [13, 'Red Flare (5 Piece Pack) - Red colour', 175, '1 box', 'Pencil Varieties'],
  [14, 'Anandha\'s Pencil Items - 2 Varities New Arrival!!', 175, '1 box', 'Pencil Varieties'],
  [15, 'Wolverine - Golden Falls (5 Piece Pack)', 160, '1 box', 'Pencil Varieties'],
  [16, 'Thor Hammer (2pcs) New arrival Limited!!', 270, '1 box', 'Pencil Varieties'],
  [17, 'Hydro Bomb', 75, '1 box', 'Sound Bomb'],
  [18, 'King Bomb', 100, '1 box', 'Sound Bomb'],
  [19, 'Classic Bomb', 160, '1 box', 'Sound Bomb'],
  [20, 'Agni Bomb', 200, '1 box', 'Sound Bomb'],
  [21, 'Red Digital / 7G Boys Bomb', 250, '1 box', 'Sound Bomb'],
  [22, '28 Chorsa', 18, '1 packet', 'Florals Crackers'],
  [23, '28 Giant', 30, '1 packet', 'Florals Crackers'],
  [24, '56 Giant', 60, '1 packet', 'Florals Crackers'],
  [25, '24 Deluxe Powerful', 60, '1 packet', 'Florals Crackers'],
  [26, '50 Deluxe Ultra Power', 140, '1 packet', 'Florals Crackers'],
  [27, '100 Deluxe Extreme Power', 270, '1 packet', 'Florals Crackers'],
  [28, '100 Wala', 45, '1 packet', 'Florals Crackers'],
  [29, '1000 Wala Super', 250, '1 box', 'Florals Crackers'],
  [30, '1000 Wala Premium (Extra Power)', 360, '1 box', 'Florals Crackers'],
  [31, '2000 Wala Super', 500, '1 box', 'Florals Crackers'],
  [32, '2000 Wala Premium (Extra Power)', 720, '1 box', 'Florals Crackers'],
  [33, '5000 Wala Super', 1250, '1 box', 'Florals Crackers'],
  [34, '5000 Wala Premium (Extra Power)', 1800, '1 box', 'Florals Crackers'],
  [35, '10000 Wala Super', 2500, '1 box', 'Florals Crackers'],
  [36, '10000 Wala Premium (Extra Power)', 3600, '1 box', 'Florals Crackers'],
  [37, 'Rocket Bomb', 65, '1 box', 'Rocket'],
  [38, 'Lunik Rocket', 120, '1 box', 'Rocket'],
  [39, 'Sky Whistling Rocket', 150, '1 box', 'Rocket'],
  [40, '1/4 KG Bomb', 55, '1 box', 'Adiyal and Money Bomb'],
  [41, '1/2 KG Bomb', 110, '1 box', 'Adiyal and Money Bomb'],
  [42, '1 KG Bomb', 200, '1 box', 'Adiyal and Money Bomb'],
  [43, 'Candy Crush (25pcs) -New Arrival', 100, '1 box', 'Adiyal and Money Bomb'],
  [44, 'Children\'s day out gifts', 180, '1 box', 'Adiyal and Money Bomb'],
  [45, 'Magic Show or Money Heist - 2 pieces', 210, '1 box', 'Adiyal and Money Bomb'],
  [46, 'Ground Chakkars Big', 40, '1 box', 'Ground Chakkars Varities'],
  [47, 'Ground Chakkars Special', 80, '1 box', 'Ground Chakkars Varities'],
  [48, 'Ground Chakkars Deluxe', 160, '1 box', 'Ground Chakkars Varities'],
  [49, 'Maska Chaska - Red and Green', 180, '1 box', 'Ground Chakkars Varities'],
  [50, 'Rathna\'s Mega Chakkar Deluxe', 250, '1 box', 'Ground Chakkars Varities'],
  [51, 'Flower Pot Big', 70, '1 box', 'Flower Pots Varities'],
  [52, 'Flower Pot Special', 90, '1 box', 'Flower Pots Varities'],
  [53, 'Flower Pot Ashoka', 120, '1 box', 'Flower Pots Varities'],
  [54, 'Colour Koti', 180, '1 box', 'Flower Pots Varities'],
  [55, 'Colour Koti Deluxe', 270, '1 box', 'Flower Pots Varities'],
  [56, 'Mega Deluxe Colour Koti - Red and Green', 525, '1 box', 'Flower Pots Varities'],
  [57, 'Kids  Tri Colour', 200, '1 box', 'Tri Colour Varieties'],
  [58, 'Yo-Yo Tri Colour Dlx', 250, '1 box', 'Tri Colour Varieties'],
  [59, 'HI-HI Bus (limited) New Arrival!!  Continuous Shower', 270, '1 box', 'Tri Colour Varieties'],
  [60, 'Ayyan\'s Little Dove Mix - 5 varities', 90, '1 box', 'Night Splendid Items'],
  [61, 'Glittering / Candy / Golden Pops', 90, '1 box', 'Night Splendid Items'],
  [62, 'Volcono Mix - 3 varities (New Arrival)', 75, '1 box', 'Night Splendid Items'],
  [63, 'Tin Shower (5 Varieties)', 85, '1 box', 'Night Splendid Items'],
  [64, 'Cherry Mix (5 Varieties - New Arrival)', 120, '1 box', 'Night Splendid Items'],
  [65, 'Bambaram', 120, '1 box', 'Night Splendid Items'],
  [66, 'Rang Lava R&G (20 secs)', 120, '1 box', 'Night Splendid Items'],
  [67, 'Colour Smoke - 3 Colours - Superb Timing', 180, '1 box', 'Night Splendid Items'],
  [68, 'Butterfly', 80, '1 box', 'Night Splendid Items'],
  [69, 'Kit Kat / Little Hearts', 30, '1 box', 'Night Splendid Items'],
  [70, 'Photo Flash - 5 pieces', 60, '1 box', 'Night Splendid Items'],
  [71, 'Krishna\'s Assorted Cartoon', 45, '1 box', 'Night Splendid Items'],
  [72, 'Drone', 120, '1 box', 'Night Splendid Items'],
  [73, 'Ayyan\'s Helicopter', 100, '1 box', 'Night Splendid Items'],
  [74, 'Mini Siren - 5 pieces', 150, '1 box', 'Night Splendid Items'],
  [75, 'Mega Siren - 3 pieces', 160, '1 box', 'Night Splendid Items'],
  [76, 'Colour Pots- 5 colours', 100, '1 box', 'Night Splendid Items'],
  [77, 'Lotus Wheel - 2 in 1 (New Arrival) Limited !!', 180, '1 box', 'Splendid Chakkar Varities'],
  [78, 'Moon or Honda Wheel (Triple Spin)', 150, '1 box', 'Splendid Chakkar Varities'],
  [79, 'Kalis Wire Chakkar Spl  - 10 pieces (Hand held)', 180, '1 box', 'Splendid Chakkar Varities'],
  [80, 'Hot Wheels / Circus - 5 pieces', 200, '1 box', 'Splendid Chakkar Varities'],
  [81, 'Jio Wheel (Pink colour wheel) -Limited', 180, '1 box', 'Splendid Chakkar Varities'],
  [82, 'Classic Wheel - Silver wheel', 100, '1 box', 'Splendid Chakkar Varities'],
  [83, 'Retro / Lays - 5 Varieties', 40, '1 box', 'Kids Special'],
  [84, 'WB Fountain - 5 Varieties', 65, '1 box', 'Kids Special'],
  [85, 'DinoDem 4 steps (Hot Sale Product ) New arrival Limited!!', 300, '1 box', 'Kids Special'],
  [86, 'Lion King - New Arrival -Limited!! 4steps', 300, '1 box', 'Kids Special'],
  [87, 'Hulk - Star Crakling', 150, '1 box', 'Kids Special'],
  [88, '24 Carat Gold  / Trixx / Spike / Rockstar', 190, '1 box', 'Kids Special'],
  [89, 'Color Galaxy - 5 Varities  - New Arrival- Limited!! (2pcs)', 230, '1 box', 'Kids Special'],
  [90, 'Romeo Juliet  - pink colour New Arrival', 230, '1 box', 'Kids Special'],
  [91, 'Mad Angles - 3 in 1 (New Arrival)', 200, '1 box', 'Kids Special'],
  [92, 'Pink Panther (Limited)', 180, '1 box', 'Kids Special'],
  [93, 'Flintstones / Dexter - New Arrival!!', 95, '1 box', 'Kids Special'],
  [94, 'Smoke Gun (Crakling function with smoke )  - 5 Pieces', 210, '1 box', 'Kids Special'],
  [95, 'Monkey Dance - 4 steps - (New Arrival)', 300, '1 box', 'Kids Special'],
  [96, 'Tropical Mushroom', 190, '1 box', 'Kids Special'],
  [97, 'Pink Pearls - 2 pieces  (New Arrival)', 250, '1 box', 'Kids Special'],
  [98, 'Cocomelons (5in1) New Arrival - Limited !!', 360, '1 box', 'Kids Special'],
  [99, 'Cylinder with smoke - 2 pieces (new Arrival)', 300, '1 box', 'Kids Special'],
  [100, 'Fruit Mix - 5 varieties (New Arrival)', 230, '1 box', 'Kids Special'],
  [101, 'Hybrid 2 in 1 New Arrival', 180, '1 box', 'Kids Special'],
  [102, 'Frozen  - Touchable', 120, '1 box', 'Kids Special'],
  [103, 'Ice Cream Cone  -  Limited !!', 200, '1 box', 'Kids Special'],
  [104, 'Feel the Fire Gun - Touchable', 320, '1 box', 'Kids Special'],
  [105, 'Kulfi 3 pieces (New Arrival)', 250, '1 box', 'Kids Special'],
  [106, 'Belly Dance Peacock - 4 varieties', 180, '1 box', 'Peacock Varieties'],
  [107, 'Anandha\'s Peacock - 5 Sides', 200, '1 box', 'Peacock Varieties'],
  [108, 'Bada Peacock Purple', 450, '1 box', 'Peacock Varieties'],
  [109, 'Bada Peacock 2in1  (Limited)', 420, '1 box', 'Peacock Varieties'],
  [110, '7 Shots - 5 piece', 100, '1 box', 'Muti Sky Shot Varieties'],
  [111, 'Penta Magic / Battle Ship - 5 colors in 1', 125, '1 box', 'Muti Sky Shot Varieties'],
  [112, 'Hi-Fi - 5 colors', 95, '1 box', 'Muti Sky Shot Varieties'],
  [113, 'Sky Shot- 10 piece', 140, '1 box', 'Muti Sky Shot Varieties'],
  [114, 'Chotta Fancy (5 Varieities)', 42, '1 piece', 'Fancy Sky Shots Pipes'],
  [115, '2” Fancy (5 Varieties)', 100, '1 piece', 'Fancy Sky Shots Pipes'],
  [116, '2.5” Fancy - SPL (5 Varieties)', 140, '1 piece', 'Fancy Sky Shots Pipes'],
  [117, '3 in 1 Fancy - 3 piece pack (6 Varieties) premium', 270, '1 piece', 'Fancy Sky Shots Pipes'],
  [118, '3.5” Fancy Premium (7 Varieties)', 285, '1 piece', 'Fancy Sky Shots Pipes'],
  [119, '3.5" Spl colour Blue Perals or Pink Bingo Boom-Limited', 300, '1 piece', 'Fancy Sky Shots Pipes'],
  [120, '3.5” Niagra Falls Bluestar  Fancy - Limited', 300, '1 piece', 'Fancy Sky Shots Pipes'],
  [121, '4" Fancy Marine / Candy Series spl colour(8 Varieties) New Arrival', 400, '1 piece', 'Fancy Sky Shots Pipes'],
  [122, '5” Fancy Elite (6 Varieties)', 600, '1 piece', 'Fancy Sky Shots Pipes'],
  [123, '4” Fancy Premium - 2 piece pack (5 Varieties)', 750, '1 piece', 'Fancy Sky Shots Pipes'],
  [124, 'Krishna\'s 4” Fancy - 2 piece pack (5 Varieties) - Limited', 800, '1 piece', 'Fancy Sky Shots Pipes'],
  [125, 'Sony 6" 3 Varities Awesome Display', 2000, '1 piece', 'Special Edition Mega Pipes-New Arrival (Limited!!)'],
  [126, 'Spnka 4" Gambling series (3 in 1) - 4 Varities -3 pcs pack', 1200, '1 box', 'Special Edition Mega Pipes-New Arrival (Limited!!)'],
  [127, 'Bindu\'s spl 6" 4 Varities wonderful display', 1400, '1 box', 'Special Edition Mega Pipes-New Arrival (Limited!!)'],
  [128, 'Spnka 4" Fruits series (Spl Color) - 4 Varities -2 pcs pack', 1200, '1 box', 'Special Edition Mega Pipes-New Arrival (Limited!!)'],
  [129, 'Sri Krishna 5" Elite series (Pink Panther ,Lone wolf)', 1400, '1 piece', 'Special Edition Mega Pipes-New Arrival (Limited!!)'],
  [130, 'Double Ball Premium ( 5 Varieties)', 420, '1 piece', 'Dual and Triple Sky Attractions'],
  [131, '8 Steps Premium ( 5 Varieties)', 350, '1 piece', 'Dual and Triple Sky Attractions'],
  [132, 'Triple Ball Premium ( 5 Varieties)', 600, '1 piece', 'Dual and Triple Sky Attractions'],
  [133, 'Dancing Shooters (Flying Mines)', 230, '1 piece', 'Dual and Triple Sky Attractions'],
  [134, '12 Steps Sky Shot (4 Varieties)', 360, '1 piece', 'Dual and Triple Sky Attractions'],
  [135, 'Love dose - 6 shot (New Arrival)', 100, '1 piece', 'Repeating Sky Shots'],
  [136, '10 Shots - Multi Color', 190, '1 piece', 'Repeating Sky Shots'],
  [137, '5G+ New Arrival - 5 in 1', 190, '1 piece', 'Repeating Sky Shots'],
  [138, '30 Shots Premium', 400, '1 piece', 'Repeating Sky Shots'],
  [139, '30 Shots Elite', 475, '1 piece', 'Repeating Sky Shots'],
  [140, '30 Peacock Dance (30 Mines Attraction)', 390, '1 piece', 'Repeating Sky Shots'],
  [141, '30 Flash Joker/ Chariot (30 Flash With Sky shots)', 450, '1 piece', 'Repeating Sky Shots'],
  [142, '60 Shots Premium', 800, '1 piece', 'Repeating Sky Shots'],
  [143, '60 Shots Elite', 950, '1 piece', 'Repeating Sky Shots'],
  [144, '120 Shots Premium', 1600, '1 piece', 'Repeating Sky Shots'],
  [145, '120 Shots Elite', 1900, '1 piece', 'Repeating Sky Shots'],
  [146, '240 Shots Premium', 3200, '1 piece', 'Repeating Sky Shots'],
  [147, '240 Shots Elite', 3800, '1 piece', 'Repeating Sky Shots'],
  [148, '510 Shots Elite (Exclusive for festivals)', 7900, '1 piece', 'Repeating Sky Shots'],
  [149, 'Krishna\'s Singing Dolls (10 Whistles)', 210, '1 box', 'Whistling Sky Shots'],
  [150, 'Sonny 25 cukatoo (Whistle with Boom)', 700, '1 box', 'Whistling Sky Shots'],
  [151, 'Krishna\'s Wedding Singer (50 Whistles)', 1300, '1 box', 'Whistling Sky Shots'],
  [152, 'Golden Octopusy (golden fall) - 2pcs', 1300, '1 box', 'Sonny\'s Sky Series - Limited!!'],
  [153, '4" Great wall series (10 varities) -2pcs', 1400, '1 box', 'Sonny\'s Sky Series - Limited!!'],
  [154, 'Neega Angels (blue) -2pcs', 1300, '1 box', 'Sonny\'s Sky Series - Limited!!'],
  [155, '5" Happy Ring or Duos Series (dual function)-2pcs', 1600, '1 box', 'Sonny\'s Sky Series - Limited!!'],
  [156, '2 inch Setout - 30 shots', 3300, '1 box', 'Setouts -Mega Continuous  Sky Display'],
  [157, 'Air Strike - 4x4 (New Arrival)', 3000, '1 box', 'Setouts -Mega Continuous  Sky Display'],
  [158, '3.5 inch Setout - 20 shots (Champion Nights)', 5400, '1 box', 'Setouts -Mega Continuous  Sky Display'],
  [159, 'Double Wave - 5x10 (New Arrival) - 2 in 1', 2700, '1 box', 'Setouts -Mega Continuous  Sky Display'],
  [160, '10x10 - Sizzling (100 Rider shots - New Arrival Limited)', 3300, '1 box', 'Setouts -Mega Continuous  Sky Display'],
  [161, '10x10 - Thunder Lights (100 shots - New Arrival Limited)', 4300, '1 box', 'Setouts -Mega Continuous  Sky Display'],
  [162, '10 cm Electric', 20, '1 box', 'Sparkelrs'],
  [163, '10 cm Red', 27, '1 box', 'Sparkelrs'],
  [164, '10 cm Green', 25, '1 box', 'Sparkelrs'],
  [165, '15 cm Electric', 45, '1 box', 'Sparkelrs'],
  [166, '15 cm Red', 48, '1 box', 'Sparkelrs'],
  [167, '15 cm Green', 45, '1 box', 'Sparkelrs'],
  [168, '30 cm Electric', 45, '1 box - 5 pcs', 'Sparkelrs'],
  [169, '30 cm Red', 48, '1 box - 5 pcs', 'Sparkelrs'],
  [170, '30 cm Green', 45, '1 box - 5 pcs', 'Sparkelrs'],
  [171, '50 cm Electric - Tube', 180, '1 box - 5 pcs', 'Sparkelrs'],
  [172, '50 cm Super Mix - Tube (4 in 1)', 230, '1 box - 5 pcs', 'Sparkelrs'],
  [173, '15 cm Orange (New Arrival Limited)', 75, '1 box - 10 pcs', 'Sparkelrs'],
  [174, '15 cm Pink (New Arrival Limited)', 75, '1 box - 10 pcs', 'Sparkelrs'],
  [175, 'Merry Go Go Rotating Sparkles (New Arrival Limited!!)', 220, '1 box', 'Sparkelrs'],
  [176, '5 Men Army - 5 in 1 or diamond', 63, '1 box', 'Colour Matches'],
  [177, 'Butterfly - 8 in 1', 120, '1 box', 'Colour Matches'],
  [178, 'Dhasara - 10 in 1 (10 boxes)', 200, '1 box', 'Colour Matches'],
  [179, 'Roll Cap Box', 75, '1 box', 'Roll Cap And Tablets'],
  [180, 'Sonny Big Snake Serpent', 30, '1 box', 'Roll Cap And Tablets'],
  [181, 'MIB (gun with Ring Cap) New Arrival', 125, '1 box', 'Roll Cap And Tablets'],
  [182, '19 Items', 330, '1 box', 'Gift Boxes'],
  [183, '23 Items', 390, '1 box', 'Gift Boxes'],
  [184, '27 Items', 450, '1 box', 'Gift Boxes'],
  [185, '41 Items', 750, '1 box', 'Gift Boxes'],
  [186, '52 Items', 950, '1 box', 'Gift Boxes'],
];

/* ========== PROFIT ANALYSIS (seller cost vs your sell price) ========== */

function normalizeProductName_(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[""''']/g, '')
    .replace(/¾/g, '3/4')
    .replace(/½/g, '1/2')
    .replace(/¼/g, '1/4')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenOverlap_(a, b) {
  var ta = String(a || '').split(' ').filter(Boolean);
  var tb = String(b || '').split(' ').filter(Boolean);
  if (!ta.length || !tb.length) return 0;
  var setB = {};
  tb.forEach(function (t) {
    setB[t] = true;
  });
  var hit = 0;
  ta.forEach(function (t) {
    if (setB[t]) hit++;
  });
  return hit / Math.max(ta.length, tb.length);
}

/** Seller costs from PDF seed baked into this script (no separate sheet). */
function loadSellerCostsFromSeed_() {
  var seed = typeof SELLER_COST_SEED !== 'undefined' ? SELLER_COST_SEED : [];
  return seed
    .map(function (r) {
      return {
        sno: Number(r[0]) || 0,
        name: String(r[1] || '').trim(),
        cost: Number(r[2]) || 0,
        unit: String(r[3] || '').trim(),
        category: String(r[4] || '').trim(),
        key: normalizeProductName_(r[1])
      };
    })
    .filter(function (s) {
      return s.name && s.cost;
    });
}

function readProductsFlat_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PRODUCTS_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var values = sheet.getDataRange().getValues();
  var headers = values[0];
  var out = [];
  values.slice(1).forEach(function (row) {
    var item = {};
    headers.forEach(function (h, i) {
      item[h] = row[i];
    });
    if (!item.name && !item.id) return;
    out.push({
      id: Number(item.id) || 0,
      category: String(item.category || 'Other'),
      name: String(item.name || ''),
      sell: Number(item.price) || 0,
      key: normalizeProductName_(item.name)
    });
  });
  return out;
}

/**
 * Ignite Products_v2 → site ids (10000 + sheet id).
 * Buying = buyingPrice column (your Ignite cost); sell = sellingPrice.
 */
function readIgniteProductsFlat_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PRODUCTS_V2_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var values = sheet.getDataRange().getValues();
  var headers = values[0];
  var idx = {};
  for (var h = 0; h < headers.length; h++) {
    idx[normalizeHeader_(headers[h])] = h;
  }
  function col_(names) {
    for (var i = 0; i < names.length; i++) {
      var k = normalizeHeader_(names[i]);
      if (idx[k] != null) return idx[k];
    }
    return -1;
  }
  var idCol = col_(['id', 'product id', 'sno']);
  var catCol = col_(['category']);
  var nameCol = col_(['name', 'product', 'item']);
  var buyCol = col_(['buyingprice', 'buying price', 'buy price', 'cost', 'purchase price']);
  var sellCol = col_(['sellingprice', 'selling price', 'sell price', 'price']);
  var activeCol = col_(['active']);
  if (idCol < 0 || nameCol < 0) return [];

  var out = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var sourceId = Number(row[idCol]);
    if (!sourceId) continue;
    if (activeCol >= 0) {
      var active = row[activeCol];
      if (String(active).toLowerCase() === 'false' || active === false || active === 0) continue;
    }
    var buyRaw = buyCol >= 0 ? row[buyCol] : '';
    var sellRaw = sellCol >= 0 ? row[sellCol] : '';
    var buy = buyRaw === '' || buyRaw == null ? '' : Number(buyRaw);
    if (buy !== '' && isNaN(buy)) buy = '';
    var sell = Number(sellRaw) || 0;
    out.push({
      id: 10000 + sourceId,
      sourceId: sourceId,
      category: catCol >= 0 ? String(row[catCol] || 'Other') : 'Other',
      name: String(row[nameCol] || ''),
      buy: buy,
      sell: sell,
      vendor: 'ignite'
    });
  }
  return out;
}

function matchSellerCost_(product, sellerByKey, sellerBySno, usedKeys) {
  var key = product.key;
  if (key && sellerByKey[key] && !usedKeys[key]) {
    usedKeys[key] = true;
    return sellerByKey[key];
  }
  if (product.id && sellerBySno[product.id]) {
    var byId = sellerBySno[product.id];
    var a = key;
    var b = byId.key;
    if (a && b && (a.indexOf(b) >= 0 || b.indexOf(a) >= 0 || tokenOverlap_(a, b) >= 0.5)) {
      if (!usedKeys[byId.key]) usedKeys[byId.key] = true;
      return byId;
    }
  }
  var best = null;
  var bestScore = 0;
  Object.keys(sellerByKey).forEach(function (sk) {
    if (usedKeys[sk]) return;
    var score = tokenOverlap_(key, sk);
    if (score > bestScore) {
      bestScore = score;
      best = sellerByKey[sk];
    }
  });
  if (best && bestScore >= 0.72) {
    usedKeys[best.key] = true;
    return best;
  }
  return null;
}

/**
 * Create/reset Profit_Analysis and fill from Products × PDF seller costs.
 * Run: setupProfitSheets  or  rebuildProfitAnalysis
 */
function setupProfitSheets() {
  rebuildProfitAnalysis();
  ensureEnquiryProfitSheet_();
  try {
    SpreadsheetApp.getUi().alert(
      'Profit_Analysis ready.\n\n' +
        'Sri: Products × PDF seller costs.\n' +
        'Ignite: Products_v2 buyingPrice / sellingPrice (ids 10001+).\n' +
        'Enquiry_Profit logs one row per enquiry.\n' +
        'Re-run rebuildProfitAnalysis() after price changes.'
    );
  } catch (e) {
    /* headless */
  }
}

/**
 * Rebuild Profit_Analysis:
 * - Sri Products × SELLER_COST_SEED (PDF)
 * - Ignite Products_v2 × buyingPrice / sellingPrice (site ids 10000+)
 */
function rebuildProfitAnalysis() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var products = readProductsFlat_();
  var sellers = loadSellerCostsFromSeed_();
  var sellerByKey = {};
  var sellerBySno = {};
  sellers.forEach(function (s) {
    sellerByKey[s.key] = s;
    if (s.sno) sellerBySno[s.sno] = s;
  });
  var used = {};
  var rows = products.map(function (p) {
    var seller = matchSellerCost_(p, sellerByKey, sellerBySno, used);
    var buy = seller ? seller.cost : '';
    var sell = p.sell;
    var profit = buy === '' ? '' : Math.round((sell - buy) * 100) / 100;
    var pct =
      buy === '' || !sell ? '' : Math.round(((sell - buy) / sell) * 10000) / 100;
    return [p.id, p.category, p.name, buy, sell, profit, pct];
  });

  // Ignite rows — buy/sell already on Products_v2; id = 10000 + sheet id
  var ignite = readIgniteProductsFlat_();
  for (var i = 0; i < ignite.length; i++) {
    var ig = ignite[i];
    var igBuy = ig.buy === '' || ig.buy == null ? '' : ig.buy;
    var igSell = ig.sell || 0;
    var igProfit = igBuy === '' ? '' : Math.round((igSell - igBuy) * 100) / 100;
    var igPct =
      igBuy === '' || !igSell ? '' : Math.round(((igSell - igBuy) / igSell) * 10000) / 100;
    rows.push([ig.id, ig.category, ig.name, igBuy, igSell, igProfit, igPct]);
  }

  var sh = ss.getSheetByName(PROFIT_ANALYSIS_SHEET);
  if (!sh) sh = ss.insertSheet(PROFIT_ANALYSIS_SHEET);
  sh.clear();
  sh.appendRow(PROFIT_HEADERS);
  sh.setFrozenRows(1);
  if (rows.length) {
    sh.getRange(2, 1, rows.length, PROFIT_HEADERS.length).setValues(rows);
  }
}

function ensureEnquiryProfitSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(ENQUIRY_PROFIT_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(ENQUIRY_PROFIT_SHEET);
    sheet.appendRow(ENQUIRY_PROFIT_HEADERS);
    sheet.setFrozenRows(1);
  } else if (sheet.getLastRow() === 0) {
    sheet.appendRow(ENQUIRY_PROFIT_HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * Map product id → { buy, sell, profit, name } from Profit_Analysis,
 * then fill any gaps from Products_v2 (Ignite 10000+ ids).
 * Missing / blank buying price → treat buy as sell (profit 0).
 */
function loadProfitByProductId_() {
  var map = loadProfitFromAnalysisSheet_();
  var ignite = readIgniteProductsFlat_();
  for (var i = 0; i < ignite.length; i++) {
    var ig = ignite[i];
    var id = String(ig.id);
    if (map[id] && !map[id].missingBuy) continue;
    var hasBuy = ig.buy !== '' && ig.buy != null && !isNaN(Number(ig.buy));
    var buyNum = hasBuy ? Number(ig.buy) : Number(ig.sell) || 0;
    var sell = Number(ig.sell) || 0;
    var profit = hasBuy ? Math.round((sell - buyNum) * 100) / 100 : 0;
    map[id] = {
      name: ig.name || '',
      buy: buyNum,
      sell: sell,
      profit: profit,
      missingBuy: !hasBuy
    };
  }
  return map;
}

function loadProfitFromAnalysisSheet_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PROFIT_ANALYSIS_SHEET);
  var map = {};
  if (!sh || sh.getLastRow() < 2) return map;

  var values = sh.getDataRange().getValues();
  var headers = values[0];
  var idx = {};
  for (var h = 0; h < headers.length; h++) {
    idx[normalizeHeader_(headers[h])] = h;
  }

  function findCol_(names) {
    for (var i = 0; i < names.length; i++) {
      var key = normalizeHeader_(names[i]);
      if (idx[key] != null) return idx[key];
    }
    return null;
  }

  var idCol = findCol_(['id', 'product id', 'pid', 'sno', 's.no']);
  var nameCol = findCol_(['name', 'product', 'item']);
  var buyCol = findCol_([
    'buying price',
    'buy price',
    'buyer price',
    'cost',
    'cost price',
    'purchase price',
    'seller cost'
  ]);
  var sellCol = findCol_([
    'selling price',
    'sell price',
    'sale price',
    'price',
    'mrp sell'
  ]);
  var profitCol = findCol_([
    'profit rupees',
    'profit rs',
    'profit ₹',
    'profit',
    'profit amount',
    'margin'
  ]);
  if (idCol == null) {
    Logger.log('Profit_Analysis: no id column. Headers=' + headers.join('|'));
    return map;
  }

  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var idRaw = row[idCol];
    if (idRaw === '' || idRaw == null) continue;
    // Sheets may store 162 or "162" or 162.0 — normalize to integer string when numeric
    var idNum = Number(idRaw);
    var id = !isNaN(idNum) && String(idRaw).trim() !== ''
      ? String(Math.round(idNum))
      : String(idRaw).trim();
    if (!id) continue;

    var buyRaw = buyCol != null ? row[buyCol] : '';
    var sellRaw = sellCol != null ? row[sellCol] : '';
    var sell = Number(sellRaw);
    if (isNaN(sell)) sell = 0;

    var buyNum = Number(buyRaw);
    var hasBuy =
      buyRaw !== '' &&
      buyRaw != null &&
      String(buyRaw).trim() !== '' &&
      !isNaN(buyNum);

    var profit = 0;
    var missingBuy = !hasBuy;
    if (hasBuy) {
      // Always sell − buy (do not trust blank Profit column — Number('') === 0 in JS)
      profit = Math.round((sell - buyNum) * 100) / 100;
    } else {
      // Assume buying = selling → profit 0
      profit = 0;
    }

    var entry = {
      name: nameCol != null ? String(row[nameCol] || '') : '',
      buy: hasBuy ? buyNum : sell,
      sell: sell,
      profit: profit,
      missingBuy: missingBuy
    };
    map[id] = entry;
    // Also index original string form if different
    var rawKey = String(idRaw).trim();
    if (rawKey && rawKey !== id) map[rawKey] = entry;
  }
  return map;
}

/**
 * Σ (unit profit × qty). Missing buy cost → profit 0 and listed in notes.
 */
function computeEnquiryProfit_(cart) {
  var profitMap = loadProfitByProductId_();
  var totalProfit = 0;
  var missing = [];
  var ids = Object.keys(cart || {});

  for (var i = 0; i < ids.length; i++) {
    var key = String(ids[i]);
    var line = cart[ids[i]] || {};
    var qty = Math.max(1, Number(line.quantity) || 1);
    var name = String(line.name || '').trim() || key;
    var lineId = line.id != null && line.id !== '' ? String(line.id).trim() : key;
    var lineIdNorm = !isNaN(Number(lineId)) ? String(Math.round(Number(lineId))) : lineId;

    var entry =
      profitMap[lineIdNorm] ||
      profitMap[lineId] ||
      profitMap[key] ||
      profitMap[!isNaN(Number(key)) ? String(Math.round(Number(key))) : key];

    var unitProfit = 0;
    var noteMissing = false;

    if (!entry) {
      unitProfit = 0;
      noteMissing = true;
    } else {
      unitProfit = Number(entry.profit);
      if (isNaN(unitProfit)) unitProfit = 0;
      if (entry.missingBuy) noteMissing = true;
    }

    totalProfit += unitProfit * qty;
    if (noteMissing) missing.push(lineIdNorm + ':' + name);
  }

  return {
    profitTotal: Math.round(totalProfit * 100) / 100,
    missingNote: missing.length ? missing.join('; ') : '',
    matched: Object.keys(profitMap).length
  };
}

function appendEnquiryProfitRow_(info) {
  var sheet = ensureEnquiryProfitSheet_();
  var computed = computeEnquiryProfit_(info.cart || {});
  if (computed.matched === 0) {
    Logger.log(
      'Enquiry_Profit: Profit_Analysis returned 0 products — check sheet name/headers'
    );
  }
  sheet.appendRow([
    info.serialNo,
    info.date || '',
    info.time || '',
    info.name || '',
    info.phone || '',
    Number(info.sellTotal) || 0,
    computed.profitTotal,
    computed.missingNote
  ]);
}

/**
 * Ignite Crackers price list → Products_v2.
 * sellingPrice = list rate; image column included (fill via /ignite-images desk).
 * WARNING: clears Products_v2. Prefer Ensure image column for existing sheets.
 * Run from sheet menu: Vish Profit → Seed Products_v2 (Ignite)
 */
function seedProductsV2() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(PRODUCTS_V2_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(PRODUCTS_V2_SHEET);
  } else {
    sheet.clear();
  }
  sheet.appendRow(PRODUCTS_V2_HEADERS);
  var values = PRODUCTS_V2_SEED.map(function (row) {
    var copy = row.slice();
    while (copy.length < PRODUCTS_V2_HEADERS.length) copy.push('');
    if (!copy[PRODUCTS_V2_HEADERS.indexOf('image')]) {
      copy[PRODUCTS_V2_HEADERS.indexOf('image')] = 'assets/optimized/placeholder.jpg';
    }
    return copy;
  });
  if (values.length) {
    sheet.getRange(2, 1, values.length, PRODUCTS_V2_HEADERS.length).setValues(values);
  }
  sheet.setFrozenRows(1);
  try {
    SpreadsheetApp.getUi().alert(
      'Products_v2 ready',
      values.length +
        ' Ignite items written (incl. image column). Set photos via /ignite-images.',
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  } catch (e) {
    /* headless */
  }
}

/** Run once on existing Products_v2 — adds image column if missing. */
function ensureProductsV2ImageColumn() {
  ensureProductsV2ImageColumn_();
  try {
    SpreadsheetApp.getUi().alert('Products_v2 image column is ready.');
  } catch (e) {}
}

/** [id, category, name, originalPrice, price, sellingPrice, active, limited, image] */
var PRODUCTS_V2_SEED = [
  [1, 'Chakras', 'CHAKKAR BIG (10PCS)', '', '', 35, true, false, 'assets/optimized/placeholder.jpg'],
  [2, 'Chakras', 'CHAKKAR BIG (25 PCS)', '', '', 75, true, false, 'assets/optimized/placeholder.jpg'],
  [3, 'Chakras', 'CHAKKAR SPECIAL', '', '', 69, true, false, 'assets/optimized/47.jpg'],
  [4, 'Chakras', 'CHAKKAR DELUXE', '', '', 127, true, false, 'assets/optimized/3.jpg'],
  [5, 'Chakras', 'DISCO / TAITANIC WHEEL CHAKKAR', '', '', 75, true, false, 'assets/optimized/placeholder.jpg'],
  [6, 'Chakras', 'WHIZLING WHEEL CHAKKAR', '', '', 98, true, false, 'assets/optimized/placeholder.jpg'],
  [7, 'Chakras', 'TREND / LOTUS WHEEL CHAKKAR', '', '', 156, true, false, 'assets/optimized/placeholder.jpg'],
  [8, 'Flower Pots', 'FLOWER POT SMALL', '', '', 52, true, false, 'assets/optimized/placeholder.jpg'],
  [9, 'Flower Pots', 'FLOWER POT BIG', '', '', 64, true, false, 'assets/optimized/placeholder.jpg'],
  [10, 'Flower Pots', 'FLOWER POT SPECIAL', '', '', 75, true, false, 'assets/optimized/placeholder.jpg'],
  [11, 'Flower Pots', 'FLOWER POT ASHOKA', '', '', 98, true, false, 'assets/optimized/placeholder.jpg'],
  [12, 'Flower Pots', 'FLOWER POT DELUXE (5 PCS)', '', '', 170, true, false],
  [13, 'Flower Pots', 'FLOWER POT SUPER (2PCS)', '', '', 81, true, false],
  [14, 'Flower Pots', 'COLOUR KOTI / GYPSY', '', '', 173, true, false],
  [15, 'Flower Pots', 'MEGA COLOUR KOTI DELUXE', '', '', 288, true, false],
  [16, 'Lakshmi Crackers', '2.75" KURUVI CRACKERS', '', '', 10, true, false],
  [17, 'Lakshmi Crackers', '3.5" LAKSHMI CRACKERS', '', '', 13, true, false],
  [18, 'Lakshmi Crackers', '3.5" PARROT CRACKERS', '', '', 15, true, false],
  [19, 'Lakshmi Crackers', '4" LAKSHMI CRACKERS', '', '', 18, true, false],
  [20, 'Lakshmi Crackers', '4" PARROT CRACKERS', '', '', 18, true, false],
  [21, 'Lakshmi Crackers', '4" DELUXE LAKSHMI', '', '', 29, true, false],
  [22, 'Lakshmi Crackers', '4" SUPER DELUXE LAKSHMI', '', '', 33, true, false],
  [23, 'Lakshmi Crackers', 'GOLD LAKSHMI MEGA', '', '', 35, true, false],
  [24, 'Lakshmi Crackers', '5" PAGUBALI / VIKRAM CRACKERS', '', '', 41, true, false],
  [25, 'Lakshmi Crackers', '6" JOKER / LAXMI CRACKERS', '', '', 52, true, false],
  [26, 'Twinkling Star / Pencil Items', '1.5" TWINKLING STAR', '', '', 29, true, false],
  [27, 'Twinkling Star / Pencil Items', '4" TWINKLING STAR', '', '', 75, true, false],
  [28, 'Twinkling Star / Pencil Items', 'POP CART PENCIL', '', '', 173, true, false],
  [29, 'Twinkling Star / Pencil Items', 'ELECTRIC STONE', '', '', 12, true, false],
  [30, 'Twinkling Star / Pencil Items', 'MAGIC POPS', '', '', 12, true, false],
  [31, 'Twinkling Star / Pencil Items', 'ZEE BOOMBA', '', '', 12, true, false],
  [32, 'Twinkling Star / Pencil Items', 'KIT KAT SHOWERS', '', '', 29, true, false],
  [33, 'Bomb Items', 'BULLET BOMB CRACKERS', '', '', 29, true, false],
  [34, 'Bomb Items', 'HYDRO BOMB CRACKERS', '', '', 52, true, false],
  [35, 'Bomb Items', 'KING OF KING BOMB CRACKERS', '', '', 87, true, false],
  [36, 'Bomb Items', 'CLASSIC BOMB CRACKERS', '', '', 98, true, false],
  [37, 'Bomb Items', 'HOLLY WOOD / DIGITAL / AGNI BOMB', '', '', 242, true, false],
  [38, 'Bomb Items', 'GANGA JAMUNA CRACKERS', '', '', 64, true, false],
  [39, 'Bomb Items', '1/4 KG PAPER BOMB CRACKERS', '', '', 58, true, false],
  [40, 'Bomb Items', '1/2 KG PAPER BOMB CRACKERS', '', '', 115, true, false],
  [41, 'Bomb Items', '1 KG PAPER BOMB CRACKERS', '', '', 230, true, false],
  [42, 'Wala Crackers', '100 WALA CRACKERS', '', '', 46, true, false],
  [43, 'Wala Crackers', '1 K WALA CRACKERS - NORMAL', '', '', 190, true, false],
  [44, 'Wala Crackers', '2 K WALA CRACKERS - NORMAL', '', '', 370, true, false],
  [45, 'Wala Crackers', '5 K WALA CRACKERS - NORMAL', '', '', 920, true, false],
  [46, 'Wala Crackers', '10 K WALA CRACKERS - NORMAL', '', '', 1840, true, false],
  [47, 'Wala Crackers', '1 K WALA CRACKERS - PREMIUM', '', '', 330, true, false],
  [48, 'Wala Crackers', '2 K WALA CRACKERS - PREMIUM', '', '', 660, true, false],
  [49, 'Wala Crackers', '5 K WALA CRACKERS - PREMIUM', '', '', 1600, true, false],
  [50, 'Wala Crackers', '10 K WALA CRACKERS - PREMIUM', '', '', 3200, true, false],
  [51, 'Bijili Crackers', 'RED BIJILI CRACKERS (50 PCS)', '', '', 17, true, false],
  [52, 'Bijili Crackers', 'STRIPPED BIJILI (50 PCS) CRACKERS', '', '', 18, true, false],
  [53, 'Bijili Crackers', 'RED BIJILI (100 PCS) CRACKERS', '', '', 32, true, false],
  [54, 'Bijili Crackers', 'STRIPPED BIJILI (100 PCS) CRACKERS', '', '', 34, true, false],
  [55, 'Rockets', 'MEGA WHIZLING ROCKET BOMB', '', '', 184, true, false],
  [56, 'Colour Crackling', 'BUTTERFLY COLOUR CHANGING', '', '', 81, true, false],
  [57, 'Colour Crackling', 'BIG SHOWER / KURKUREY', '', '', 69, true, false],
  [58, 'Colour Crackling', 'PENTA COLOUR FANCY', '', '', 150, true, false],
  [59, 'Colour Crackling', 'PHOTO FLASH (5 PCS) FUNCTION', '', '', 75, true, false],
  [60, 'Colour Crackling', 'BAMBARAM (10 PCS) FUNCTION', '', '', 110, true, false],
  [61, 'Colour Crackling', 'SMOKE COLOUR FUNCTION', '', '', 173, true, false],
  [62, 'Colour Crackling', 'PEACOCK FUNCTION MEDIUM', '', '', 161, true, false],
  [63, 'Colour Crackling', 'PEACOCK FUNCTION BADA', '', '', 391, true, false],
  [64, 'Colour Crackling', 'MINI SIREN (5 PCS) ALARM SOUND', '', '', 144, true, false],
  [65, 'Colour Crackling', 'SIREN (2 PCS) ALARM SOUND', '', '', 138, true, false],
  [66, 'Colour Crackling', 'SIREN (3 PCS) ALARM SOUND', '', '', 184, true, false],
  [67, 'Colour Crackling', 'MONEY PAPER VEDI / MILLIONAIRES', '', '', 213, true, false],
  [68, 'Amazing Fountain', 'RED SUN (5 PCS) (10 VARIETIES)', '', '', 173, true, false],
  [69, 'Amazing Fountain', 'TIN SMALL SIZE - 7UP, MANGO', '', '', 92, true, false],
  [70, 'Amazing Fountain', 'TIN BIG SIZE - NUTS, DRAGON', '', '', 156, true, false],
  [71, 'Amazing Fountain', 'STAR SHOW (RED & GREEN)', '', '', 173, true, false],
  [72, 'Amazing Fountain', 'WHITE CRACKLING FUNCTION', '', '', 173, true, false],
  [73, 'Amazing Fountain', 'TIO / KIO / SEO / MIO - TESCO', '', '', 173, true, false],
  [74, 'Amazing Fountain', 'KING CRACKLING MEGA', '', '', 253, true, false],
  [75, 'Amazing Fountain', 'WONDER 3 IN 1 CRACKLING MEGA', '', '', 253, true, false],
  [76, 'Amazing Fountain', 'TRI COLOUR FOUNTAIN (5 PCS)', '', '', 299, true, false],
  [77, 'Amazing Fountain', 'SELFIE STICK FLASH (5 PCS)', '', '', 144, true, false],
  [78, 'Amazing Fountain', 'HELICOPTER (5 PCS) SKY FLY', '', '', 104, true, false],
  [79, 'Amazing Fountain', 'DRONE (5 PCS) SKY FLY', '', '', 161, true, false],
  [80, 'Amazing Fountain', 'FEATHER - SMALL PEACOCK', '', '', 98, true, false],
  [81, 'Amazing Fountain', 'COLOUR RAIN / GOLDEN RAISE', '', '', 98, true, false],
  [82, 'Amazing Fountain', 'LOLLY POP - LONG STICK', '', '', 242, true, false],
  [83, 'Fancy Items', 'CHOTTA FANCY - SKY SHOT', '', '', 41, true, false],
  [84, 'Fancy Items', '3 BITS FANCY (3 PCS) (5 VARIETIES)', '', '', 196, true, false],
  [85, 'Fancy Items', 'STAR WORLD (5 PCS) (5 VARIETIES)', '', '', 184, true, false],
  [86, 'Fancy Items', '2.5" FANCY (1 PCS) (10 VARIETIES)', '', '', 115, true, false],
  [87, 'Fancy Items', '2.75" FANCY (1 PCS) (6 VARIETIES)', '', '', 202, true, false],
  [88, 'Fancy Items', '3 PCS FANCY (3 PCS) (6 VARIETIES)', '', '', 265, true, false],
  [89, 'Fancy Items', '3.5" FANCY (1 PCS) (6 VARIETIES)', '', '', 265, true, false],
  [90, 'Fancy Items', '5" FANCY (1 PCS) (6 VARIETIES)', '', '', 350, true, false],
  [91, 'Fancy Items', '5" FANCY (2 PCS) (6 VARIETIES)', '', '', 700, true, false],
  [92, 'Fancy Items', '6" FANCY (2 PCS) (4 VARIETIES)', '', '', 800, true, false],
  [93, 'Sky Shot Fancy', '7 SHOT (5 PCS)', '', '', 127, true, false],
  [94, 'Sky Shot Fancy', '12 SHOT STAR BOMB', '', '', 144, true, false],
  [95, 'Sky Shot Fancy', '12 SHOT BIG MULTI COLOUR', '', '', 259, true, false],
  [96, 'Sky Shot Fancy', '25 SHOT LONG SIZE RAIDER', '', '', 259, true, false],
  [97, 'Sky Shot Fancy', '30 SHOT MULTI COLOUR', '', '', 430, true, false],
  [98, 'Sky Shot Fancy', '60 SHOT MULTI COLOUR', '', '', 860, true, false],
  [99, 'Sky Shot Fancy', '120 SHOT MULTI COLOUR', '', '', 1725, true, false],
  [100, 'Sky Shot Fancy', '240 SHOT MULTI COLOUR', '', '', 3335, true, false],
  [101, 'Sparklers', '7CM ELECTRIC SPARKLERS', '', '', 9, true, false],
  [102, 'Sparklers', '7CM COLOUR SPARKLERS', '', '', 10, true, false],
  [103, 'Sparklers', '7CM GREEN SPARKLERS', '', '', 12, true, false],
  [104, 'Sparklers', '7CM RED SPARKLERS', '', '', 15, true, false],
  [105, 'Sparklers', '10CM ELECTRIC SPARKLERS', '', '', 16, true, false],
  [106, 'Sparklers', '10CM COLOUR SPARKLERS', '', '', 17, true, false],
  [107, 'Sparklers', '10CM GREEN SPARKLERS', '', '', 18, true, false],
  [108, 'Sparklers', '10CM RED SPARKLERS', '', '', 22, true, false],
  [109, 'Sparklers', '12CM ELECTRIC SPARKLERS', '', '', 24, true, false],
  [110, 'Sparklers', '12CM COLOUR SPARKLERS', '', '', 25, true, false],
  [111, 'Sparklers', '12CM GREEN SPARKLERS', '', '', 27, true, false],
  [112, 'Sparklers', '12CM RED SPARKLERS', '', '', 31, true, false],
  [113, 'Sparklers', '15CM ELECTRIC SPARKLERS', '', '', 41, true, false],
  [114, 'Sparklers', '15CM COLOUR SPARKLERS', '', '', 42, true, false],
  [115, 'Sparklers', '15CM GREEN SPARKLERS', '', '', 44, true, false],
  [116, 'Sparklers', '15CM RED SPARKLERS', '', '', 49, true, false],
  [117, 'Sparklers', '30CM ELECTRIC SPARKLERS', '', '', 41, true, false],
  [118, 'Sparklers', '30CM COLOUR SPARKLERS', '', '', 42, true, false],
  [119, 'Sparklers', '30CM GREEN SPARKLERS', '', '', 44, true, false],
  [120, 'Sparklers', '30CM RED SPARKLERS', '', '', 49, true, false],
  [121, 'Sparklers', '40CM ELECTRIC SPARKLERS', '', '', 124, true, false],
  [122, 'Sparklers', '40CM COLOUR SPARKLERS', '', '', 140, true, false],
  [123, 'Sparklers', '50CM ELECTRIC SPARKLERS', '', '', 152, true, false],
  [124, 'Sparklers', '50CM COLOUR SPARKLERS', '', '', 163, true, false],
  [125, 'Colour Matches', 'ORDINARY MATCHES', '', '', 12, true, false],
  [126, 'Colour Matches', 'JAMES BOND COLOUR MATCHES', '', '', 96, true, false],
  [127, 'Colour Matches', 'CLASSIC COLOUR MATCHES', '', '', 140, true, false],
  [128, 'Colour Matches', 'JACKE JOHN VOLOUT MATCH - 5BOX', '', '', 146, true, false],
  [129, 'Colour Matches', 'LAPTOP COLOUR MATCHES - 10 BOX', '', '', 280, true, false],
  [130, 'Colour Matches', 'ROLL CAP ITEMS', '', '', 68, true, false],
  [131, 'Colour Matches', 'SNAKE SERPHANT SMALL', '', '', 17, true, false],
  [132, 'Colour Matches', 'SNAKE SERPHANT BIG', '', '', 28, true, false],
  [133, 'Gift Boxes', '17 ITEMS GIFT BOX', '', '', 299, true, false],
  [134, 'Gift Boxes', '20 ITEMS GIFT BOX', '', '', 345, true, false],
  [135, 'Gift Boxes', '25 ITEMS GIFT BOX', '', '', 420, true, false],
  [136, 'Gift Boxes', '30 ITEMS GIFT BOX', '', '', 480, true, false],
  [137, 'Gift Boxes', '35 ITEMS GIFT BOX', '', '', 575, true, false],
  [138, 'Gift Boxes', '40 ITEMS GIFT BOX', '', '', 799, true, false],
  [139, 'Gift Boxes', '50 ITEMS GIFT BOX', '', '', 899, true, false],
  [140, 'Gift Boxes', 'VIP GIFT BOX', '', '', 1149, true, false],
  [141, 'Best Combo', 'Kids Combo', '', '', 3999, true, false],
  [142, 'Best Combo', 'Special Combo', '', '', 4999, true, false]
];

function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu('Vish Profit')
      .addItem('Setup / rebuild Profit_Analysis', 'rebuildProfitAnalysis')
      .addItem('Ensure Enquiry_Profit sheet', 'ensureEnquiryProfitSheet_')
      .addItem('Ensure Products_v2 image column', 'ensureProductsV2ImageColumn')
      .addItem('Seed Products_v2 (Ignite)', 'seedProductsV2')
      .addToUi();
  } catch (e) {
    /* headless */
  }
}
