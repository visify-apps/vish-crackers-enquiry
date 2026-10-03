/**
 * Download an image URL → compress (same settings as optimize-images) →
 * save as assets/optimized/{nextSno}.jpg
 *
 * CLI:
 *   npm run import-image -- "https://example.com/photo.jpg"
 *
 * Local API (for /ignite-images desk):
 *   npm run import-server
 *   POST http://127.0.0.1:8787/import  { "url": "https://..." }
 */
import sharp from 'sharp';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DEST = path.join(ROOT, 'assets', 'optimized');
const MAX_WIDTH = 900;
const QUALITY = 82;
const PORT = 8787;

function nextSerialNo() {
  fs.mkdirSync(DEST, { recursive: true });
  let max = 0;
  for (const name of fs.readdirSync(DEST)) {
    const m = /^(\d+)\.(jpe?g|png|webp)$/i.exec(name);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

function assertHttpUrl(raw) {
  let u;
  try {
    u = new URL(String(raw || '').trim());
  } catch {
    throw new Error('Invalid URL');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('Only http/https URLs allowed');
  }
  return u.href;
}

async function importFromUrl(urlRaw) {
  const url = assertHttpUrl(urlRaw);
  const sno = nextSerialNo();
  const outRel = `assets/optimized/${sno}.jpg`;
  const outPath = path.join(ROOT, outRel);

  const res = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'VishFireworksImageImport/1.0',
      Accept: 'image/*,*/*'
    }
  });
  if (!res.ok) {
    throw new Error(`Download failed (${res.status})`);
  }
  const ctype = String(res.headers.get('content-type') || '');
  if (ctype && !/^image\//i.test(ctype) && !/octet-stream/i.test(ctype)) {
    throw new Error('URL did not return an image (' + ctype + ')');
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 32) throw new Error('Downloaded file too small');
  if (buf.length > 25 * 1024 * 1024) throw new Error('Image larger than 25MB');

  await sharp(buf)
    .rotate()
    .resize({ width: MAX_WIDTH, withoutEnlargement: true })
    .jpeg({ quality: QUALITY, mozjpeg: true, chromaSubsampling: '4:4:4' })
    .toFile(outPath);

  const sizeKb = Math.round(fs.statSync(outPath).size / 1024);
  return { sno, path: outRel, bytesKb: sizeKb };
}

function sendJson(res, status, body) {
  const json = status === 204 ? '' : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Length': Buffer.byteLength(json)
  });
  res.end(json);
}

function startServer() {
  const server = http.createServer(async (req, res) => {
    const urlPath = (req.url || '/').split('?')[0];
    if (req.method === 'OPTIONS') {
      sendJson(res, 204, {});
      return;
    }
    if (req.method === 'GET' && (urlPath === '/' || urlPath === '/health')) {
      sendJson(res, 200, {
        status: 'ok',
        nextSno: nextSerialNo(),
        hint: 'POST /import {"url":"https://..."}'
      });
      return;
    }
    if (req.method === 'POST' && (urlPath === '/import' || urlPath === '/')) {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      try {
        const body = raw ? JSON.parse(raw) : {};
        const result = await importFromUrl(body.url);
        console.log(`Imported ${result.path} (${result.bytesKb} KB)`);
        sendJson(res, 200, { status: 'ok', ...result });
      } catch (err) {
        console.error(err.message || err);
        sendJson(res, 400, { status: 'error', message: err.message || 'Import failed' });
      }
      return;
    }
    sendJson(res, 404, { status: 'error', message: 'Not found' });
  });

  server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} already in use — import server may already be running.`);
      console.error(`Check: lsof -nP -iTCP:${PORT} -sTCP:LISTEN`);
      console.error(`Or stop it: kill $(lsof -t -iTCP:${PORT} -sTCP:LISTEN)`);
      process.exit(1);
    }
    throw err;
  });

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Image import server: http://127.0.0.1:${PORT}`);
    console.log(`Next S.No will be: ${nextSerialNo()}`);
  });
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const args = process.argv.slice(2);
  const wantServer =
    args.includes('--server') ||
    args.includes('-s') ||
    process.env.npm_lifecycle_event === 'import-server';
  const urlArg = args.find((a) => !a.startsWith('-'));

  if (wantServer) {
    startServer();
  } else if (urlArg) {
    importFromUrl(urlArg)
      .then((r) => {
        console.log(`Saved ${r.path} (${r.bytesKb} KB) — S.No ${r.sno}`);
      })
      .catch((err) => {
        console.error(err.message || err);
        process.exit(1);
      });
  } else {
    console.error('Usage:');
    console.error('  npm run import-image -- "https://example.com/a.jpg"');
    console.error('  npm run import-server');
    process.exit(1);
  }
}
