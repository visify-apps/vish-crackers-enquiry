import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const SRC = path.resolve('assets');
const DEST = path.resolve('assets/optimized');
const MAX_WIDTH = 900;
const QUALITY = 82;

fs.mkdirSync(DEST, { recursive: true });

const files = fs.readdirSync(SRC).filter((f) =>
  /\.(jpe?g|png|webp)$/i.test(f) && fs.statSync(path.join(SRC, f)).isFile()
);

let saved = 0;
let bytesIn = 0;
let bytesOut = 0;

for (const file of files) {
  const inputPath = path.join(SRC, file);
  const base = path.parse(file).name;
  const outPath = path.join(DEST, `${base}.jpg`);
  const inStat = fs.statSync(inputPath);
  bytesIn += inStat.size;

  await sharp(inputPath)
    .rotate()
    .resize({ width: MAX_WIDTH, withoutEnlargement: true })
    .jpeg({ quality: QUALITY, mozjpeg: true, chromaSubsampling: '4:4:4' })
    .toFile(outPath);

  const outStat = fs.statSync(outPath);
  bytesOut += outStat.size;
  saved++;
  if (saved % 20 === 0) console.log(`Optimized ${saved}/${files.length}…`);
}

console.log(
  `Done: ${saved} files\n` +
    `Before: ${(bytesIn / 1024 / 1024).toFixed(1)} MB\n` +
    `After:  ${(bytesOut / 1024 / 1024).toFixed(1)} MB`
);
