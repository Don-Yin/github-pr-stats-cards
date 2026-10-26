import { appendFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
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

export async function contributions(user, token, request = fetch) {
  if (!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(user || "")) throw new Error("A valid GitHub user is required.");
  if (!token?.trim()) throw new Error("A GitHub token is required.");
  const repos = new Map(), avatars = new Map();
  let after = null;
  do {
    const response = await request("https://api.github.com/graphql", {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: { user, after } }), signal: AbortSignal.timeout(30000),
    });
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

export function render(data, narrow = false) {
  const width = narrow ? 368 : 480, columns = narrow ? 1 : 2, tileWidth = (width - 28 - (columns - 1) * 5) / columns;
  const height = 52 + Math.max(1, Math.ceil(data.length / columns)) * 31;
  // the widest count and star label fix the icon columns, so every row lines up
  const mergeX = tileWidth - 26 - Math.max(1, ...data.map(d => String(d.merged).length)) * 7, starX = mergeX - 10 - Math.max(1, ...data.map(d => compact(d.stars).length)) * 6 - 13;
  const nameWidth = starX - 42;
  const tiles = data.map((d, i) => {
    const x = 14 + (i % columns) * (tileWidth + 5), y = 43 + Math.floor(i / columns) * 31;
    const count = String(d.merged), stars = compact(d.stars);
    const name = shorten(narrow ? d.repo : d.repo.split("/")[1], nameWidth), slash = name.indexOf("/") + 1;
    return `<g transform="translate(${x} ${y})"><title>${escape(d.repo)}: ${count} merged pull requests; ${d.stars} stars</title>
<rect width="${tileWidth}" height="26" rx="6" fill="#161b22" stroke="#30363d"/>
<clipPath id="avatar-${i}"><rect x="8" y="5" width="16" height="16" rx="4"/></clipPath><image x="8" y="5" width="16" height="16" href="${escape(d.avatar)}" clip-path="url(#avatar-${i})"/>
<clipPath id="name-${i}"><rect x="30" y="0" width="${nameWidth}" height="26"/></clipPath><text x="30" y="17" clip-path="url(#name-${i})"><tspan fill="#8b949e">${escape(name.slice(0, slash))}</tspan>${escape(name.slice(slash))}</text>
<g transform="translate(${starX} 8)" fill="#6e7681"><path d="m5.5 0 1.7 3.4 3.8.5-2.8 2.7.7 3.8-3.4-1.8-3.4 1.8.7-3.8L0 3.9l3.8-.5Z"/><text x="14" y="9" font-size="11">${stars}</text></g>
<g transform="translate(${mergeX} 6)" stroke="#3fb950" stroke-width="1.4" fill="none"><path d="M3 4v6m0-6c0 3 4 3 7 3"/><circle cx="3" cy="2" r="2"/><circle cx="3" cy="12" r="2"/><circle cx="12" cy="7" r="2"/></g><text x="${tileWidth - 8}" y="17" text-anchor="end" fill="#3fb950">${count}</text></g>`;
  }).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title description">
<title id="title">Merged Contributions</title><desc id="description">Merged public pull requests outside personal repositories, sorted by merged count then stars. Green merge icons show pull requests; grey stars show repository stars.</desc>
<rect width="${width}" height="${height}" fill="#0d1117"/>
<g font-family="-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="12" fill="#c9d1d9"><text x="14" y="27" fill="#58a6ff" font-size="16" font-weight="600">Merged Contributions</text>
${tiles || '<text x="14" y="61" fill="#8b949e">No merged contributions yet.</text>'}</g></svg>\n`;
}

export async function run(env = process.env) {
  const data = await contributions(env.INPUT_USER, env.INPUT_TOKEN || env.GITHUB_TOKEN);
  for (const [name, narrow] of [["wide", false], ["narrow", true]]) {
    const path = `merged-card-${name}.svg`;
    await writeFile(path, render(data, narrow));
    if (env.GITHUB_OUTPUT) await appendFile(env.GITHUB_OUTPUT, `${name}=${path}\n`);
  }
  console.log(`Rendered ${data.reduce((total, repo) => total + repo.merged, 0)} merged pull requests across ${data.length} public repositories.`);
  return data;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  run().catch(error => { console.error(error.message); process.exitCode = 1; });
}
