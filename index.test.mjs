import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contributions, render, renderSprite, run, section, updateReadme } from "./index.mjs";

const avatar = "data:image/png;base64,AQID";
const repo = (name, stars = 1, isPrivate = false) => ({ repository: {
  nameWithOwner: name, stargazerCount: stars, isPrivate,
  owner: { login: name.split("/")[0], avatarUrl: `https://avatars.githubusercontent.com/${name.split("/")[0]}` },
} });
const json = body => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

test("all pages, public external repositories, count/star ordering and cached inline avatars", async () => {
  const pages = [
    [repo("outside/frequent", 3), repo("DON-YIN/self"), repo("secret/private", 50, true), repo("outside/starred", 12)],
    [repo("outside/frequent", 3), repo("other/small", 1), repo("outside/second", 3)],
  ];
  const cursors = [], avatars = [];
  const data = await contributions("Don-Yin", "test-token", async (url, options) => {
    if (url.endsWith("/graphql")) {
      assert.equal(options.headers.Authorization, "Bearer test-token");
      const { query, variables } = JSON.parse(options.body);
      assert.match(query, /states:MERGED/);
      cursors.push(variables.after);
      return json({ data: { user: { pullRequests: { nodes: pages.shift(), pageInfo: {
        hasNextPage: cursors.length === 1, endCursor: "page-two",
      } } } } });
    }
    assert.equal(options.headers, undefined, "never send the token to avatars");
    avatars.push(url);
    return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } });
  });
  assert.deepEqual(cursors, [null, "page-two"]);
  assert.equal(avatars.length, 2);
  assert.deepEqual(data.map(({ repo, merged, stars }) => [repo, merged, stars]), [
    ["outside/frequent", 2, 3], ["outside/starred", 1, 12], ["outside/second", 1, 3], ["other/small", 1, 1],
  ]);
  assert.ok(data.every(entry => entry.avatar === avatar));
  const wide = render(data), narrow = render(data, true);
  assert.match(wide, /width="480" height="114"/);
  assert.match(narrow, /width="368" height="176"/);
  assert.match(wide, /translate\(242\.5 43\)/);
  assert.match(narrow, /translate\(14 74\)/);
  assert.doesNotMatch(wide, /<tspan fill="#8b949e">outside\//);
  assert.match(narrow, /<tspan fill="#8b949e">outside\//);
  assert.equal((wide.match(/href="data:image\/png;base64,/g) || []).length, 4);
  assert.doesNotMatch(wide, /foreignObject|href="https?:/);
  assert.match(wide, /@media \(prefers-color-scheme: light\) \{ rect\[fill="#0d1117"\] \{ fill: #fff \}/);
  assert.match(render([{ repo: "a/<&\"'", stars: 1234, merged: 1, avatar }]), /a\/&lt;&amp;&quot;&#39;/);
  assert.match(render([]), /No merged contributions yet/);
});

test("clickable mode: one sprite with a view per repository and a README block with one link each", async () => {
  const data = ["a/one", "b/two", "c/three"].map((repo, i) => ({ repo, stars: 10 - i, merged: 3 - i, avatar }));
  const sprite = renderSprite(data);
  assert.deepEqual(sprite.match(/<view id="[^"]+"/g), ['<view id="heading"', '<view id="r-a--one"', '<view id="r-b--two"', '<view id="r-c--three"']);
  assert.match(sprite, /<view id="r-b--two" viewBox="-2\.5 64\.5 228\.5 31"\/>/);
  assert.match(renderSprite(data, true), /<tspan fill="#8b949e">a\/<\/tspan>one/);
  const block = section(data, "./metrics");
  assert.deepEqual(block.match(/<a href="[^"]+"/g), ['<a href="https://github.com/Don-Yin/github-pr-stats-cards"', '<a href="https://github.com/a/one"', '<a href="https://github.com/b/two"', '<a href="https://github.com/c/three"']);
  assert.match(block, /srcset="\.\/metrics\/pr-stats-narrow\.svg#r-a--one" width="368"><img align="top" alt="a\/one: 3 merged pull requests, 10 stars" src="\.\/metrics\/pr-stats-wide\.svg#r-a--one" width="196">/);
  assert.equal(block.split("\n").filter(line => line.endsWith("<br>")).length, 3, "heading line, then rows of two");
  assert.match(section([]), /No merged contributions yet/);
  const text = "intro\n<!-- pr-stats:start -->\nold\n<!-- pr-stats:end -->\noutro\n";
  assert.equal(updateReadme(updateReadme(text, "<!-- pr-stats:start -->x<!-- pr-stats:end -->"), "<!-- pr-stats:start -->x<!-- pr-stats:end -->"), "intro\n<!-- pr-stats:start -->x<!-- pr-stats:end -->\noutro\n");
  assert.throws(() => updateReadme("no markers", "x"), /needs <!-- pr-stats:start -->/);
  const dir = await mkdtemp(join(tmpdir(), "pr-stats-")), readme = join(dir, "README.md");
  await writeFile(readme, "no markers\n");
  await assert.rejects(run({ INPUT_USER: "Don-Yin", INPUT_TOKEN: "t", INPUT_README: readme }), /needs <!-- pr-stats:start -->/);
  assert.equal(await readFile(readme, "utf8"), "no markers\n");
});

test("limit must be a whole number", async () => {
  await assert.rejects(run({ INPUT_USER: "Don-Yin", INPUT_TOKEN: "t", INPUT_LIMIT: "twelve" }), /whole number/);
  await assert.rejects(run({ INPUT_USER: "Don-Yin", INPUT_TOKEN: "t", INPUT_LIMIT: "-1" }), /whole number/);
});

test("invalid inputs and API/avatar failures never produce a partial card", async () => {
  const unused = () => { throw new Error("unexpected request"); };
  await assert.rejects(contributions("bad/user", "token", unused), /valid GitHub user/);
  await assert.rejects(contributions("Don-Yin", "", unused), /token is required/);
  await assert.rejects(contributions("Don-Yin", "token", async () => new Response("", { status: 403 })), /HTTP 403/);
  await assert.rejects(contributions("Don-Yin", "token", async () => json({ errors: [{ message: "rate limited" }] })), /rate limited/);
  await assert.rejects(contributions("Don-Yin", "token", async () => json({ data: { user: null } })), /user not found/);
  await assert.rejects(contributions("Don-Yin", "token", async url => url.endsWith("/graphql")
    ? json({ data: { user: { pullRequests: { nodes: [repo("a/b")], pageInfo: { hasNextPage: false } } } } })
    : new Response("not an image", { headers: { "content-type": "text/html" } })), /Could not load avatar/);
  await assert.rejects(contributions("Don-Yin", "token", async () => new Response("", { status: 502 }), 0), /HTTP 502/);
});

test("a transient 502 is retried", async () => {
  let calls = 0;
  const data = await contributions("Don-Yin", "token", async url => {
    if (!url.endsWith("/graphql")) return new Response(new Uint8Array([1]), { headers: { "content-type": "image/png" } });
    return ++calls === 1 ? new Response("", { status: 502 })
      : json({ data: { user: { pullRequests: { nodes: [repo("a/b")], pageInfo: { hasNextPage: false } } } } });
  }, 0);
  assert.equal(calls, 2);
  assert.equal(data[0].repo, "a/b");
});
