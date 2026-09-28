/* Combo packs — map to product IDs from the catalogue / Sheet.
   Edit this file (or later a Packs sheet) to add more packs.
   Each item.id must match a product id in data/products.js */
window.PACKS_DATA = [
  {
    id: 'day-pack',
    name: 'Day Combo',
    tagline: 'A starter mix for daytime celebrations',
    description: 'Lakshmi + Bijili + Bomb + Rocket + Wala — one tap to add the set.',
    badge: 'Starter',
    items: [
      { id: 3, qty: 2 },   // 4" Lakshmi
      { id: 8, qty: 1 },   // Red Bijili Premium
      { id: 17, qty: 1 },  // Hydro Bomb
      { id: 39, qty: 1 },  // Sky Whistling Rocket
      { id: 28, qty: 2 }   // 100 Wala
    ]
  }
];
