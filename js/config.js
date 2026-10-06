/* White-label shop config — change this file first for every new store. */
window.SITE_CONFIG = {
  brand: 'Vish Fireworks Store',
  brandShort: 'Vish Crackers',
  ownerName: 'Vishnu P',
  phone: '9994376845',
  whatsapp: '919994376845',
  address: 'Near Hayagrivas School, Vembakottai Road, Sivakasi – 626189',
  siteUrl: 'https://vishcrackers.online',
  /* false = catalogue-only; hide Combos nav, hero pack CTA, and combos.html */
  combosEnabled: false,
  deliveryNote:
    'Pan India delivery. Charges usually ₹250–₹1,500 based on location, order size and how close we are to festival week — earlier enquiries usually get better transport rates.',
  orderDeadline: '25 October 2026',
  /* Countdown ends at local midnight of this day */
  orderDeadlineISO: '2026-10-25',
  /* Urgency bar start (same year as deadline unless rolling over) */
  seasonStartISO: '2026-09-01',
  /* Suggested enquiry total — does not block submit */
  softMinOrder: 2000,
  softMinOrderNote:
    'Lists under ₹2,000 are confirmed on WhatsApp after we review them with you.',
  /* First 2–3 digits of pincode → zone hint after lookup */
  deliveryZones: {
    '62': {
      label: 'Tamil Nadu (near Sivakasi)',
      hint: 'Usually fastest / lower transport from Sivakasi when booked early.'
    },
    '60': {
      label: 'Tamil Nadu',
      hint: 'TN routes are common — transport often in the lower band if you enquire early.'
    },
    '63': {
      label: 'Tamil Nadu',
      hint: 'TN routes are common — transport often in the lower band if you enquire early.'
    },
    '56': {
      label: 'South India',
      hint: 'South India parcel routes are regular; charges rise near festival week.'
    },
    '50': {
      label: 'South India',
      hint: 'South India parcel routes are regular; charges rise near festival week.'
    },
    '67': {
      label: 'South / Kerala',
      hint: 'South routes available; confirm hub early for better vehicle rates.'
    },
    '68': {
      label: 'South / Kerala',
      hint: 'South routes available; confirm hub early for better vehicle rates.'
    },
    default: {
      label: 'Rest of India',
      hint: 'Pan-India parcel possible. Transport usually ₹250–₹1,500+ depending on size and festival week.'
    }
  },
  responsePromise: 'We will contact you on WhatsApp within 24 hours to confirm delivery and payment.',
  /*
   * DEMO / SHOWCASE (Netlify free URL, pitch to shop owners):
   *   demoMode: true  → browse / cart OK; NEVER posts to Sheet; NEVER opens enquiry WhatsApp.
   * REAL SHOP (paid handover on their domain + their Google account):
   *   demoMode: false → set appsScriptUrl + enquiryIngestKey below, then enquiries hit THEIR sheet.
   */
  demoMode: true,
  /* Leave blank while demoMode is true. Wire only for a real shop integration. */
  appsScriptUrl: '',
  /* Must match Apps Script → Project Settings → Script properties → ENQUIRY_INGEST_KEY */
  enquiryIngestKey: '',
  /*
   * Vish live shop backup (do NOT paste into customer demos — only your own production site):
   * appsScriptUrl: 'https://script.google.com/macros/s/AKfycbyq9hJBdtdriXBL8YMxM75701MWh84VrP3zXJ6r2tBPeVEBtr7YhthaWsnyyENJlI5H/exec',
   * enquiryIngestKey: 'vish_7LWxtlPM4jKG7Fx9RhCivAeF2z7NU88t',
   */
  currency: '₹'
};
