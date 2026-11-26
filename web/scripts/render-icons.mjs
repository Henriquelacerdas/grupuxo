// Gera os ícones do PWA a partir do glifo do ícone do app (grupuxo/grupuxo/AppIcon.icon/Assets/icone1.svg):
// fundo claro do ícone do iOS (gradiente cinza automático), glifo com a mesma escala e deslocamento do icon.json.
// Uso: npm run icons (precisa do Chromium do Playwright: npx playwright install chromium).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(root, "..", "grupuxo", "grupuxo", "AppIcon.icon", "Assets", "icone1.svg"), "utf8");
const glyph = source.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "").trim();

function icon({ scale, corner, offsetY }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#e6e6eb"/></linearGradient></defs>
<rect width="1024" height="1024" rx="${corner}" fill="url(#bg)"/>
<g transform="translate(512 ${512 + offsetY}) scale(${scale}) translate(-512 -512)">${glyph}</g>
</svg>`;
}

const regular = icon({ scale: 1.05, corner: 228, offsetY: -49.55 + 24 });
const maskable = icon({ scale: 0.8, corner: 0, offsetY: -30 });
const square = icon({ scale: 1.05, corner: 0, offsetY: -49.55 + 24 });
writeFileSync(join(root, "public", "icons", "icon.svg"), regular);

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
async function png(svg, size, name) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('width="1024" height="1024"', `width="${size}" height="${size}"`)}</body></html>`);
  writeFileSync(join(root, "public", "icons", name), await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } }));
}
await png(regular, 192, "icon-192.png");
await png(regular, 512, "icon-512.png");
await png(maskable, 512, "maskable-512.png");
await png(square, 180, "apple-touch-icon.png");
await png(regular, 32, "favicon-32.png");
await browser.close();
console.log("ícones gerados em public/icons");
