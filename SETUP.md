# Vish Fireworks Store — V2 Setup

## Run locally

```bash
npx serve .
```

## Google Sheet admin (products + enquiry stats)

### Critical security (do this)

1. Create the Sheet under **your** Google account.
2. Sheet sharing must stay **Restricted** (only you). Never “Anyone with the link”.
3. Apps Script web app:
   - Execute as: **Me**
   - Who has access: **Anyone** ← visitors hit the *script URL only*; they cannot open the Sheet.
4. Paste `scripts/google-apps-script.js`, run `setupSheet()` once, deploy web app.
5. Put the Web App URL in `js/config.js` → `appsScriptUrl`.
6. Optional extra lock: Apps Script → Project Settings → Script properties → add `ENQUIRY_INGEST_KEY` = a long random string, and set the same value in `js/config.js` → `enquiryIngestKey`.

The hardened script:
- **Enquiries** is the sole enquiry / order book (website submit + bill desk)
- `Enquiry_Log` is obsolete — after redeploy and a successful `/bill` test, you may delete that tab
- Bill desk reads Enquiries only (with `BILL_PAGE_PASSWORD`); it does not write status back
- Validates name / phone / pincode / cart
- Rate-limits by phone
- Ignores honeypot spam fields

### Day-to-day admin

| Sheet | Use |
| --- | --- |
| **Products** | Sri catalogue prices, active/limited flags |
| **Products_v2** | Ignite catalogue sell prices + **image** column (same paths as Products) |
| **Enquiries** | Sole order book — status, cart JSON, fulfill vendor (edit status here) |

Site paints **local** catalogue instantly (`data/products.js` + `data/products-ignite.js`), then silently refreshes from Sheet in the background (`?action=products` → `products` + `productsIgnite`). Rare sheet edits only change the UI if the fetch returns different data.

### Sync sheet → code (after you edit Products / Products_v2)

```bash
npm run sync-products
```

That overwrites `data/products.js` and `data/products-ignite.js` from the live Apps Script. Commit those files when ready. Optional: bump `?v=` on the product `<script>` tags in `index.html` / `combos.html` / `ignite-images.html` if a browser caches hard.

Ignite photos: edit via private `/ignite-images` (bill password) → writes `Products_v2.image`, then run `npm run sync-products` so local fallback matches. Menu **Vish Profit → Ensure Products_v2 image column** adds the column without wiping rows.

### Cutover after this Apps Script update

1. Paste `scripts/google-apps-script.js` → Deploy **New version**
2. Sheet menu: **Vish Profit → Ensure Products_v2 image column**
3. Submit one test enquiry from the site → row appears in **Enquiries**
4. Change **Order Status** in Enquiries → Load that S.No on `/bill` → status matches
5. Confirm bill line items load (`Items Json` column must be present/filled)
6. Only then delete the `Enquiry_Log` tab if it still exists

## What customers get on submit

1. Enquiry saved to **Enquiries** (if `appsScriptUrl` is set)
2. Enquiry PDF
3. WhatsApp opens with the same summary

## Re-compress images

```bash
npm install
node scripts/optimize-images.mjs
```

## Import a web image for Ignite (next S.No)

```bash
# one-shot
npm run import-image -- "https://example.com/photo.jpg"
# → assets/optimized/301.jpg (after current max)

# or keep a local helper running for /ignite-images “Import from internet URL”
npm run import-server
```

Then on `/ignite-images`, select the product, paste the URL, click **Download · compress · assign**.
