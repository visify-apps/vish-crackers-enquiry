/**
 * Vish Fireworks Store — Google Apps Script (hardened v3 — order sheet)
 *
 * SECURITY:
 * 1. Sheet sharing = Restricted (only you). NEVER "Anyone with the link".
 * 2. Deploy → Web app: Execute as Me, Who has access: Anyone.
 * 3. Set Script property ENQUIRY_INGEST_KEY to the same value as js/config.js enquiryIngestKey.
 * 4. Optional: Script property NOTIFY_EMAIL (defaults to visifyapps@gmail.com).
 * 5. Never returns Enquiries rows.
 *
 * After pasting:
 * 1. Run migrateEnquiriesSheet() once (wipes old Enquiries data + new headers/dropdowns).
 * 2. Set ENQUIRY_INGEST_KEY if not already set.
 * 3. Run testNotifyEmail() once and Allow (Gmail) if needed.
 * 4. Run flushEnquiryMailQueue() once and Allow if asked (triggers).
 * 5. Deploy → Manage deployments → Edit → Version: New version → Deploy.
 */

var PRODUCTS_SHEET = 'Products';
var ENQUIRIES_SHEET = 'Enquiries';
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

/** Column titles — keep Capitalized */
var ENQUIRY_HEADERS = [
  'S.No',
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
  'Submission Id'
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

  var sheet1 = ss.getSheetByName('Sheet1');
  if (sheet1 && ss.getSheets().length > 1) {
    ss.deleteSheet(sheet1);
  }
}

/**
 * ONE-TIME: clears old Enquiries rows and installs the new header layout + dropdowns.
 * Products sheet is not touched.
 */
function migrateEnquiriesSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(ENQUIRIES_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(ENQUIRIES_SHEET);
  }
  sheet.clear();
  sheet.clearDataValidations();
  sheet.appendRow(ENQUIRY_HEADERS);
  sheet.setFrozenRows(1);
  applyEnquiryValidations_(sheet);
  sheet.autoResizeColumns(1, ENQUIRY_HEADERS.length);
  Logger.log('Enquiries sheet migrated. Old enquiry rows were deleted.');
}

function ensureEnquiriesSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(ENQUIRIES_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(ENQUIRIES_SHEET);
    sheet.appendRow(ENQUIRY_HEADERS);
    sheet.setFrozenRows(1);
    applyEnquiryValidations_(sheet);
    return sheet;
  }
  var first = sheet.getRange(1, 1, 1, ENQUIRY_HEADERS.length).getValues()[0];
  if (String(first[0]).trim() !== 'S.No') {
    // Old layout still present — force migrate once so new writes do not corrupt columns
    migrateEnquiriesSheet();
    return ss.getSheetByName(ENQUIRIES_SHEET);
  }
  applyEnquiryValidations_(sheet);
  return sheet;
}

function applyEnquiryValidations_(sheet) {
  var last = Math.max(sheet.getMaxRows(), 500);
  sheet.getRange(2, 13, last - 1, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(ORDER_STATUSES, true).setAllowInvalid(false).build()
  );
  sheet.getRange(2, 14, last - 1, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(PAYMENT_STATUSES, true).setAllowInvalid(false).build()
  );
}

function doGet(e) {
  var action = e && e.parameter && e.parameter.action;
  if (action === 'products') {
    return jsonOutput({ status: 'ok', products: readProducts() });
  }
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

    // Honeypot — only reject clear bot fills (URL-like). Autofill of "website" must not drop real orders.
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

      var sheet = ensureEnquiriesSheet_();
      var serialNo = nextSerialNumber_(sheet);
      var when = istParts_(data.submittedAt);
      var itemsSummary = itemsSummaryText_(priced);
      var waLink = 'https://wa.me/91' + contact.phone;

      sheet.appendRow([
        serialNo,
        when.date,
        when.time,
        contact.name,
        contact.phone,
        contact.officeName || '',
        contact.city || '',
        contact.state || '',
        contact.pincode,
        itemsSummary,
        priced.total,
        '', // Address — filled manually later
        'UnderEnquiry',
        'Pending',
        '', // Paid Amount
        waLink,
        JSON.stringify(priced.cart),
        submissionId
      ]);

      if (submissionId) markSubmission(submissionId);
      rateLimitBump(contact.phone);
      SpreadsheetApp.flush();

      try {
        queueEnquiryEmail(contact, priced, submissionId, serialNo);
      } catch (mailErr) {
        Logger.log('Enquiry mail queue failed: ' + mailErr);
        try {
          sendEnquiryEmail(contact, priced, submissionId, serialNo);
        } catch (inlineErr) {
          Logger.log('Inline enquiry mail failed: ' + inlineErr);
        }
      }

      return jsonOutput({
        status: 'ok',
        total: priced.total,
        saved: priced.saved,
        serialNo: serialNo
      });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return jsonOutput({ status: 'error', message: 'Rejected' });
  }
}

function nextSerialNumber_(sheet) {
  var last = sheet.getLastRow();
  if (last < 2) return 1;
  var values = sheet.getRange(2, 1, last - 1, 1).getValues();
  var max = 0;
  for (var i = 0; i < values.length; i++) {
    var n = Number(values[i][0]);
    if (!isNaN(n) && n > max) max = n;
  }
  return max + 1;
}

/** India time parts for sheet Date / Time columns */
function istParts_(submittedAt) {
  var d = submittedAt ? new Date(submittedAt) : new Date();
  if (isNaN(d.getTime())) d = new Date();
  var fmt = Session.getScriptTimeZone() || 'Asia/Kolkata';
  // Force IST display even if script timezone differs
  var date = Utilities.formatDate(d, 'Asia/Kolkata', 'dd/MM/yyyy');
  var time = Utilities.formatDate(d, 'Asia/Kolkata', 'HH:mm');
  return { date: date, time: time, tz: fmt };
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
function queueEnquiryEmail(contact, priced, submissionId, serialNo) {
  var item = {
    contact: contact,
    priced: {
      cart: priced.cart,
      total: priced.total,
      saved: priced.saved
    },
    submissionId: submissionId || '',
    serialNo: serialNo
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
        sendEnquiryEmail(item.contact, item.priced || {}, item.submissionId, item.serialNo);
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
function sendEnquiryEmail(contact, priced, submissionId, serialNo) {
  var to = notifyEmail();
  if (!to) return;

  var built = buildCategorizedLists_(priced.cart || {});
  var subject =
    'VishCrackers - New Order [Id : ' +
    serialNo +
    ', ' +
    contact.name +
    ', ' +
    priced.total +
    ']';

  var lines = [];
  lines.push('New enquiry');
  lines.push('');
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
    if (e.range.getColumn() !== 14) return; // Payment Status

    var value = String(e.value || '').trim();
    if (value !== 'Paid') return;

    var row = e.range.getRow();
    var totalPrice = sheet.getRange(row, 11).getValue(); // Total Price
    var paidCell = sheet.getRange(row, 15); // Paid Amount
    paidCell.setValue(totalPrice);
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
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PRODUCTS_SHEET);
  if (!sheet) return map;
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return map;
  var headers = values[0];
  var idIdx = headers.indexOf('id');
  var priceIdx = headers.indexOf('price');
  var mrpIdx = headers.indexOf('originalPrice');
  var nameIdx = headers.indexOf('name');
  var unitIdx = headers.indexOf('unit');
  var activeIdx = headers.indexOf('active');
  var catIdx = headers.indexOf('category');
  if (idIdx < 0 || priceIdx < 0) return map;

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
      originalPrice: mrpIdx >= 0 ? Number(row[mrpIdx]) || 0 : Number(row[priceIdx]) || 0
    };
  });
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
