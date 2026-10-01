window.VishApp = (function () {
  const cfg = () => window.SITE_CONFIG;
  let productsData = [];
  let activeCategory = 'all';
  let searchQuery = '';
  let categorySearch = '';
  let openCategories = new Set();
  let submitting = false;
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

  function allProducts() {
    return productsData.flatMap((cat) =>
      cat.items
        .filter((i) => i.active !== false)
        .map((item) => ({ ...item, category: cat.category }))
    );
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

  function productById(id) {
    return (
      allProducts().find((p) => String(p.id) === String(id)) ||
      productsData.flatMap((c) => c.items).find((p) => String(p.id) === String(id))
    );
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
      const note = softMinOrderNote(total);
      if (note && count > 0) {
        warn.hidden = false;
        warn.textContent = note;
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
        VishCart.addItem(item);
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
    pruneInactiveCartItems();
    renderProducts();
    renderPacks();
    updateCartBar();
    if ($('sheet') && $('sheet').classList.contains('is-open')) renderSheet();
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

  function softMinOrderNote(total) {
    const min = Number(cfg().softMinOrder) || 0;
    if (!min || total >= min) return '';
    return (
      cfg().softMinOrderNote ||
      'Orders under ' +
        money(min) +
        ' will be reviewed first and confirmed only after we check with you on WhatsApp.'
    );
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

  function closePdfViewer() {
    const viewer = $('pdf-viewer');
    const frame = $('pdf-viewer-frame');
    if (frame) frame.src = 'about:blank';
    if (viewer) viewer.hidden = true;
    document.body.classList.remove('pdf-viewer-open');
    if (priceListPreviewUrl) {
      URL.revokeObjectURL(priceListPreviewUrl);
      priceListPreviewUrl = '';
    }
    priceListPreviewFilename = '';
  }

  function openPriceListViewer() {
    if (!productsData.length) {
      alert('Catalogue is still loading. Please try again in a moment.');
      return;
    }
    try {
      closePdfViewer();
      const preview = VishPdf.createPriceListPreview(productsData, cfg());
      priceListPreviewUrl = preview.url;
      priceListPreviewFilename = preview.filename;
      const frame = $('pdf-viewer-frame');
      const viewer = $('pdf-viewer');
      if (frame) frame.src = preview.url;
      if (viewer) viewer.hidden = false;
      document.body.classList.add('pdf-viewer-open');
      injectIcons(viewer);
    } catch (err) {
      console.error(err);
      alert(err.message || 'Could not create PDF. Please refresh and try again.');
    }
  }

  function downloadPriceListFromViewer() {
    if (!productsData.length) return;
    try {
      VishPdf.downloadPriceListPdf(productsData, cfg());
    } catch (err) {
      console.error(err);
      alert(err.message || 'Could not download PDF.');
    }
  }

  function showEnquiryConfirm() {
    const confirm = $('enquiry-confirm');
    const panel = document.querySelector('#sheet .sheet-panel');
    if (panel) panel.classList.add('is-confirming');
    if (confirm) {
      confirm.hidden = false;
      const primary = $('confirm-with-pdf');
      if (primary) primary.focus();
    }
  }

  function hideEnquiryConfirm() {
    const confirm = $('enquiry-confirm');
    const panel = document.querySelector('#sheet .sheet-panel');
    if (confirm) confirm.hidden = true;
    if (panel) panel.classList.remove('is-confirming');
  }

  function packTotals(pack) {
    let total = 0;
    let mrp = 0;
    const lines = [];
    (pack.items || []).forEach((row) => {
      const product = productById(row.id);
      if (!product || product.active === false) return;
      const qty = row.qty || 1;
      total += product.price * qty;
      mrp += (product.originalPrice || product.price) * qty;
      lines.push({ product, qty });
    });
    return { total, mrp, saved: Math.max(0, mrp - total), lines };
  }

  function addPack(pack) {
    const { lines } = packTotals(pack);
    if (!lines.length) {
      alert('This combo has no available products right now.');
      return;
    }
    lines.forEach(({ product, qty }) => VishCart.addItem(product, qty));
    refreshAfterCartChange();
    openSheet();
  }

  function renderPacks() {
    const root = $('packs-list');
    if (!root) return;
    const packs = Array.isArray(window.PACKS_DATA) ? window.PACKS_DATA : [];
    root.innerHTML = '';
    if (!packs.length) {
      root.innerHTML = '<p class="empty-state">No combos yet.</p>';
      return;
    }

    packs.forEach((pack) => {
      const { total, mrp, saved, lines } = packTotals(pack);
      const card = document.createElement('article');
      card.className = 'pack-card';
      card.innerHTML =
        '<div class="pack-top">' +
        '<span class="pack-badge">' +
        escapeHtml(pack.badge || 'Combo') +
        '</span>' +
        '<h3>' +
        escapeHtml(pack.name) +
        '</h3>' +
        '<p>' +
        escapeHtml(pack.tagline || '') +
        '</p>' +
        '</div>' +
        '<ul class="pack-items">' +
        lines
          .map(
            (l) =>
              '<li><span>' +
              escapeHtml(l.product.name) +
              '</span><span>×' +
              l.qty +
              '</span></li>'
          )
          .join('') +
        '</ul>' +
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
        '<button type="button" class="btn-add-pack">Add combo</button>' +
        '</div>';
      card.querySelector('.btn-add-pack').addEventListener('click', () => addPack(pack));
      root.appendChild(card);
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
    if (minEl) {
      const note = softMinOrderNote(total);
      if (note && VishCart.cartCount(cart) > 0) {
        minEl.hidden = false;
        minEl.textContent = note;
      } else {
        minEl.hidden = true;
        minEl.textContent = '';
      }
    }
  }

  function openSheet() {
    renderSheet();
    $('sheet').classList.add('is-open');
    $('sheet').setAttribute('aria-hidden', 'false');
    document.body.classList.add('sheet-open');
    if (VishCart.cartCount() > 0 && $('customer-name')) $('customer-name').focus();
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
    if (withPdfBtn) withPdfBtn.textContent = 'Saving… please wait';
    if (waOnlyBtn) waOnlyBtn.textContent = 'Saving… please wait';
    if ($('form-msg')) {
      $('form-msg').textContent = 'Saving your enquiry… please keep this page open for a few seconds.';
    }

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
      website: '',
      ingestKey: cfg().enquiryIngestKey || '',
      userAgent: navigator.userAgent || ''
    };

    const result = await postEnquiry(payload);

    // Require confirmed server save — never open PDF/WA on hope
    if (result.ok !== true) {
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

    if ($('share-cart-btn')) {
      $('share-cart-btn').addEventListener('click', async () => {
        const share = VishCart.encodeShare();
        if (!share) {
          showToast('Add items before sharing');
          return;
        }
        const url =
          location.origin +
          location.pathname.replace(/combos\.html$/, 'index.html') +
          '?cart=' +
          encodeURIComponent(share);
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(url);
            showToast('Cart link copied');
          } else {
            window.prompt('Copy cart link', url);
          }
        } catch (err) {
          window.prompt('Copy cart link', url);
        }
      });
    }

    if ($('resume-cart-btn')) {
      $('resume-cart-btn').addEventListener('click', () => {
        openSheet();
        const chip = $('resume-cart-chip');
        if (chip) chip.hidden = true;
      });
    }

    if ($('review-btn')) $('review-btn').addEventListener('click', openSheet);
    if ($('cart-badge-btn')) {
      $('cart-badge-btn').addEventListener('click', () => {
        if (VishCart.cartCount() === 0) return;
        openSheet();
      });
    }
    if ($('close-sheet')) $('close-sheet').addEventListener('click', closeSheet);
    if ($('sheet-backdrop')) $('sheet-backdrop').addEventListener('click', closeSheet);
    if ($('enquiry-form')) $('enquiry-form').addEventListener('submit', submitEnquiry);

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

    function runPriceListDownload(btn) {
      try {
        if (btn) btn.disabled = true;
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

    wireWhatsAppFloat();

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
    if (Array.isArray(window.PRODUCTS_DATA) && window.PRODUCTS_DATA.length) {
      productsData = window.PRODUCTS_DATA;
      return true;
    }
    return false;
  }

  function paintCatalog() {
    pruneInactiveCartItems();
    updateCategoryLabel();
    renderProducts();
    renderPacks();
    updateCartBar();
    injectIcons(document);
  }

  async function refreshProductsFromSheet() {
    const url = (cfg().appsScriptUrl || '').trim();
    if (!url) return;

    const controller = new AbortController();
    // Apps Script cold starts often exceed 4s on live; keep waiting longer than local.
    const timer = setTimeout(() => controller.abort(), 25000);

    try {
      const res = await fetch(url + '?action=products&_=' + Date.now(), {
        signal: controller.signal,
        cache: 'no-store'
      });
      const data = await res.json();
      if (data && Array.isArray(data.products) && data.products.length) {
        productsData = data.products;
        paintCatalog();
      }
    } catch (err) {
      console.warn('Sheet catalog refresh skipped:', err);
    } finally {
      clearTimeout(timer);
    }
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

    const params = new URLSearchParams(location.search);
    const cartShare = params.get('cart');
    if (cartShare) {
      const existingCount = VishCart.cartCount();
      let apply = true;
      if (existingCount > 0) {
        apply = window.confirm(
          'You already have ' +
            existingCount +
            ' item(s) in your enquiry list.\n\nReplace them with the shared cart?'
        );
      }
      if (apply) {
        const result = VishCart.applyShare(cartShare, productById, { replace: true });
        if (result.added) {
          showToast(
            'Loaded ' +
              result.added +
              ' item(s) from shared link' +
              (result.skipped ? ' (' + result.skipped + ' unavailable skipped)' : '')
          );
        }
      } else {
        showToast('Kept your existing enquiry list');
      }
      try {
        history.replaceState({}, '', location.pathname + location.hash);
      } catch (err) {}
    } else if (VishCart.cartCount() > 0 && $('resume-cart-chip')) {
      $('resume-cart-chip').hidden = false;
    }

    paintCatalog();
    refreshProductsFromSheet();
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
