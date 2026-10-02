/* Night lane — Ignite = family nights at home · Sri = soft nights with kids / open-ground shows.
   Never expose vendor names to customers. */
window.VishLane = (function () {
  const LANE_KEY = 'vish_night_lane_v1';
  const ANSWER_KEY = 'vish_night_answers_v1';
  const LANES = {
    bestvalue: {
      id: 'bestvalue',
      vendor: 'ignite',
      title: 'For family nights at home',
      short: 'Family nights at home',
      blurb: 'Complete packs when you light in a flat or house courtyard.',
      combosHint: 'Starter to Premium ready packs',
      pdfLabel: 'Family nights at home — price list',
      pdfHint: 'Flats and house courtyards'
    },
    fullvariety: {
      id: 'fullvariety',
      vendor: 'sri',
      title: 'For soft nights with kids, or open-ground shows',
      short: 'Soft nights with kids · Open-ground shows',
      blurb: 'Fuller soft and kids favourites, plus big-sky finales.',
      combosHint: 'Soft kids favourites & open-ground finales',
      pdfLabel: 'Soft nights with kids / open-ground shows — price list',
      pdfHint: 'Soft kids favourites and big-sky finales'
    }
  };

  /** Customer-facing answer to “why two lists / two PDFs?” */
  const WHY_TWO_LISTS =
    'We keep two lists so packing stays simple and the show fits your place. ' +
    'One is for family nights at home — complete Diwali packs for flats and courtyards. ' +
    'The other is for soft nights with kids, or for open-ground shows — fuller soft items and big-sky finales. ' +
    'Each enquiry uses only one list, so rates, combos, and the PDF match what you ordered.';

  function normalizeLane(id) {
    return LANES[id] ? id : '';
  }

  function readRaw(key) {
    try {
      // Session-only: survives index↔combos, not forever across days/tabs.
      if (window.sessionStorage) {
        const fromSession = sessionStorage.getItem(key);
        if (fromSession) return fromSession;
      }
      // One-time migrate / drop leftover localStorage from older builds.
      if (window.localStorage) {
        const legacy = localStorage.getItem(key);
        if (legacy) {
          localStorage.removeItem(key);
          if (window.sessionStorage) sessionStorage.setItem(key, legacy);
          return legacy;
        }
      }
      return '';
    } catch (e) {
      return '';
    }
  }

  function writeRaw(key, value) {
    try {
      if (window.localStorage) localStorage.removeItem(key);
      if (!window.sessionStorage) return;
      if (value) sessionStorage.setItem(key, value);
      else sessionStorage.removeItem(key);
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

  /**
   * Ignite-biased resolver:
   * - Kids → soft nights with kids / open-ground (Sri)
   * - Open ground → soft nights with kids / open-ground (Sri)
   * - Flat / courtyard + family or big show → family nights at home (Ignite)
   */
  function resolveLane(place, who) {
    const p = String(place || '');
    const w = String(who || '');
    if (w === 'kids') return 'fullvariety';
    if (p === 'ground') return 'fullvariety';
    return 'bestvalue';
  }

  function reasonChips(place, who) {
    const placeLabel =
      place === 'flat' ? 'Flat / balcony' : place === 'ground' ? 'Open ground' : 'House courtyard';
    const whoLabel =
      who === 'kids' ? 'Mostly kids / soft' : who === 'show' ? 'Big show' : 'Whole family';
    return [placeLabel, whoLabel];
  }

  function resultCopy(laneId, place, who) {
    const meta = getMeta(laneId);
    if (!meta) return { title: '', body: '', chips: [] };
    const chips = reasonChips(place, who);
    let body =
      laneId === 'bestvalue'
        ? 'Complete packs for flats and courtyards — simple to pack and confirm.'
        : 'Soft kids favourites and big-sky finales — matched to your answers.';
    return { title: meta.title, body: body, chips: chips, meta: meta };
  }

  return {
    LANE_KEY: LANE_KEY,
    LANES: LANES,
    WHY_TWO_LISTS: WHY_TWO_LISTS,
    getLane: getLane,
    setLane: setLane,
    clearLane: clearLane,
    getMeta: getMeta,
    laneToVendor: laneToVendor,
    vendorToLane: vendorToLane,
    resolveLane: resolveLane,
    saveAnswers: saveAnswers,
    getAnswers: getAnswers,
    resultCopy: resultCopy,
    reasonChips: reasonChips
  };
})();
