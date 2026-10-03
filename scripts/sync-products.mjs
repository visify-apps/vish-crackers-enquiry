/**
 * Pull live Products + Products_v2 from Apps Script → local catalogue files.
 *
 *   npm run sync-products
 *
 * Uses appsScriptUrl from js/config.js. Overwrites:
 *   data/products.js
 *   data/products-ignite.js
 *
 * After sync: hard-refresh the site, commit the two data files when ready.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CONFIG = path.join(ROOT, 'js', 'config.js');
const OUT_SRI = path.join(ROOT, 'data', 'products.js');
const OUT_IGNITE = path.join(ROOT, 'data', 'products-ignite.js');

function readAppsScriptUrl() {
  const fromEnv = (process.env.APPS_SCRIPT_URL || '').trim();
  if (fromEnv) return fromEnv;
  const src = fs.readFileSync(CONFIG, 'utf8');
  const m = src.match(/appsScriptUrl\s*:\s*['"]([^'"]+)['"]/);
  if (!m) throw new Error('appsScriptUrl not found in js/config.js');
  return m[1].trim();
}

function writeJs(filePath, globalName, value, headerComment) {
  const body =
    (headerComment ? headerComment + '\n' : '') +
    'window.' +
    globalName +
    ' = ' +
    JSON.stringify(value, null, 2) +
    ';\n';
  fs.writeFileSync(filePath, body, 'utf8');
}

function countItems(cats) {
  return (cats || []).reduce((n, c) => n + ((c.items && c.items.length) || 0), 0);
}

async function main() {
  const base = readAppsScriptUrl().replace(/\/$/, '');
  const url = base + '?action=products&_=' + Date.now();
  console.log('Fetching', url);

  const res = await fetch(url, {
    redirect: 'follow',
    headers: { Accept: 'application/json' }
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error('Apps Script did not return JSON. Redeploy web app?');
  }

  if (!data || !Array.isArray(data.products) || !data.products.length) {
    throw new Error('No products in response');
  }

  const sri = data.products;
  const ignite = Array.isArray(data.productsIgnite) ? data.productsIgnite : [];

  writeJs(OUT_SRI, 'PRODUCTS_DATA', sri);
  writeJs(
    OUT_IGNITE,
    'PRODUCTS_IGNITE_DATA',
    ignite,
    '/* Ignite catalogue — ids 10001+; synced from Products_v2 sheet. */'
  );

  console.log(
    'Wrote data/products.js (' +
      countItems(sri) +
      ' items, ' +
      sri.length +
      ' categories)'
  );
  console.log(
    'Wrote data/products-ignite.js (' +
      countItems(ignite) +
      ' items, ' +
      ignite.length +
      ' categories)'
  );
  console.log('Done. Bump ?v= on product script tags if the browser caches hard.');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
