/* Central vendorMode helpers — dual | sri | ignite (from SITE_CONFIG). */
window.VishVendorMode = (function () {
  function rawMode() {
    const cfg = window.SITE_CONFIG || {};
    return String(cfg.vendorMode || 'dual').toLowerCase().trim();
  }

  function vendorMode() {
    const m = rawMode();
    if (m === 'sri' || m === 'ignite' || m === 'dual') return m;
    return 'dual';
  }

  function isDualVendor() {
    return vendorMode() === 'dual';
  }

  function fixedVendor() {
    const m = vendorMode();
    if (m === 'sri' || m === 'ignite') return m;
    return null;
  }

  function allowedVendors() {
    const fixed = fixedVendor();
    if (fixed) return [fixed];
    return ['sri', 'ignite'];
  }

  function isAllowedVendor(v) {
    const s = String(v || '').toLowerCase();
    return allowedVendors().indexOf(s) !== -1;
  }

  /** Infer vendor from product id / tag (Ignite catalogue ids are 10000+). */
  function inferVendorFromItem(item) {
    if (!item || typeof item !== 'object') return 'sri';
    const tagged = String(item.vendor || '').toLowerCase();
    if (tagged === 'ignite' || tagged === 'sri') return tagged;
    const n = Number(item.id);
    if (Number.isFinite(n) && n >= 10000) return 'ignite';
    return 'sri';
  }

  return {
    vendorMode: vendorMode,
    isDualVendor: isDualVendor,
    fixedVendor: fixedVendor,
    allowedVendors: allowedVendors,
    isAllowedVendor: isAllowedVendor,
    inferVendorFromItem: inferVendorFromItem
  };
})();
