/* Add to Home Screen helper — shows on page load (mobile), again each new calendar day */
(function () {
  var DISMISS_KEY = 'vish_a2hs_dismissed_day_v1';
  var deferredPrompt = null;

  function todayKey() {
    var d = new Date();
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function isStandalone() {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true
    );
  }

  function isIos() {
    var ua = window.navigator.userAgent || '';
    return (
      /iPad|iPhone|iPod/.test(ua) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    );
  }

  function isMobileish() {
    return window.matchMedia('(max-width: 820px)').matches || isIos();
  }

  function dismissedToday() {
    try {
      return localStorage.getItem(DISMISS_KEY) === todayKey();
    } catch (e) {
      return false;
    }
  }

  function setDismissedToday() {
    try {
      localStorage.setItem(DISMISS_KEY, todayKey());
    } catch (e) {}
  }

  function ensureBanner() {
    var el = document.getElementById('a2hs-banner');
    if (el) return el;

    el = document.createElement('div');
    el.id = 'a2hs-banner';
    el.className = 'a2hs-banner';
    el.hidden = true;
    el.innerHTML =
      '<div class="a2hs-banner-inner">' +
      '<img class="a2hs-banner-icon" src="icons/icon-192.png" width="40" height="40" alt="" />' +
      '<div class="a2hs-banner-copy">' +
      '<strong id="a2hs-title">Add to Home Screen</strong>' +
      '<p id="a2hs-text">Open Vish Crackers faster next time — like an app icon.</p>' +
      '</div>' +
      '<div class="a2hs-banner-actions">' +
      '<button type="button" class="a2hs-btn" id="a2hs-install">Add</button>' +
      '<button type="button" class="a2hs-dismiss" id="a2hs-dismiss" aria-label="Dismiss">×</button>' +
      '</div>' +
      '</div>';
    document.body.appendChild(el);

    document.getElementById('a2hs-dismiss').addEventListener('click', function () {
      setDismissedToday();
      el.hidden = true;
    });

    document.getElementById('a2hs-install').addEventListener('click', function () {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.finally(function () {
          deferredPrompt = null;
          setDismissedToday();
          el.hidden = true;
        });
        return;
      }
      if (isIos()) {
        document.getElementById('a2hs-title').textContent = 'Add from Share';
        document.getElementById('a2hs-text').textContent =
          'Tap Share □↑ then “Add to Home Screen”.';
        document.getElementById('a2hs-install').hidden = true;
        return;
      }
      document.getElementById('a2hs-title').textContent = 'Install from browser';
      document.getElementById('a2hs-text').textContent =
        'Chrome menu ⋮ → “Add to Home screen” / “Install app”.';
    });

    return el;
  }

  function showBanner() {
    if (!isMobileish() || isStandalone() || dismissedToday()) return;
    var el = ensureBanner();
    var title = document.getElementById('a2hs-title');
    var text = document.getElementById('a2hs-text');
    var btn = document.getElementById('a2hs-install');
    btn.hidden = false;
    btn.textContent = isIos() ? 'How?' : 'Add';
    title.textContent = 'Add to Home Screen';
    text.textContent = isIos()
      ? 'Tap Share □↑ → Add to Home Screen for quick open.'
      : 'Open Vish Crackers faster next time — like an app icon.';
    el.hidden = false;
  }

  function registerSw() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('./sw.js').catch(function () {});
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
  });

  window.addEventListener('appinstalled', function () {
    deferredPrompt = null;
    setDismissedToday();
    var el = document.getElementById('a2hs-banner');
    if (el) el.hidden = true;
  });

  function boot() {
    registerSw();
    showBanner();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
