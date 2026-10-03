/* Full-screen night planner + PDF lane chooser (theme-matched, no vendor names). */
window.VishNightUI = (function () {
  let root = null;
  let step = 'place';
  let place = '';
  let who = '';
  let budget = '';
  let vibe = '';
  let pdfChooser = null;
  let bannerEl = null;
  let revealEl = null;
  let revealTimer = null;
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
      '<h2 id="pdf-chooser-title">Your curated price list</h2>' +
      '<p class="pdf-lane-why">This PDF matches the same curated selection you’re browsing.</p>' +
      '<div class="pdf-lane-actions">' +
      '<button type="button" class="btn-hero featured" data-pdf-continue="1">' +
      '<span class="featured-copy"><strong>Open price list</strong><small>Same curated order as the site</small></span>' +
      '</button>' +
      '</div>' +
      '<div class="night-result-links">' +
      '<button type="button" class="btn-dialog btn-dialog-cancel pdf-lane-cancel" data-pdf-close="1">Cancel</button>' +
      '</div>' +
      '</div>';
    document.body.appendChild(pdfChooser);
    pdfChooser.addEventListener('click', (e) => {
      const close = e.target.closest('[data-pdf-close]');
      if (close) {
        hidePdfChooser();
        return;
      }
      if (!e.target.closest('[data-pdf-continue]')) return;
      hidePdfChooser();
      const lane = window.VishLane ? VishLane.getLane() || 'bestvalue' : 'bestvalue';
      if (typeof pdfChooser._onPick === 'function') pdfChooser._onPick(lane);
    });
    return pdfChooser;
  }

  function showMatchHelp() {
    if (!window.VishDialog) return;
    VishDialog.notice({
      kicker: 'Quick match',
      title: 'How we match your celebration',
      body: window.VishLane ? VishLane.MATCH_HELP : ''
    });
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
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
      '<span class="lane-sticky-label">Curated for you</span>' +
      '<strong class="lane-sticky-name">Products in a curated order</strong>' +
      '</div>' +
      '</div>';
    el.onclick = null;

    bannerHideTimer = setTimeout(function () {
      bannerHideTimer = null;
      el.hidden = true;
      el.innerHTML = '';
      document.body.classList.remove('has-lane-banner');
    }, 5000);
  }

  /** Preferences persist across refresh. Never wipe them on reload. */
  function requestEditPreferences() {
    const count = window.VishCart ? VishCart.cartCount() : 0;
    const body =
      (count > 0
        ?         'This clears your enquiry list (' + count + ' item' + (count === 1 ? '' : 's') + ') and your saved celebration preferences.\n\n'
        : 'This clears your saved celebration preferences.\n\n') +
      'You’ll answer the quick match again.';
    const ask = window.VishDialog
      ? VishDialog.confirm({
          kicker: 'Edit preferences',
          title: 'Start the match again?',
          body: body,
          confirmLabel: 'Clear & rematch',
          cancelLabel: 'Keep current'
        })
      : Promise.resolve(true);
    ask.then(function (ok) {
      if (!ok) return;
      if (count > 0) VishCart.clearCart();
      VishLane.clearLane();
      paintBanner();
      if (typeof onLaneChanged === 'function') onLaneChanged();
      openMatcher({ force: true });
    });
  }

  function requestPlanAgain() {
    requestEditPreferences();
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
            kicker: 'Edit selection',
            title: 'Clear enquiry and continue?',
            body: 'Your current items will be removed so we can show a new curated selection.',
            confirmLabel: 'Clear & continue',
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

  function stepsHtml(activeIndex) {
    // 4 question steps (0–3)
    let html = '<div class="night-steps" aria-hidden="true">';
    for (let i = 0; i < 4; i++) {
      const cls = i < activeIndex ? 'is-done' : i === activeIndex ? 'is-on' : '';
      html += '<span class="' + cls + '"></span>';
    }
    return html + '</div>';
  }

  function currentAnswers() {
    return {
      place: place,
      who: who,
      budget: budget,
      vibe: vibe,
      lane: VishLane.resolveLane(place, who, vibe)
    };
  }

  function reduceMotion() {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) {
      return false;
    }
  }

  function ensureReveal() {
    if (revealEl && document.body.contains(revealEl)) return revealEl;
    revealEl = document.createElement('div');
    revealEl.id = 'night-reveal';
    revealEl.className = 'night-reveal';
    revealEl.hidden = true;
    revealEl.setAttribute('role', 'status');
    revealEl.setAttribute('aria-live', 'polite');
    revealEl.innerHTML =
      '<div class="night-reveal-backdrop"></div>' +
      '<div class="night-reveal-sky" aria-hidden="true">' +
      '<span class="night-fw night-fw-a"></span>' +
      '<span class="night-fw night-fw-b"></span>' +
      '<span class="night-fw night-fw-c"></span>' +
      '<span class="night-fw night-fw-d"></span>' +
      '<span class="night-rocket night-rocket-1"></span>' +
      '<span class="night-rocket night-rocket-2"></span>' +
      '<span class="night-rocket night-rocket-3"></span>' +
      '</div>' +
      '<div class="night-reveal-card">' +
      '<div class="night-reveal-sparks" aria-hidden="true"></div>' +
      '<div class="night-reveal-burst" aria-hidden="true"></div>' +
      '<p class="night-reveal-eyebrow">Matching</p>' +
      '<h2 id="night-reveal-title" class="night-reveal-title">Your celebration, sorted</h2>' +
      '<p class="night-reveal-body">Crackling the best packs…</p>' +
      '<div class="night-reveal-track" aria-hidden="true"><span class="night-reveal-bar"></span></div>' +
      '<div class="night-reveal-actions">' +
      '<a class="night-reveal-combos" href="combos.html" data-reveal-combos="1">Explore combos</a>' +
      '</div>' +
      '</div>';
    document.body.appendChild(revealEl);
    revealEl.addEventListener('click', (e) => {
      if (e.target.closest('[data-reveal-combos]')) {
        e.preventDefault();
        dismissReveal('combos');
      }
    });
    return revealEl;
  }

  function clearRevealTimer() {
    if (revealTimer) {
      clearTimeout(revealTimer);
      revealTimer = null;
    }
  }

  function goHomeAfterReveal() {
    const path = (location.pathname || '').split('/').pop() || '';
    if (path === 'combos.html') {
      location.href = 'index.html';
      return;
    }
    if (location.hash) {
      try {
        history.replaceState({}, '', location.pathname);
      } catch (e) {}
    }
    window.scrollTo({ top: 0, left: 0, behavior: reduceMotion() ? 'auto' : 'smooth' });
  }

  function finishRevealDismiss(dest) {
    if (revealEl) {
      revealEl.hidden = true;
      revealEl.classList.remove('is-reduced', 'is-out');
      const bar = revealEl.querySelector('.night-reveal-bar');
      if (bar) {
        bar.style.animation = '';
        bar.style.animationDuration = '';
      }
    }
    document.body.classList.remove('night-reveal-open');
    paintBanner({ forceShow: true });
    if (typeof onLaneChanged === 'function') onLaneChanged();
    if (dest === 'combos') {
      location.href = 'combos.html';
      return;
    }
    goHomeAfterReveal();
  }

  function dismissReveal(dest) {
    clearRevealTimer();
    if (!revealEl || revealEl.hidden) {
      finishRevealDismiss(dest);
      return;
    }
    if (reduceMotion()) {
      finishRevealDismiss(dest);
      return;
    }
    revealEl.classList.add('is-out');
    revealTimer = setTimeout(function () {
      revealTimer = null;
      finishRevealDismiss(dest);
    }, 620);
  }

  function showReveal() {
    const el = ensureReveal();
    clearRevealTimer();
    el.classList.remove('is-out');
    const ms = reduceMotion() ? 1500 : 4000;
    el.classList.toggle('is-reduced', ms < 4000);
    const bar = el.querySelector('.night-reveal-bar');
    if (bar) {
      bar.style.animation = 'none';
      void bar.offsetWidth;
      bar.style.animation = '';
      bar.style.animationDuration = ms + 'ms';
    }
    el.hidden = false;
    document.body.classList.add('night-reveal-open');
    revealTimer = setTimeout(function () {
      revealTimer = null;
      dismissReveal('home');
    }, ms);
  }

  function goResult() {
    const answers = currentAnswers();
    VishLane.saveAnswers(answers);
    VishLane.setLane(answers.lane);
    hideMatcher();
    if (typeof onLaneChanged === 'function') onLaneChanged();
    showReveal();
  }

  function renderStep() {
    const el = ensureRoot();
    if (step === 'vibe') {
      el.innerHTML =
        '<div class="night-matcher-panel">' +
        stepsHtml(3) +
        '<p class="eyebrow">Last step</p>' +
        '<h2 id="night-matcher-title">What style do you want?</h2>' +
        '<p class="night-sub">We’ll favour packs that feel like this.</p>' +
        '<div class="night-cards">' +
        card('vibe', 'soft', 'Soft & colourful', 'Sparklers, colour, gentle favourites') +
        card('vibe', 'classic', 'Classic family mix', 'Balanced Diwali mix for everyone') +
        card('vibe', 'finale', 'Big finale energy', 'Stronger sky and presence') +
        '</div>' +
        '<button type="button" class="night-soft-link" data-night-back="budget">Back</button>' +
        '</div>';
      return;
    }

    if (step === 'budget') {
      el.innerHTML =
        '<div class="night-matcher-panel">' +
        stepsHtml(2) +
        '<p class="eyebrow">Step 3 of 4</p>' +
        '<h2 id="night-matcher-title">Rough budget for the celebration?</h2>' +
        '<p class="night-sub">We’ll put matching combos first.</p>' +
        '<div class="night-cards">' +
        card('budget', 'under5', 'Under ₹5,000', 'Starter-friendly packs') +
        card('budget', 'mid', '₹5,000 – ₹10,000', 'Most popular family packs') +
        card('budget', 'high', '₹10,000 – ₹20,000', 'Fuller premium packs') +
        card('budget', 'any', 'Decide while browsing', 'Show everything in order') +
        '</div>' +
        '<button type="button" class="night-soft-link" data-night-back="who">Back</button>' +
        '</div>';
      return;
    }

    if (step === 'who') {
      el.innerHTML =
        '<div class="night-matcher-panel">' +
        stepsHtml(1) +
        '<p class="eyebrow">Step 2 of 4</p>' +
        '<h2 id="night-matcher-title">Who is celebrating?</h2>' +
        '<p class="night-sub">Helps us pick the right mix.</p>' +
        '<div class="night-cards">' +
        card('who', 'kids', 'Mostly kids', 'Soft favourites matter most') +
        card('who', 'family', 'Whole family', 'Classic mix for everyone') +
        card('who', 'show', 'Big celebration crowd', 'Stronger sky and presence') +
        '</div>' +
        '<button type="button" class="night-soft-link" data-night-back="place">Back</button>' +
        '</div>';
      return;
    }

    // place
    el.innerHTML =
      '<div class="night-matcher-panel">' +
      stepsHtml(0) +
      '<p class="eyebrow">Quick match</p>' +
      '<h2 id="night-matcher-title">Where will you light?</h2>' +
      '<p class="night-sub">Four quick taps — we curate packs for your celebration.</p>' +
      '<div class="night-cards">' +
      card('place', 'flat', 'Flat / balcony', 'Apartment · society space · limited sky') +
      card('place', 'courtyard', 'House front / side open', 'In front of house · street-side open area') +
      card('place', 'ground', 'Open ground / farm land', 'Vacant plot · full sky possible') +
      '</div>' +
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
      if (e.target.closest('[data-night-help]')) {
        showMatchHelp();
        return;
      }
      const back = e.target.closest('[data-night-back]');
      if (back) {
        step = back.getAttribute('data-night-back') || 'place';
        renderStep();
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
        step = 'budget';
        renderStep();
        return;
      }
      const budgetBtn = e.target.closest('[data-night-budget]');
      if (budgetBtn) {
        budget = budgetBtn.getAttribute('data-night-budget');
        step = 'vibe';
        renderStep();
        return;
      }
      const vibeBtn = e.target.closest('[data-night-vibe]');
      if (vibeBtn) {
        vibe = vibeBtn.getAttribute('data-night-vibe');
        goResult();
      }
    };
  }

  function openMatcher(options) {
    options = options || {};
    ensureRoot();
    bindRootClicks();
    step = 'place';
    place = '';
    who = '';
    budget = '';
    vibe = '';
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
    requestEditPreferences: requestEditPreferences,
    requestClearAndSwitch: requestClearAndSwitch,
    openPdfChooser: openPdfChooser,
    hidePdfChooser: hidePdfChooser
  };
})();
