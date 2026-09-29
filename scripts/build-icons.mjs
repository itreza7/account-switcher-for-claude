// Renders public/logo.svg (48, 128 px) and public/logo-small.svg (16, 32 px, bolder strokes)
// to transparent PNGs in public/icon-{size}.png. Run with `npm run icons`. Needs Google Chrome (or CHROME_PATH).
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(HERE, '../public');
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const JOBS = [
  { size: 16, svg: 'logo-small.svg' },
  { size: 32, svg: 'logo-small.svg' },
  { size: 48, svg: 'logo.svg' },
  { size: 128, svg: 'logo.svg' },
];

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
try {
  const page = await browser.newPage();
  for (const { size, svg } of JOBS) {
    const src = fs.readFileSync(path.join(PUBLIC, svg), 'utf8').replace(/ width="\d+" height="\d+"/, ' width="100%" height="100%"');
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block}</style>${src}`);
    const out = path.join(PUBLIC, `icon-${size}.png`);
    await page.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    console.log(`icon-${size}.png  (${svg})  ${fs.statSync(out).size} bytes`);
  }
} finally {
  await browser.close();
}
