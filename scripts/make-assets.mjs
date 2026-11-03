// Regenerate assets/hero.png and assets/anatomy.png from live data:
//   INPUT_USER=you INPUT_TOKEN="$(gh auth token)" node scripts/make-assets.mjs   (needs rsvg-convert)
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { contributions, render } from "../index.mjs";

const dir = new URL("../assets/", import.meta.url).pathname;
const data = await contributions(process.env.INPUT_USER, process.env.INPUT_TOKEN);
const font = "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";

// place a rendered card inside another svg at (x, y) with a given width
const place = (svg, x, y, w, id = "c") => {
  svg = svg.replace(/(id="|url\(#)(avatar|name)-/g, `$1${id}-$2-`);
  const [, cw, ch] = svg.match(/width="(\d+)" height="(\d+)"/);
  const h = (w / cw) * ch;
  return { h, svg: svg.replace(/<svg [^>]*?viewBox/, `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox`) };
};

// hero: desktop window with the wide card, phone with the narrow card
{
  const W = 880, H = 470;
  const wide = place(render(data.slice(0, 14)), 42, 92, 536, "w");
  const narrow = place(render(data.slice(0, 22), true), 634, 92, 204, "n");
  const out = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${font}">
<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#161b22"/><stop offset="1" stop-color="#0d1117"/></linearGradient>
<clipPath id="screen"><rect x="634" y="92" width="204" height="334" rx="6"/></clipPath>
<filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#000" flood-opacity=".55"/></filter></defs>
<rect width="${W}" height="${H}" rx="18" fill="url(#bg)"/>
<g filter="url(#shadow)"><rect x="30" y="46" width="560" height="${wide.h + 60}" rx="12" fill="#0d1117" stroke="#30363d"/></g>
<path d="M30 58a12 12 0 0 1 12-12h536a12 12 0 0 1 12 12v22H30z" fill="#161b22"/>
<circle cx="50" cy="63" r="5" fill="#ff5f57"/><circle cx="67" cy="63" r="5" fill="#febc2e"/><circle cx="84" cy="63" r="5" fill="#28c840"/>
<rect x="192" y="55" width="236" height="17" rx="8.5" fill="#0d1117" stroke="#30363d"/><text x="310" y="67.5" text-anchor="middle" font-size="10.5" fill="#8b949e">github.com/you</text>
${wide.svg}
<g filter="url(#shadow)"><rect x="622" y="40" width="228" height="398" rx="34" fill="#010409" stroke="#30363d" stroke-width="1.5"/></g>
<rect x="706" y="50" width="60" height="18" rx="9" fill="#000"/>
<text x="642" y="64" font-size="10" fill="#8b949e">9:41</text>
<g clip-path="url(#screen)">${narrow.svg}</g>
<text x="310" y="${wide.h + 136}" text-anchor="middle" font-size="13" fill="#8b949e">wide · two columns on desktop</text>
<text x="736" y="458" text-anchor="middle" font-size="13" fill="#8b949e">narrow · one column on phones</text>
</svg>`;
  execFileSync("rsvg-convert", ["-z", "2", "-o", `${dir}/hero.png`], { input: out });
}

// anatomy: three tiles, enlarged, with callouts
{
  const picks = ["postcss/postcss", "jgm/texmath", "miltonllera/mindset-eval"].map(r => data.find(d => d.repo === r));
  const card = render(picks, true);
  const s = 1.5, X = 44, Y = 70, W = 640;
  const placed = place(card, X, Y, 368 * s);
  // tile geometry copied from render(): narrow tileWidth 340, merge and star icon columns
  const tileWidth = 340, mergeX = tileWidth - 26 - Math.max(...picks.map(d => String(d.merged).length)) * 7;
  const compact = n => n < 1000 ? String(n) : `${(n / 1000).toFixed(n < 10000 ? 1 : 0).replace(/\.0$/, "")}k`;
  const starX = mergeX - 10 - Math.max(...picks.map(d => compact(d.stars).length)) * 6 - 13;
  const px = x => X + (14 + x) * s, py = row => Y + (43 + row * 31) * s;
  const H = Math.round(Y + placed.h + 84);
  const callout = (x, yTop, yLabel, label, anchor = "middle") =>
    `<line x1="${x}" y1="${yTop}" x2="${x}" y2="${yLabel + (yLabel < yTop ? 6 : -16)}" stroke="#58a6ff" stroke-dasharray="3 3"/><circle cx="${x}" cy="${yTop}" r="3" fill="#58a6ff"/><text x="${x}" y="${yLabel}" text-anchor="${anchor}" font-size="15" fill="#c9d1d9">${label}</text>`;
  const top = py(0), bottom = py(2) + 26 * s;
  const out = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${font}">
<rect width="${W}" height="${H}" rx="18" fill="#161b22"/>
${placed.svg}
${callout(px(16), top, 40, "owner avatar")}
${callout(px(30 + 70), top, 40, "owner / repository")}
${callout(px(starX + 5), bottom, H - 28, "repository stars, grey → gold")}
${callout(px(mergeX + 6), top, 40, "your merged PRs")}
</svg>`;
  execFileSync("rsvg-convert", ["-z", "2", "-o", `${dir}/anatomy.png`], { input: out });
}
console.log(`wrote ${dir}hero.png and ${dir}anatomy.png`);
