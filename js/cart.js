/* Vish Fireworks — hardened cart (localStorage treated as untrusted) */
window.VishCart = (function () {
  const CART_KEY = 'vish_cart_v3';
  const LEGACY_KEYS = ['vish_cart_v2'];
  const MAX_QTY = 999;
  let memoryFallback = null;

  function clampQty(n) {
    const q = parseInt(n, 10);
    if (!Number.isFinite(q) || q <= 0) return 0;
    return Math.min(MAX_QTY, q);
  }

  function normalizeItem(id, item) {
    if (!item || typeof item !== 'object') return null;
    const quantity = clampQty(item.quantity != null ? item.quantity : item.qty);
    if (!quantity) return null;
    return {
      id: item.id != null ? item.id : id,
      name: String(item.name || '').slice(0, 120),
      price: Number(item.price) || 0,
      originalPrice: Number(item.originalPrice) || 0,
      unit: String(item.unit || '').slice(0, 40),
      image: String(item.image || '').slice(0, 200),
      quantity: quantity
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

  function clearCart() {
    memoryFallback = {};
    try {
      if (window.localStorage) {
        localStorage.removeItem(CART_KEY);
        LEGACY_KEYS.forEach((k) => localStorage.removeItem(k));
      }
    } catch (e) {}
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
        quantity: qty
      };
    }
    return saveCart(cart);
  }

  function setQuantity(id, quantity) {
    const cart = getCart();
    const key = String(id);
    if (!cart[key]) return cart;
    const q = clampQty(quantity);
    if (!q) delete cart[key];
    else cart[key].quantity = q;
    return saveCart(cart);
  }

  function removeItem(id) {
    const cart = getCart();
    delete cart[String(id)];
    return saveCart(cart);
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
  function applyShare(share, resolveProduct) {
    const cart = getCart();
    let added = 0;
    let skipped = 0;
    String(share || '')
      .split(',')
      .forEach((part) => {
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
        const key = String(product.id);
        if (cart[key]) {
          cart[key].quantity = clampQty(cart[key].quantity + qty) || cart[key].quantity;
        } else {
          cart[key] = {
            id: product.id,
            name: String(product.name || '').slice(0, 120),
            price: Number(product.price) || 0,
            originalPrice: Number(product.originalPrice) || 0,
            unit: String(product.unit || '').slice(0, 40),
            image: String(product.image || '').slice(0, 200),
            quantity: qty
          };
        }
        added++;
      });
    return { cart: saveCart(cart), added: added, skipped: skipped };
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
    MAX_QTY: MAX_QTY
  };
})();
