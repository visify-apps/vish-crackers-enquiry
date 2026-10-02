/* Full-screen night planner + PDF lane chooser (theme-matched, no vendor names). */
window.VishNightUI = (function () {
  let root = null;
  let step = 'place';
  let place = '';
  let who = '';
  let pdfChooser = null;
  let bannerEl = null;
  let onLaneChanged = null;

  function $(id) {
    return document.getElementById(id);
  }

  function ensureRoot() {
    if (root && document.body.contains(root)) return root;
    root = document.createElement('div');
    root.id = 'night-matcher';
    root.className = 'night-matcher';
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'night-matcher-title');
    document.body.appendChild(root);
    return root;
  }

  function ensureBanner() {
    if (bannerEl && document.body.contains(bannerEl)) return bannerEl;
    bannerEl = document.createElement('div');
    bannerEl.id = 'lane-sticky-banner';
    bannerEl.className = 'lane-sticky-banner';
    bannerEl.hidden = true;
    document.body.appendChild(bannerEl);
    return bannerEl;
  }

  function ensurePdfChooser() {
    if (pdfChooser && document.body.contains(pdfChooser)) return pdfChooser;
    pdfChooser = document.createElement('div');
    pdfChooser.id = 'pdf-lane-chooser';
    pdfChooser.className = 'pdf-lane-chooser';
    pdfChooser.hidden = true;
    pdfChooser.innerHTML =
      '<div class="pdf-lane-chooser-backdrop" data-pdf-close="1"></div>' +
      '<div class="pdf-lane-chooser-panel" role="dialog" aria-modal="true" aria-labelledby="pdf-chooser-title">' +
      '<p class="eyebrow">Price list PDF</p>' +
      '<h2 id="pdf-chooser-title">Which list do you need?</h2>' +
      '<p class="pdf-lane-why">Each enquiry uses one list — pick the PDF that matches.</p>' +
      '<div class="pdf-lane-actions">' +
      '<button type="button" class="btn-hero featured" data-pdf-lane="bestvalue">' +
      '<span class="featured-copy"><strong>For family nights at home</strong><small>Flats and house courtyards</small></span>' +
      '</button>' +
      '<button type="button" class="btn-hero featured" data-pdf-lane="fullvariety">' +
      '<span class="featured-copy"><strong>For soft nights with kids, or open-ground shows</strong><small>Soft kids favourites and big-sky finales</small></span>' +
      '</button>' +
      '</div>' +
      '<div class="night-result-links">' +
      '<button type="button" class="night-soft-link" data-night-why="1">Why two lists?</button>' +
      '<button type="button" class="btn-dialog btn-dialog-cancel pdf-lane-cancel" data-pdf-close="1">Cancel</button>' +
      '</div>' +
      '</div>';
    document.body.appendChild(pdfChooser);
    pdfChooser.addEventListener('click', (e) => {
      if (e.target.closest('[data-night-why]')) {
        if (window.VishDialog) {
          VishDialog.notice({
            kicker: 'Two lists',
            title: 'Why two lists?',
            body: window.VishLane ? VishLane.WHY_TWO_LISTS : ''
          });
        }
        return;
      }
      const close = e.target.closest('[data-pdf-close]');
      if (close) {
        hidePdfChooser();
        return;
      }
      const btn = e.target.closest('[data-pdf-lane]');
      if (!btn) return;
      const lane = btn.getAttribute('data-pdf-lane');
      hidePdfChooser();
      if (typeof pdfChooser._onPick === 'function') pdfChooser._onPick(lane);
    });
    return pdfChooser;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** Split “A, or B” lane titles so both halves read clearly. */
  function formatLaneTitle(title) {
    const text = String(title || '');
    const parts = text.split(', or ');
    if (parts.length === 2) {
      return (
        '<span class="night-title-main">' +
        escapeHtml(parts[0]) +
        ',</span> <span class="night-title-or">or</span> <span class="night-title-alt">' +
        escapeHtml(parts[1]) +
        '</span>'
      );
    }
    return '<span class="night-title-main">' + escapeHtml(text) + '</span>';
  }

  function setCallbacks(hooks) {
    onLaneChanged = hooks && hooks.onLaneChanged;
  }

  let bannerHideTimer = null;
  let bannerFlashKey = '';

  function clearBannerDom() {
    const el = ensureBanner();
    if (bannerHideTimer) {
      clearTimeout(bannerHideTimer);
      bannerHideTimer = null;
    }
    el.hidden = true;
    el.innerHTML = '';
    document.body.classList.remove('has-lane-banner');
  }

  function paintBanner(options) {
    options = options || {};
    const el = ensureBanner();
    const lane = VishLane.getLane();
    const meta = VishLane.getMeta(lane);
    const cartCount = window.VishCart ? VishCart.cartCount() : 0;

    if (!meta || cartCount < 1) {
      bannerFlashKey = '';
      clearBannerDom();
      return;
    }

    const key = String(lane);
    // Flash once per lock (≈8s). Later cart edits must not pin the bar forever.
    if (!options.forceShow && bannerFlashKey === key) {
      return;
    }
    bannerFlashKey = key;

    if (bannerHideTimer) {
      clearTimeout(bannerHideTimer);
      bannerHideTimer = null;
    }

    document.body.classList.add('has-lane-banner');
    el.hidden = false;
    el.innerHTML =
      '<div class="lane-sticky-inner shell">' +
      '<div class="lane-sticky-copy">' +
      '<span class="lane-sticky-label">Enquiry locked to</span>' +
      '<strong class="lane-sticky-name">' +
      escapeHtml(meta.short) +
      '</strong>' +
      '</div>' +
      '<button type="button" class="btn-secondary lane-sticky-plan" data-lane-plan="1">Plan again</button>' +
      '</div>';
    el.onclick = (e) => {
      if (e.target.closest('[data-lane-plan]')) {
        requestPlanAgain();
      }
    };

    bannerHideTimer = setTimeout(function () {
      bannerHideTimer = null;
      el.hidden = true;
      el.innerHTML = '';
      document.body.classList.remove('has-lane-banner');
    }, 5000);
  }

  /** Drop a planned lane after reload if nothing is in the enquiry yet. */
  function reconcileLaneForVisit() {
    if (!window.VishLane || !window.VishCart) return;
    if (VishCart.cartCount() > 0) return;
    try {
      const nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
      if (nav && nav.type === 'reload') {
        VishLane.clearLane();
      }
    } catch (e) {}
  }

  function requestPlanAgain() {
    const count = window.VishCart ? VishCart.cartCount() : 0;
    const go = function () {
      if (count > 0) VishCart.clearCart();
      VishLane.clearLane();
      paintBanner();
      if (typeof onLaneChanged === 'function') onLaneChanged();
      openMatcher({ force: true });
    };
    if (count > 0) {
      const ask = window.VishDialog
        ? VishDialog.confirm({
            kicker: 'Switch list',
            title: 'Plan a different night?',
            body: 'Your current enquiry items will be removed.',
            confirmLabel: 'Clear & plan again',
            cancelLabel: 'Keep list'
          })
        : Promise.resolve(true);
      ask.then(function (ok) {
        if (ok) go();
      });
      return;
    }
    go();
  }

  function requestClearAndSwitch(targetLane) {
    const count = window.VishCart ? VishCart.cartCount() : 0;
    const apply = function () {
      if (count > 0) VishCart.clearCart();
      VishLane.setLane(targetLane);
      paintBanner();
      if (typeof onLaneChanged === 'function') onLaneChanged();
      return true;
    };
    if (count > 0) {
      const ask = window.VishDialog
        ? VishDialog.confirm({
            kicker: 'Switch list',
            title: 'Clear enquiry and switch?',
            body: 'Your current items will be removed so the new list can open.',
            confirmLabel: 'Clear & switch',
            cancelLabel: 'Stay'
          })
        : Promise.resolve(true);
      return ask.then(function (ok) {
        if (!ok) return false;
        return apply();
      });
    }
    return Promise.resolve(apply());
  }

  function renderStep() {
    const el = ensureRoot();
    if (step === 'result') {
      const lane = VishLane.resolveLane(place, who);
      const copy = VishLane.resultCopy(lane, place, who);
      el.innerHTML =
        '<div class="night-matcher-panel night-result">' +
        '<p class="eyebrow">Your night is ready</p>' +
        '<h2 id="night-matcher-title" class="night-result-title">' +
        formatLaneTitle(copy.title) +
        '</h2>' +
        '<p class="night-result-body">' +
        escapeHtml(copy.body) +
        '</p>' +
        '<div class="night-chips">' +
        copy.chips.map((c) => '<span class="night-chip">' + escapeHtml(c) + '</span>').join('') +
        '</div>' +
        '<div class="night-result-actions">' +
        '<a class="btn-hero featured" href="combos.html" data-enter-lane="1">' +
        '<span class="featured-copy"><strong>See matching combos</strong><small>' +
        escapeHtml(copy.meta.combosHint) +
        '</small></span></a>' +
        '<a class="btn-hero featured is-muted" href="index.html#catalog" data-enter-lane="1">' +
        '<span class="featured-copy"><strong>Browse catalogue</strong><small>Items from this list only</small></span></a>' +
        '</div>' +
        '<div class="night-result-links">' +
        '<button type="button" class="night-soft-link" data-night-back="who">Change answers</button>' +
        '<button type="button" class="night-soft-link" data-night-why="1">Why two lists?</button>' +
        '</div>' +
        '</div>';
      return;
    }

    if (step === 'who') {
      el.innerHTML =
        '<div class="night-matcher-panel">' +
        '<div class="night-steps" aria-hidden="true"><span class="is-done"></span><span class="is-on"></span></div>' +
        '<p class="eyebrow">Step 2 of 2</p>' +
        '<h2 id="night-matcher-title">Who is the night for?</h2>' +
        '<p class="night-sub">We’ll open the list that fits — one enquiry, one list.</p>' +
        '<div class="night-cards">' +
        card('who', 'kids', 'Mostly kids / soft colour', 'No heavy bombs — soft favourites matter most') +
        card('who', 'family', 'Whole family', 'Classic Diwali mix for everyone') +
        card('who', 'show', 'Big show / youth finale', 'Stronger sky and presence') +
        '</div>' +
        '<button type="button" class="link-action" data-night-back="place">Back</button>' +
        '</div>';
      return;
    }

    // place
    el.innerHTML =
      '<div class="night-matcher-panel">' +
      '<div class="night-steps" aria-hidden="true"><span class="is-on"></span><span></span></div>' +
      '<p class="eyebrow">Plan your night</p>' +
      '<h2 id="night-matcher-title">Where will you light?</h2>' +
      '<p class="night-sub">Two lists keep packing simple and the show right for your place. One enquiry = one list.</p>' +
      '<div class="night-cards">' +
      card('place', 'flat', 'Flat / balcony', 'Society rules · limited sky · complete soft-night lists') +
      card('place', 'courtyard', 'House courtyard', 'Street front / compound · classic family Diwali') +
      card('place', 'ground', 'Open ground / farm', 'Vacant plot · full sky finales possible') +
      '</div>' +
      '<p class="night-skip-label">Already know which list you need?</p>' +
      '<div class="night-skip-row">' +
      '<button type="button" class="link-action" data-skip-lane="bestvalue">Family nights at home</button>' +
      '<span aria-hidden="true">·</span>' +
      '<button type="button" class="link-action" data-skip-lane="fullvariety">Soft nights with kids · Open-ground shows</button>' +
      '</div>' +
      '<button type="button" class="link-action night-why" data-night-why="1">Why two lists?</button>' +
      '</div>';
  }

  function card(kind, value, title, sub) {
    return (
      '<button type="button" class="night-card night-card-' +
      value +
      '" data-night-' +
      kind +
      '="' +
      value +
      '">' +
      '<span class="night-card-glow" aria-hidden="true"></span>' +
      '<strong>' +
      escapeHtml(title) +
      '</strong>' +
      '<small>' +
      escapeHtml(sub) +
      '</small>' +
      '</button>'
    );
  }

  function bindRootClicks() {
    const el = ensureRoot();
    el.onclick = (e) => {
      if (e.target.closest('[data-night-why]')) {
        if (window.VishDialog) {
          VishDialog.notice({
            kicker: 'Two lists',
            title: 'Why two lists?',
            body: VishLane.WHY_TWO_LISTS
          });
        }
        return;
      }
      const skip = e.target.closest('[data-skip-lane]');
      if (skip) {
        finishLane(skip.getAttribute('data-skip-lane'), { place: 'skip', who: 'skip' });
        return;
      }
      const back = e.target.closest('[data-night-back]');
      if (back) {
        step = back.getAttribute('data-night-back') || 'place';
        renderStep();
        return;
      }
      if (e.target.closest('[data-enter-lane]')) {
        // links navigate; lane already set on result paint
        hideMatcher();
        if (typeof onLaneChanged === 'function') onLaneChanged();
        return;
      }
      const placeBtn = e.target.closest('[data-night-place]');
      if (placeBtn) {
        place = placeBtn.getAttribute('data-night-place');
        step = 'who';
        renderStep();
        return;
      }
      const whoBtn = e.target.closest('[data-night-who]');
      if (whoBtn) {
        who = whoBtn.getAttribute('data-night-who');
        const lane = VishLane.resolveLane(place, who);
        VishLane.saveAnswers({ place: place, who: who, lane: lane });
        VishLane.setLane(lane);
        step = 'result';
        renderStep();
        paintBanner();
        if (typeof onLaneChanged === 'function') onLaneChanged();
        return;
      }
    };
  }

  function finishLane(laneId, answers) {
    VishLane.saveAnswers(answers || {});
    VishLane.setLane(laneId);
    if (answers && answers.place === 'skip') {
      place = laneId === 'fullvariety' ? 'ground' : 'courtyard';
      who = laneId === 'fullvariety' ? 'kids' : 'family';
    }
    step = 'result';
    renderStep();
    paintBanner();
    if (typeof onLaneChanged === 'function') onLaneChanged();
  }

  function openMatcher(options) {
    options = options || {};
    ensureRoot();
    bindRootClicks();
    step = 'place';
    place = '';
    who = '';
    renderStep();
    root.hidden = false;
    document.body.classList.add('night-matcher-open');
    const title = $('night-matcher-title');
    if (title && title.focus) {
      try {
        title.setAttribute('tabindex', '-1');
        title.focus();
      } catch (e) {}
    }
  }

  function hideMatcher() {
    if (!root) return;
    root.hidden = true;
    document.body.classList.remove('night-matcher-open');
  }

  function ensureGate() {
    reconcileLaneForVisit();
    paintBanner();
    if (VishLane.getLane()) {
      hideMatcher();
      return false;
    }
    openMatcher({ force: true });
    return true;
  }

  function openPdfChooser(onPick) {
    const el = ensurePdfChooser();
    el._onPick = onPick;
    el.hidden = false;
    document.body.classList.add('pdf-chooser-open');
  }

  function hidePdfChooser() {
    if (!pdfChooser) return;
    pdfChooser.hidden = true;
    document.body.classList.remove('pdf-chooser-open');
  }

  return {
    setCallbacks: setCallbacks,
    ensureGate: ensureGate,
    openMatcher: openMatcher,
    hideMatcher: hideMatcher,
    paintBanner: paintBanner,
    requestPlanAgain: requestPlanAgain,
    requestClearAndSwitch: requestClearAndSwitch,
    openPdfChooser: openPdfChooser,
    hidePdfChooser: hidePdfChooser
  };
})();
