/* Private draft quote desk — bill-format PDFs, blank customer OK */
(function () {
  var SESSION_FLAG = 'vish_quote_desk_unlocked_v1';
  var SESSION_PW = 'vish_quote_desk_pw_v1';
  var DRAFTS_KEY = 'vish_quote_desk_drafts_v1';
  var WORK_KEY = 'vish_quote_desk_work_v1';

  var vendor = 'sri';
  var catalog = { sri: [], ignite: [] };
  var lines = [];
  var searchQ = '';
  var previewUrl = '';
  var previewMeta = null;

  function cfg() {
    return window.SITE_CONFIG || {};
  }

  function $(id) {
    return document.getElementById(id);
  }

  function money(n) {
    return '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
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
    $('quote-gate').hidden = !!show;
    $('quote-desk').hidden = !show;
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

  async function postBill(payload) {
    var url = (cfg().appsScriptUrl || '').trim();
    if (!url) throw new Error('Apps Script URL missing in config');
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
    try {
      return text ? JSON.parse(text) : null;
    } catch (e) {
      throw new Error('Google Script returned no JSON');
    }
  }

  function flattenCatalog(data, vendorName) {
    var out = [];
    (Array.isArray(data) ? data : []).forEach(function (cat) {
      (cat.items || []).forEach(function (item) {
        if (item.active === false) return;
        out.push({
          id: Number(item.id),
          name: item.name || '',
          unit: item.unit || '',
          price: Number(item.price) || 0,
          originalPrice: Number(item.originalPrice || item.price) || 0,
          category: cat.category || '',
          vendor: vendorName
        });
      });
    });
    out.sort(function (a, b) {
      return a.id - b.id;
    });
    return out;
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

  function readMoney(id) {
    var n = Number(($('' + id).value || '').trim());
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function readContact() {
    return {
      name: ($('q-name').value || '').trim(),
      phone: ($('q-phone').value || '').trim(),
      pincode: ($('q-pincode').value || '').trim(),
      officeName: ($('q-area').value || '').trim(),
      city: ($('q-city').value || '').trim(),
      state: ($('q-state').value || '').trim(),
      address: ''
    };
  }

  function totals() {
    var clean = cleanLines();
    var subtotal = clean.reduce(function (sum, l) {
      return sum + l.qty * l.price;
    }, 0);
    var discount = readMoney('q-discount');
    if (discount > subtotal) discount = subtotal;
    var charges = readMoney('q-charges');
    return {
      clean: clean,
      subtotal: subtotal,
      discount: discount,
      charges: charges,
      payable: Math.max(0, subtotal - discount + charges)
    };
  }

  function persistWork() {
    try {
      localStorage.setItem(
        WORK_KEY,
        JSON.stringify({
          vendor: vendor,
          lines: lines,
          contact: readContact(),
          notes: ($('q-notes').value || '').trim(),
          discount: ($('q-discount').value || '').trim(),
          charges: ($('q-charges').value || '').trim()
        })
      );
    } catch (e) {}
  }

  function restoreWork() {
    try {
      var raw = localStorage.getItem(WORK_KEY);
      if (!raw) return false;
      var data = JSON.parse(raw);
      if (!data || typeof data !== 'object') return false;
      vendor = data.vendor === 'ignite' ? 'ignite' : 'sri';
      lines = Array.isArray(data.lines) ? data.lines : [];
      var c = data.contact || {};
      $('q-name').value = c.name || '';
      $('q-phone').value = c.phone || '';
      $('q-pincode').value = c.pincode || '';
      $('q-area').value = c.officeName || '';
      $('q-city').value = c.city || '';
      $('q-state').value = c.state || '';
      $('q-notes').value = data.notes || '';
      $('q-discount').value = data.discount || '';
      $('q-charges').value = data.charges || '';
      return true;
    } catch (e) {
      return false;
    }
  }

  function loadDrafts() {
    try {
      var raw = localStorage.getItem(DRAFTS_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function saveDrafts(list) {
    try {
      localStorage.setItem(DRAFTS_KEY, JSON.stringify(list || []));
    } catch (e) {}
  }

  function refreshBillNo() {
    if (window.VishPdf && VishPdf.makeBillNo) {
      $('quote-bill-no').textContent = VishPdf.makeBillNo();
    }
  }

  function paintSummary() {
    var t = totals();
    $('quote-subtotal').textContent = money(t.subtotal);
    $('quote-discount-label').textContent = '− ' + money(t.discount);
    $('quote-charges-label').textContent = money(t.charges);
    $('quote-total').textContent = money(t.payable);
    $('quote-line-count').textContent = String(t.clean.length);
    $('quote-vendor-label').textContent = vendor;
    $('quote-picker-vendor').textContent = vendor;
  }

  function renderLines() {
    var body = $('quote-lines-body');
    if (!lines.length) {
      body.innerHTML =
        '<tr><td colspan="6" style="color:var(--muted);padding:14px 6px">No items yet — search on the right or paste cart JSON.</td></tr>';
      paintSummary();
      persistWork();
      return;
    }
    body.innerHTML = lines
      .map(function (l, idx) {
        var amt = (Number(l.qty) || 1) * (Number(l.price) || 0);
        return (
          '<tr data-idx="' +
          idx +
          '">' +
          '<td><input data-f="name" value="' +
          escapeAttr(l.name || '') +
          '" /></td>' +
          '<td class="col-unit"><input data-f="unit" value="' +
          escapeAttr(l.unit || '') +
          '" /></td>' +
          '<td class="col-qty"><input data-f="qty" type="number" min="1" value="' +
          (l.qty || 1) +
          '" /></td>' +
          '<td class="col-rate"><input data-f="price" type="number" min="0" step="1" value="' +
          (l.price || 0) +
          '" /></td>' +
          '<td class="col-amt">' +
          money(amt) +
          '</td>' +
          '<td class="col-del"><button type="button" class="btn-secondary" data-del="' +
          idx +
          '">×</button></td>' +
          '</tr>'
        );
      })
      .join('');
    paintSummary();
    persistWork();
  }

  function paintHits() {
    var root = $('quote-product-hits');
    var q = searchQ.trim().toLowerCase();
    if (!q) {
      root.innerHTML = '<p class="quote-picker-hint">Type to search the ' + vendor + ' catalogue.</p>';
      return;
    }
    var hits = catalog[vendor].filter(function (p) {
      return (p.id + ' ' + p.name + ' ' + p.category).toLowerCase().indexOf(q) !== -1;
    }).slice(0, 40);
    if (!hits.length) {
      root.innerHTML = '<p class="quote-picker-hint">No matches.</p>';
      return;
    }
    root.innerHTML = hits
      .map(function (p) {
        return (
          '<button type="button" class="quote-hit" data-add-id="' +
          p.id +
          '">' +
          '<strong>' +
          escapeHtml(p.name) +
          '</strong>' +
          '<small>#' +
          p.id +
          ' · ' +
          money(p.price) +
          (p.unit ? ' · ' + escapeHtml(p.unit) : '') +
          '</small>' +
          '</button>'
        );
      })
      .join('');
  }

  function paintDrafts() {
    var root = $('quote-drafts');
    var drafts = loadDrafts();
    if (!drafts.length) {
      root.innerHTML = '';
      return;
    }
    root.innerHTML =
      '<p class="bill-hint" style="margin:0 0 4px">Saved drafts (this browser)</p>' +
      drafts
        .map(function (d, i) {
          var label = d.label || 'Draft ' + (i + 1);
          var who = (d.contact && d.contact.name) || 'No name';
          return (
            '<div class="quote-draft-card" data-draft="' +
            i +
            '">' +
            '<div><strong>' +
            escapeHtml(label) +
            '</strong><small>' +
            escapeHtml(who) +
            ' · ' +
            (d.vendor || 'sri') +
            ' · ' +
            ((d.lines && d.lines.length) || 0) +
            ' lines · ' +
            money(d.payable || 0) +
            '</small></div>' +
            '<div class="quote-draft-actions">' +
            '<button type="button" class="btn-secondary" data-load-draft="' +
            i +
            '">Load</button>' +
            '<button type="button" class="btn-secondary" data-del-draft="' +
            i +
            '">Delete</button>' +
            '</div></div>'
          );
        })
        .join('');
  }

  function addProduct(id) {
    var p = catalog[vendor].find(function (x) {
      return Number(x.id) === Number(id);
    });
    if (!p) return;
    var existing = lines.find(function (l) {
      return String(l.name || '').trim() === p.name && Number(l.price) === Number(p.price);
    });
    if (existing) {
      existing.qty = (Number(existing.qty) || 1) + 1;
    } else {
      lines.push({ name: p.name, unit: p.unit, qty: 1, price: p.price });
    }
    renderLines();
    setMsg($('quote-desk-msg'), 'Added #' + p.id + ' · ' + p.name, true);
  }

  function parseCartJson(text) {
    var data = JSON.parse(text);
    var out = [];
    if (Array.isArray(data)) {
      data.forEach(function (it) {
        var name = String(it.name || '').trim();
        var qty = Number(it.qty != null ? it.qty : it.quantity) || 1;
        var price = Number(it.price) || 0;
        if (!name) return;
        out.push({ name: name, unit: String(it.unit || '').trim(), qty: Math.max(1, qty), price: price });
      });
      return out;
    }
    if (data && typeof data === 'object') {
      if (Array.isArray(data.items)) return parseCartJson(JSON.stringify(data.items));
      Object.keys(data).forEach(function (key) {
        var it = data[key];
        if (!it || typeof it !== 'object') return;
        var name = String(it.name || '').trim();
        if (!name) return;
        out.push({
          name: name,
          unit: String(it.unit || '').trim(),
          qty: Math.max(1, Number(it.qty != null ? it.qty : it.quantity) || 1),
          price: Math.max(0, Number(it.price) || 0)
        });
      });
    }
    return out;
  }

  function applyPaste() {
    try {
      var parsed = parseCartJson(($('quote-paste').value || '').trim());
      if (!parsed.length) throw new Error('No product lines found in JSON');
      lines = parsed;
      $('quote-paste-wrap').hidden = true;
      $('quote-paste').value = '';
      renderLines();
      setMsg($('quote-desk-msg'), 'Loaded ' + parsed.length + ' lines from JSON', true);
    } catch (err) {
      setMsg($('quote-desk-msg'), err.message || 'Invalid JSON');
    }
  }

  function closeViewer() {
    var viewer = $('quote-pdf-viewer');
    var frame = $('quote-pdf-frame');
    if (frame) frame.src = 'about:blank';
    if (viewer) viewer.hidden = true;
    document.body.classList.remove('pdf-viewer-open');
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      previewUrl = '';
    }
    previewMeta = null;
  }

  function buildPreview() {
    if (!window.VishPdf || !VishPdf.createBillPreview) {
      throw new Error('PDF library not ready — refresh page');
    }
    var t = totals();
    if (!t.clean.length) throw new Error('Add at least one product line');
    var billNo = VishPdf.makeBillNo();
    $('quote-bill-no').textContent = billNo;
    var meta = {
      billNo: billNo,
      enquirySno: '',
      notes: ($('q-notes').value || '').trim(),
      discount: t.discount,
      packingTransport: t.charges
    };
    var contact = readContact();
    var preview = VishPdf.createBillPreview(contact, t.clean, cfg(), meta);
    return {
      preview: preview,
      contact: contact,
      lines: t.clean,
      meta: meta,
      payable: preview.payable
    };
  }

  function previewPdf() {
    setMsg($('quote-desk-msg'), '');
    try {
      closeViewer();
      var built = buildPreview();
      previewUrl = built.preview.url;
      previewMeta = built;
      $('quote-pdf-title').textContent = 'Bill ' + built.preview.billNo;
      $('quote-pdf-frame').src = built.preview.url;
      $('quote-pdf-viewer').hidden = false;
      document.body.classList.add('pdf-viewer-open');
      setMsg($('quote-desk-msg'), 'Preview ready — blank fields stay empty on the PDF', true);
    } catch (err) {
      setMsg($('quote-desk-msg'), err.message || 'PDF failed');
    }
  }

  function downloadPdf() {
    setMsg($('quote-desk-msg'), '');
    try {
      if (!window.VishPdf || !VishPdf.downloadBillPdf) {
        throw new Error('PDF library not ready — refresh page');
      }
      var built = previewMeta || buildPreview();
      var billNo = VishPdf.downloadBillPdf(built.contact, built.lines, cfg(), built.meta);
      setMsg($('quote-desk-msg'), 'Downloaded Vish-Bill-' + billNo + '.pdf', true);
    } catch (err) {
      setMsg($('quote-desk-msg'), err.message || 'Download failed');
    }
  }

  function newQuote() {
    if (lines.length || readContact().name || readContact().phone) {
      if (!confirm('Start a fresh quote? Current lines/customer will clear (saved drafts stay).')) return;
    }
    lines = [];
    $('q-name').value = '';
    $('q-phone').value = '';
    $('q-pincode').value = '';
    $('q-area').value = '';
    $('q-city').value = '';
    $('q-state').value = '';
    $('q-notes').value = '';
    $('q-discount').value = '';
    $('q-charges').value = '';
    closeViewer();
    refreshBillNo();
    renderLines();
    setMsg($('quote-desk-msg'), 'Fresh quote — add items for the next customer', true);
  }

  function saveDraft() {
    var t = totals();
    if (!t.clean.length) {
      setMsg($('quote-desk-msg'), 'Add items before saving a draft');
      return;
    }
    var contact = readContact();
    var label =
      prompt('Draft label (optional)', contact.name || vendor + ' · ' + money(t.payable)) || '';
    var drafts = loadDrafts();
    drafts.unshift({
      id: 'd-' + Date.now(),
      label: label.trim() || 'Draft ' + new Date().toLocaleString('en-IN'),
      savedAt: Date.now(),
      vendor: vendor,
      lines: t.clean,
      contact: contact,
      notes: ($('q-notes').value || '').trim(),
      discount: ($('q-discount').value || '').trim(),
      charges: ($('q-charges').value || '').trim(),
      payable: t.payable
    });
    if (drafts.length > 40) drafts = drafts.slice(0, 40);
    saveDrafts(drafts);
    paintDrafts();
    setMsg($('quote-desk-msg'), 'Draft saved in this browser', true);
  }

  function loadDraft(i) {
    var drafts = loadDrafts();
    var d = drafts[i];
    if (!d) return;
    vendor = d.vendor === 'ignite' ? 'ignite' : 'sri';
    lines = Array.isArray(d.lines) ? d.lines.slice() : [];
    var c = d.contact || {};
    $('q-name').value = c.name || '';
    $('q-phone').value = c.phone || '';
    $('q-pincode').value = c.pincode || '';
    $('q-area').value = c.officeName || '';
    $('q-city').value = c.city || '';
    $('q-state').value = c.state || '';
    $('q-notes').value = d.notes || '';
    $('q-discount').value = d.discount || '';
    $('q-charges').value = d.charges || '';
    refreshBillNo();
    renderLines();
    paintHits();
    setMsg($('quote-desk-msg'), 'Loaded draft: ' + (d.label || ''), true);
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, '&#39;');
  }

  async function unlock() {
    var password = ($('quote-password').value || '').trim();
    setMsg($('quote-gate-msg'), 'Checking…');
    try {
      if (!password) {
        setMsg($('quote-gate-msg'), 'Enter password');
        return;
      }
      var data = await postBill({
        action: 'checkBillPassword',
        billPassword: password
      });
      if (!data || data.status !== 'ok') {
        setMsg($('quote-gate-msg'), (data && data.message) || 'Wrong password');
        return;
      }
      setUnlocked(true, password);
      showDesk(true);
      setMsg($('quote-gate-msg'), '');
      $('quote-password').value = '';
      bootDesk();
    } catch (err) {
      setMsg($('quote-gate-msg'), err.message || 'Unlock failed');
    }
  }

  function bootDesk() {
    catalog.sri = flattenCatalog(window.PRODUCTS_DATA, 'sri');
    catalog.ignite = flattenCatalog(window.PRODUCTS_IGNITE_DATA, 'ignite');
    var restored = restoreWork();
    if (!restored && !lines.length) lines = [];
    refreshBillNo();
    renderLines();
    paintHits();
    paintDrafts();
    setMsg(
      $('quote-desk-msg'),
      restored
        ? 'Restored your last draft work from this browser.'
        : 'Ready — customer fields can stay blank.',
      true
    );
  }

  function bind() {
    $('quote-unlock').addEventListener('click', unlock);
    $('quote-password').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') unlock();
    });
    $('quote-lock').addEventListener('click', function () {
      persistWork();
      setUnlocked(false);
      closeViewer();
      showDesk(false);
      $('quote-password').value = '';
    });
    $('quote-new').addEventListener('click', newQuote);
    $('quote-add-line').addEventListener('click', function () {
      lines.push({ name: '', unit: '', qty: 1, price: 0 });
      renderLines();
    });
    $('quote-clear-lines').addEventListener('click', function () {
      if (!lines.length) return;
      if (!confirm('Clear all product lines?')) return;
      lines = [];
      renderLines();
    });
    $('quote-paste-toggle').addEventListener('click', function () {
      $('quote-paste-wrap').hidden = false;
      $('quote-paste').focus();
    });
    $('quote-apply-paste').addEventListener('click', applyPaste);
    $('quote-cancel-paste').addEventListener('click', function () {
      $('quote-paste-wrap').hidden = true;
    });
    $('quote-preview').addEventListener('click', previewPdf);
    $('quote-download').addEventListener('click', downloadPdf);
    $('quote-save-draft').addEventListener('click', saveDraft);
    $('quote-pdf-download').addEventListener('click', downloadPdf);
    $('quote-pdf-close').addEventListener('click', closeViewer);
    $('quote-pdf-backdrop').addEventListener('click', closeViewer);

    document.querySelectorAll('[data-vendor]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        vendor = btn.getAttribute('data-vendor') === 'ignite' ? 'ignite' : 'sri';
        paintHits();
        paintSummary();
        persistWork();
      });
    });

    $('quote-product-search').addEventListener('input', function () {
      searchQ = $('quote-product-search').value || '';
      paintHits();
    });
    $('quote-product-hits').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-add-id]');
      if (!btn) return;
      addProduct(btn.getAttribute('data-add-id'));
    });

    $('quote-lines-body').addEventListener('input', function (e) {
      var row = e.target.closest('[data-idx]');
      if (!row) return;
      var idx = Number(row.getAttribute('data-idx'));
      var f = e.target.getAttribute('data-f');
      if (!lines[idx] || !f) return;
      if (f === 'qty') lines[idx].qty = Math.max(1, parseInt(e.target.value, 10) || 1);
      else if (f === 'price') lines[idx].price = Math.max(0, Number(e.target.value) || 0);
      else lines[idx][f] = e.target.value;
      paintSummary();
      persistWork();
    });
    $('quote-lines-body').addEventListener('change', function () {
      renderLines();
    });
    $('quote-lines-body').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-del]');
      if (!btn) return;
      lines.splice(Number(btn.getAttribute('data-del')), 1);
      renderLines();
    });

    ['q-discount', 'q-charges', 'q-name', 'q-phone', 'q-pincode', 'q-area', 'q-city', 'q-state', 'q-notes'].forEach(
      function (id) {
        $(id).addEventListener('input', function () {
          paintSummary();
          persistWork();
        });
      }
    );

    $('quote-drafts').addEventListener('click', function (e) {
      var loadBtn = e.target.closest('[data-load-draft]');
      if (loadBtn) {
        loadDraft(Number(loadBtn.getAttribute('data-load-draft')));
        return;
      }
      var delBtn = e.target.closest('[data-del-draft]');
      if (delBtn) {
        var drafts = loadDrafts();
        drafts.splice(Number(delBtn.getAttribute('data-del-draft')), 1);
        saveDrafts(drafts);
        paintDrafts();
        setMsg($('quote-desk-msg'), 'Draft deleted', true);
      }
    });
  }

  function init() {
    bind();
    if (isUnlocked()) {
      showDesk(true);
      bootDesk();
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
