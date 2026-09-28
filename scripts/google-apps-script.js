/**
 * Vish Fireworks Store — Google Apps Script (hardened)
 *
 * SECURITY (must follow):
 * 1. Google Sheet sharing = Restricted (only your Google account). NEVER "Anyone with the link".
 * 2. Deploy → Web app:
 *    - Execute as: Me
 *    - Who has access: Anyone   ← this is ONLY the web app URL, NOT the Sheet
 * 3. This script NEVER returns rows from the Enquiries sheet.
 * 4. Optional: set Script property ENQUIRY_INGEST_KEY and put the same value in js/config.js
 *    enquiryIngestKey. This blocks casual scrapers (not a secret once the site is public).
 *
 * SETUP:
 * 1. Paste this file into Apps Script bound to your Sheet.
 * 2. Run setupSheet() once (authorize).
 * 3. Deploy as Web app (settings above).
 * 4. Put the Web App URL in js/config.js → appsScriptUrl
 */

var PRODUCTS_SHEET = 'Products';
var ENQUIRIES_SHEET = 'Enquiries';
var MAX_CART_ITEMS = 120;
var MAX_BODY_CHARS = 80000;
var RATE_LIMIT_PER_PHONE = 5;
var RATE_WINDOW_SECONDS = 3600;

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

  var enquiries = ss.getSheetByName(ENQUIRIES_SHEET) || ss.insertSheet(ENQUIRIES_SHEET);
  if (enquiries.getLastRow() === 0) {
    enquiries.appendRow([
      'timestamp',
      'name',
      'phone',
      'address',
      'city',
      'state',
      'pincode',
      'officeName',
      'total',
      'saved',
      'itemsJson',
      'userAgent'
    ]);
  }

  var sheet1 = ss.getSheetByName('Sheet1');
  if (sheet1 && ss.getSheets().length > 1) {
    ss.deleteSheet(sheet1);
  }
}

function doGet(e) {
  var action = e && e.parameter && e.parameter.action;
  if (action === 'products') {
    return jsonOutput({ status: 'ok', products: readProducts() });
  }
  // Intentionally minimal — do not expose sheet names, counts, or enquiries
  return jsonOutput({ status: 'ok' });
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

    // Honeypot — bots often fill hidden "website" fields
    if (data.website || data.company || data.url) {
      return jsonOutput({ status: 'ok' });
    }

    if (!ingestKeyOk(data)) {
      return jsonOutput({ status: 'error', message: 'Unauthorized' });
    }

    var contact = validateEnquiry(data);
    if (contact.error) {
      return jsonOutput({ status: 'error', message: contact.error });
    }

    if (!rateLimitOk(contact.phone)) {
      return jsonOutput({ status: 'error', message: 'Too many requests. Try again later.' });
    }

    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ENQUIRIES_SHEET);
    if (!sheet) {
      setupSheet();
      sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ENQUIRIES_SHEET);
    }

    var cartJson = JSON.stringify(sanitizeCart(data.cart || {}));
    sheet.appendRow([
      data.submittedAt || new Date().toISOString(),
      contact.name,
      contact.phone,
      contact.address,
      contact.city,
      contact.state,
      contact.pincode,
      contact.officeName,
      Number(data.total) || 0,
      Number(data.saved) || 0,
      cartJson,
      String(data.userAgent || '').slice(0, 180)
    ]);

    return jsonOutput({ status: 'ok' });
  } catch (err) {
    return jsonOutput({ status: 'error', message: 'Rejected' });
  }
}

function ingestKeyOk(data) {
  var expected = PropertiesService.getScriptProperties().getProperty('ENQUIRY_INGEST_KEY');
  if (!expected) return true; // key not configured — open ingest with validation only
  return data && data.ingestKey && String(data.ingestKey) === String(expected);
}

function rateLimitOk(phone) {
  var cache = CacheService.getScriptCache();
  var key = 'enq_' + phone;
  var raw = cache.get(key);
  var count = raw ? Number(raw) : 0;
  if (count >= RATE_LIMIT_PER_PHONE) return false;
  cache.put(key, String(count + 1), RATE_WINDOW_SECONDS);
  return true;
}

function validateEnquiry(data) {
  var name = String(data.name || '').trim().slice(0, 80);
  var phone = String(data.phone || '').replace(/\s+/g, '');
  var pincode = String(data.pincode || '').trim();
  var city = String(data.city || '').trim().slice(0, 80);
  var state = String(data.state || '').trim().slice(0, 80);
  var officeName = String(data.officeName || '').trim().slice(0, 120);
  var address = String(data.address || 'Nearest parcel / courier office').trim().slice(0, 200);

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

function sanitizeCart(cart) {
  var out = {};
  var keys = Object.keys(cart || {}).slice(0, MAX_CART_ITEMS);
  keys.forEach(function (id) {
    var item = cart[id] || {};
    out[String(id).slice(0, 24)] = {
      id: item.id,
      name: String(item.name || '').slice(0, 120),
      unit: String(item.unit || '').slice(0, 40),
      price: Number(item.price) || 0,
      originalPrice: Number(item.originalPrice) || 0,
      quantity: Math.min(999, Math.max(1, Number(item.quantity) || 1))
    };
  });
  return out;
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
