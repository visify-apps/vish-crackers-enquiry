/**
 * Vish Fireworks Store — Google Apps Script (hardened v2)
 *
 * SECURITY:
 * 1. Sheet sharing = Restricted (only you). NEVER "Anyone with the link".
 * 2. Deploy → Web app: Execute as Me, Who has access: Anyone.
 * 3. Set Script property ENQUIRY_INGEST_KEY to the same value as js/config.js enquiryIngestKey.
 * 4. Optional: Script property NOTIFY_EMAIL (defaults to visifyapps@gmail.com).
 * 5. Never returns Enquiries rows.
 *
 * After pasting:
 * 1. Run setupSheet() once (if needed).
 * 2. Set ENQUIRY_INGEST_KEY.
 * 3. Run testNotifyEmail() once and click Allow (Gmail).
 * 4. Run flushEnquiryMailQueue() once and Allow if asked (triggers).
 * 5. Deploy → Manage deployments → Edit (pencil) → Version: New version → Deploy.
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
      'userAgent',
      'submissionId'
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

      var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ENQUIRIES_SHEET);
      if (!sheet) {
        setupSheet();
        sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ENQUIRIES_SHEET);
      }

      sheet.appendRow([
        data.submittedAt || new Date().toISOString(),
        contact.name,
        contact.phone,
        contact.address,
        contact.city,
        contact.state,
        contact.pincode,
        contact.officeName,
        priced.total,
        priced.saved,
        JSON.stringify(priced.cart),
        String(data.userAgent || '').slice(0, 180),
        submissionId
      ]);

      if (submissionId) markSubmission(submissionId);
      rateLimitBump(contact.phone);
      SpreadsheetApp.flush();

      // Queue mail so HTTP response returns fast (browser won't time out / false-fail).
      // Email is sent ~1s later via flushEnquiryMailQueue.
      try {
        queueEnquiryEmail(contact, priced, submissionId, data.submittedAt);
      } catch (mailErr) {
        Logger.log('Enquiry mail queue failed: ' + mailErr);
        try {
          sendEnquiryEmail(contact, priced, submissionId, data.submittedAt);
        } catch (inlineErr) {
          Logger.log('Inline enquiry mail failed: ' + inlineErr);
        }
      }

      return jsonOutput({
        status: 'ok',
        total: priced.total,
        saved: priced.saved
      });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return jsonOutput({ status: 'error', message: 'Rejected' });
  }
}

function notifyEmail() {
  var fromProp = PropertiesService.getScriptProperties().getProperty('NOTIFY_EMAIL');
  return String(fromProp || DEFAULT_NOTIFY_EMAIL).trim();
}

/**
 * Save mail payload and schedule a near-immediate flush.
 * Keeps doPost fast so the website does not hang or show a false network error.
 */
function queueEnquiryEmail(contact, priced, submissionId, submittedAt) {
  var item = {
    contact: contact,
    priced: {
      cart: priced.cart,
      total: priced.total,
      saved: priced.saved
    },
    submissionId: submissionId || '',
    submittedAt: submittedAt || new Date().toISOString()
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
        sendEnquiryEmail(item.contact, item.priced || {}, item.submissionId, item.submittedAt);
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

  // Remove one-shot triggers for this handler
  var triggers = ScriptApp.getProjectTriggers();
  for (var t = 0; t < triggers.length; t++) {
    if (triggers[t].getHandlerFunction() === 'flushEnquiryMailQueue') {
      try {
        ScriptApp.deleteTrigger(triggers[t]);
      } catch (delErr) {}
    }
  }

  // If new items arrived during flush, schedule another run
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
 * You should get a test mail at visifyapps@gmail.com within ~1 minute.
 */
function testNotifyEmail() {
  var to = notifyEmail();
  MailApp.sendEmail({
    to: to,
    subject: 'Vish enquiry — TEST mail OK',
    body:
      'This is a test from Vish Apps Script.\n\n' +
      'If you received this, email alerts are working.\n' +
      'Next: Deploy → Manage deployments → New version → Deploy,\n' +
      'then place a real enquiry from the website.\n\n' +
      'Sent to: ' +
      to +
      '\nTime: ' +
      new Date().toISOString()
  });
  Logger.log('Test mail sent to ' + to);
}

/**
 * Plain-text email: pack list first (id / name / qty), prices only at the end.
 * Easy to forward to the packing owner.
 */
function sendEnquiryEmail(contact, priced, submissionId, submittedAt) {
  var to = notifyEmail();
  if (!to) return;

  var cart = priced.cart || {};
  var ids = Object.keys(cart).sort(function (a, b) {
    return Number(a) - Number(b) || String(a).localeCompare(String(b));
  });

  var packLines = [];
  var priceLines = [];
  for (var i = 0; i < ids.length; i++) {
    var item = cart[ids[i]];
    var id = item.id != null ? item.id : ids[i];
    var name = item.name || '';
    var qty = item.quantity || 1;
    var unit = item.unit ? ' (' + item.unit + ')' : '';
    var price = Number(item.price) || 0;
    var lineTotal = price * qty;

    packLines.push(padRight(String(id), 6) + '  ' + name + unit + '  × ' + qty);
    priceLines.push(
      padRight(String(id), 6) +
        '  ' +
        name +
        '  × ' +
        qty +
        '  @ ₹' +
        price +
        '  = ₹' +
        lineTotal
    );
  }

  var when = submittedAt || new Date().toISOString();
  var subject =
    'New enquiry — ' + contact.name + ' — ' + ids.length + ' item(s) — ₹' + priced.total;

  var lines = [];
  lines.push('NEW ENQUIRY — Vish Fireworks Store');
  lines.push('================================');
  lines.push('');
  lines.push('CUSTOMER');
  lines.push('--------');
  lines.push('Name:    ' + contact.name);
  lines.push('Phone:   ' + contact.phone);
  lines.push('Pincode: ' + contact.pincode);
  lines.push('City:    ' + (contact.city || '-'));
  lines.push('State:   ' + (contact.state || '-'));
  lines.push('Office:  ' + (contact.officeName || '-'));
  lines.push('Address: ' + (contact.address || '-'));
  lines.push('Time:    ' + when);
  if (submissionId) lines.push('Ref:     ' + submissionId);
  lines.push('');
  lines.push('PACK LIST  (ID / NAME / QTY)  — forward this section');
  lines.push('-----------------------------------------------');
  if (packLines.length) {
    for (var p = 0; p < packLines.length; p++) lines.push(packLines[p]);
  } else {
    lines.push('(no items)');
  }
  lines.push('');
  lines.push('Total items: ' + ids.length);
  lines.push('');
  lines.push('PRICES (reference only — at the end)');
  lines.push('------------------------------------');
  if (priceLines.length) {
    for (var r = 0; r < priceLines.length; r++) lines.push(priceLines[r]);
  } else {
    lines.push('(no items)');
  }
  lines.push('');
  lines.push('Order total:  ₹' + priced.total);
  lines.push('Customer saved: ₹' + priced.saved);
  lines.push('');
  lines.push('— Auto mail from Vish enquiry form —');

  MailApp.sendEmail({
    to: to,
    subject: subject,
    body: lines.join('\n')
  });
}

function padRight(str, len) {
  str = String(str);
  while (str.length < len) str += ' ';
  return str;
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
  if (idIdx < 0 || priceIdx < 0) return map;

  values.slice(1).forEach(function (row) {
    var id = String(row[idIdx]);
    var active = activeIdx < 0 ? true : row[activeIdx];
    if (String(active).toLowerCase() === 'false' || active === false || active === 0) return;
    map[id] = {
      id: row[idIdx],
      name: nameIdx >= 0 ? String(row[nameIdx] || '') : '',
      unit: unitIdx >= 0 ? String(row[unitIdx] || '') : '',
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
    // Prefer sheet prices; if id missing from Products sheet, fall back to client line
    // so local-first catalogue still works before Products sync.
    var price = live ? live.price : Number(item.price) || 0;
    var mrp = live ? live.originalPrice || price : Number(item.originalPrice) || price;
    var name = live ? live.name : String(item.name || '').slice(0, 120);
    var unit = live ? live.unit : String(item.unit || '').slice(0, 40);

    out[id] = {
      id: live ? live.id : item.id,
      name: name,
      unit: unit,
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
