window.VishApp = (function () {
  const cfg = () => window.SITE_CONFIG;
  let sriProductsData = [];
  let igniteProductsData = [];
  let productsData = [];
  let activeCategory = 'all';
  let searchQuery = '';
  let categorySearch = '';
  let openCategories = new Set();
  let submitting = false;
  let submitProgressTimer = null;
  let submitProgressValue = 0;
  let pinLookupToken = 0;
  let pinAbort = null;
  let resolvedArea = { city: '', state: '', officeName: '', offices: [] };

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function safeImageSrc(src) {
    const s = String(src || 'assets/optimized/placeholder.jpg');
    if (/^assets\/[a-zA-Z0-9_./-]+$/.test(s)) return s;
    return 'assets/optimized/placeholder.jpg';
  }

  function liveProduct(id) {
    return productById(id);
  }

  function liveCartTotals(cart) {
    return VishCart.cartTotals(cart, liveProduct);
  }

  function newSubmissionId() {
    if (window.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return 's_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
  }

  function isPacksPage() {
    return document.body.classList.contains('page-packs');
  }

  function money(n) {
    return '₹' + Number(n).toLocaleString('en-IN');
  }

  function percentOff(item) {
    if (!item.originalPrice || item.originalPrice <= item.price) return 0;
    return Math.round(((item.originalPrice - item.price) / item.originalPrice) * 100);
  }

  function injectIcons(root) {
    if (!window.VishIcons) return;
    (root || document).querySelectorAll('[data-icon]').forEach((el) => {
      const name = el.getAttribute('data-icon');
      if (!name || el.dataset.iconReady === '1') return;
      el.innerHTML = VishIcons.svg(name);
      el.dataset.iconReady = '1';
    });
  }

  function wireWhatsAppFloat() {
    const waText = encodeURIComponent(
      'Hi, I would like to enquire about fireworks from Vish Fireworks Store.'
    );
    const waUrl = 'https://wa.me/' + cfg().whatsapp + '?text=' + waText;
    const waFloat = $('wa-float');
    if (waFloat) {
      waFloat.href = waUrl;
      const icon = $('wa-float-icon');
      if (icon && window.VishIcons) icon.innerHTML = VishIcons.whatsappLogo(22);
    }
    const callBtn = $('call-btn');
    if (callBtn) callBtn.href = 'tel:' + cfg().phone;
  }

  function tagVendor(categories, vendor) {
    return (categories || []).map((cat) => ({
      category: cat.category,
      vendor: vendor,
      items: (cat.items || []).map((item) => ({ ...item, vendor: vendor }))
    }));
  }

  function flattenCatalog(categories) {
    return (categories || []).flatMap((cat) =>
      (cat.items || [])
        .filter((i) => i.active !== false)
        .map((item) => ({ ...item, category: cat.category, vendor: item.vendor || cat.vendor || 'sri' }))
    );
  }

  function catalogForVendor(vendor) {
    return sriProductsData;
  }

  function syncActiveCatalog() {
    productsData = sriProductsData;
    return productsData;
  }

  function activeVendor() {
    return 'sri';
  }

  function resolveFulfillVendor() {
    return 'sri';
  }

  function activeLaneId() {
    return '';
  }

  function hasNightMatch() {
    return true;
  }

  function requireNightMatch() {
    return true;
  }

  function vendorLockMessage() {
    return 'Please refresh and try again.';
  }

  function allProducts() {
    return flattenCatalog(productsData);
  }

  function productById(id) {
    return flattenCatalog(sriProductsData).find((p) => String(p.id) === String(id)) || null;
  }

  function productByIdInCatalog(categories, id) {
    return flattenCatalog(categories).find((p) => String(p.id) === String(id)) || null;
  }

  function filteredProducts() {
    const q = searchQuery.trim().toLowerCase();
    return allProducts().filter((item) => {
      const catOk = activeCategory === 'all' || item.category === activeCategory;
      if (!catOk) return false;
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q)
      );
    });
  }

  function groupedFiltered() {
    const items = filteredProducts();
    const map = new Map();
    items.forEach((item) => {
      if (!map.has(item.category)) map.set(item.category, []);
      map.get(item.category).push(item);
    });
    return map;
  }

  function updateCategoryLabel() {
    const label = $('category-current-label');
    if (!label) return;
    label.textContent = activeCategory === 'all' ? 'All products' : activeCategory;
  }

  function updateCartBar() {
    const cart = VishCart.getCart();
    const count = VishCart.cartCount(cart);
    const { total, saved } = liveCartTotals(cart);
    const bar = $('cart-bar');
    const badge = $('cart-badge');
    const meta = $('cart-bar-meta');
    const savedEl = $('cart-bar-saved');
    const enquiryBtn = $('cart-badge-btn');

    if (badge) {
      badge.textContent = String(count);
      badge.hidden = count === 0;
    }
    if (meta) {
      meta.textContent =
        count === 0
          ? isPacksPage()
            ? 'Add a combo to start'
            : 'Add items to build your enquiry'
          : count + (count === 1 ? ' item' : ' items') + ' · ' + money(total);
    }

    if (savedEl) {
      if (saved > 0 && count > 0) {
        savedEl.hidden = false;
        savedEl.textContent = 'You save ' + money(saved) + ' vs MRP';
      } else {
        savedEl.hidden = true;
        savedEl.textContent = '';
      }
    }

    if (bar) bar.classList.toggle('is-empty', count === 0);
    if ($('review-btn')) $('review-btn').disabled = count === 0;

    const warn = $('cart-min-warn');
    if (warn) {
      const status = minOrderStatus(total);
      if (status && count > 0) {
        warn.hidden = false;
        warn.textContent = status.short;
      } else {
        warn.hidden = true;
        warn.textContent = '';
      }
    }

    if (enquiryBtn) {
      enquiryBtn.classList.toggle('is-idle', count === 0);
      enquiryBtn.classList.toggle('is-live', count > 0);
      enquiryBtn.setAttribute('aria-disabled', count === 0 ? 'true' : 'false');
    }
  }

  function renderCategoryPicker() {
    const grid = $('category-picker-grid');
    if (!grid) return;
    grid.innerHTML = '';

    const q = categorySearch.trim().toLowerCase();
    const cats = [{ label: 'All products', value: 'all', count: allProducts().length }].concat(
      productsData.map((cat) => ({
        label: cat.category,
        value: cat.category,
        count: (cat.items || []).filter((i) => i.active !== false).length
      }))
    );

    cats
      .filter((c) => !q || c.label.toLowerCase().includes(q))
      .forEach((c) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className =
          'picker-option' + (activeCategory === c.value ? ' is-active' : '');
        btn.innerHTML =
          '<span class="picker-option-label">' +
          escapeHtml(c.label) +
          '</span><span class="picker-option-count">' +
          c.count +
          '</span>';
        btn.addEventListener('click', () => {
          activeCategory = c.value;
          if (activeCategory === 'all') openCategories.clear();
          else openCategories.add(activeCategory);
          updateCategoryLabel();
          renderCategoryPicker();
          renderProducts();
          closeCategoryPicker();
          const catalog = $('catalog');
          if (catalog) {
            window.scrollTo({ top: catalog.offsetTop - 70, behavior: 'smooth' });
          }
        });
        grid.appendChild(btn);
      });
  }

  function openCategoryPicker() {
    const picker = $('category-picker');
    if (!picker) return;
    categorySearch = '';
    if ($('category-search')) $('category-search').value = '';
    renderCategoryPicker();
    picker.hidden = false;
    document.body.classList.add('picker-open');
    setTimeout(() => {
      if ($('category-search')) $('category-search').focus();
    }, 50);
  }

  function closeCategoryPicker() {
    const picker = $('category-picker');
    if (!picker) return;
    picker.hidden = true;
    document.body.classList.remove('picker-open');
  }

  function productCard(item) {
    const cart = VishCart.getCart();
    const inCart = cart[item.id];
    const off = percentOff(item);
    const unavailable = item.active === false;
    const el = document.createElement('article');
    el.className =
      'product-row' +
      (inCart ? ' is-in-cart' : '') +
      (item.limited ? ' is-limited' : '') +
      (unavailable ? ' is-unavailable' : '');
    el.dataset.id = item.id;

    const badges =
      (off > 0 && !unavailable ? '<span class="badge-off">' + off + '% off</span>' : '') +
      (item.limited ? '<span class="badge-limited">Limited</span>' : '');

    el.innerHTML =
      '<button type="button" class="thumb-btn" data-lightbox="1" aria-label="View larger image of ' +
      escapeHtml(item.name) +
      '">' +
      '<img class="product-thumb" src="' +
      safeImageSrc(item.image) +
      '" alt="' +
      escapeHtml(item.name) +
      '" loading="lazy" decoding="async" width="72" height="72">' +
      '</button>' +
      '<div class="product-main">' +
      '<h3 class="product-name">' +
      escapeHtml(item.name) +
      '</h3>' +
      '<div class="product-meta">' +
      '<span class="product-unit">' +
      escapeHtml(item.unit) +
      '</span>' +
      badges +
      '</div>' +
      '</div>' +
      '<div class="product-side">' +
      '<div class="product-actions"></div>' +
      '<div class="price-stack">' +
      (item.originalPrice > item.price
        ? '<span class="mrp" aria-label="MRP">' + money(item.originalPrice) + '</span>'
        : '') +
      '<div class="price">' +
      money(item.price) +
      '</div>' +
      '</div>' +
      '</div>';

    const thumbBtn = el.querySelector('[data-lightbox]');
    thumbBtn.addEventListener('click', () => openLightbox(item));

    const actions = el.querySelector('.product-actions');
    if (unavailable) {
      const sold = document.createElement('span');
      sold.className = 'unavailable-label';
      sold.textContent = 'Unavailable';
      actions.appendChild(sold);
      return el;
    }

    if (inCart) {
      const controls = document.createElement('div');
      controls.className = 'qty-controls';
      controls.innerHTML =
        '<button type="button" class="qty-btn" data-act="dec" aria-label="Decrease quantity">−</button>' +
        '<span class="qty-value" aria-live="polite">' +
        inCart.quantity +
        '</span>' +
        '<button type="button" class="qty-btn" data-act="inc" aria-label="Increase quantity">+</button>';
      controls.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        const q = inCart.quantity + (btn.dataset.act === 'inc' ? 1 : -1);
        VishCart.setQuantity(item.id, q);
        refreshAfterCartChange();
      });
      actions.appendChild(controls);
    } else {
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'btn btn-add';
      add.textContent = 'Add';
      add.addEventListener('click', () => {
        const result = VishCart.addItem(item);
        if (result && result.ok === false) {
          notify(vendorLockMessage(result.vendor));
          return;
        }
        refreshAfterCartChange();
      });
      actions.appendChild(add);
    }
    return el;
  }

  function isCategoryOpen(category) {
    if (searchQuery.trim()) return true;
    return openCategories.has(category);
  }

  function fillCategoryPanel(panel, items) {
    panel.innerHTML = '';
    const list = document.createElement('div');
    list.className = 'product-list';
    items.forEach((item) => list.appendChild(productCard(item)));
    panel.appendChild(list);
  }

  function closeCategorySection(section) {
    if (!section) return;
    const category = section.dataset.category;
    const toggle = section.querySelector('.category-toggle');
    const panel = section.querySelector('.category-panel');
    section.classList.remove('is-open');
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
    if (panel) panel.innerHTML = '';
    if (category) openCategories.delete(category);
  }

  function renderProducts() {
    const root = $('product-list');
    if (!root || isPacksPage()) return;
    root.innerHTML = '';
    const grouped = groupedFiltered();

    if (grouped.size === 0) {
      root.innerHTML =
        '<p class="empty-state">No products match your search. Try another category or keyword.</p>';
      return;
    }

    // Specific category: flat list, no accordion / chevron
    if (activeCategory !== 'all') {
      const list = document.createElement('div');
      list.className = 'product-list';
      grouped.forEach((items) => {
        items.forEach((item) => list.appendChild(productCard(item)));
      });
      root.appendChild(list);
      return;
    }

    const chevron =
      '<svg class="category-chevron-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"></polyline></svg>';

    grouped.forEach((items, category) => {
      const open = isCategoryOpen(category);
      const panelId = 'cat-panel-' + category.replace(/\s+/g, '-').toLowerCase();
      const section = document.createElement('section');
      section.className = 'category-section' + (open ? ' is-open' : '');
      section.id = 'cat-' + category.replace(/\s+/g, '-').toLowerCase();
      section.dataset.category = category;

      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'category-toggle';
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.setAttribute('aria-controls', panelId);
      toggle.innerHTML =
        '<span class="category-toggle-label">' +
        '<span class="category-name">' +
        escapeHtml(category) +
        '</span>' +
        '<span class="category-count">' +
        items.length +
        '</span>' +
        '</span>' +
        '<span class="category-chevron" aria-hidden="true">' +
        chevron +
        '</span>';

      const panel = document.createElement('div');
      panel.className = 'category-panel';
      panel.id = panelId;

      toggle.addEventListener('click', () => {
        const willOpen = !section.classList.contains('is-open');

        if (willOpen && !searchQuery.trim()) {
          root.querySelectorAll('.category-section.is-open').forEach((other) => {
            if (other !== section) closeCategorySection(other);
          });
        }

        if (willOpen) {
          section.classList.add('is-open');
          toggle.setAttribute('aria-expanded', 'true');
          openCategories.add(category);
          fillCategoryPanel(panel, items);
          section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } else {
          closeCategorySection(section);
        }
      });

      if (open) fillCategoryPanel(panel, items);

      section.appendChild(toggle);
      section.appendChild(panel);
      root.appendChild(section);
    });
  }

  function refreshAfterCartChange() {
    syncActiveCatalog();
    pruneInactiveCartItems();
    if (typeof VishCart.pruneAddedCombos === 'function') {
      VishCart.pruneAddedCombos(window.PACKS_DATA || []);
    }
    renderProducts();
    renderPacks();
    updateCartBar();
    updateCatalogVendorNote();
    if ($('sheet') && $('sheet').classList.contains('is-open')) renderSheet();
  }

  function updateCatalogVendorNote() {
    const dock = $('prefs-dock-link');
    if (dock) dock.hidden = true;
    const note = $('catalog-vendor-note');
    if (!note) return;
    note.hidden = true;
    note.innerHTML = '';
  }

  function showToast(message) {
    let el = $('site-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'site-toast';
      el.className = 'site-toast';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.add('is-visible');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => el.classList.remove('is-visible'), 3200);
  }

  function pruneInactiveCartItems() {
    const cart = VishCart.getCart();
    const removed = [];
    Object.keys(cart).forEach((id) => {
      const live = liveProduct(id);
      const n = Number(id);
      if ((Number.isFinite(n) && n >= 10000) || (live && live.vendor === 'ignite')) {
        VishCart.removeItem(id);
        return;
      }
      if (live && live.active === false) {
        VishCart.removeItem(id);
        removed.push(live.name || id);
      }
    });
    if (removed.length) {
      showToast(
        removed.length === 1
          ? removed[0] + ' is unavailable — removed from list'
          : removed.length + ' unavailable items removed from your list'
      );
    }
  }

  function deliveryZoneForPin(pin) {
    const zones = cfg().deliveryZones || {};
    const p = String(pin || '');
    if (p.length < 2) return null;
    return zones[p.slice(0, 2)] || zones[p.slice(0, 3)] || zones.default || null;
  }

  function minOrderStatus(total) {
    const min = Number(cfg().softMinOrder) || 0;
    if (!min || total <= 0 || total >= min) return null;
    const need = Math.max(0, Math.ceil(min - total));
    return {
      min: min,
      need: need,
      pct: Math.max(4, Math.min(100, Math.round((total / min) * 100))),
      short: 'Add ' + money(need) + ' more to reach ' + money(min)
    };
  }

  function openLightbox(item) {
    const box = $('lightbox');
    if (!box || !item) return;
    $('lightbox-img').src = item.image || 'assets/optimized/placeholder.jpg';
    $('lightbox-img').alt = item.name;
    $('lightbox-caption').textContent = item.name + ' · ' + money(item.price);
    box.hidden = false;
    document.body.classList.add('lightbox-open');
  }

  function closeLightbox() {
    const box = $('lightbox');
    if (!box) return;
    box.hidden = true;
    document.body.classList.remove('lightbox-open');
  }

  let priceListPreviewUrl = '';
  let priceListPreviewFilename = '';
  let pdfPreviewTimer = null;
  let pdfJsLoading = null;

  function pdfPreviewLikelyUnsupported() {
    try {
      const ua = navigator.userAgent || '';
      const touch = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
      if (/iPhone|iPad|iPod/i.test(ua)) return true;
      if (/Android/i.test(ua)) return true;
      if (touch && /Mobile|Tablet/i.test(ua)) return true;
    } catch (e) {}
    return false;
  }

  function setPdfPreviewMode(mode) {
    const viewer = $('pdf-viewer');
    const fallback = $('pdf-viewer-fallback');
    const pages = $('pdf-viewer-pages');
    const hint = $('pdf-viewer-hint');
    if (!viewer) return;
    viewer.classList.remove('is-preview-iframe', 'is-preview-canvas', 'is-preview-download');
    viewer.classList.add(
      mode === 'canvas'
        ? 'is-preview-canvas'
        : mode === 'download'
          ? 'is-preview-download'
          : 'is-preview-iframe'
    );
    if (fallback) fallback.hidden = mode !== 'download';
    if (pages) pages.hidden = mode !== 'canvas';
    if (hint) {
      if (mode === 'canvas') {
        hint.textContent = 'Scroll to preview pages. Tap Download to save.';
      } else if (mode === 'download') {
        hint.textContent = 'Preview failed — download the PDF below.';
      } else {
        hint.textContent = 'Preview below. Tap Download anytime to save the file.';
      }
    }
  }

  function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (pdfJsLoading) return pdfJsLoading;
    pdfJsLoading = new Promise(function (resolve, reject) {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
      s.async = true;
      s.onload = function () {
        if (!window.pdfjsLib) {
          reject(new Error('PDF engine missing'));
          return;
        }
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
        resolve(window.pdfjsLib);
      };
      s.onerror = function () {
        pdfJsLoading = null;
        reject(new Error('Could not load PDF preview engine'));
      };
      document.head.appendChild(s);
    });
    return pdfJsLoading;
  }

  function clearPdfPages() {
    const pages = $('pdf-viewer-pages');
    if (pages) pages.innerHTML = '';
  }

  function renderPdfCanvasPreview(arrayBuffer) {
    const pages = $('pdf-viewer-pages');
    if (!pages || !arrayBuffer) return Promise.reject(new Error('No preview target'));
    pages.hidden = false;
    pages.innerHTML = '<p class="pdf-viewer-loading">Loading preview…</p>';
    setPdfPreviewMode('canvas');
    return loadPdfJs().then(function (pdfjsLib) {
      return pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    }).then(function (pdf) {
      pages.innerHTML = '';
      const width = Math.max(280, pages.clientWidth - 20);
      let chain = Promise.resolve();
      for (let i = 1; i <= pdf.numPages; i++) {
        chain = chain.then(function () {
          return pdf.getPage(i).then(function (page) {
            const base = page.getViewport({ scale: 1 });
            const scale = Math.min(2.2, width / base.width);
            const viewport = page.getViewport({ scale: scale });
            const canvas = document.createElement('canvas');
            canvas.className = 'pdf-page-canvas';
            canvas.width = Math.floor(viewport.width);
            canvas.height = Math.floor(viewport.height);
            canvas.setAttribute('aria-label', 'Page ' + i);
            pages.appendChild(canvas);
            return page.render({
              canvasContext: canvas.getContext('2d'),
              viewport: viewport
            }).promise;
          });
        });
      }
      return chain;
    });
  }

  function closePdfViewer() {
    const viewer = $('pdf-viewer');
    const frame = $('pdf-viewer-frame');
    if (pdfPreviewTimer) {
      clearTimeout(pdfPreviewTimer);
      pdfPreviewTimer = null;
    }
    if (frame) frame.src = 'about:blank';
    clearPdfPages();
    if (viewer) {
      viewer.hidden = true;
      viewer.classList.remove('is-preview-iframe', 'is-preview-canvas', 'is-preview-download');
    }
    document.body.classList.remove('pdf-viewer-open');
    if (priceListPreviewUrl) {
      URL.revokeObjectURL(priceListPreviewUrl);
      priceListPreviewUrl = '';
    }
    priceListPreviewFilename = '';
    const fallback = $('pdf-viewer-fallback');
    if (fallback) fallback.hidden = true;
    const pages = $('pdf-viewer-pages');
    if (pages) pages.hidden = true;
  }

  function showPriceListPreview(preview, viewerTitle) {
    closePdfViewer();
    priceListPreviewUrl = preview.url;
    priceListPreviewFilename = preview.filename;
    const frame = $('pdf-viewer-frame');
    const viewer = $('pdf-viewer');
    const title = $('pdf-viewer-title');
    if (title && viewerTitle) title.textContent = viewerTitle;
    const useCanvas = pdfPreviewLikelyUnsupported();
    if (viewer) viewer.hidden = false;
    document.body.classList.add('pdf-viewer-open');
    injectIcons(viewer);

    if (useCanvas) {
      if (frame) frame.src = 'about:blank';
      renderPdfCanvasPreview(preview.arrayBuffer).catch(function (err) {
        console.warn('Canvas PDF preview failed:', err);
        setPdfPreviewMode('download');
      });
      return;
    }

    if (frame) frame.src = preview.url;
    setPdfPreviewMode('iframe');
    if (frame) {
      pdfPreviewTimer = setTimeout(function () {
        pdfPreviewTimer = null;
        try {
          const blank =
            !frame.contentDocument ||
            !frame.contentDocument.body ||
            frame.contentDocument.body.childElementCount === 0;
          if (blank && preview.arrayBuffer) {
            renderPdfCanvasPreview(preview.arrayBuffer).catch(function () {
              setPdfPreviewMode('download');
            });
          }
        } catch (e) {
          if (preview.arrayBuffer) {
            renderPdfCanvasPreview(preview.arrayBuffer).catch(function () {
              setPdfPreviewMode('download');
            });
          }
        }
      }, 1600);
    }
  }

  function openPriceListViewerForCatalog(catalog, subtitle, filename) {
    if (!catalog || !catalog.length) {
      notify('Catalogue is still loading. Please try again in a moment.');
      return;
    }
    try {
      const preview = VishPdf.createPriceListPreview(catalog, {
        ...cfg(),
        priceListSubtitle: subtitle || 'Price list  |  Sivakasi  |  Enquiry only',
        priceListFilename: filename || ''
      });
      showPriceListPreview(preview, 'Price list');
    } catch (err) {
      console.error(err);
      notify(err.message || 'Could not create PDF. Please refresh and try again.');
    }
  }

  function openPriceListViewer() {
    openPriceListViewerForCatalog(sriProductsData, 'Price list  |  Sivakasi  |  Enquiry only');
  }

  function downloadPriceListFromViewer() {
    if (!priceListPreviewUrl) return;
    try {
      // Phones often ignore <a download> for blob PDFs — open instead.
      if (pdfPreviewLikelyUnsupported()) {
        window.open(priceListPreviewUrl, '_blank', 'noopener');
        return;
      }
      const a = document.createElement('a');
      a.href = priceListPreviewUrl;
      a.download = priceListPreviewFilename || 'vish-price-list.pdf';
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      console.error(err);
      try {
        window.open(priceListPreviewUrl, '_blank', 'noopener');
      } catch (e2) {
        notify('Could not start download. Please try again.');
      }
    }
  }

  function showEnquiryConfirm() {
    const confirm = $('enquiry-confirm');
    const panel = document.querySelector('#sheet .sheet-panel');
    if (panel) panel.classList.add('is-confirming');
    resetSubmitProgressUi();
    if (confirm) {
      confirm.hidden = false;
      const primary = $('confirm-with-pdf');
      if (primary) primary.focus();
    }
  }

  function hideEnquiryConfirm() {
    stopSubmitProgress();
    resetSubmitProgressUi();
    const confirm = $('enquiry-confirm');
    const panel = document.querySelector('#sheet .sheet-panel');
    if (confirm) confirm.hidden = true;
    if (panel) panel.classList.remove('is-confirming');
  }

  function stopSubmitProgress() {
    if (submitProgressTimer) {
      clearInterval(submitProgressTimer);
      submitProgressTimer = null;
    }
  }

  function paintSubmitProgress(pct) {
    submitProgressValue = Math.max(0, Math.min(100, Math.round(pct)));
    const fill = $('enquiry-progress-fill');
    const bar = $('enquiry-progress-bar');
    const label = $('enquiry-progress-pct');
    if (fill) fill.style.width = submitProgressValue + '%';
    if (bar) bar.setAttribute('aria-valuenow', String(submitProgressValue));
    if (label) label.textContent = submitProgressValue + '%';
  }

  function resetSubmitProgressUi() {
    stopSubmitProgress();
    paintSubmitProgress(0);
    const actions = $('enquiry-confirm-actions');
    const progress = $('enquiry-submit-progress');
    const title = $('enquiry-progress-title');
    const copy = $('enquiry-progress-copy');
    if (actions) actions.hidden = false;
    if (progress) progress.hidden = true;
    if (title) title.textContent = 'Saving your enquiry…';
    if (copy) copy.textContent = 'Usually takes 5–10 seconds. Keep this page open.';
  }

  function startSubmitProgress() {
    stopSubmitProgress();
    const actions = $('enquiry-confirm-actions');
    const progress = $('enquiry-submit-progress');
    const title = $('enquiry-progress-title');
    const copy = $('enquiry-progress-copy');
    if (actions) actions.hidden = true;
    if (progress) progress.hidden = false;
    if (title) title.textContent = 'Saving your enquiry…';
    if (copy) copy.textContent = 'Usually takes 5–10 seconds. Keep this page open.';
    paintSubmitProgress(4);

    const raceMs = 8000;
    const cap = 90;
    const started = Date.now();
    submitProgressTimer = setInterval(function () {
      const t = Math.min(1, (Date.now() - started) / raceMs);
      // Ease-out toward 90% over ~8s
      const eased = 1 - Math.pow(1 - t, 2.2);
      paintSubmitProgress(4 + eased * (cap - 4));
      if (t >= 1) {
        clearInterval(submitProgressTimer);
        submitProgressTimer = null;
        if (title) title.textContent = 'Still saving…';
        if (copy) copy.textContent = 'Taking a little longer — please keep this page open.';
      }
    }, 100);
  }

  function completeSubmitProgress() {
    return new Promise(function (resolve) {
      stopSubmitProgress();
      const title = $('enquiry-progress-title');
      const copy = $('enquiry-progress-copy');
      if (title) title.textContent = 'Saved';
      if (copy) copy.textContent = 'Opening WhatsApp next…';
      paintSubmitProgress(100);
      setTimeout(resolve, 280);
    });
  }

  function failSubmitProgress() {
    stopSubmitProgress();
    resetSubmitProgressUi();
  }

  function packTotals(pack) {
    let total = 0;
    let mrp = 0;
    const lines = [];
    const catalog = catalogForVendor(pack.vendor === 'ignite' ? 'ignite' : 'sri');
    (pack.items || []).forEach((row) => {
      const product = productByIdInCatalog(catalog, row.id) || productById(row.id);
      if (!product || product.active === false) return;
      const qty = row.qty || 1;
      total += product.price * qty;
      mrp += (product.originalPrice || product.price) * qty;
      lines.push({ product, qty });
    });
    return { total, mrp, saved: Math.max(0, mrp - total), lines };
  }

  function comboCustomerList() {
    const packs = Array.isArray(window.PACKS_DATA) ? window.PACKS_DATA : [];
    return packs
      .filter(function (pack) {
        return pack.vendor !== 'ignite';
      })
      .map(function (pack) {
        const { total, mrp, saved, lines } = packTotals(pack);
        if (!lines.length) return null;
        return {
          name: pack.name || 'Combo',
          tagline: String(pack.tagline || '')
            .replace(/\s*after adding\.?/gi, '')
            .replace(/\s*after you add the combo\.?/gi, '')
            .replace(/\s+/g, ' ')
            .trim(),
          mrp: mrp,
          price: total,
          saved: saved,
          items: lines.map(function (line) {
            const product = line.product;
            const qty = line.qty || 1;
            return {
              name: product.name,
              unit: qty + ' x ' + (product.unit || '1 Pack'),
              originalPrice: (product.originalPrice || product.price) * qty,
              price: product.price * qty,
              image: product.image || 'assets/optimized/placeholder.jpg'
            };
          })
        };
      })
      .filter(Boolean);
  }

  async function openStaffComboPdf() {
    const combos = comboCustomerList();
    if (!combos.length) {
      notify('No combos found.');
      return;
    }
    try {
      const preview = await VishPdf.createComboListPreview(combos, {
        ...cfg(),
        priceListFilename: 'Vish-Cracker-Combos-' + new Date().toISOString().slice(0, 10) + '.pdf'
      });
      showPriceListPreview(preview, 'Vish Cracker Combos');
    } catch (err) {
      console.error(err);
      notify(err.message || 'Could not create combo PDF.');
    }
  }

  function addPack(pack) {
    const runAdd = function () {
      const vendor = 'sri';
      const lock = VishCart.ensureVendor(vendor);
      if (!lock.ok) {
        notify(vendorLockMessage(lock.vendor));
        return;
      }
      const { lines } = packTotals(pack);
      if (!lines.length) {
        notify('This combo has no available products right now.');
        return;
      }
      for (let i = 0; i < lines.length; i++) {
        const result = VishCart.addItem(lines[i].product, lines[i].qty);
        if (result && result.ok === false) {
          notify(vendorLockMessage(result.vendor));
          refreshAfterCartChange();
          return;
        }
      }
      if (pack.id != null) VishCart.markComboAdded(pack.id);
      refreshAfterCartChange();
      showToast((pack.name || 'Combo') + ' added to enquiry');
      openSheet();
    };

    const already = pack.id != null && VishCart.hasCombo(pack.id);
    if (already) {
      const ask = window.VishDialog
        ? VishDialog.confirm({
            kicker: 'Already added',
            title: 'Add another set of this combo?',
            body:
              '“' +
              (pack.name || 'This combo') +
              '” is already in your enquiry. Adding again will put another full set of its items into the list.',
            confirmLabel: 'Add another set',
            cancelLabel: 'Not now'
          })
        : Promise.resolve(true);
      ask.then(function (ok) {
        if (ok) runAdd();
      });
      return;
    }
    runAdd();
  }

  function notify(message) {
    if (window.VishDialog) {
      VishDialog.notice({ title: 'Quick note', body: String(message || '') });
      return;
    }
    showToast(message);
  }

  function sectionBlurb(sectionName) {
    if (/kids magic/i.test(sectionName)) {
      return 'Touchable, peacock & kids favourites — fullest soft variety. Edit only within this list after adding.';
    }
    if (/soft colour/i.test(sectionName)) {
      return 'No bombs · colour & sparklers. Edit with matching soft items after adding.';
    }
    if (/open ground/i.test(sectionName)) {
      return 'True open-yard finales (setout-class sky). Open yards only — not for flats.';
    }
    if (/family diwali/i.test(sectionName)) {
      return 'Complete Diwali packs from ₹2,000. Add one, then customise from this list.';
    }
    return 'Add one combo, then customise freely within this list.';
  }

  function sectionTone(sectionName) {
    if (/kids magic|soft colour/i.test(sectionName)) return 'kids';
    if (/open ground/i.test(sectionName)) return 'ground';
    return 'night';
  }

  function packPhotosOn() {
    try {
      return sessionStorage.getItem('vish_pack_photos_v2') === '1';
    } catch (e) {
      return false;
    }
  }

  function setPackPhotosOn(on) {
    try {
      sessionStorage.removeItem('vish_pack_photos_v1');
      if (on) sessionStorage.setItem('vish_pack_photos_v2', '1');
      else sessionStorage.removeItem('vish_pack_photos_v2');
    } catch (e) {}
    syncPackPhotosUi();
  }

  function syncPackPhotosUi() {
    const on = packPhotosOn();
    document.body.classList.toggle('packs-show-photos', on);
    document.querySelectorAll('.pack-photos-toggle').forEach((btn) => {
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.textContent = on ? 'Hide photos' : 'Show photos';
    });
  }

  function packPhotosToggleHtml() {
    const on = packPhotosOn();
    return (
      '<button type="button" class="pack-photos-toggle" data-pack-photos="1" aria-pressed="' +
      (on ? 'true' : 'false') +
      '">' +
      (on ? 'Hide photos' : 'Show photos') +
      '</button>'
    );
  }

  function packItemLinesHtml(lines) {
    return (lines || [])
      .map((l) => {
        const src = safeImageSrc(l.product && l.product.image);
        return (
          '<li>' +
          '<img class="pack-item-photo" src="' +
          src +
          '" alt="" loading="lazy" width="40" height="40" />' +
          '<span class="pack-item-name">' +
          escapeHtml(l.product.name) +
          '</span>' +
          '<span class="pack-item-qty">×' +
          l.qty +
          '</span>' +
          '</li>'
        );
      })
      .join('');
  }

  function updatePacksLaneNote() {
    const note = $('packs-lane-note');
    if (!note) return;
    note.innerHTML =
      '<strong>Ready combos.</strong> Add one, then change quantities or mix items from the catalogue.';
  }

  function preferredSectionOrder(answers) {
    const who = answers && answers.who;
    const vibe = answers && answers.vibe;
    const place = answers && answers.place;
    if (who === 'kids' || vibe === 'soft') {
      return ['Kids magic nights', 'Soft colour nights', 'Family Diwali nights', 'Open ground finales'];
    }
    if (place === 'ground' || vibe === 'finale' || who === 'show') {
      return ['Open ground finales', 'Family Diwali nights', 'Kids magic nights', 'Soft colour nights'];
    }
    return ['Family Diwali nights', 'Soft colour nights', 'Kids magic nights', 'Open ground finales'];
  }

  function renderPackCard(pack, opts) {
    opts = opts || {};
    const { total, mrp, saved, lines } = packTotals(pack);
    const theme = String(pack.theme || 'starter')
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '');
    const already = pack.id != null && VishCart.hasCombo(pack.id);
    const packVendor = pack.vendor === 'ignite' ? 'ignite' : 'sri';
    const tone = opts.tone || sectionTone(pack.section || '');
    const badge = opts.budgetFit ? 'Fits your budget' : pack.badge || 'Combo';
    const card = document.createElement('article');
    card.className =
      'pack-card pack-theme-' +
      theme +
      (tone === 'kids' ? ' pack-card-kids' : '') +
      (already ? ' pack-card-added' : '') +
      (opts.budgetFit ? ' pack-card-budget' : '');
    card.dataset.theme = theme;
    card.dataset.vendor = packVendor;
    card.innerHTML =
      '<div class="pack-atmosphere" aria-hidden="true">' +
      '<span class="pack-burst"></span>' +
      '<span class="pack-sparks"></span>' +
      '</div>' +
      '<div class="pack-body">' +
      '<div class="pack-top">' +
      '<span class="pack-badge">' +
      escapeHtml(badge) +
      '</span>' +
      '<h3>' +
      escapeHtml(pack.name) +
      '</h3>' +
      '<p>' +
      escapeHtml(pack.tagline || '') +
      '</p>' +
      '</div>' +
      '<div class="pack-foot">' +
      '<div class="pack-pricing">' +
      '<strong class="price">' +
      money(total) +
      '</strong>' +
      (saved > 0
        ? '<span class="mrp">' +
          money(mrp) +
          '</span><span class="pack-save">Save ' +
          money(saved) +
          '</span>'
        : '') +
      '</div>' +
      '<button type="button" class="btn-add-pack' +
      (already ? ' is-added' : '') +
      '">' +
      (already ? 'Add another set' : 'Add combo') +
      '</button>' +
      '</div>' +
      '<button type="button" class="pack-details-toggle" aria-expanded="false">' +
      '<span class="pack-details-label">' +
      'View ' +
      lines.length +
      (lines.length === 1 ? ' item' : ' items') +
      '</span>' +
      '<span class="pack-details-chevron" aria-hidden="true">' +
      (window.VishIcons ? VishIcons.svg('chevron') : '▾') +
      '</span>' +
      '</button>' +
      '<div class="pack-details">' +
      '<div class="pack-details-inner">' +
      '<div class="pack-details-tools">' +
      packPhotosToggleHtml() +
      '</div>' +
      '<ul class="pack-items">' +
      packItemLinesHtml(lines) +
      '</ul>' +
      '<p class="pack-customize-hint">After adding, change quantities or add more items anytime.</p>' +
      '</div>' +
      '</div>' +
      '</div>';
    const addBtn = card.querySelector('.btn-add-pack');
    if (addBtn) addBtn.addEventListener('click', () => addPack(pack));
    const toggle = card.querySelector('.pack-details-toggle');
    if (toggle) {
      toggle.addEventListener('click', () => {
        const open = card.classList.toggle('is-open');
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    }
    return card;
  }

  function renderPacks() {
    const root = $('packs-list');
    if (!root) return;
    updatePacksLaneNote();
    document.body.classList.toggle('packs-show-photos', packPhotosOn());
    const oldBar = $('packs-toolbar');
    if (oldBar) oldBar.remove();
    const allPacks = Array.isArray(window.PACKS_DATA) ? window.PACKS_DATA : [];
    const packs = allPacks.filter((pack) => pack.vendor !== 'ignite');
    root.innerHTML = '';
    if (!packs.length) {
      root.innerHTML = '<p class="empty-state">No combos right now. Browse the catalogue instead.</p>';
      return;
    }

    const enriched = packs.map((pack) => {
      const totals = packTotals(pack);
      return {
        pack: pack,
        total: totals.total,
        fit: true,
        score: totals.total
      };
    });

    const bySection = new Map();
    enriched.forEach((e) => {
      const key = e.pack.section || 'Combos';
      if (!bySection.has(key)) bySection.set(key, []);
      bySection.get(key).push(e);
    });

    const preferred = preferredSectionOrder({});
    const sectionOrder = Array.from(bySection.keys()).sort((a, b) => {
      const ai = preferred.indexOf(a);
      const bi = preferred.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });

    sectionOrder.forEach((sectionName) => {
      const sectionPacks = (bySection.get(sectionName) || []).sort((a, b) => a.score - b.score);
      if (!sectionPacks.length) return;
      const tone = sectionTone(sectionName);
      const block = document.createElement('section');
      block.className =
        'packs-section' +
        (tone === 'kids' ? ' packs-section-kids' : '') +
        (tone === 'ground' ? ' packs-section-ground' : '') +
        (tone === 'night' ? ' packs-section-night' : '');
      block.id =
        tone === 'kids' ? 'kids-combos' : tone === 'ground' ? 'ground-combos' : 'diwali-combos';
      const heading = document.createElement('div');
      heading.className = 'packs-section-head';
      heading.innerHTML =
        '<h2>' +
        escapeHtml(sectionName) +
        '</h2>' +
        '<p>' +
        escapeHtml(sectionBlurb(sectionName)) +
        '</p>';
      block.appendChild(heading);
      const grid = document.createElement('div');
      grid.className = 'packs-section-grid';
      sectionPacks.forEach((e) => {
        grid.appendChild(
          renderPackCard(e.pack, {
            tone: tone,
            budgetFit: false
          })
        );
      });
      block.appendChild(grid);
      root.appendChild(block);
    });
  }

  function deadlineDate() {
    const iso = cfg().orderDeadlineISO || '2026-10-25';
    return new Date(iso + 'T23:59:59');
  }

  function urgencyCopy(daysLeft) {
    if (daysLeft < 0) {
      return {
        level: 'closed',
        kicker: 'Booking closed',
        title: 'Online enquiry window is closed',
        text:
          'New lists are paused after ' +
          (cfg().orderDeadline || 'the deadline') +
          '. WhatsApp us for leftovers or special requests.'
      };
    }
    if (daysLeft <= 2) {
      return {
        level: 'critical',
        kicker: 'Peak rates ahead',
        title: 'Last chance before festival transport spikes',
        text: 'Near Diwali, Sivakasi often cannot find enough parcel vehicles — transporters charge much more. Send your list now to lock a better dispatch cost.'
      };
    }
    if (daysLeft <= 7) {
      return {
        level: 'hot',
        kicker: 'Rates climbing',
        title: 'Later orders usually cost more to dispatch',
        text: 'Festival demand makes parcel vehicles scarce from Sivakasi. Lists locked this week still have a stronger chance of lower delivery charges.'
      };
    }
    if (daysLeft <= 14) {
      return {
        level: 'warn',
        kicker: 'Transport rush building',
        title: 'Two weeks to avoid peak delivery charges',
        text: 'As Diwali nears, parcel services ask higher amounts because vehicles are limited. Earlier enquiries help us book transport at more reasonable rates.'
      };
    }
    return {
      level: 'open',
      kicker: 'Dispatch clock · 25 Oct',
      title: 'Earlier lists = lower delivery charges',
      text: 'Near Diwali, Sivakasi parcel vehicles get scarce and transport rates climb. Lock your enquiry early for a smoother, more affordable dispatch.'
    };
  }

  function updateUrgency() {
    const banner = $('urgency-banner');
    if (!banner || isPacksPage()) return;
    const end = deadlineDate();
    const now = new Date();
    const diff = end - now;
    const daysLeft = Math.ceil(diff / (1000 * 60 * 60 * 24));
    const copy = urgencyCopy(daysLeft);
    banner.dataset.level = copy.level;
    if ($('urgency-kicker')) $('urgency-kicker').textContent = copy.kicker;
    if ($('urgency-title')) $('urgency-title').textContent = copy.title;
    if ($('urgency-text')) $('urgency-text').textContent = copy.text;

    if (diff <= 0) {
      if ($('cd-days')) $('cd-days').textContent = '00';
      if ($('cd-hours')) $('cd-hours').textContent = '00';
      if ($('cd-mins')) $('cd-mins').textContent = '00';
      if ($('urgency-progress')) $('urgency-progress').style.width = '100%';
      return;
    }

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
    const mins = Math.floor((diff / (1000 * 60)) % 60);
    if ($('cd-days')) $('cd-days').textContent = String(days).padStart(2, '0');
    if ($('cd-hours')) $('cd-hours').textContent = String(hours).padStart(2, '0');
    if ($('cd-mins')) $('cd-mins').textContent = String(mins).padStart(2, '0');

    const seasonStart = new Date('2026-09-01T00:00:00');
    const total = Math.max(1, end - seasonStart);
    const done = Math.min(1, Math.max(0, (now - seasonStart) / total));
    if ($('urgency-progress')) $('urgency-progress').style.width = Math.round(done * 100) + '%';
  }

  function renderSheet() {
    const cart = VishCart.getCart();
    const list = $('sheet-items');
    if (!list) return;
    const { total, saved } = liveCartTotals(cart);
    list.innerHTML = '';

    if (VishCart.cartCount(cart) === 0) {
      list.innerHTML = '<p class="empty-state">Your enquiry list is empty.</p>';
    } else {
      Object.values(cart).forEach((item) => {
        const live = liveProduct(item.id);
        const unavailable = live && live.active === false;
        const price = live && live.active !== false ? Number(live.price) || 0 : Number(item.price) || 0;
        const name = live && live.name ? live.name : item.name;
        const unit = live && live.unit ? live.unit : item.unit;
        const row = document.createElement('div');
        row.className = 'sheet-item' + (unavailable ? ' is-unavailable' : '');
        row.innerHTML =
          '<div class="sheet-item-main">' +
          '<strong>' +
          escapeHtml(name) +
          (unavailable ? ' <em>(unavailable)</em>' : '') +
          '</strong>' +
          '<span>' +
          escapeHtml(unit) +
          ' · ' +
          money(price) +
          '</span>' +
          '</div>' +
          '<div class="qty-controls compact">' +
          '<button type="button" class="qty-btn" data-act="dec" aria-label="Decrease">−</button>' +
          '<span class="qty-value">' +
          item.quantity +
          '</span>' +
          '<button type="button" class="qty-btn" data-act="inc" aria-label="Increase">+</button>' +
          '</div>' +
          '<button type="button" class="link-remove" data-act="remove">Remove</button>' +
          '<div class="sheet-item-total">' +
          money(price * item.quantity) +
          '</div>';

        row.addEventListener('click', (e) => {
          const btn = e.target.closest('[data-act]');
          if (!btn) return;
          if (btn.dataset.act === 'remove') VishCart.removeItem(item.id);
          else {
            const q = item.quantity + (btn.dataset.act === 'inc' ? 1 : -1);
            VishCart.setQuantity(item.id, q);
          }
          refreshAfterCartChange();
        });
        list.appendChild(row);
      });
    }

    if ($('sheet-total')) $('sheet-total').textContent = money(total);
    if ($('sheet-saved')) {
      $('sheet-saved').textContent = saved > 0 ? 'You save ' + money(saved) : '';
      $('sheet-saved').hidden = saved <= 0;
    }
    const minEl = $('sheet-min-warn');
    const minLabel = $('sheet-min-label');
    const minBar = $('sheet-min-bar');
    const status = minOrderStatus(total);
    if (minEl) {
      if (status && VishCart.cartCount(cart) > 0) {
        minEl.hidden = false;
        if (minLabel) minLabel.textContent = status.short;
        if (minBar) minBar.style.width = status.pct + '%';
      } else {
        minEl.hidden = true;
        if (minLabel) minLabel.textContent = '';
        if (minBar) minBar.style.width = '0%';
      }
    }
    const clearBtn = $('clear-cart-btn');
    if (clearBtn) clearBtn.hidden = VishCart.cartCount(cart) === 0;
    const tools = document.querySelector('.sheet-tools');
    if (tools) tools.hidden = VishCart.cartCount(cart) === 0;
  }

  function openSheet() {
    renderSheet();
    const sheet = $('sheet');
    if (!sheet) return;
    sheet.classList.add('is-open');
    sheet.setAttribute('aria-hidden', 'false');
    document.body.classList.add('sheet-open');
    const panel = sheet.querySelector('.sheet-panel');
    if (panel) panel.scrollTop = 0;
  }

  function closeSheet() {
    if (!$('sheet')) return;
    $('sheet').classList.remove('is-open');
    $('sheet').setAttribute('aria-hidden', 'true');
    document.body.classList.remove('sheet-open');
    hideEnquiryConfirm();
  }

  function setPinMeta(text, ok) {
    const el = $('pin-meta');
    if (!el) return;
    if (!text) {
      el.hidden = true;
      el.textContent = '';
      el.classList.remove('is-ok', 'is-warn');
      return;
    }
    el.hidden = false;
    el.textContent = text;
    el.classList.toggle('is-ok', !!ok);
    el.classList.toggle('is-warn', !ok);
  }

  function clearOfficeSelect() {
    const field = $('pin-office-field');
    const sel = $('pin-office');
    if (field) field.hidden = true;
    if (sel) {
      sel.innerHTML = '';
      sel.removeAttribute('required');
    }
  }

  function applySelectedOffice() {
    const sel = $('pin-office');
    if (!sel || !sel.value) return;
    const idx = Number(sel.value);
    const po = resolvedArea.offices[idx];
    if (!po) return;
    resolvedArea.officeName = po.Name || '';
    resolvedArea.city = po.District || po.Block || po.Name || '';
    resolvedArea.state = po.State || '';
    const label = [po.Name, po.Block, po.District, po.State].filter(Boolean).join(' · ');
    setPinMeta('Selected hub: ' + label, true);
  }

  function fillOfficeSelect(offices) {
    const field = $('pin-office-field');
    const sel = $('pin-office');
    if (!field || !sel) return;
    sel.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent =
      offices.length > 1 ? 'Select your preferred post office…' : 'Confirm this post office…';
    placeholder.disabled = true;
    placeholder.selected = true;
    sel.appendChild(placeholder);

    offices.forEach((po, idx) => {
      const opt = document.createElement('option');
      opt.value = String(idx);
      const bits = [po.Name];
      if (po.Block && po.Block !== po.Name) bits.push(po.Block);
      if (po.District) bits.push(po.District);
      opt.textContent = bits.filter(Boolean).join(' · ');
      sel.appendChild(opt);
    });

    sel.setAttribute('required', 'required');
    field.hidden = false;
    resolvedArea.offices = offices;
    resolvedArea.officeName = '';
    resolvedArea.city = offices[0].District || '';
    resolvedArea.state = offices[0].State || '';

    if (offices.length === 1) {
      sel.value = '0';
      applySelectedOffice();
    } else {
      setPinMeta(offices.length + ' post offices found — please pick yours.', true);
    }
  }

  async function lookupPincode(pin) {
    const token = ++pinLookupToken;
    if (pinAbort) {
      try {
        pinAbort.abort();
      } catch (e) {}
    }
    pinAbort = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const abortTimer = pinAbort ? setTimeout(() => pinAbort.abort(), 8000) : null;

    resolvedArea = { city: '', state: '', officeName: '', offices: [] };
    clearOfficeSelect();
    if (!/^\d{6}$/.test(pin)) {
      setPinMeta('');
      if (abortTimer) clearTimeout(abortTimer);
      return;
    }
    setPinMeta('Looking up post offices…', true);
    try {
      const res = await fetch('https://api.postalpincode.in/pincode/' + pin, {
        signal: pinAbort ? pinAbort.signal : undefined
      });
      const data = await res.json();
      if (token !== pinLookupToken) return;
      const entry = Array.isArray(data) ? data[0] : null;
      if (!entry || entry.Status !== 'Success' || !entry.PostOffice || !entry.PostOffice.length) {
        setPinMeta('Pincode accepted. Choose office later if needed.', false);
        return;
      }
      fillOfficeSelect(entry.PostOffice);
      const zone = deliveryZoneForPin(pin);
      const firstPo = entry.PostOffice[0] || {};
      const place = firstPo.District || firstPo.Block || firstPo.State || '';
      if (zone) {
        setPinMeta(
          (place ? place + ' · ' : '') + zone.label + ' — ' + zone.hint,
          true
        );
      }
    } catch (err) {
      if (token !== pinLookupToken) return;
      const zone = deliveryZoneForPin(pin);
      setPinMeta(
        zone
          ? 'Pincode saved. ' + zone.label + ' — ' + zone.hint
          : 'Pincode saved. Area lookup skipped — we will confirm with you.',
        false
      );
    } finally {
      if (abortTimer) clearTimeout(abortTimer);
    }
  }

  function validateContact() {
    const contact = {
      name: ($('customer-name') && $('customer-name').value.trim()) || '',
      phone: (($('customer-phone') && $('customer-phone').value.trim()) || '').replace(/\s+/g, ''),
      pincode: (($('customer-pincode') && $('customer-pincode').value.trim()) || ''),
      officeName: resolvedArea.officeName || '',
      city: resolvedArea.city || '',
      state: resolvedArea.state || '',
      address: ''
    };
    const msg = $('form-msg');
    const officeField = $('pin-office-field');
    const officeSel = $('pin-office');

    if (!contact.name || !contact.phone || !contact.pincode) {
      if (msg) msg.textContent = 'Name, mobile and pincode are required.';
      return null;
    }
    if (!/^[6-9]\d{9}$/.test(contact.phone)) {
      if (msg) msg.textContent = 'Enter a valid 10-digit Indian mobile number.';
      return null;
    }
    if (!/^\d{6}$/.test(contact.pincode)) {
      if (msg) msg.textContent = 'Enter a valid 6-digit pincode.';
      return null;
    }
    if (officeField && !officeField.hidden && officeSel && !officeSel.value) {
      if (msg) msg.textContent = 'Please select your preferred post office / hub.';
      return null;
    }
    if (officeSel && officeSel.value) applySelectedOffice();
    contact.officeName = resolvedArea.officeName || '';
    contact.city = resolvedArea.city || '';
    contact.state = resolvedArea.state || '';
    if (msg) msg.textContent = '';
    return contact;
  }

  async function submitEnquiry(e) {
    e.preventDefault();
    if (submitting) return;

    const cart = VishCart.getCart();
    if (VishCart.cartCount(cart) === 0) {
      if ($('form-msg')) $('form-msg').textContent = 'Add at least one product before submitting.';
      return;
    }

    const contact = validateContact();
    if (!contact) return;

    showEnquiryConfirm();
  }

  function fetchWithTimeout(url, options, ms) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
  }

  /**
   * Apps Script /exec returns 302 then a JSON body (GET on redirect).
   * Use cors + redirect:follow + text/plain so we can READ status:ok|error.
   * Never treat opaque/no-cors as success — that opened WhatsApp with no Sheet row.
   */
  async function postEnquiry(payload) {
    const url = (cfg().appsScriptUrl || '').trim();
    if (!url) return { ok: false, reason: 'missing-url' };

    try {
      const res = await fetchWithTimeout(
        url,
        {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(payload),
          redirect: 'follow'
        },
        45000
      );
      const data = await res.json().catch(() => null);
      if (data && data.status === 'ok') return { ok: true, data: data };
      if (data && data.status === 'error') {
        return { ok: false, reason: data.message || 'rejected', data: data };
      }
      return { ok: false, reason: 'bad-response' };
    } catch (err) {
      console.warn('Enquiry POST failed', err);
      return { ok: false, reason: 'network' };
    }
  }

  function resetConfirmButtons(withPdfBtn, waOnlyBtn, backBtn) {
    submitting = false;
    if (withPdfBtn) {
      withPdfBtn.disabled = false;
      withPdfBtn.textContent = 'Yes, download PDF';
    }
    if (waOnlyBtn) {
      waOnlyBtn.disabled = false;
      waOnlyBtn.textContent = 'No, continue';
    }
    if (backBtn) backBtn.disabled = false;
  }

  async function finishEnquiry(wantPdf) {
    if (submitting) return;

    const cart = VishCart.getCart();
    if (VishCart.cartCount(cart) === 0) return;
    const contact = validateContact();
    if (!contact) {
      hideEnquiryConfirm();
      return;
    }

    const hp = $('customer-website');
    if (hp) hp.value = '';

    submitting = true;
    const withPdfBtn = $('confirm-with-pdf');
    const waOnlyBtn = $('confirm-whatsapp-only');
    const backBtn = $('confirm-back');
    [withPdfBtn, waOnlyBtn, backBtn].forEach((b) => {
      if (b) b.disabled = true;
    });
    if ($('form-msg')) {
      $('form-msg').textContent = 'Saving your enquiry… please keep this page open.';
    }
    startSubmitProgress();

    const totals = liveCartTotals(cart);
    const submissionId = newSubmissionId();
    const payload = {
      name: contact.name,
      phone: contact.phone,
      address: contact.officeName
        ? 'Preferred hub: ' + contact.officeName
        : 'Nearest parcel / courier office',
      city: contact.city || '',
      state: contact.state || '',
      pincode: contact.pincode,
      officeName: contact.officeName || '',
      deliveryMode: 'parcel-office',
      cart: cart,
      total: totals.total,
      saved: totals.saved,
      submissionId: submissionId,
      submittedAt: new Date().toISOString(),
      fulfillVendor: resolveFulfillVendor(),
      website: '',
      ingestKey: cfg().enquiryIngestKey || '',
      userAgent: navigator.userAgent || ''
    };

    const result = await postEnquiry(payload);

    // Require confirmed server save — never open PDF/WA on hope
    if (result.ok !== true) {
      failSubmitProgress();
      resetConfirmButtons(withPdfBtn, waOnlyBtn, backBtn);
      hideEnquiryConfirm();
      let errText = 'Could not save your enquiry. Please try Submit again — your list is still here.';
      if (result.reason === 'missing-url') {
        errText = 'Enquiry service is not configured. Please contact us on WhatsApp directly.';
      } else if (result.reason && result.reason !== 'network' && result.reason !== 'bad-response') {
        errText = result.reason + ' — your list is still here. Try again in a minute or use another number.';
      } else if (result.reason === 'network') {
        errText =
          'Network error while saving. Check connection and try Submit again — your list is still here.';
      }
      if ($('form-msg')) $('form-msg').textContent = errText;
      return;
    }

    await completeSubmitProgress();

    const exportCart = (function enrich(cart) {
      const out = {};
      Object.values(cart).forEach((item) => {
        const live = liveProduct(item.id);
        out[item.id] = {
          id: item.id,
          quantity: item.quantity,
          name: live && live.name ? live.name : item.name,
          unit: live && live.unit ? live.unit : item.unit,
          price: live && live.active !== false ? Number(live.price) || 0 : Number(item.price) || 0,
          originalPrice:
            live && live.active !== false
              ? Number(live.originalPrice) || Number(live.price) || 0
              : Number(item.originalPrice) || Number(item.price) || 0,
          image: item.image
        };
      });
      return out;
    })(cart);

    if (wantPdf) {
      try {
        VishPdf.downloadEnquiryPdf(contact, exportCart, cfg());
      } catch (err) {
        console.warn('PDF failed', err);
      }
    }

    const waText = VishPdf.buildWhatsAppMessage(contact, exportCart, cfg());
    VishPdf.openWhatsApp(cfg(), waText);

    VishCart.clearCart();
    updateCartBar();
    renderProducts();
    renderPacks();
    hideEnquiryConfirm();
    closeSheet();
    showSuccess(true, wantPdf, false);
    if ($('enquiry-form')) $('enquiry-form').reset();
    resolvedArea = { city: '', state: '', officeName: '', offices: [] };
    clearOfficeSelect();
    setPinMeta('');
    resetConfirmButtons(withPdfBtn, waOnlyBtn, backBtn);
  }

  function showSuccess(logged, wantPdf, opaque) {
    const el = $('success');
    if (!el || !$('success-detail')) return;
    el.hidden = false;
    if (!logged) {
      $('success-detail').textContent =
        'Could not confirm server save. WhatsApp should still open with your list — please send that message.';
    } else if (opaque) {
      $('success-detail').textContent = wantPdf
        ? 'Enquiry sent. Your PDF is downloading — please send the WhatsApp message so we can confirm.'
        : 'Enquiry sent. Please send the WhatsApp message so we can confirm.';
    } else if (wantPdf) {
      $('success-detail').textContent =
        'Enquiry submitted. Your PDF is downloading — we will contact you shortly to confirm.';
    } else {
      $('success-detail').textContent =
        'Enquiry submitted. We will contact you shortly to confirm.';
    }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function bindUi() {
    const search = $('search-input');
    if (search && search.type !== 'hidden') {
      search.addEventListener('input', (e) => {
        searchQuery = e.target.value;
        renderProducts();
      });
    }

    if ($('clear-cart-btn')) {
      $('clear-cart-btn').addEventListener('click', () => {
        if (VishCart.cartCount() === 0) return;
        const ask = window.VishDialog
          ? VishDialog.confirm({
              kicker: 'Enquiry list',
              title: 'Clear your entire enquiry?',
              body: 'All items will be removed from this list.',
              confirmLabel: 'Clear list',
              cancelLabel: 'Keep items'
            })
          : Promise.resolve(true);
        ask.then(function (ok) {
          if (!ok) return;
          VishCart.clearCart();
          refreshAfterCartChange();
          showToast('Enquiry list cleared');
        });
      });
    }

    if ($('review-btn')) $('review-btn').addEventListener('click', openSheet);
    if ($('cart-badge-btn')) {
      $('cart-badge-btn').addEventListener('click', () => {
        if (VishCart.cartCount() === 0) {
          showToast('Add a combo or products first');
          return;
        }
        openSheet();
      });
    }
    if ($('close-sheet')) $('close-sheet').addEventListener('click', closeSheet);
    if ($('sheet-backdrop')) $('sheet-backdrop').addEventListener('click', closeSheet);
    if ($('enquiry-form')) $('enquiry-form').addEventListener('submit', submitEnquiry);

    const browseLink = $('sheet-browse-link');
    if (browseLink) {
      browseLink.addEventListener('click', (e) => {
        if (isPacksPage()) return;
        e.preventDefault();
        closeSheet();
        const catalog = $('catalog') || document.getElementById('product-list');
        if (catalog) catalog.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }

    const pinInput = $('customer-pincode');
    if (pinInput) {
      pinInput.addEventListener('input', (e) => {
        const pin = e.target.value.replace(/\D/g, '').slice(0, 6);
        e.target.value = pin;
        if (pin.length === 6) lookupPincode(pin);
        else {
          clearOfficeSelect();
          setPinMeta('');
        }
      });
    }

    const officeSel = $('pin-office');
    if (officeSel) {
      officeSel.addEventListener('change', applySelectedOffice);
    }

    const catTrigger = $('category-trigger');
    if (catTrigger && !catTrigger.hidden) {
      catTrigger.addEventListener('click', openCategoryPicker);
    }
    if ($('category-picker-close')) {
      $('category-picker-close').addEventListener('click', closeCategoryPicker);
    }
    if ($('category-picker-backdrop')) {
      $('category-picker-backdrop').addEventListener('click', closeCategoryPicker);
    }
    const catSearch = $('category-search');
    if (catSearch && catSearch.type !== 'hidden') {
      catSearch.addEventListener('input', (e) => {
        categorySearch = e.target.value;
        renderCategoryPicker();
      });
    }

    async function runPriceListDownload(btn) {
      try {
        if (btn) btn.disabled = true;
        await refreshProductsFromSheet({ paint: false, timeoutMs: 10000 });
        openPriceListViewer();
      } finally {
        if (btn) btn.disabled = false;
      }
    }

    const pdfBtn = $('download-pricelist');
    if (pdfBtn) {
      pdfBtn.addEventListener('click', () => runPriceListDownload(pdfBtn));
    }
    ['download-pricelist-visit', 'download-pricelist-teaser', 'download-pricelist-footer'].forEach((id) => {
      const el = $(id);
      if (el) el.addEventListener('click', () => runPriceListDownload(el));
    });

    if ($('confirm-with-pdf')) {
      $('confirm-with-pdf').addEventListener('click', () => finishEnquiry(true));
    }
    if ($('confirm-whatsapp-only')) {
      $('confirm-whatsapp-only').addEventListener('click', () => finishEnquiry(false));
    }
    if ($('confirm-back')) {
      $('confirm-back').addEventListener('click', hideEnquiryConfirm);
    }

    if ($('pdf-viewer-close')) {
      $('pdf-viewer-close').addEventListener('click', closePdfViewer);
    }
    if ($('pdf-viewer-backdrop')) {
      $('pdf-viewer-backdrop').addEventListener('click', closePdfViewer);
    }
    if ($('pdf-viewer-download')) {
      $('pdf-viewer-download').addEventListener('click', downloadPriceListFromViewer);
    }
    if ($('pdf-viewer-download-main')) {
      $('pdf-viewer-download-main').addEventListener('click', downloadPriceListFromViewer);
    }

    wireWhatsAppFloat();

    document.addEventListener('click', (e) => {
      if (e.target.closest('[data-edit-prefs], [data-plan-again], [data-match-help], [data-why-two-lists]')) {
        e.preventDefault();
        return;
      }
      if (e.target.closest('[data-pack-photos]')) {
        e.preventDefault();
        setPackPhotosOn(!packPhotosOn());
      }
    });

    const lbClose = $('lightbox-close');
    const lb = $('lightbox');
    if (lbClose) lbClose.addEventListener('click', closeLightbox);
    if (lb) {
      lb.addEventListener('click', (e) => {
        if (e.target === lb) closeLightbox();
      });
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeSheet();
        closeLightbox();
        closeCategoryPicker();
        closePdfViewer();
        if (window.VishNightUI) VishNightUI.hidePdfChooser();
      }
    });
  }

  function hydrateHeader() {
    if ($('brand-name')) $('brand-name').textContent = 'Vish Fireworks';
    if ($('brand-tag') && !isPacksPage()) {
      $('brand-tag').textContent = 'From Sivakasi · ' + cfg().brandShort;
    }
    if ($('biz-address')) $('biz-address').textContent = cfg().address;
    if ($('biz-phone')) $('biz-phone').textContent = cfg().ownerName + ' – ' + cfg().phone;
    if ($('biz-deadline')) {
      $('biz-deadline').textContent =
        'No new enquiries after ' +
        cfg().orderDeadline +
        '. We close early so festival transport demand does not push delivery charges too high.';
    }
    if ($('biz-delivery')) $('biz-delivery').textContent = cfg().deliveryNote;
  }

  function useLocalProducts() {
    const sri = Array.isArray(window.PRODUCTS_DATA) ? window.PRODUCTS_DATA : [];
    if (!sri.length) return false;
    sriProductsData = tagVendor(sri, 'sri');
    igniteProductsData = [];
    VishCart.setVendor('sri');
    syncActiveCatalog();
    return true;
  }

  function paintPricesLoading() {
    const msg = '<p class="empty-state">Loading latest prices…</p>';
    const products = $('product-list');
    if (products && !isPacksPage()) products.innerHTML = msg;
    const packs = $('packs-list');
    if (packs) packs.innerHTML = msg;
  }

  function paintCatalog() {
    syncActiveCatalog();
    pruneInactiveCartItems();
    updateCategoryLabel();
    renderProducts();
    renderPacks();
    updateCartBar();
    updateCatalogVendorNote();
    injectIcons(document);
  }

  function catalogFingerprint(sri, ignite) {
    try {
      return JSON.stringify({ s: sri || [], i: ignite || [] });
    } catch (e) {
      return '';
    }
  }

  async function refreshProductsFromSheet(options) {
    options = options || {};
    const shouldPaint = options.paint !== false;
    const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 25000;
    const url = (cfg().appsScriptUrl || '').trim();
    if (!url) return false;

    const before = catalogFingerprint(sriProductsData, igniteProductsData);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url + '?action=products&_=' + Date.now(), {
        signal: controller.signal,
        cache: 'no-store'
      });
      const data = await res.json();
      if (data && Array.isArray(data.products) && data.products.length) {
        const nextSri = tagVendor(data.products, 'sri');
        const after = catalogFingerprint(nextSri, []);
        if (after && after === before) return true;
        sriProductsData = nextSri;
        igniteProductsData = [];
        syncActiveCatalog();
        if (shouldPaint) paintCatalog();
        return true;
      }
    } catch (err) {
      console.warn('Sheet catalog refresh skipped:', err);
    } finally {
      clearTimeout(timer);
    }
    return false;
  }

  async function init() {
    injectIcons(document);
    hydrateHeader();
    bindUi();
    updateUrgency();
    setInterval(updateUrgency, 30000);

    if (!useLocalProducts()) {
      if ($('product-list') && !isPacksPage()) {
        $('product-list').innerHTML =
          '<p class="empty-state">Could not load products. Please refresh.</p>';
      }
      throw new Error('Product data missing');
    }

    try {
      if (new URLSearchParams(location.search).has('cart')) {
        history.replaceState({}, '', location.pathname + location.hash);
      }
    } catch (err) {}

    // Local catalogue first (instant). Sheet refresh in background; silent re-paint only if changed.
    paintCatalog();
    refreshProductsFromSheet({ paint: true, timeoutMs: 25000 }).catch(function () {});

    try {
      if (new URLSearchParams(location.search).get('staffpdf') === 'combos') {
        openStaffComboPdf();
      }
    } catch (err) {}
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', () => {
  VishApp.init().catch((err) => {
    console.error(err);
    const root = document.getElementById('product-list');
    if (root && !document.body.classList.contains('page-packs')) {
      root.innerHTML = '<p class="empty-state">Could not load products. Please refresh.</p>';
    }
  });
});
