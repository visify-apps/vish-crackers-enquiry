/* Private bill desk — password only typed by you; checked by Apps Script */
(function () {
  var SESSION_FLAG = 'vish_bill_unlocked_v1';
  var SESSION_PW = 'vish_bill_pw_v1';
  var lines = [];
  var enquirySno = '';
  var billPreviewUrl = '';
  var billPreviewFilename = '';
  var billPreviewMeta = null;

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

  function readDiscount(subtotal) {
    var raw = ($('c-discount') && $('c-discount').value) || '';
    if (raw === '' || raw == null) return 0;
    var n = Math.max(0, Number(raw) || 0);
    if (n > subtotal) n = subtotal;
    return n;
  }

  function updateSummary() {
    var subtotal = calcSubtotal();
    var discount = readDiscount(subtotal);
    var payable = Math.max(0, subtotal - discount);
    if ($('bill-subtotal')) $('bill-subtotal').textContent = money(subtotal);
    if ($('bill-discount-label')) {
      $('bill-discount-label').textContent = discount > 0 ? '− ' + money(discount) : '− ₹0';
    }
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

  function cartToLines(cart) {
    var out = [];
    Object.keys(cart || {}).forEach(function (id) {
      var item = cart[id] || {};
      out.push({
        name: item.name || '',
        unit: item.unit || '',
        qty: Number(item.quantity) || 1,
        price: Number(item.price) || 0
      });
    });
    return out;
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
    } catch (err) {
      setMsg($('gate-msg'), err.message || 'Unlock failed');
    }
  }

  async function loadEnquiry() {
    var sno = ($('load-sno').value || '').trim();
    setMsg($('desk-msg'), 'Loading enquiry… (may retry if Google is slow)');
    try {
      if (!sno) {
        setMsg($('desk-msg'), 'Enter enquiry S.No');
        return;
      }
      var password = getSessionPassword();
      if (!password) {
        setUnlocked(false);
        showDesk(false);
        setMsg($('gate-msg'), 'Session expired — enter password again');
        return;
      }
      var data = await postBill({
        action: 'getEnquiry',
        sno: sno,
        billPassword: password
      });
      if (!data || data.status !== 'ok' || !data.enquiry) {
        setMsg($('desk-msg'), (data && data.message) || 'Not found');
        return;
      }
      var enq = data.enquiry;
      enquirySno = String(enq.serialNo || sno);
      $('enquiry-sno-label').textContent = enquirySno;
      $('c-name').value = enq.name || '';
      $('c-phone').value = enq.phone || '';
      $('c-pincode').value = enq.pincode || '';
      $('c-area').value = enq.area || '';
      $('c-city').value = enq.city || '';
      $('c-state').value = enq.state || '';
      $('c-address').value = enq.address || '';
      if ($('c-discount')) $('c-discount').value = '';
      lines = cartToLines(enq.cart);
      if (!lines.length) {
        lines = [{ name: '', unit: '', qty: 1, price: 0 }];
      }
      renderLines();
      setMsg($('desk-msg'), 'Loaded from ' + (enq.source || 'sheet'), true);
    } catch (err) {
      setMsg($('desk-msg'), err.message || 'Load failed');
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
      discount: readDiscount(subtotal)
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
      billPreviewMeta = {
        contact: contact,
        lines: clean,
        meta: meta
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

  function bind() {
    $('bill-unlock').addEventListener('click', unlock);
    $('bill-password').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') unlock();
    });
    $('btn-load').addEventListener('click', loadEnquiry);
    $('btn-lock').addEventListener('click', function () {
      closeBillPdfViewer();
      setUnlocked(false);
      showDesk(false);
      $('bill-password').value = '';
    });
    $('btn-add-line').addEventListener('click', function () {
      lines.push({ name: '', unit: '', qty: 1, price: 0 });
      renderLines();
    });
    $('btn-preview').addEventListener('click', previewBill);

    if ($('c-discount')) {
      $('c-discount').addEventListener('input', updateSummary);
      $('c-discount').addEventListener('change', updateSummary);
    }

    if ($('bill-pdf-close')) {
      $('bill-pdf-close').addEventListener('click', closeBillPdfViewer);
    }
    if ($('bill-pdf-backdrop')) {
      $('bill-pdf-backdrop').addEventListener('click', closeBillPdfViewer);
    }
    if ($('bill-pdf-download')) {
      $('bill-pdf-download').addEventListener('click', downloadBillFromViewer);
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
