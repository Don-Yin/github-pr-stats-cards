import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const query = `query($user:String!,$after:String){user(login:$user){pullRequests(first:100,after:$after,states:MERGED){nodes{repository{nameWithOwner isPrivate stargazerCount owner{login avatarUrl(size:32)}}}pageInfo{hasNextPage endCursor}}}}`;
const escape = value => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const compact = n => n < 1000 ? String(n) : `${(n / 1000).toFixed(n < 10000 ? 1 : 0).replace(/\.0$/, "")}k`;
const textWidth = text => [...text].reduce((width, c) => {
  if (/[ilI.,:!'|]/.test(c)) return width + 3.5;
  return width + (/[MW@]/.test(c) ? 10 : 7);
}, 0);
const shorten = (text, width) => {
  if (textWidth(text) <= width) return text;
  while (text && textWidth(`${text}…`) > width) text = text.slice(0, -1);
  return `${text}…`;
};

export async function contributions(user, token, request = fetch, retryDelay = 2000) {
  if (!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(user || "")) throw new Error("A valid GitHub user is required.");
  if (!token?.trim()) throw new Error("A GitHub token is required.");
  const repos = new Map(), avatars = new Map();
  let after = null;
  do {
    let response;
    // GitHub's GraphQL endpoint returns occasional 502/503s; retry those twice before failing
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (attempt > 1) await new Promise(done => setTimeout(done, retryDelay * attempt));
      response = await request("https://api.github.com/graphql", {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables: { user, after } }), signal: AbortSignal.timeout(30000),
      });
      if (response.status < 500) break;
    }
    if (!response.ok) throw new Error(`GitHub API returned HTTP ${response.status}.`);
    const result = await response.json();
    if (result.errors?.length) throw new Error(result.errors.map(error => error.message).join("; "));
    if (!result.data?.user) throw new Error(`GitHub user not found: ${user}`);
    const page = result.data.user.pullRequests;
    for (const { repository: repo } of page.nodes) {
      if (repo.isPrivate || repo.owner.login.toLowerCase() === user.toLowerCase()) continue;
      const entry = repos.get(repo.nameWithOwner) || { repo: repo.nameWithOwner, stars: repo.stargazerCount, avatar: repo.owner.avatarUrl, merged: 0 };
      entry.merged++;
      repos.set(entry.repo, entry);
    }
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);
  const data = [...repos.values()].sort((a, b) => b.merged - a.merged || b.stars - a.stars || a.repo.localeCompare(b.repo));
  for (const entry of data) {
    if (!avatars.has(entry.avatar)) {
      const response = await request(entry.avatar, { signal: AbortSignal.timeout(30000) });
      const type = response.headers.get("content-type")?.split(";")[0];
      if (!response.ok || !/^image\/(png|jpeg|gif|webp)$/.test(type || "")) throw new Error(`Could not load avatar for ${entry.repo}.`);
      avatars.set(entry.avatar, `data:${type};base64,${Buffer.from(await response.arrayBuffer()).toString("base64")}`);
    }
    entry.avatar = avatars.get(entry.avatar);
  }
  return data;
}

const style = `<style>@media (prefers-color-scheme: light) { rect[fill="#0d1117"] { fill: #fff } rect[fill="#161b22"] { fill: #f6f8fa; stroke: #d0d7de } g[fill="#c9d1d9"] { fill: #1f2328 } [fill="#8b949e"] { fill: #59636e } [fill="#58a6ff"] { fill: #0969da } [fill="#3fb950"] { fill: #1a7f37 } [stroke="#3fb950"] { stroke: #1a7f37 } }</style>`;
const font = `font-family="-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="12" fill="#c9d1d9"`;
const heading = `fill="#58a6ff" font-size="16" font-weight="600">Merged Contributions</text>`;

// column positions and star colours shared by every tile, so tiles line up and use one colour scale
function layout(data, narrow) {
  const width = narrow ? 368 : 480, columns = narrow ? 1 : 2, tileWidth = (width - 28 - (columns - 1) * 5) / columns;
  const mergeX = tileWidth - 26 - Math.max(1, ...data.map(d => String(d.merged).length)) * 7, starX = mergeX - 10 - Math.max(1, ...data.map(d => compact(d.stars).length)) * 6 - 13;
  // star colour runs from grey to GitHub's star gold, on a log scale between the fewest and most stars shown, cubed so the top repos stand out
  const logs = data.map(d => Math.log1p(d.stars)), low = Math.min(...logs), span = Math.max(...logs) - low || 1;
  const starColour = s => "#" + [[0x6e, 0xe3], [0x76, 0xb3], [0x81, 0x41]].map(([a, b]) => Math.round(a + (b - a) * ((Math.log1p(s) - low) / span) ** 3).toString(16).padStart(2, "0")).join("");
  return { narrow, width, columns, tileWidth, mergeX, starX, nameWidth: starX - 42, starColour };
}

const tile = (d, i, g) => {
  const count = String(d.merged), stars = compact(d.stars);
  const name = shorten(g.narrow ? d.repo : d.repo.split("/")[1], g.nameWidth), slash = name.indexOf("/") + 1;
  return `<title>${escape(d.repo)}: ${count} merged pull requests; ${d.stars} stars</title>
<rect width="${g.tileWidth}" height="26" rx="6" fill="#161b22" stroke="#30363d"/>
<clipPath id="avatar-${i}"><rect x="8" y="5" width="16" height="16" rx="4"/></clipPath><image x="8" y="5" width="16" height="16" href="${escape(d.avatar)}" clip-path="url(#avatar-${i})"/>
<clipPath id="name-${i}"><rect x="30" y="0" width="${g.nameWidth}" height="26"/></clipPath><text x="30" y="17" clip-path="url(#name-${i})"><tspan fill="#8b949e">${escape(name.slice(0, slash))}</tspan>${escape(name.slice(slash))}</text>
<g transform="translate(${g.starX} 8)" fill="${g.starColour(d.stars)}"><path d="m5.5 0 1.7 3.4 3.8.5-2.8 2.7.7 3.8-3.4-1.8-3.4 1.8.7-3.8L0 3.9l3.8-.5Z"/><text x="14" y="9" font-size="11">${stars}</text></g>
<g transform="translate(${g.mergeX} 6)" stroke="#3fb950" stroke-width="1.4" fill="none"><path d="M3 4v6m0-6c0 3 4 3 7 3"/><circle cx="3" cy="2" r="2"/><circle cx="3" cy="12" r="2"/><circle cx="12" cy="7" r="2"/></g><text x="${g.tileWidth - 8}" y="17" text-anchor="end" fill="#3fb950">${count}</text>`;
};

export function render(data, narrow = false) {
  const g = layout(data, narrow), width = g.width;
  const height = 52 + Math.max(1, Math.ceil(data.length / g.columns)) * 31;
  const tiles = data.map((d, i) => `<g transform="translate(${14 + (i % g.columns) * (g.tileWidth + 5)} ${43 + Math.floor(i / g.columns) * 31})">${tile(d, i, g)}</g>`).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title description">
${style}
<title id="title">Merged Contributions</title><desc id="description">Merged public pull requests outside personal repositories, sorted by merged count then stars. Green merge icons show pull requests; stars show repository stars, brighter gold for more stars.</desc>
<rect width="${width}" height="${height}" fill="#0d1117"/>
<g ${font}><text x="14" y="27" ${heading}
${tiles || '<text x="14" y="61" fill="#8b949e">No merged contributions yet.</text>'}</g></svg>\n`;
}

// Clickable mode: every tile stacked in one file, each with a named <view>. The README shows one tile per <img>
// through file.svg#id, so each repository gets its own link while the browser downloads only one file.
export const viewId = repo => `r-${repo.replace("/", "--")}`;
export function renderSprite(data, narrow = false, gap = 2) {
  // gap: transparent margin around each view, so spacing comes from the SVG, not from whitespace or the line box
  const g = layout(data, narrow), w = g.tileWidth + 1, pitch = 27 + 2 * gap, vw = w + 2 * gap, hw = narrow ? vw : 2 * vw;
  const total = 36 + Math.max(1, data.length) * pitch;
  const views = data.map((d, i) => `<view id="${viewId(d.repo)}" viewBox="${-0.5 - gap} ${36 + i * pitch - 0.5 - gap} ${vw} ${pitch}"/>`).join("\n");
  const tiles = data.map((d, i) => `<g transform="translate(0 ${36 + i * pitch})">${tile(d, i, g)}</g>`).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${w / 2 - hw / 2} 0 ${hw} ${total}" role="img" aria-label="Merged Contributions">
${style}
<view id="heading" viewBox="${w / 2 - hw / 2} 0 ${hw} 34"/>
${views}
<g ${font}><text x="${w / 2}" y="23" text-anchor="middle" ${heading}
${tiles}</g></svg>\n`;
}

// The README block: one link per repository, two tiles per line on wide screens and one on phones.
// align="top" (kept by GitHub) takes the images off the text baseline, and a row's tiles touch, so the only gaps are the sprite's own.
export const markers = ["<!-- pr-stats:start -->", "<!-- pr-stats:end -->"];
export function section(data, dir = ".") {
  const cell = (href, id, alt, wide, narrow) => `<a href="${href}"><picture><source media="(max-width: 600px)" srcset="${dir}/pr-stats-narrow.svg#${id}" width="${narrow}"><img align="top" alt="${escape(alt)}" src="${dir}/pr-stats-wide.svg#${id}" width="${wide}"></picture></a>`;
  const rows = [];
  for (let i = 0; i < data.length; i += 2) {
    rows.push(data.slice(i, i + 2).map(d => cell(`https://github.com/${d.repo}`, viewId(d.repo), `${d.repo}: ${d.merged} merged pull requests, ${d.stars} stars`, 196, 368)).join("") + "<br>");
  }
  return `${markers[0]}
<div align="center">
${cell("https://github.com/Don-Yin/github-pr-stats-cards", "heading", "Merged Contributions", 392, 368)}<br>
${rows.join("\n") || "No merged contributions yet."}
</div>
${markers[1]}`;
}

export function updateReadme(text, block) {
  const start = text.indexOf(markers[0]), end = text.indexOf(markers[1]);
  if (start < 0 || end < start) throw new Error(`The README needs ${markers[0]} followed by ${markers[1]} where the cards go.`);
  return text.slice(0, start) + block + text.slice(end + markers[1].length);
}

export async function run(env = process.env) {
  const limit = Number(env.INPUT_LIMIT || 0);
  if (!Number.isInteger(limit) || limit < 0) throw new Error("limit must be a whole number; 0 shows every repository.");
  const readme = env.INPUT_README?.trim(), dir = env.INPUT_DIR?.trim() || ".";
  const text = readme ? await readFile(readme, "utf8") : null;
  if (readme) updateReadme(text, ""); // fail on missing markers before spending API calls
  const data = await contributions(env.INPUT_USER, env.INPUT_TOKEN || env.GITHUB_TOKEN), shown = limit ? data.slice(0, limit) : data;
  await mkdir(dir, { recursive: true });
  for (const [name, narrow] of [["wide", false], ["narrow", true]]) {
    const path = join(dir, `pr-stats-${name}.svg`);
    await writeFile(path, readme ? renderSprite(shown, narrow) : render(shown, narrow));
    if (env.GITHUB_OUTPUT) await appendFile(env.GITHUB_OUTPUT, `${name}=${path}\n`);
  }
  if (readme) {
    const link = `./${relative(dirname(resolve(readme)), resolve(dir)).split(sep).join(posix.sep)}`.replace(/\/$/, "");
    await writeFile(readme, updateReadme(text, section(shown, link)));
  }
  console.log(`Rendered ${data.reduce((total, repo) => total + repo.merged, 0)} merged pull requests across ${data.length} public repositories.`);
  return data;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  run().catch(error => { console.error(error.message); process.exitCode = 1; });
}
