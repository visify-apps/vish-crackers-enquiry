window.VishCart = (function () {
  const CART_KEY = 'vish_cart_v2';

  function getCart() {
    try {
      return JSON.parse(localStorage.getItem(CART_KEY)) || {};
    } catch {
      return {};
    }
  }

  function saveCart(cart) {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
  }

  function clearCart() {
    localStorage.removeItem(CART_KEY);
  }

  function cartCount(cart) {
    cart = cart || getCart();
    return Object.values(cart).reduce((n, item) => n + item.quantity, 0);
  }

  function cartTotals(cart) {
    cart = cart || getCart();
    let total = 0;
    let saved = 0;
    Object.values(cart).forEach((item) => {
      total += item.price * item.quantity;
      const mrp = item.originalPrice || item.price;
      saved += Math.max(0, mrp - item.price) * item.quantity;
    });
    return { total, saved };
  }

  function addItem(product, qty) {
    qty = Math.max(1, parseInt(qty, 10) || 1);
    const cart = getCart();
    if (cart[product.id]) {
      cart[product.id].quantity += qty;
    } else {
      cart[product.id] = {
        id: product.id,
        name: product.name,
        price: product.price,
        originalPrice: product.originalPrice,
        unit: product.unit,
        image: product.image,
        quantity: qty
      };
    }
    saveCart(cart);
    return cart;
  }

  function setQuantity(id, quantity) {
    const cart = getCart();
    if (!cart[id]) return cart;
    if (quantity <= 0) delete cart[id];
    else cart[id].quantity = quantity;
    saveCart(cart);
    return cart;
  }

  function removeItem(id) {
    const cart = getCart();
    delete cart[id];
    saveCart(cart);
    return cart;
  }

  return { getCart, saveCart, clearCart, cartCount, cartTotals, addItem, setQuantity, removeItem };
})();
