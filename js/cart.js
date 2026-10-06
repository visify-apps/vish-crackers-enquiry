/* Vish Fireworks — hardened cart (localStorage treated as untrusted) */
window.VishCart = (function () {
  const CART_KEY = 'vish_cart_v3';
  const COMBOS_KEY = 'vish_added_combos_v1';
  const VENDOR_KEY = 'vish_cart_vendor_v1';
  const LEGACY_KEYS = ['vish_cart_v2'];
  const MAX_QTY = 999;
  const VENDORS = { sri: true };
  let memoryFallback = null;
  let combosFallback = null;
  let vendorFallback = null;

  function clampQty(n) {
    const q = parseInt(n, 10);
    if (!Number.isFinite(q) || q <= 0) return 0;
    return Math.min(MAX_QTY, q);
  }

  function normalizeItem(id, item) {
    if (!item || typeof item !== 'object') return null;
    const quantity = clampQty(item.quantity != null ? item.quantity : item.qty);
    if (!quantity) return null;
    const vendor = normalizeVendor(item.vendor);
    return {
      id: item.id != null ? item.id : id,
      name: String(item.name || '').slice(0, 120),
      price: Number(item.price) || 0,
      originalPrice: Number(item.originalPrice) || 0,
      unit: String(item.unit || '').slice(0, 40),
      image: String(item.image || '').slice(0, 200),
      quantity: quantity,
      vendor: vendor || undefined
    };
  }

  function normalizeCart(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    Object.keys(raw).forEach((key) => {
      const normalized = normalizeItem(key, raw[key]);
      if (normalized) out[String(normalized.id)] = normalized;
    });
    return out;
  }

  function readRaw() {
    if (memoryFallback) return memoryFallback;
    try {
      if (!window.localStorage) return {};
      let raw = localStorage.getItem(CART_KEY);
      if (!raw) {
        for (let i = 0; i < LEGACY_KEYS.length; i++) {
          const legacy = localStorage.getItem(LEGACY_KEYS[i]);
          if (legacy) {
            raw = legacy;
            break;
          }
        }
      }
      if (!raw) return {};
      return JSON.parse(raw);
    } catch (e) {
      return {};
    }
  }

  function getCart() {
    return normalizeCart(readRaw());
  }

  function saveCart(cart) {
    const normalized = normalizeCart(cart);
    memoryFallback = normalized;
    try {
      if (!window.localStorage) return normalized;
      localStorage.setItem(CART_KEY, JSON.stringify(normalized));
      LEGACY_KEYS.forEach((k) => {
        try {
          localStorage.removeItem(k);
        } catch (e) {}
      });
    } catch (e) {
      console.warn('Cart storage unavailable; using in-memory cart', e);
    }
    return normalized;
  }

  function normalizeVendor(v) {
    const s = String(v || '').toLowerCase();
    return VENDORS[s] ? s : '';
  }

  function getVendor() {
    if (vendorFallback === 'sri') return vendorFallback;
    try {
      if (!window.localStorage) return '';
      return normalizeVendor(localStorage.getItem(VENDOR_KEY));
    } catch (e) {
      return '';
    }
  }

  function setVendor(vendor) {
    const v = normalizeVendor(vendor);
    vendorFallback = v || null;
    try {
      if (!window.localStorage) return v;
      if (v) localStorage.setItem(VENDOR_KEY, v);
      else localStorage.removeItem(VENDOR_KEY);
    } catch (e) {}
    return v;
  }

  function clearVendor() {
    return setVendor('');
  }

  /**
   * Lock cart to a vendor. Returns { ok, vendor, reason }.
   * Empty cart may switch freely; non-empty cart cannot mix vendors.
   */
  function ensureVendor(vendor, options) {
    options = options || {};
    const next = normalizeVendor(vendor);
    if (!next) return { ok: false, vendor: getVendor(), reason: 'invalid-vendor' };
    const current = getVendor();
    const count = cartCount();
    if (!current || count === 0) {
      setVendor(next);
      return { ok: true, vendor: next, reason: '' };
    }
    if (current === next) return { ok: true, vendor: current, reason: '' };
    if (options.force) {
      setVendor(next);
      return { ok: true, vendor: next, reason: 'forced' };
    }
    return { ok: false, vendor: current, reason: 'vendor-lock' };
  }

  function clearCart() {
    memoryFallback = {};
    combosFallback = {};
    vendorFallback = null;
    try {
      if (window.localStorage) {
        localStorage.removeItem(CART_KEY);
        localStorage.removeItem(COMBOS_KEY);
        localStorage.removeItem(VENDOR_KEY);
        LEGACY_KEYS.forEach((k) => localStorage.removeItem(k));
      }
    } catch (e) {}
  }

  function readAddedCombos() {
    if (combosFallback && typeof combosFallback === 'object') return { ...combosFallback };
    try {
      if (!window.localStorage) return {};
      const raw = localStorage.getItem(COMBOS_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      const out = {};
      Object.keys(parsed).forEach((id) => {
        if (parsed[id]) out[String(id)] = true;
      });
      return out;
    } catch (e) {
      return {};
    }
  }

  function saveAddedCombos(map) {
    const out = {};
    Object.keys(map || {}).forEach((id) => {
      if (map[id]) out[String(id)] = true;
    });
    combosFallback = out;
    try {
      if (window.localStorage) {
        if (Object.keys(out).length) localStorage.setItem(COMBOS_KEY, JSON.stringify(out));
        else localStorage.removeItem(COMBOS_KEY);
      }
    } catch (e) {}
    return out;
  }

  function hasCombo(packId) {
    if (packId == null || packId === '') return false;
    return !!readAddedCombos()[String(packId)];
  }

  function markComboAdded(packId) {
    if (packId == null || packId === '') return readAddedCombos();
    const map = readAddedCombos();
    map[String(packId)] = true;
    return saveAddedCombos(map);
  }

  /** Drop combo marks when none of that combo's products remain in the cart. */
  function pruneAddedCombos(packs) {
    const cart = getCart();
    const map = readAddedCombos();
    const list = Array.isArray(packs) ? packs : [];
    const next = {};
    Object.keys(map).forEach((packId) => {
      const pack = list.find((p) => String(p.id) === String(packId));
      if (!pack) return;
      const stillThere = (pack.items || []).some((row) => {
        const line = cart[String(row.id)];
        return line && line.quantity > 0;
      });
      if (stillThere) next[packId] = true;
    });
    return saveAddedCombos(next);
  }

  function cartCount(cart) {
    cart = cart || getCart();
    return Object.values(cart).reduce((n, item) => n + (item.quantity || 0), 0);
  }

  /**
   * Totals. Prefer live catalog via resolveProduct(id) when provided.
   * Falls back to stored snapshot prices only if catalog miss.
   */
  function cartTotals(cart, resolveProduct) {
    cart = cart || getCart();
    let total = 0;
    let saved = 0;
    Object.values(cart).forEach((item) => {
      const live = typeof resolveProduct === 'function' ? resolveProduct(item.id) : null;
      const price = live && live.active !== false ? Number(live.price) || 0 : Number(item.price) || 0;
      const mrp =
        live && live.active !== false
          ? Number(live.originalPrice) || price
          : Number(item.originalPrice) || price;
      const qty = item.quantity || 0;
      total += price * qty;
      saved += Math.max(0, mrp - price) * qty;
    });
    return { total: Math.round(total), saved: Math.round(saved) };
  }

  function addItem(product, qty) {
    if (!product || product.id == null) return getCart();
    const productVendor = normalizeVendor(product.vendor) || 'sri';
    const lock = ensureVendor(productVendor);
    if (!lock.ok) {
      return { cart: getCart(), ok: false, reason: lock.reason, vendor: lock.vendor };
    }
    qty = clampQty(qty == null ? 1 : qty) || 1;
    const cart = getCart();
    const id = String(product.id);
    if (cart[id]) {
      cart[id].quantity = clampQty(cart[id].quantity + qty) || cart[id].quantity;
    } else {
      cart[id] = {
        id: product.id,
        name: String(product.name || '').slice(0, 120),
        price: Number(product.price) || 0,
        originalPrice: Number(product.originalPrice) || 0,
        unit: String(product.unit || '').slice(0, 40),
        image: String(product.image || '').slice(0, 200),
        quantity: qty,
        vendor: productVendor
      };
    }
    saveCart(cart);
    return { cart: getCart(), ok: true, reason: '', vendor: productVendor };
  }

  function setQuantity(id, quantity) {
    const cart = getCart();
    const key = String(id);
    if (!cart[key]) return cart;
    const q = clampQty(quantity);
    if (!q) delete cart[key];
    else cart[key].quantity = q;
    const saved = saveCart(cart);
    if (cartCount(saved) === 0) clearVendor();
    return saved;
  }

  function removeItem(id) {
    const cart = getCart();
    delete cart[String(id)];
    const saved = saveCart(cart);
    if (cartCount(saved) === 0) clearVendor();
    return saved;
  }

  /** Compact share string: id:qty,id:qty */
  function encodeShare(cart) {
    cart = cart || getCart();
    return Object.values(cart)
      .map((item) => String(item.id) + ':' + (item.quantity || 1))
      .join(',');
  }

  /**
   * Apply ?cart= share string using resolveProduct(id) → product object.
   * Returns { cart, added, skipped }.
   */
  function applyShare(share, resolveProduct, options) {
    options = options || {};
    const replace = !!options.replace;
    if (replace) clearCart();
    const cart = replace ? {} : getCart();
    let added = 0;
    let skipped = 0;
    let blocked = false;
    String(share || '')
      .split(',')
      .forEach((part) => {
        if (blocked) return;
        const bit = part.trim();
        if (!bit) return;
        const sep = bit.lastIndexOf(':');
        const id = sep >= 0 ? bit.slice(0, sep) : bit;
        const qty = sep >= 0 ? clampQty(bit.slice(sep + 1)) || 1 : 1;
        const product = typeof resolveProduct === 'function' ? resolveProduct(id) : null;
        if (!product || product.active === false) {
          skipped++;
          return;
        }
        const result = addItem(product, qty);
        if (result && result.ok === false) {
          blocked = true;
          skipped++;
          return;
        }
        added++;
      });
    return { cart: getCart(), added: added, skipped: skipped, replaced: replace, blocked: blocked };
  }

  return {
    getCart: getCart,
    saveCart: saveCart,
    clearCart: clearCart,
    cartCount: cartCount,
    cartTotals: cartTotals,
    addItem: addItem,
    setQuantity: setQuantity,
    removeItem: removeItem,
    encodeShare: encodeShare,
    applyShare: applyShare,
    hasCombo: hasCombo,
    markComboAdded: markComboAdded,
    pruneAddedCombos: pruneAddedCombos,
    getVendor: getVendor,
    setVendor: setVendor,
    clearVendor: clearVendor,
    ensureVendor: ensureVendor,
    MAX_QTY: MAX_QTY
  };
})();
