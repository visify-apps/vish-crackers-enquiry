/* Temporary private desk — rematch Ignite product images to Sri assets */
(function () {
  var SESSION_FLAG = 'vish_ignite_img_unlocked_v1';
  var SESSION_PW = 'vish_ignite_img_pw_v1';
  var STORE_KEY = 'vish_ignite_image_fixes_v1';

  var items = [];
  var sriPicks = [];
  var overrides = {};
  var filter = 'all';
  var index = 0;
  var searchQ = '';

  function cfg() {
    return window.SITE_CONFIG || {};
  }

  function $(id) {
    return document.getElementById(id);
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
    $('img-gate').hidden = !!show;
    $('img-desk').hidden = !show;
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

  function loadOverrides() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      var parsed = raw ? JSON.parse(raw) : {};
      overrides = parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) {
      overrides = {};
    }
  }

  function saveOverrides() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(overrides));
    } catch (e) {}
  }

  function flattenIgnite() {
    var out = [];
    var cats = Array.isArray(window.PRODUCTS_IGNITE_DATA) ? window.PRODUCTS_IGNITE_DATA : [];
    cats.forEach(function (cat) {
      (cat.items || []).forEach(function (item) {
        out.push({
          id: item.id,
          sourceId: item.sourceId,
          name: item.name || '',
          category: cat.category || item.category || '',
          baseImage: item.image || 'assets/optimized/placeholder.jpg',
          unit: item.unit || '',
          price: item.price,
          originalPrice: item.originalPrice,
          active: item.active !== false,
          limited: !!item.limited,
          vendor: 'ignite'
        });
      });
    });
    out.sort(function (a, b) {
      return Number(a.id) - Number(b.id);
    });
    return out;
  }

  function flattenSriPicks() {
    var map = {};
    var cats = Array.isArray(window.PRODUCTS_DATA) ? window.PRODUCTS_DATA : [];
    cats.forEach(function (cat) {
      (cat.items || []).forEach(function (item) {
        var img = String(item.image || '').trim();
        if (!img || /placeholder/i.test(img)) return;
        if (!map[img]) {
          map[img] = {
            image: img,
            name: item.name || '',
            id: item.id,
            category: cat.category || ''
          };
        }
      });
    });
    return Object.keys(map)
      .map(function (k) {
        return map[k];
      })
      .sort(function (a, b) {
        return Number(a.id) - Number(b.id);
      });
  }

  function currentImage(item) {
    var key = String(item.id);
    if (overrides[key]) return overrides[key];
    return item.baseImage;
  }

  function isPlaceholder(path) {
    return /placeholder/i.test(String(path || ''));
  }

  function isChanged(item) {
    return Object.prototype.hasOwnProperty.call(overrides, String(item.id));
  }

  function filteredItems() {
    return items.filter(function (item) {
      var img = currentImage(item);
      if (filter === 'ph') return isPlaceholder(img);
      if (filter === 'changed') return isChanged(item);
      return true;
    });
  }

  function clampIndex() {
    var list = filteredItems();
    if (!list.length) {
      index = 0;
      return;
    }
    if (index >= list.length) index = list.length - 1;
    if (index < 0) index = 0;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function paintStats() {
    var changed = Object.keys(overrides).length;
    var ph = items.filter(function (i) {
      return isPlaceholder(currentImage(i));
    }).length;
    $('img-stats').textContent =
      items.length +
      ' Ignite products · ' +
      ph +
      ' placeholders · ' +
      changed +
      ' local fixes (saved in this browser)';
  }

  function paintFilterButtons() {
    [['img-filter-all', 'all'], ['img-filter-ph', 'ph'], ['img-filter-changed', 'changed']].forEach(
      function (pair) {
        var el = $(pair[0]);
        if (!el) return;
        el.classList.toggle('ignite-filter-on', filter === pair[1]);
      }
    );
  }

  function paintCurrent() {
    clampIndex();
    var list = filteredItems();
    paintStats();
    paintFilterButtons();
    $('img-position').textContent = list.length ? index + 1 + ' / ' + list.length : '0 / 0';
    if (!list.length) {
      $('img-meta').textContent = 'No products in this filter';
      $('img-name').textContent = '—';
      $('img-path').textContent = '';
      $('img-preview').removeAttribute('src');
      return;
    }
    var item = list[index];
    var img = currentImage(item);
    $('img-meta').textContent =
      'Ignite id ' +
      item.id +
      ' · sheet #' +
      (item.sourceId != null ? item.sourceId : '—') +
      ' · ' +
      item.category +
      (isChanged(item) ? ' · edited' : '');
    $('img-name').textContent = item.name;
    $('img-path').textContent = img;
    $('img-preview').src = img;
  }

  function paintPicker() {
    var grid = $('img-picker-grid');
    if (!grid) return;
    var q = searchQ.trim().toLowerCase();
    var list = sriPicks;
    if (q) {
      list = sriPicks.filter(function (p) {
        return (
          String(p.name).toLowerCase().indexOf(q) >= 0 ||
          String(p.category).toLowerCase().indexOf(q) >= 0 ||
          String(p.id).indexOf(q) >= 0 ||
          String(p.image).toLowerCase().indexOf(q) >= 0
        );
      });
    }
    list = list.slice(0, 120);
    var current = filteredItems()[index];
    var currentImg = current ? currentImage(current) : '';
    if (!list.length) {
      grid.innerHTML = '<p class="empty-state">No Sri images match.</p>';
      return;
    }
    grid.innerHTML = list
      .map(function (p) {
        return (
          '<button type="button" class="ignite-pick-card' +
          (p.image === currentImg ? ' is-current' : '') +
          '" data-img="' +
          escapeHtml(p.image) +
          '">' +
          '<img src="' +
          escapeHtml(p.image) +
          '" alt="" loading="lazy" />' +
          '<strong>' +
          escapeHtml(p.name) +
          '</strong>' +
          '<small>Sri #' +
          escapeHtml(p.id) +
          ' · ' +
          escapeHtml(p.category) +
          '</small></button>'
        );
      })
      .join('');
  }

  function paintFilmstrip() {
    var strip = $('img-filmstrip');
    if (!strip) return;
    var list = filteredItems();
    if (!list.length) {
      strip.innerHTML = '<p class="empty-state">No products in this filter.</p>';
      return;
    }
    strip.innerHTML = list
      .map(function (item, i) {
        var img = currentImage(item);
        return (
          '<button type="button" class="ignite-film-card' +
          (i === index ? ' is-on' : '') +
          (isPlaceholder(img) ? ' is-ph' : '') +
          '" data-jump="' +
          i +
          '" title="' +
          escapeHtml(item.name) +
          '">' +
          '<img src="' +
          escapeHtml(img) +
          '" alt="" loading="lazy" />' +
          '<strong>' +
          escapeHtml(item.name) +
          '</strong>' +
          '<small>#' +
          escapeHtml(item.id) +
          '</small></button>'
        );
      })
      .join('');

    var on = strip.querySelector('.is-on');
    if (on && typeof on.scrollIntoView === 'function') {
      on.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }

  function paintAll() {
    paintCurrent();
    paintPicker();
    paintFilmstrip();
  }

  async function assignImage(path) {
    var list = filteredItems();
    if (!list.length) return;
    var item = list[index];
    var key = String(item.id);
    if (path === item.baseImage) delete overrides[key];
    else overrides[key] = path;
    saveOverrides();
    paintAll();
    setMsg($('img-desk-msg'), 'Saving #' + item.id + ' to Products_v2…');
    try {
      var password = getSessionPassword();
      if (!password) throw new Error('Session expired — unlock again');
      var data = await postBill({
        action: 'updateIgniteImage',
        billPassword: password,
        sourceId: item.sourceId != null ? item.sourceId : item.id - 10000,
        image: path
      });
      if (!data || data.status !== 'ok') {
        throw new Error((data && data.message) || 'Sheet update failed');
      }
      item.baseImage = path;
      delete overrides[key];
      saveOverrides();
      paintAll();
      setMsg($('img-desk-msg'), 'Saved image for #' + item.id + ' on Products_v2', true);
    } catch (err) {
      setMsg(
        $('img-desk-msg'),
        (err && err.message ? err.message : 'Sheet save failed') +
          ' — kept locally; fix Apps Script deploy / image column.',
        false
      );
    }
  }

  function buildExportJs() {
    var cats = Array.isArray(window.PRODUCTS_IGNITE_DATA)
      ? JSON.parse(JSON.stringify(window.PRODUCTS_IGNITE_DATA))
      : [];
    cats.forEach(function (cat) {
      (cat.items || []).forEach(function (item) {
        var key = String(item.id);
        if (overrides[key]) item.image = overrides[key];
      });
    });
    return (
      '/* Ignite catalogue — ids 10001+; images shared from Sri by role similarity. */\n' +
      'window.PRODUCTS_IGNITE_DATA = ' +
      JSON.stringify(cats, null, 2) +
      ';\n'
    );
  }

  function downloadExport() {
    var blob = new Blob([buildExportJs()], { type: 'application/javascript;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'products-ignite.js';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setMsg(
      $('img-desk-msg'),
      'Downloaded products-ignite.js — replace data/products-ignite.js in the repo when done.',
      true
    );
  }

  async function unlock() {
    var password = ($('img-password').value || '').trim();
    setMsg($('img-gate-msg'), 'Checking…');
    try {
      if (!password) {
        setMsg($('img-gate-msg'), 'Enter password');
        return;
      }
      var data = await postBill({
        action: 'checkBillPassword',
        billPassword: password
      });
      if (!data || data.status !== 'ok') {
        setMsg($('img-gate-msg'), (data && data.message) || 'Wrong password');
        return;
      }
      setUnlocked(true, password);
      showDesk(true);
      setMsg($('img-gate-msg'), '');
      $('img-password').value = '';
      bootDesk();
    } catch (err) {
      setMsg($('img-gate-msg'), err.message || 'Unlock failed');
    }
  }

  async function loadIgniteFromSheet() {
    var url = (cfg().appsScriptUrl || '').trim();
    if (!url) return false;
    try {
      var res = await fetchWithTimeout(url + '?action=products&_=' + Date.now(), {}, 20000);
      var data = await res.json();
      if (!data || !Array.isArray(data.productsIgnite) || !data.productsIgnite.length) return false;
      var out = [];
      data.productsIgnite.forEach(function (cat) {
        (cat.items || []).forEach(function (item) {
          out.push({
            id: item.id,
            sourceId: item.sourceId,
            name: item.name || '',
            category: cat.category || item.category || '',
            baseImage: item.image || 'assets/optimized/placeholder.jpg',
            unit: item.unit || '',
            price: item.price,
            originalPrice: item.originalPrice,
            active: item.active !== false,
            limited: !!item.limited,
            vendor: 'ignite'
          });
        });
      });
      out.sort(function (a, b) {
        return Number(a.id) - Number(b.id);
      });
      if (!out.length) return false;
      items = out;
      return true;
    } catch (e) {
      return false;
    }
  }

  async function bootDesk() {
    loadOverrides();
    items = flattenIgnite();
    sriPicks = flattenSriPicks();
    index = 0;
    paintAll();
    setMsg($('img-desk-msg'), 'Loading Products_v2 images from sheet…');
    var fromSheet = await loadIgniteFromSheet();
    paintAll();
    setMsg(
      $('img-desk-msg'),
      fromSheet
        ? 'Loaded from Products_v2. Tap a Sri photo — saves to the image column.'
        : 'Using local catalogue (sheet load failed). Tap a photo to save once Apps Script is deployed.',
      fromSheet
    );
  }

  var IMPORT_SERVER = 'http://127.0.0.1:8787';

  async function importUrlForCurrent() {
    var list = filteredItems();
    if (!list.length) {
      setMsg($('img-desk-msg'), 'No product selected');
      return;
    }
    var url = (($('img-url') && $('img-url').value) || '').trim();
    if (!url) {
      setMsg($('img-desk-msg'), 'Paste an image URL first');
      return;
    }
    setMsg($('img-desk-msg'), 'Downloading & compressing via local import-server…');
    try {
      var res = await fetchWithTimeout(
        IMPORT_SERVER + '/import',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: url })
        },
        90000
      );
      var data = await res.json();
      if (!data || data.status !== 'ok' || !data.path) {
        throw new Error((data && data.message) || 'Import failed');
      }
      if ($('img-url')) $('img-url').value = '';
      setMsg(
        $('img-desk-msg'),
        'Saved ' + data.path + ' (S.No ' + data.sno + ', ' + data.bytesKb + ' KB) — assigning…',
        true
      );
      await assignImage(data.path);
    } catch (err) {
      var msg = err && err.name === 'AbortError' ? 'Import timed out' : err.message || 'Import failed';
      if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
        msg =
          'Import server not running. In a terminal: npm run import-server — then try again.';
      }
      setMsg($('img-desk-msg'), msg, false);
    }
  }

  async function pushAllLocalToSheet() {
    var password = getSessionPassword();
    if (!password) {
      setMsg($('img-desk-msg'), 'Unlock again first');
      return;
    }
    var images = {};
    items.forEach(function (item) {
      var sourceId = item.sourceId != null ? item.sourceId : Number(item.id) - 10000;
      images[String(sourceId)] = currentImage(item);
    });
    setMsg($('img-desk-msg'), 'Pushing all images to Products_v2…');
    try {
      var data = await postBill({
        action: 'setIgniteImages',
        billPassword: password,
        images: images
      });
      if (!data || data.status !== 'ok') {
        throw new Error((data && data.message) || 'Batch update failed');
      }
      items.forEach(function (item) {
        item.baseImage = currentImage(item);
      });
      overrides = {};
      saveOverrides();
      paintAll();
      setMsg(
        $('img-desk-msg'),
        'Pushed ' + (data.updated || 0) + ' images to sheet' + (data.skipped ? ' (' + data.skipped + ' skipped)' : ''),
        true
      );
    } catch (err) {
      setMsg($('img-desk-msg'), err.message || 'Push failed', false);
    }
  }

  function bind() {
    $('img-unlock').addEventListener('click', unlock);
    $('img-password').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') unlock();
    });
    $('img-lock').addEventListener('click', function () {
      setUnlocked(false);
      showDesk(false);
      $('img-password').value = '';
    });
    $('img-prev').addEventListener('click', function () {
      index -= 1;
      clampIndex();
      paintAll();
    });
    $('img-next').addEventListener('click', function () {
      index += 1;
      clampIndex();
      paintAll();
    });
    $('img-mark-next').addEventListener('click', function () {
      index += 1;
      clampIndex();
      paintAll();
      setMsg($('img-desk-msg'), 'Moved to next product', true);
    });
    if ($('img-import-url')) {
      $('img-import-url').addEventListener('click', importUrlForCurrent);
    }
    if ($('img-url')) {
      $('img-url').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          importUrlForCurrent();
        }
      });
    }
    $('img-use-placeholder').addEventListener('click', function () {
      assignImage('assets/optimized/placeholder.jpg');
    });
    $('img-revert').addEventListener('click', function () {
      var list = filteredItems();
      if (!list.length) return;
      delete overrides[String(list[index].id)];
      saveOverrides();
      paintAll();
      setMsg($('img-desk-msg'), 'Cleared local edit (sheet value unchanged)', true);
    });
    $('img-export').addEventListener('click', downloadExport);
    if ($('img-push-sheet')) {
      $('img-push-sheet').addEventListener('click', pushAllLocalToSheet);
    }
    $('img-filter-all').addEventListener('click', function () {
      filter = 'all';
      index = 0;
      paintAll();
    });
    $('img-filter-ph').addEventListener('click', function () {
      filter = 'ph';
      index = 0;
      paintAll();
    });
    $('img-filter-changed').addEventListener('click', function () {
      filter = 'changed';
      index = 0;
      paintAll();
    });
    $('img-search').addEventListener('input', function () {
      searchQ = $('img-search').value || '';
      paintPicker();
    });
    $('img-picker-grid').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-img]');
      if (!btn) return;
      assignImage(btn.getAttribute('data-img'));
    });
    $('img-filmstrip').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-jump]');
      if (!btn) return;
      index = Number(btn.getAttribute('data-jump')) || 0;
      clampIndex();
      paintAll();
    });
    document.addEventListener('keydown', function (e) {
      if ($('img-desk').hidden) return;
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        $('img-prev').click();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        $('img-next').click();
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
