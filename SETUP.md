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
| **Products_v2** | Ignite catalogue sell prices |
| **Enquiries** | Sole order book — status, cart JSON, fulfill vendor (edit status here) |

Site loads local catalogue first, then optionally refreshes from Sheet (`?action=products`).

### Cutover after this Apps Script update

1. Paste `scripts/google-apps-script.js` → Deploy **New version**
2. Submit one test enquiry from the site → row appears in **Enquiries**
3. Change **Order Status** in Enquiries → Load that S.No on `/bill` → status matches
4. Confirm bill line items load (`Items Json` column must be present/filled)
5. Only then delete the `Enquiry_Log` tab if it still exists

## What customers get on submit

1. Enquiry saved to **Enquiries** (if `appsScriptUrl` is set)
2. Enquiry PDF
3. WhatsApp opens with the same summary

## Re-compress images

```bash
npm install
node scripts/optimize-images.mjs
```
