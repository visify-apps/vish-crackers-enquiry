/* Private bill desk — password only typed by you; checked by Apps Script */
(function () {
  var SESSION_FLAG = 'vish_bill_unlocked_v1';
  var SESSION_PW = 'vish_bill_pw_v1';
  var lines = [];
  var enquirySno = '';
  var enquiryStatus = '';
  var fulfillVendor = '';
  var billPreviewUrl = '';
  var billPreviewFilename = '';
  var billPreviewMeta = null;
  var lastPayable = 0;
  var warmTimer = null;

  function cfg() {
    return window.SITE_CONFIG || {};
  }

  function $(id) {
    return document.getElementById(id);
  }

  function money(n) {
    return (cfg().currency || '₹') + Number(n || 0).toLocaleString('en-IN');
  }

  function setMsg(el, text, ok) {
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('is-ok', !!ok);
  }

  function isUnlocked() {
    return sessionStorage.getItem(SESSION_FLAG) === '1' && !!getSessionPassword();
  }

  function getSessionPassword() {
    return sessionStorage.getItem(SESSION_PW) || '';
  }

  function setUnlocked(on, password) {
    if (on && password) {
      sessionStorage.setItem(SESSION_FLAG, '1');
      sessionStorage.setItem(SESSION_PW, password);
    } else {
      sessionStorage.removeItem(SESSION_FLAG);
      sessionStorage.removeItem(SESSION_PW);
    }
  }

  function showDesk(show) {
    $('bill-gate').hidden = !!show;
    $('bill-desk').hidden = !show;
    if (show) startWarmPing();
    else stopWarmPing();
  }

  function startWarmPing() {
    stopWarmPing();
    warmTimer = setInterval(function () {
      var password = getSessionPassword();
      if (!password) return;
      postBill({ action: 'checkBillPassword', billPassword: password }, 1).catch(function () {});
    }, 180000);
  }

  function stopWarmPing() {
    if (warmTimer) {
      clearInterval(warmTimer);
      warmTimer = null;
    }
  }

  function refreshBillNo() {
    if (window.VishPdf && VishPdf.makeBillNo) {
      $('bill-no-preview').textContent = VishPdf.makeBillNo();
    }
  }

  function lineAmount(line) {
    return (Number(line.qty) || 0) * (Number(line.price) || 0);
  }

  function calcSubtotal() {
    return lines.reduce(function (sum, line) {
      return sum + lineAmount(line);
    }, 0);
  }

  function readMoneyField(id) {
    var raw = ($(id) && $(id).value) || '';
    if (raw === '' || raw == null) return 0;
    return Math.max(0, Number(raw) || 0);
  }

  function readDiscount(subtotal) {
    var n = readMoneyField('c-discount');
    if (n > subtotal) n = subtotal;
    return n;
  }

  function updateSummary() {
    var subtotal = calcSubtotal();
    var discount = readDiscount(subtotal);
    var charges = readMoneyField('c-charges');
    var payable = Math.max(0, subtotal - discount + charges);
    lastPayable = payable;
    if ($('bill-subtotal')) $('bill-subtotal').textContent = money(subtotal);
    if ($('bill-discount-label')) {
      $('bill-discount-label').textContent = discount > 0 ? '− ' + money(discount) : '− ₹0';
    }
    if ($('bill-charges-label')) $('bill-charges-label').textContent = money(charges);
    if ($('bill-total')) $('bill-total').textContent = money(payable);
  }

  function renderLines() {
    var body = $('bill-lines-body');
    body.innerHTML = '';
    lines.forEach(function (line, idx) {
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td><input data-k="name" data-i="' +
        idx +
        '" value="' +
        escapeAttr(line.name) +
        '" /></td>' +
        '<td class="col-unit"><input data-k="unit" data-i="' +
        idx +
        '" value="' +
        escapeAttr(line.unit) +
        '" /></td>' +
        '<td class="col-qty"><input data-k="qty" data-i="' +
        idx +
        '" type="number" min="1" step="1" value="' +
        (line.qty || 1) +
        '" /></td>' +
        '<td class="col-rate"><input data-k="price" data-i="' +
        idx +
        '" type="number" min="0" step="1" value="' +
        (line.price || 0) +
        '" /></td>' +
        '<td class="col-amt">' +
        money(lineAmount(line)) +
        '</td>' +
        '<td class="col-del"><button type="button" class="btn-secondary" data-del="' +
        idx +
        '">×</button></td>';
      body.appendChild(tr);
    });
    updateSummary();
    refreshBillNo();
  }

  function escapeAttr(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;');
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function cartToLines(cart) {
    var out = [];
    Object.keys(cart || {}).forEach(function (id) {
      var item = cart[id] || {};
      out.push({
        id: id,
        name: item.name || '',
        unit: item.unit || '',
        qty: Number(item.quantity) || 1,
        price: Number(item.price) || 0
      });
    });
    return out;
  }

  function cleanAreaHub(area) {
    return String(area || '')
      .replace(/^Fulfill\s*:\s*(Ignite|Sri)\s*[·\-–—]\s*/i, '')
      .replace(/^Fulfill\s*:\s*(Ignite|Sri)\s*/i, '')
      .trim();
  }

  function inferFulfillFromCart(cart) {
    var keys = Object.keys(cart || {});
    for (var i = 0; i < keys.length; i++) {
      var item = cart[keys[i]] || {};
      var v = String(item.vendor || '').toLowerCase();
      if (v === 'ignite' || v === 'sri') return v;
      var n = Number(item.id != null ? item.id : keys[i]);
      if (!isNaN(n) && n >= 10000) return 'ignite';
    }
    if (keys.length) return 'sri';
    return '';
  }

  function resolveFulfillVendor(enq) {
    var fromApi = String((enq && (enq.fulfillVendor || enq.fulfillLabel)) || '')
      .trim()
      .toLowerCase();
    if (fromApi.indexOf('ignite') === 0) return 'ignite';
    if (fromApi.indexOf('sri') === 0) return 'sri';

    var area = String((enq && enq.area) || '');
    var areaMatch = area.match(/Fulfill\s*:\s*(Ignite|Sri)/i);
    if (areaMatch) {
      return String(areaMatch[1]).toLowerCase() === 'ignite' ? 'ignite' : 'sri';
    }

    var items = String((enq && enq.itemsSummary) || '');
    var itemsMatch = items.match(/^\s*\[(Ignite|Sri)\]/i);
    if (itemsMatch) {
      return String(itemsMatch[1]).toLowerCase() === 'ignite' ? 'ignite' : 'sri';
    }

    return inferFulfillFromCart((enq && enq.cart) || {});
  }

  function fulfillDisplay(vendor) {
    if (vendor === 'ignite') {
      return {
        label: 'Ignite Crackers',
        hint: 'Place / pack this order against the Ignite price list (home & house curated set).'
      };
    }
    if (vendor === 'sri') {
      return {
        label: 'Sri Crackers',
        hint: 'Place / pack this order against the Sri price list (kids & open-sky curated set).'
      };
    }
    return {
      label: 'Unknown — check Items / cart ids',
      hint: 'Could not detect vendor. Prefer Ignite if product ids are 10001+, else Sri.'
    };
  }

  function paintFulfillNote(vendor) {
    fulfillVendor = vendor || '';
    var note = $('bill-fulfill-note');
    var nameEl = $('bill-fulfill-vendor');
    var hintEl = $('bill-fulfill-hint');
    if (!note || !nameEl) return;
    if (!fulfillVendor && !enquirySno) {
      note.hidden = true;
      note.classList.remove('is-ignite', 'is-sri');
      nameEl.textContent = '—';
      if (hintEl) hintEl.textContent = '';
      return;
    }
    var info = fulfillDisplay(fulfillVendor);
    note.hidden = false;
    note.classList.toggle('is-ignite', fulfillVendor === 'ignite');
    note.classList.toggle('is-sri', fulfillVendor === 'sri');
    nameEl.textContent = info.label;
    if (hintEl) hintEl.textContent = info.hint;
  }

  function fetchWithTimeout(url, options, ms) {
    var controller = new AbortController();
    var timer = setTimeout(function () {
      controller.abort();
    }, ms);
    return fetch(url, Object.assign({}, options, { signal: controller.signal })).finally(function () {
      clearTimeout(timer);
    });
  }

  async function postBill(payload, attempts) {
    var url = (cfg().appsScriptUrl || '').trim();
    if (!url) throw new Error('Apps Script URL missing in config');
    var maxTries = attempts || 3;
    var lastErr = null;

    for (var tryNo = 1; tryNo <= maxTries; tryNo++) {
      try {
        var res = await fetchWithTimeout(
          url,
          {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(payload),
            redirect: 'follow'
          },
          45000
        );
        var text = await res.text();
        var data = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch (parseErr) {
          data = null;
        }
        if (data && typeof data === 'object') return data;
        lastErr = new Error(
          'Google Script returned no JSON (try ' + tryNo + '/' + maxTries + '). Retrying…'
        );
      } catch (err) {
        if (err && err.name === 'AbortError') {
          lastErr = new Error(
            'Timed out waiting for Google Script (try ' + tryNo + '/' + maxTries + ')'
          );
        } else {
          lastErr = err || new Error('Network error');
        }
      }
      if (tryNo < maxTries) {
        await new Promise(function (resolve) {
          setTimeout(resolve, 800 * tryNo);
        });
      }
    }
    throw lastErr || new Error('Could not reach Google Script — try again');
  }

  function requirePassword() {
    var password = getSessionPassword();
    if (!password) {
      setUnlocked(false);
      showDesk(false);
      setMsg($('gate-msg'), 'Session expired — enter password again');
      return '';
    }
    return password;
  }

  function applyEnquiry(enq) {
    enquirySno = String(enq.serialNo || '');
    enquiryStatus = String(enq.orderStatus || '');
    $('enquiry-sno-label').textContent = enquirySno || '—';
    $('enquiry-status-label').textContent = enquiryStatus || '—';
    $('c-name').value = enq.name || '';
    $('c-phone').value = enq.phone || '';
    $('c-pincode').value = enq.pincode || '';
    $('c-area').value = cleanAreaHub(enq.area || '');
    $('c-city').value = enq.city || '';
    $('c-state').value = enq.state || '';
    $('c-address').value = enq.address || '';
    if ($('c-discount')) $('c-discount').value = '';
    if ($('c-charges')) $('c-charges').value = '';
    if ($('c-courier')) $('c-courier').value = '';
    if ($('c-tracking')) $('c-tracking').value = '';
    lines = cartToLines(enq.cart);
    if (!lines.length) {
      lines = [{ name: '', unit: '', qty: 1, price: 0 }];
    }
    paintFulfillNote(resolveFulfillVendor(enq));
    renderLines();
    hidePickList();
    hideRecent();
  }

  function hidePickList() {
    var el = $('bill-pick-list');
    if (el) {
      el.hidden = true;
      el.innerHTML = '';
    }
  }

  function hideRecent() {
    var el = $('bill-recent');
    if (el) {
      el.hidden = true;
      el.innerHTML = '';
    }
  }

  function renderMatchList(matches, containerId, title) {
    var el = $(containerId);
    if (!el) return;
    hidePickList();
    hideRecent();
    el.hidden = false;
    el.innerHTML =
      '<p class="bill-list-title">' +
      escapeHtml(title) +
      '</p>' +
      matches
        .map(function (m) {
          return (
            '<button type="button" class="bill-list-item" data-sno="' +
            escapeAttr(m.serialNo) +
            '">' +
            '<strong>#' +
            escapeHtml(m.serialNo) +
            '</strong> ' +
            escapeHtml(m.name || '') +
            ' · ' +
            escapeHtml(m.phone || '') +
            '<span>' +
            escapeHtml(m.date || '') +
            (m.totalPrice ? ' · ₹' + escapeHtml(String(m.totalPrice)) : '') +
            (m.orderStatus ? ' · ' + escapeHtml(m.orderStatus) : '') +
            (m.fulfillLabel || m.fulfillVendor
              ? ' · → ' + escapeHtml(m.fulfillLabel || (m.fulfillVendor === 'ignite' ? 'Ignite' : 'Sri'))
              : '') +
            '</span></button>'
          );
        })
        .join('');
  }

  async function unlock() {
    var password = ($('bill-password').value || '').trim();
    setMsg($('gate-msg'), 'Checking… (Google Script can take 10–20s first time)');
    try {
      if (!password) {
        setMsg($('gate-msg'), 'Enter password');
        return;
      }
      var data = await postBill({
        action: 'checkBillPassword',
        billPassword: password
      });
      if (!data || data.status !== 'ok') {
        setMsg($('gate-msg'), (data && data.message) || 'Wrong password');
        return;
      }
      setUnlocked(true, password);
      showDesk(true);
      setMsg($('gate-msg'), '');
      $('bill-password').value = '';
      refreshBillNo();
      if (!lines.length) {
        lines = [{ name: '', unit: '', qty: 1, price: 0 }];
        renderLines();
      }
      loadRecent(true);
    } catch (err) {
      setMsg($('gate-msg'), err.message || 'Unlock failed');
    }
  }

  async function loadBySno(sno) {
    var password = requirePassword();
    if (!password) return;
    setMsg($('desk-msg'), 'Loading enquiry…');
    var data = await postBill({
      action: 'getEnquiry',
      sno: sno,
      billPassword: password
    });
    if (!data || data.status !== 'ok' || !data.enquiry) {
      setMsg($('desk-msg'), (data && data.message) || 'Not found');
      return;
    }
    applyEnquiry(data.enquiry);
    var src = String((data.enquiry && data.enquiry.source) || '').trim();
    if (src && src !== 'Enquiries') {
      setMsg(
        $('desk-msg'),
        'Loaded #' +
          enquirySno +
          ' from ' +
          src +
          ' — Apps Script still on old version. Paste google-apps-script.js and Deploy → New version.',
        false
      );
    } else {
      setMsg($('desk-msg'), 'Loaded #' + enquirySno + ' from Enquiries', true);
    }
  }

  async function loadEnquiry() {
    var sno = ($('load-sno').value || '').trim();
    var phone = ($('load-phone').value || '').trim();
    setMsg($('desk-msg'), 'Loading… (may retry if Google is slow)');
    try {
      var password = requirePassword();
      if (!password) return;

      if (sno) {
        await loadBySno(sno);
        return;
      }
      if (!phone) {
        setMsg($('desk-msg'), 'Enter S.No or phone');
        return;
      }

      var data = await postBill({
        action: 'findByPhone',
        phone: phone,
        billPassword: password
      });
      if (!data || data.status !== 'ok') {
        setMsg($('desk-msg'), (data && data.message) || 'Not found');
        return;
      }
      if (data.enquiry) {
        applyEnquiry(data.enquiry);
        if ($('load-sno')) $('load-sno').value = enquirySno;
        setMsg($('desk-msg'), 'Loaded #' + enquirySno, true);
        return;
      }
      if (data.matches && data.matches.length) {
        renderMatchList(data.matches, 'bill-pick-list', 'Multiple matches — tap one');
        setMsg($('desk-msg'), data.matches.length + ' enquiries for this phone — pick one');
        return;
      }
      setMsg($('desk-msg'), 'Not found');
    } catch (err) {
      setMsg($('desk-msg'), err.message || 'Load failed');
    }
  }

  async function loadRecent(silent) {
    try {
      var password = requirePassword();
      if (!password) return;
      if (!silent) setMsg($('desk-msg'), 'Loading recent…');
      var data = await postBill({
        action: 'listRecent',
        limit: 20,
        billPassword: password
      });
      if (!data || data.status !== 'ok') {
        if (!silent) setMsg($('desk-msg'), (data && data.message) || 'Could not load recent');
        return;
      }
      var list = data.enquiries || [];
      if (!list.length) {
        if (!silent) setMsg($('desk-msg'), 'No recent enquiries');
        return;
      }
      renderMatchList(list, 'bill-recent', 'Recent enquiries — tap to load');
      if (!silent) setMsg($('desk-msg'), 'Showing last ' + list.length, true);
    } catch (err) {
      if (!silent) setMsg($('desk-msg'), err.message || 'Recent failed');
    }
  }

  async function exportCsv() {
    try {
      var password = requirePassword();
      if (!password) return;
      setMsg($('desk-msg'), 'Exporting CSV…');
      var today = new Date();
      var dd = String(today.getDate()).padStart(2, '0');
      var mm = String(today.getMonth() + 1).padStart(2, '0');
      var yyyy = today.getFullYear();
      var dateStr = dd + '/' + mm + '/' + yyyy;
      var data = await postBill({
        action: 'exportCsv',
        date: dateStr,
        billPassword: password
      });
      if (!data || data.status !== 'ok') {
        setMsg($('desk-msg'), (data && data.message) || 'Export failed');
        return;
      }
      var blob = new Blob([data.csv || ''], { type: 'text/csv;charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = data.filename || 'Enquiries.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setMsg($('desk-msg'), 'Downloaded ' + (data.rows || 0) + ' rows for ' + dateStr, true);
    } catch (err) {
      setMsg($('desk-msg'), err.message || 'Export failed');
    }
  }

  function readContact() {
    return {
      name: ($('c-name').value || '').trim(),
      phone: ($('c-phone').value || '').trim(),
      pincode: ($('c-pincode').value || '').trim(),
      officeName: ($('c-area').value || '').trim(),
      city: ($('c-city').value || '').trim(),
      state: ($('c-state').value || '').trim(),
      address: ($('c-address').value || '').trim()
    };
  }

  function cleanLines() {
    return lines
      .map(function (l) {
        return {
          name: String(l.name || '').trim(),
          unit: String(l.unit || '').trim(),
          qty: Math.max(1, parseInt(l.qty, 10) || 1),
          price: Math.max(0, Number(l.price) || 0)
        };
      })
      .filter(function (l) {
        return l.name;
      });
  }

  function buildBillMeta(billNo, clean) {
    var subtotal = clean.reduce(function (sum, l) {
      return sum + l.qty * l.price;
    }, 0);
    return {
      billNo: billNo,
      enquirySno: enquirySno,
      notes: ($('c-notes').value || '').trim(),
      discount: readDiscount(subtotal),
      packingTransport: readMoneyField('c-charges')
    };
  }

  function closeBillPdfViewer() {
    var viewer = $('bill-pdf-viewer');
    var frame = $('bill-pdf-frame');
    if (frame) frame.src = 'about:blank';
    if (viewer) viewer.hidden = true;
    document.body.classList.remove('pdf-viewer-open');
    if (billPreviewUrl) {
      URL.revokeObjectURL(billPreviewUrl);
      billPreviewUrl = '';
    }
    billPreviewFilename = '';
    billPreviewMeta = null;
  }

  function previewBill() {
    setMsg($('desk-msg'), '');
    try {
      if (!window.VishPdf || !VishPdf.createBillPreview) {
        setMsg($('desk-msg'), 'PDF library not ready — refresh page');
        return;
      }
      var contact = readContact();
      if (!contact.name || !contact.phone) {
        setMsg($('desk-msg'), 'Name and phone are required');
        return;
      }
      var clean = cleanLines();
      if (!clean.length) {
        setMsg($('desk-msg'), 'Add at least one product line');
        return;
      }
      closeBillPdfViewer();
      var billNo = VishPdf.makeBillNo();
      $('bill-no-preview').textContent = billNo;
      var meta = buildBillMeta(billNo, clean);
      var preview = VishPdf.createBillPreview(contact, clean, cfg(), meta);
      billPreviewUrl = preview.url;
      billPreviewFilename = preview.filename;
      lastPayable = preview.payable;
      billPreviewMeta = {
        contact: contact,
        lines: clean,
        meta: meta,
        payable: preview.payable
      };
      var frame = $('bill-pdf-frame');
      var viewer = $('bill-pdf-viewer');
      var title = $('bill-pdf-title');
      if (title) title.textContent = 'Bill ' + billNo;
      if (frame) frame.src = preview.url;
      if (viewer) viewer.hidden = false;
      document.body.classList.add('pdf-viewer-open');
      setMsg($('desk-msg'), 'Preview ready — check then download', true);
    } catch (err) {
      setMsg($('desk-msg'), err.message || 'PDF failed');
    }
  }

  function downloadBillFromViewer() {
    setMsg($('desk-msg'), '');
    try {
      if (!window.VishPdf || !VishPdf.downloadBillPdf) {
        setMsg($('desk-msg'), 'PDF library not ready — refresh page');
        return;
      }
      if (!billPreviewMeta) {
        setMsg($('desk-msg'), 'Open preview first');
        return;
      }
      var billNo = VishPdf.downloadBillPdf(
        billPreviewMeta.contact,
        billPreviewMeta.lines,
        cfg(),
        billPreviewMeta.meta
      );
      setMsg($('desk-msg'), 'Bill PDF downloaded — ' + billNo, true);
    } catch (err) {
      setMsg($('desk-msg'), err.message || 'Download failed');
    }
  }

  function downloadPackingSlip() {
    try {
      if (!window.VishPdf || !VishPdf.downloadPackingSlipPdf) {
        setMsg($('desk-msg'), 'PDF library not ready');
        return;
      }
      var contact = readContact();
      var clean = cleanLines();
      if (!clean.length) {
        setMsg($('desk-msg'), 'Add at least one product line');
        return;
      }
      var billNo =
        (billPreviewMeta && billPreviewMeta.meta && billPreviewMeta.meta.billNo) ||
        VishPdf.makeBillNo();
      VishPdf.downloadPackingSlipPdf(contact, clean, cfg(), {
        billNo: billNo,
        enquirySno: enquirySno
      });
      setMsg($('desk-msg'), 'Packing slip downloaded — ' + billNo, true);
    } catch (err) {
      setMsg($('desk-msg'), err.message || 'Packing slip failed');
    }
  }

  function customerWaDigits() {
    var digits = String(($('c-phone') && $('c-phone').value) || '').replace(/\D/g, '');
    if (digits.length > 10) digits = digits.slice(-10);
    if (digits.length === 10) return '91' + digits;
    return '';
  }

  function openCustomerWa(text) {
    var to = customerWaDigits();
    if (!to) {
      setMsg($('desk-msg'), 'Customer phone required for WhatsApp');
      return;
    }
    var url = 'https://wa.me/' + to + '?text=' + encodeURIComponent(text);
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function sendBillWhatsApp() {
    updateSummary();
    var contact = readContact();
    if (!contact.phone) {
      setMsg($('desk-msg'), 'Customer phone required');
      return;
    }
    var meta =
      (billPreviewMeta && billPreviewMeta.meta) ||
      buildBillMeta(($('bill-no-preview').textContent || '').trim() || '—', cleanLines());
    var payable =
      (billPreviewMeta && billPreviewMeta.payable != null
        ? billPreviewMeta.payable
        : lastPayable) || 0;
    var text =
      window.VishPdf && VishPdf.buildBillWhatsAppMessage
        ? VishPdf.buildBillWhatsAppMessage(contact, meta, payable, cfg())
        : 'Proforma ready. Amount: ' + money(payable);
    openCustomerWa(text);
    setMsg($('desk-msg'), 'WhatsApp opened — attach PDF after download', true);
  }

  function waTemplate(kind) {
    var name = ($('c-name').value || '').trim() || 'there';
    var brand = cfg().brandShort || 'Vish Crackers';
    var gpay = cfg().phone || '9994376845';
    var courier = ($('c-courier') && $('c-courier').value.trim()) || '';
    var tracking = ($('c-tracking') && $('c-tracking').value.trim()) || '';
    var texts = {
      address:
        'Hi ' +
        name +
        ',\n\nWould you like to make any changes to your order, or shall we proceed with it?\n\nTo proceed, please share your complete delivery address so we can confirm the delivery charges.',
      confirmed:
        'Thank you ' +
        name +
        '\n\nYour order is confirmed. We will update you once it is packed / dispatched from Sivakasi - ' +
        brand,
      dispatched: tracking
        ? 'Hi ' +
          name +
          '\n\nYour order has been dispatched' +
          (courier ? ' through ' + courier + ' couriers' : '') +
          ' with Tracking Id : ' +
          tracking +
          '.\n\nThank you - ' +
          brand
        : 'Hello ' +
          name +
          '\n\nYour order has been dispatched.' +
          (courier ? ' Parcel service: ' + courier + '.' : '') +
          ' Tracking details will be shared shortly - ' +
          brand,
      payment:
        'Hey ' +
        name +
        '\n\nFriendly reminder: please complete payment for your order so we can dispatch it.\n\nAmount payable: ' +
        money(lastPayable) +
        '\nGPAY Number : ' +
        gpay +
        '\n(share screenshot after payment success)'
    };
    var text = texts[kind];
    if (!text) return;
    openCustomerWa(text);
    setMsg($('desk-msg'), 'Template opened on WhatsApp', true);
  }

  function bind() {
    $('bill-unlock').addEventListener('click', unlock);
    $('bill-password').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') unlock();
    });
    $('btn-load').addEventListener('click', loadEnquiry);
    $('btn-recent').addEventListener('click', function () {
      loadRecent(false);
    });
    $('btn-export-csv').addEventListener('click', exportCsv);
    $('btn-lock').addEventListener('click', function () {
      closeBillPdfViewer();
      stopWarmPing();
      setUnlocked(false);
      showDesk(false);
      enquirySno = '';
      enquiryStatus = '';
      fulfillVendor = '';
      paintFulfillNote('');
      $('bill-password').value = '';
    });
    $('btn-add-line').addEventListener('click', function () {
      lines.push({ name: '', unit: '', qty: 1, price: 0 });
      renderLines();
    });
    $('btn-preview').addEventListener('click', previewBill);
    $('btn-packing-slip').addEventListener('click', downloadPackingSlip);
    $('btn-wa-bill').addEventListener('click', sendBillWhatsApp);

    ['c-discount', 'c-charges'].forEach(function (id) {
      if ($(id)) {
        $(id).addEventListener('input', updateSummary);
        $(id).addEventListener('change', updateSummary);
      }
    });

    document.querySelectorAll('[data-wa-tpl]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        waTemplate(btn.getAttribute('data-wa-tpl'));
      });
    });

    function onListClick(e) {
      var btn = e.target.closest('[data-sno]');
      if (!btn) return;
      var sno = btn.getAttribute('data-sno');
      if ($('load-sno')) $('load-sno').value = sno;
      loadBySno(sno).catch(function (err) {
        setMsg($('desk-msg'), err.message || 'Load failed');
      });
    }
    if ($('bill-pick-list')) $('bill-pick-list').addEventListener('click', onListClick);
    if ($('bill-recent')) $('bill-recent').addEventListener('click', onListClick);

    if ($('bill-pdf-close')) {
      $('bill-pdf-close').addEventListener('click', closeBillPdfViewer);
    }
    if ($('bill-pdf-backdrop')) {
      $('bill-pdf-backdrop').addEventListener('click', closeBillPdfViewer);
    }
    if ($('bill-pdf-download')) {
      $('bill-pdf-download').addEventListener('click', downloadBillFromViewer);
    }
    if ($('bill-pdf-wa')) {
      $('bill-pdf-wa').addEventListener('click', sendBillWhatsApp);
    }

    $('bill-lines-body').addEventListener('input', function (e) {
      var input = e.target.closest('input[data-i]');
      if (!input) return;
      var i = Number(input.dataset.i);
      var k = input.dataset.k;
      if (!lines[i]) return;
      lines[i][k] = input.value;
      updateSummary();
    });

    $('bill-lines-body').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-del]');
      if (!btn) return;
      var i = Number(btn.getAttribute('data-del'));
      lines.splice(i, 1);
      if (!lines.length) lines.push({ name: '', unit: '', qty: 1, price: 0 });
      renderLines();
    });

    $('bill-lines-body').addEventListener('change', function () {
      renderLines();
    });
  }

  function init() {
    bind();
    if (isUnlocked()) {
      showDesk(true);
      refreshBillNo();
      if (!lines.length) {
        lines = [{ name: '', unit: '', qty: 1, price: 0 }];
        renderLines();
      }
      loadRecent(true);
    } else {
      setUnlocked(false);
      showDesk(false);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
