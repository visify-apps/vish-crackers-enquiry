/* Diwali match — curate packs for place / crowd / budget / vibe.
   Internal lanes map to vendors; never expose vendor names to customers. */
window.VishLane = (function () {
  const LANE_KEY = 'vish_night_lane_v1';
  const ANSWER_KEY = 'vish_night_answers_v1';

  /* Customer-facing strings must stay identical across lanes — never reveal two catalogues. */
  const LANES = {
    bestvalue: {
      id: 'bestvalue',
      vendor: 'ignite',
      title: 'Your celebration',
      short: 'Your celebration',
      blurb: 'Packs curated for your answers.',
      combosHint: 'Ready packs in your budget',
      pdfLabel: 'Price list',
      pdfHint: 'Same curated selection as the site'
    },
    fullvariety: {
      id: 'fullvariety',
      vendor: 'sri',
      title: 'Your celebration',
      short: 'Your celebration',
      blurb: 'Packs curated for your answers.',
      combosHint: 'Ready packs in your budget',
      pdfLabel: 'Price list',
      pdfHint: 'Same curated selection as the site'
    }
  };

  const BUDGETS = {
    under5: { id: 'under5', label: 'Under ₹5,000', min: 2000, max: 5000, mid: 3500 },
    mid: { id: 'mid', label: '₹5,000 – ₹10,000', min: 5000, max: 10000, mid: 7500 },
    high: { id: 'high', label: '₹10,000 – ₹20,000', min: 10000, max: 20000, mid: 15000 },
    any: { id: 'any', label: 'Decide while browsing', min: 0, max: Infinity, mid: 8000 }
  };

  const VIBES = {
    soft: { id: 'soft', label: 'Soft & colourful' },
    classic: { id: 'classic', label: 'Classic family mix' },
    finale: { id: 'finale', label: 'Big finale energy' }
  };

  const MATCH_HELP =
    'A few quick answers help us show products and packs in a curated order that fits your place, crowd, and budget. ' +
    'Tap Edit preferences anytime to change — your enquiry always follows the same curated selection you’re browsing.';

  /**
   * Lane rules (budget never changes lane — it only sorts combos).
   * place × who × vibe = 27 outcomes; × 4 budgets = 108 paths, same 27 lane results.
   *
   * Priority:
   * 1) Open ground / farm → kids soft & open-sky (fullvariety)
   * 2) Mostly kids → kids soft & open-sky
   * 3) Flat / balcony → home & house (bestvalue)  [safe society lighting]
   * 4) House front / side open:
   *    - Big show crowd OR big finale vibe → kids soft & open-sky
   *    - else → home & house
   */
  function resolveLane(place, who, vibe) {
    const p = String(place || '');
    const w = String(who || '');
    const v = String(vibe || '');
    if (p === 'ground') return 'fullvariety';
    if (w === 'kids') return 'fullvariety';
    if (p === 'flat') return 'bestvalue';
    if (p === 'courtyard') {
      if (w === 'show' || v === 'finale') return 'fullvariety';
      return 'bestvalue';
    }
    return 'bestvalue';
  }

  /** All 27 place×who×vibe lane landings (budget omitted — display only). */
  function laneMatrix() {
    const places = ['flat', 'courtyard', 'ground'];
    const whos = ['kids', 'family', 'show'];
    const vibes = ['soft', 'classic', 'finale'];
    const rows = [];
    places.forEach((p) => {
      whos.forEach((w) => {
        vibes.forEach((v) => {
          rows.push({ place: p, who: w, vibe: v, lane: resolveLane(p, w, v) });
        });
      });
    });
    return rows;
  }

  function normalizeLane(id) {
    return LANES[id] ? id : '';
  }

  function readRaw(key) {
    try {
      if (window.localStorage) {
        const fromLocal = localStorage.getItem(key);
        if (fromLocal) return fromLocal;
      }
      if (window.sessionStorage) {
        const fromSession = sessionStorage.getItem(key);
        if (fromSession) {
          sessionStorage.removeItem(key);
          if (window.localStorage) localStorage.setItem(key, fromSession);
          return fromSession;
        }
      }
      return '';
    } catch (e) {
      return '';
    }
  }

  function writeRaw(key, value) {
    try {
      if (window.sessionStorage) sessionStorage.removeItem(key);
      if (!window.localStorage) return;
      if (value) localStorage.setItem(key, value);
      else localStorage.removeItem(key);
    } catch (e) {}
  }

  function getLane() {
    return normalizeLane(readRaw(LANE_KEY));
  }

  function setLane(id) {
    const lane = normalizeLane(id);
    writeRaw(LANE_KEY, lane);
    return lane;
  }

  function clearLane() {
    writeRaw(LANE_KEY, '');
    writeRaw(ANSWER_KEY, '');
    return '';
  }

  function getMeta(id) {
    return LANES[normalizeLane(id) || getLane()] || null;
  }

  function laneToVendor(id) {
    const meta = getMeta(id);
    return meta ? meta.vendor : '';
  }

  function vendorToLane(vendor) {
    const v = String(vendor || '').toLowerCase();
    if (v === 'ignite') return 'bestvalue';
    if (v === 'sri') return 'fullvariety';
    return '';
  }

  function saveAnswers(answers) {
    try {
      writeRaw(ANSWER_KEY, JSON.stringify(answers || {}));
    } catch (e) {}
  }

  function getAnswers() {
    try {
      const raw = readRaw(ANSWER_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (e) {
      return null;
    }
  }

  function budgetMeta(id) {
    return BUDGETS[id] || BUDGETS.any;
  }

  function vibeMeta(id) {
    return VIBES[id] || VIBES.classic;
  }

  function packFitsBudget(total, budgetId) {
    const b = budgetMeta(budgetId);
    if (!budgetId || budgetId === 'any') return true;
    const t = Number(total) || 0;
    return t >= b.min && t <= b.max;
  }

  function budgetScore(total, budgetId) {
    const b = budgetMeta(budgetId);
    const t = Number(total) || 0;
    if (!budgetId || budgetId === 'any') return Math.abs(t - b.mid);
    if (t < b.min || t > b.max) return 100000 + Math.abs(t - b.mid);
    return Math.abs(t - b.mid);
  }

  function reasonChips(answers) {
    const a = answers || {};
    const chips = [];
    if (a.place === 'flat') chips.push('Flat / balcony');
    else if (a.place === 'ground') chips.push('Open ground / farm');
    else if (a.place === 'courtyard') chips.push('House front / side open');

    if (a.who === 'kids') chips.push('Mostly kids');
    else if (a.who === 'show') chips.push('Big celebration');
    else if (a.who === 'family') chips.push('Whole family');

    if (a.budget && BUDGETS[a.budget]) chips.push(BUDGETS[a.budget].label);
    if (a.vibe && VIBES[a.vibe]) chips.push(VIBES[a.vibe].label);
    return chips;
  }

  function resultCopy(laneId, answers) {
    const meta = getMeta(laneId);
    if (!meta) return { title: '', body: '', chips: [], meta: null };
    const a = answers || getAnswers() || {};
    return {
      title: 'Picks for your celebration',
      body: 'Products and packs are shown in a curated order for your answers — start with a combo, then tweak. Edit preferences anytime.',
      chips: reasonChips(a),
      meta: meta
    };
  }

  return {
    LANE_KEY: LANE_KEY,
    LANES: LANES,
    BUDGETS: BUDGETS,
    VIBES: VIBES,
    MATCH_HELP: MATCH_HELP,
    WHY_TWO_LISTS: MATCH_HELP,
    getLane: getLane,
    setLane: setLane,
    clearLane: clearLane,
    getMeta: getMeta,
    laneToVendor: laneToVendor,
    vendorToLane: vendorToLane,
    resolveLane: resolveLane,
    laneMatrix: laneMatrix,
    saveAnswers: saveAnswers,
    getAnswers: getAnswers,
    resultCopy: resultCopy,
    reasonChips: reasonChips,
    budgetMeta: budgetMeta,
    vibeMeta: vibeMeta,
    packFitsBudget: packFitsBudget,
    budgetScore: budgetScore
  };
})();
