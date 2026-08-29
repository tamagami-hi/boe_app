// Renders the Android launcher icons AND splash screens from the brand SVG.
//
// Run from the repository root (so `playwright` resolves):
//   node app/resources/launcher/generate-android-assets.mjs
//
// Two variants, one difference between them: the brand colour. `*-red.svg` is
// `beonedge-logo-wide.svg` with #1800AD swapped for #FF0000 and nothing else
// touched, so the mark can never drift between client and admin.
//
// WHY A BROWSER: ImageMagick's SVG delegate is rsvg-convert, which is not
// installed here, and its built-in MSVG renderer cannot handle the nested
// clipPath chains this logo uses — it silently produces no image. Chromium
// renders the file exactly as a browser would, which is also how the same asset
// is drawn inside the app.
//
// WHY THE SQUARE ARTWORK IS COMPOSITED RATHER THAN CROPPED: the SVG is a solid
// colour field with the B centred in it. Dropping that square onto a canvas of
// the same colour leaves an invisible seam, so one asset serves both the square
// adaptive-icon foreground and the non-square splash images without ever needing
// to key out a background or clip the mark. It is also what makes this wide
// artwork safe under the adaptive-icon mask: the B occupies ~62% of the height,
// inside the 72/108 safe zone, so masking only trims surrounding colour.

import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const HERE = dirname(new URL(import.meta.url).pathname);

// Adaptive-icon foreground densities, and the legacy square/round icon sizes.
const FOREGROUND = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };
const LEGACY = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };

// ── How large the mark sits inside the icon ──────────────────────────────────
// The artwork is a colour field with the B centred in it, and the B is 61.6% of
// that artwork's height. So the artwork gets scaled DOWN inside a full-bleed
// field of the same colour, which is what leaves colour around the mark instead
// of the mark running to the edges.
//
// The two ratios differ because the two icon types show different amounts:
//
//   Adaptive: Android zooms the 108dp foreground so only the central 72dp is
//   guaranteed visible — an effective 1.5x crop. A mark drawn at 61.6% of the
//   full canvas therefore fills ~92% of what the launcher actually shows, which
//   is the "touches the sides" problem. At 0.60 the mark lands at ~37% of the
//   canvas, or ~55% of the visible circle.
//
//   Legacy: no zoom and no mask, so the whole square is visible, so this stays at
//   1.5x the adaptive ratio. That puts the mark at ~55% of the icon too, matching
//   the adaptive result rather than looking like a different logo on older
//   devices.
//
// To retune: B as a share of the visible circle = ratio x 92.4. Keep
// LEGACY = ADAPTIVE x 1.5 so the two icon types stay visually identical.
const ADAPTIVE_ARTWORK_RATIO = 0.6;
const LEGACY_ARTWORK_RATIO = 0.9;

// Exactly the folders and dimensions Capacitor generated, so nothing is added or
// dropped from the resource set.
const SPLASH = {
  drawable: [480, 320],
  'drawable-port-mdpi': [320, 480],
  'drawable-port-hdpi': [480, 800],
  'drawable-port-xhdpi': [720, 1280],
  'drawable-port-xxhdpi': [960, 1600],
  'drawable-port-xxxhdpi': [1280, 1920],
  'drawable-land-mdpi': [480, 320],
  'drawable-land-hdpi': [800, 480],
  'drawable-land-xhdpi': [1280, 720],
  'drawable-land-xxhdpi': [1600, 960],
  'drawable-land-xxxhdpi': [1920, 1280],
};

// Matches the mark size Capacitor's original splash used: measured on
// port-xxxhdpi the B was 360x614 within 1280x1920, i.e. the square artwork sat at
// ~0.78 of the canvas's shorter side, centred.
const SPLASH_ARTWORK_RATIO = 0.78;

const VARIANTS = {
  client: { svg: 'beonedge-logo-wide.svg', bg: '#1800AD' },
  admin: { svg: 'beonedge-logo-wide-red.svg', bg: '#FF0000' },
};

const svgCache = new Map();
async function svgAt(path, size) {
  if (!svgCache.has(path)) svgCache.set(path, await readFile(join(HERE, path), 'utf8'));
  return svgCache
    .get(path)
    .replace(/width="\d+"/, `width="${size}"`)
    .replace(/height="[\d.]+"/, `height="${size}"`);
}

/**
 * A full-bleed field of `bg` with the artwork scaled to `ratio` of the shorter
 * side and centred. One helper for icons and splashes alike: because the artwork
 * carries its own matching background, dropping it onto the same colour leaves an
 * invisible seam, so the only thing that changes between outputs is how much of
 * the frame the mark is allowed to occupy.
 */
async function renderField(page, svgPath, bg, width, height, ratio) {
  const art = Math.round(Math.min(width, height) * ratio);
  await page.setViewportSize({ width, height });
  await page.setContent(
    `<!doctype html><html><body style="margin:0;width:${width}px;height:${height}px;overflow:hidden;` +
      `background:${bg};display:flex;align-items:center;justify-content:center">` +
      `<div style="width:${art}px;height:${art}px">${await svgAt(svgPath, art)}</div>` +
      `</body></html>`,
    { waitUntil: 'load' },
  );
  return page.screenshot({ type: 'png' });
}

const browser = await chromium.launch({ executablePath: '/usr/bin/chromium' });
const page = await browser.newPage();

for (const [variant, cfg] of Object.entries(VARIANTS)) {
  for (const [density, size] of Object.entries(FOREGROUND)) {
    const out = join(HERE, variant, `mipmap-${density}`, 'ic_launcher_foreground.png');
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, await renderField(page, cfg.svg, cfg.bg, size, size, ADAPTIVE_ARTWORK_RATIO));
  }

  for (const [density, size] of Object.entries(LEGACY)) {
    const dir = join(HERE, variant, `mipmap-${density}`);
    await mkdir(dir, { recursive: true });
    const square = await renderField(page, cfg.svg, cfg.bg, size, size, LEGACY_ARTWORK_RATIO);
    // Round is masked from this same render by the caller, so the two shapes
    // cannot diverge.
    await writeFile(join(dir, 'ic_launcher.png'), square);
    await writeFile(join(dir, 'ic_launcher_round.png'), square);
  }

  for (const [folder, [w, h]] of Object.entries(SPLASH)) {
    const dir = join(HERE, variant, folder);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'splash.png'), await renderField(page, cfg.svg, cfg.bg, w, h, SPLASH_ARTWORK_RATIO));
  }

  // The adaptive background is a flat colour resource, so switching variant is
  // one value rather than another five images.
  const values = join(HERE, variant, 'values');
  await mkdir(values, { recursive: true });
  await writeFile(
    join(values, 'ic_launcher_background.xml'),
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${cfg.bg}</color>\n</resources>\n`,
  );

  console.log(`${variant}: icons + ${Object.keys(SPLASH).length} splash images, colour ${cfg.bg}`);
}

await browser.close();
