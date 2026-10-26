import assert from "node:assert/strict";
import test from "node:test";
import { contributions, render } from "./index.mjs";

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
  assert.match(render([{ repo: "a/<&\"'", stars: 1234, merged: 1, avatar }]), /a\/&lt;&amp;&quot;&#39;/);
  assert.match(render([]), /No merged contributions yet/);
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
