/* Combo packs — map to product IDs from the catalogue / Sheet.
   Full-night mixes cover many firework types in one tap.
   Kids / Colour packs skip bombs & loud sound so parents can showcase safely. */
window.PACKS_DATA = [
  /* ========== FULL NIGHT MIX (every type, scaled by budget) ========== */
  {
    id: 'one-tap-starter',
    section: 'Full Night Mix',
    name: 'One-Tap Starter',
    tagline: 'Tiny full night — sound, bijili, sparkler, ground, night & mini sky',
    badge: '≈ ₹400',
    items: [
      { id: 1, qty: 2 }, // Kuruvi
      { id: 8, qty: 1 }, // Red Bijili
      { id: 10, qty: 1 }, // Twin Star
      { id: 162, qty: 1 }, // 10cm electric
      { id: 69, qty: 1 }, // Kit Kat
      { id: 71, qty: 1 }, // Assorted Cartoon
      { id: 46, qty: 1 }, // Chakkar Big
      { id: 51, qty: 1 }, // Flower Pot Big
      { id: 115, qty: 1 }, // Chotta Fancy
      { id: 28, qty: 1 } // 100 Wala
    ]
  },
  {
    id: 'whole-vibe-pack',
    section: 'Full Night Mix',
    name: 'Whole Vibe Pack',
    tagline: 'Same full mix, thicker — adds kids soft + colour pots',
    badge: '≈ ₹850',
    items: [
      { id: 3, qty: 2 },
      { id: 7, qty: 1 },
      { id: 8, qty: 1 },
      { id: 10, qty: 1 },
      { id: 162, qty: 1 },
      { id: 167, qty: 1 },
      { id: 69, qty: 1 },
      { id: 71, qty: 1 },
      { id: 84, qty: 1 },
      { id: 46, qty: 1 },
      { id: 51, qty: 1 },
      { id: 76, qty: 1 },
      { id: 116, qty: 1 },
      { id: 28, qty: 2 },
      { id: 180, qty: 1 }
    ]
  },
  {
    id: 'balcony-full-night',
    section: 'Full Night Mix',
    name: 'Balcony Full Night',
    tagline: 'Apartment-friendly full mix across 7+ firework types',
    badge: '≈ ₹1,500',
    items: [
      { id: 3, qty: 3 },
      { id: 8, qty: 2 },
      { id: 10, qty: 1 },
      { id: 11, qty: 1 },
      { id: 166, qty: 1 },
      { id: 167, qty: 1 },
      { id: 47, qty: 1 },
      { id: 52, qty: 1 },
      { id: 63, qty: 1 },
      { id: 68, qty: 1 },
      { id: 85, qty: 1 },
      { id: 116, qty: 1 },
      { id: 134, qty: 1 },
      { id: 29, qty: 1 },
      { id: 37, qty: 1 }
    ]
  },
  {
    id: 'family-full-night',
    section: 'Full Night Mix',
    name: 'Family Full Night',
    tagline: 'Full mix tilted for family — more soft night & kids, still covers every type',
    badge: '≈ ₹1,600',
    items: [
      { id: 2, qty: 2 },
      { id: 8, qty: 1 },
      { id: 10, qty: 1 },
      { id: 164, qty: 1 },
      { id: 167, qty: 1 },
      { id: 174, qty: 1 },
      { id: 69, qty: 2 },
      { id: 71, qty: 1 },
      { id: 76, qty: 1 },
      { id: 84, qty: 1 },
      { id: 85, qty: 1 },
      { id: 103, qty: 1 },
      { id: 104, qty: 1 },
      { id: 46, qty: 1 },
      { id: 51, qty: 1 },
      { id: 115, qty: 1 },
      { id: 116, qty: 1 },
      { id: 134, qty: 1 },
      { id: 28, qty: 1 }
    ]
  },
  {
    id: 'society-special',
    section: 'Full Night Mix',
    name: 'Society Special',
    tagline: 'Full mix + mid wala + fancy pipe + colour smoke — society show energy',
    badge: '≈ ₹2,400',
    items: [
      { id: 4, qty: 2 },
      { id: 9, qty: 1 },
      { id: 11, qty: 1 },
      { id: 166, qty: 1 },
      { id: 172, qty: 1 },
      { id: 48, qty: 1 },
      { id: 54, qty: 1 },
      { id: 64, qty: 1 },
      { id: 67, qty: 1 },
      { id: 88, qty: 1 },
      { id: 116, qty: 1 },
      { id: 117, qty: 1 },
      { id: 135, qty: 1 },
      { id: 29, qty: 1 },
      { id: 39, qty: 1 }
    ]
  },
  {
    id: 'main-character-night',
    section: 'Full Night Mix',
    name: 'Main Character Night',
    tagline: 'Full mix with peacock, elite fancy & 30-shots finale energy',
    badge: '≈ ₹4,300',
    items: [
      { id: 4, qty: 3 },
      { id: 9, qty: 1 },
      { id: 11, qty: 1 },
      { id: 172, qty: 1 },
      { id: 49, qty: 1 },
      { id: 55, qty: 1 },
      { id: 67, qty: 1 },
      { id: 92, qty: 1 },
      { id: 106, qty: 1 },
      { id: 121, qty: 1 },
      { id: 122, qty: 1 },
      { id: 138, qty: 1 },
      { id: 30, qty: 1 },
      { id: 110, qty: 1 },
      { id: 42, qty: 1 }
    ]
  },
  {
    id: 'open-ground-drop',
    section: 'Full Night Mix',
    name: 'Open Ground Drop',
    tagline: 'Full mix + mega fancy + 120 shots — for open yards only',
    badge: '≈ ₹6,100',
    items: [
      { id: 5, qty: 2 },
      { id: 11, qty: 1 },
      { id: 172, qty: 1 },
      { id: 50, qty: 1 },
      { id: 56, qty: 1 },
      { id: 121, qty: 1 },
      { id: 122, qty: 1 },
      { id: 143, qty: 1 },
      { id: 31, qty: 1 },
      { id: 148, qty: 1 },
      { id: 67, qty: 1 },
      { id: 95, qty: 1 },
      { id: 42, qty: 1 }
    ]
  },
  {
    id: 'season-finale',
    section: 'Full Night Mix',
    name: 'Season Finale',
    tagline: 'Everything bag — setout + 120 shots + 5000 wala + gift box',
    badge: '≈ ₹9,000',
    items: [
      { id: 6, qty: 2 },
      { id: 11, qty: 2 },
      { id: 172, qty: 1 },
      { id: 122, qty: 1 },
      { id: 143, qty: 1 },
      { id: 157, qty: 1 },
      { id: 33, qty: 1 },
      { id: 148, qty: 1 },
      { id: 106, qty: 1 },
      { id: 67, qty: 1 },
      { id: 184, qty: 1 }
    ]
  },

  /* ========== KIDS & COLOUR — parent peace, no bombs / no heavy sound ========== */
  {
    id: 'toddler-glow-kit',
    section: 'Kids & Colour (Parent Peace)',
    name: 'Toddler Glow Kit',
    tagline: 'Sparklers + soft night + snake + colour matches — zero bombs, zero scare',
    badge: 'Kids safe',
    items: [
      { id: 162, qty: 2 },
      { id: 164, qty: 1 },
      { id: 167, qty: 1 },
      { id: 174, qty: 1 },
      { id: 69, qty: 2 },
      { id: 71, qty: 1 },
      { id: 76, qty: 1 },
      { id: 84, qty: 1 },
      { id: 180, qty: 1 },
      { id: 176, qty: 1 }
    ]
  },
  {
    id: 'colour-soft-show',
    section: 'Kids & Colour (Parent Peace)',
    name: 'Colour Soft Show',
    tagline: 'Pink/orange/green glow night parents can light while kids watch close',
    badge: 'Colour',
    items: [
      { id: 163, qty: 1 },
      { id: 164, qty: 1 },
      { id: 173, qty: 1 },
      { id: 174, qty: 1 },
      { id: 69, qty: 1 },
      { id: 71, qty: 1 },
      { id: 76, qty: 1 },
      { id: 68, qty: 1 },
      { id: 67, qty: 1 },
      { id: 84, qty: 1 },
      { id: 85, qty: 1 },
      { id: 103, qty: 1 },
      { id: 115, qty: 1 },
      { id: 176, qty: 1 }
    ]
  },
  {
    id: 'kids-main-stage',
    section: 'Kids & Colour (Parent Peace)',
    name: 'Kids Main Stage',
    tagline: 'Touchable + peacock + kids heroes + soft sky — showcase night, no bombs',
    badge: 'Kids hero',
    items: [
      { id: 167, qty: 1 },
      { id: 174, qty: 1 },
      { id: 175, qty: 1 },
      { id: 71, qty: 1 },
      { id: 76, qty: 1 },
      { id: 67, qty: 1 },
      { id: 84, qty: 1 },
      { id: 88, qty: 1 },
      { id: 92, qty: 1 },
      { id: 103, qty: 1 },
      { id: 104, qty: 1 },
      { id: 106, qty: 1 },
      { id: 115, qty: 1 },
      { id: 134, qty: 1 },
      { id: 176, qty: 1 }
    ]
  },
  {
    id: 'parent-peace-pack',
    section: 'Kids & Colour (Parent Peace)',
    name: 'Parent Peace Pack',
    tagline: 'Biggest fear-free colour night — sparklers, smoke, touchable, peacock, soft sky',
    badge: 'No fear',
    items: [
      { id: 162, qty: 1 },
      { id: 167, qty: 1 },
      { id: 173, qty: 1 },
      { id: 174, qty: 1 },
      { id: 69, qty: 1 },
      { id: 71, qty: 1 },
      { id: 63, qty: 1 },
      { id: 76, qty: 1 },
      { id: 67, qty: 1 },
      { id: 84, qty: 1 },
      { id: 85, qty: 1 },
      { id: 103, qty: 1 },
      { id: 104, qty: 1 },
      { id: 105, qty: 1 },
      { id: 106, qty: 1 },
      { id: 115, qty: 1 },
      { id: 116, qty: 1 },
      { id: 134, qty: 1 },
      { id: 176, qty: 1 }
    ]
  }
];
