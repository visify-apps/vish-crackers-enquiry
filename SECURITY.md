# Security notes

## How Google Sheet stays private

| Layer | Setting | Result |
| --- | --- | --- |
| Spreadsheet sharing | **Restricted** (owner only) | Public cannot open the Sheet URL |
| Apps Script deploy | Execute as **Me**, access **Anyone** | Site can POST enquiries / GET products only through your script |
| `doGet` / `doPost` | Hardened | No endpoint returns Enquiries data |

Visitors never need Google login and never get a share link to your Sheet.

## What is public once the site is on GitHub Pages

These are **expected** for a static enquiry site:

- Product catalogue (`data/products.js`)
- Business phone / WhatsApp / address (`js/config.js`)
- Apps Script **web app URL** (browser must call it)

Anyone can open DevTools and see those values. That does **not** grant Sheet UI access if sharing stays Restricted.

## Residual risks (and mitigations)

1. **Spam POSTs to Apps Script** — mitigated with validation, honeypot, phone rate-limit, optional `ENQUIRY_INGEST_KEY`.
2. **Ingest key in frontend** — visible in page source; only stops casual bots, not determined attackers. Real secrecy needs a private backend.
3. **Product prices readable** — intentional (price list site).
4. **GitHub token / passwords** — never commit; rotate if pasted in chat.

## Do not commit

- GitHub PATs, `.env`, service-account JSON
- Spreadsheet edit links
- Apps Script editor / deployment private keys (none needed for this stack)
