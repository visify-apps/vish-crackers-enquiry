# Security notes

## How Google Sheet stays private

| Layer | Setting | Result |
| --- | --- | --- |
| Spreadsheet sharing | **Restricted** (owner only) | Public cannot open the Sheet URL |
| Apps Script deploy | Execute as **Me**, access **Anyone** | Site can POST enquiries / GET products only through your script |
| `doGet` / `doPost` | Hardened | No endpoint returns Enquiries data |
| `LockService` | Around Sheet writes | Reduces concurrent `appendRow` overwrites |
| `submissionId` | Client UUID + CacheService | Dedupes retries within 24h |
| Server totals | From Products sheet by id | Client prices are not trusted when catalog exists |

Visitors never need Google login and never get a share link to your Sheet.

## Required after each Apps Script update

1. Paste `scripts/google-apps-script.js` into the Apps Script editor.
2. Run `setupSheet()` once.
3. **Project Settings → Script properties** set:
   - `ENQUIRY_INGEST_KEY` = same value as `enquiryIngestKey` in `js/config.js`
4. **Deploy → Manage deployments → Edit → New version → Deploy.**

## What is public once the site is on GitHub Pages

These are **expected** for a static enquiry site:

- Product catalogue (`data/products.js`)
- Business phone / WhatsApp / address (`js/config.js`)
- Apps Script **web app URL** (browser must call it)
- `enquiryIngestKey` (visible in page source — raises the bar for casual bots only)

Anyone can open DevTools and see those values. That does **not** grant Sheet UI access if sharing stays Restricted.

## Residual risks (and mitigations)

1. **Spam POSTs** — validation, honeypot, phone rate-limit, ingest key, locks.
2. **Ingest key in frontend** — not a true secret; stops casual scrapers. Real secrecy needs a private backend.
3. **Product prices readable** — intentional (price list site).
4. **Opaque CORS POSTs** — browser may not read Apps Script response; WhatsApp remains the primary owner notify path; hard network failures keep the cart.

## Do not commit

- GitHub PATs, `.env`, service-account JSON
- Spreadsheet edit links
- Apps Script editor / deployment private keys (none needed for this stack)
