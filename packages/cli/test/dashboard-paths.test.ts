// The dev server's pages must work when something serves them under a prefix.
//
// These exist because of a specific bug: every URL the page resolved for itself
// was root-absolute (`/inpage.js`, `/?d=…`, `/events`, `/api/run`). Served from
// the origin root that is fine. Served under a prefix — code-server's
// `/proxy/4173/`, a reverse proxy, an embed — the browser resolves `/…` against
// the ORIGIN, so it asked the proxy's root for the script and got a 404. The
// page rendered its nav and styles with no JavaScript at all, and the switcher
// links navigated out of the dashboard entirely.
//
// A relative reference resolves against the document, which is correct at any
// depth, including the root. These pin that so a future edit can't quietly put
// the leading slash back.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEV_PATHS } from "../src/dashboard.js";

/** Every path the shells emit, with a representative argument. */
const emitted = (): string[] => [
  DEV_PATHS.dashboard("overview_dashboard"),
  DEV_PATHS.inPage("overview_dashboard"),
  DEV_PATHS.bundle("overview_dashboard"),
  DEV_PATHS.events,
  DEV_PATHS.run,
];

test("no path the page resolves for itself is root-absolute", () => {
  for (const p of emitted()) {
    assert.ok(
      !p.startsWith("/"),
      `${JSON.stringify(p)} is root-absolute — under a proxy prefix the browser ` +
        `resolves it against the origin, not the dashboard`,
    );
  }
});

test("nor absolute in the other direction — a full URL pins the origin too", () => {
  for (const p of emitted()) {
    assert.ok(
      !/^[a-z][a-z0-9+.-]*:/i.test(p) && !p.startsWith("//"),
      `${JSON.stringify(p)} names an origin; the page must not care which one it is served from`,
    );
  }
});

test("they resolve under a proxy prefix the way the browser will", () => {
  // Exactly the shape that was broken: code-server serving the dev server at
  // /proxy/4173/. `new URL(rel, base)` is the browser's own algorithm.
  const base = "http://localhost:8080/proxy/4173/?d=overview_dashboard";
  assert.equal(
    new URL(DEV_PATHS.inPage("overview_dashboard"), base).pathname,
    "/proxy/4173/inpage.js",
  );
  assert.equal(new URL(DEV_PATHS.events, base).pathname, "/proxy/4173/events");
  assert.equal(new URL(DEV_PATHS.run, base).pathname, "/proxy/4173/api/run");
  assert.equal(
    new URL(DEV_PATHS.dashboard("seasonality"), base).href,
    "http://localhost:8080/proxy/4173/?d=seasonality",
  );
});

test("and still resolve correctly at the origin root", () => {
  // The direct `malloyyo dashboard dev` case, which must not regress.
  const base = "http://localhost:4173/?d=overview_dashboard";
  assert.equal(new URL(DEV_PATHS.inPage("overview_dashboard"), base).pathname, "/inpage.js");
  assert.equal(new URL(DEV_PATHS.events, base).pathname, "/events");
  assert.equal(new URL(DEV_PATHS.run, base).pathname, "/api/run");
  assert.equal(
    new URL(DEV_PATHS.dashboard("seasonality"), base).href,
    "http://localhost:4173/?d=seasonality",
  );
});

test("dashboard names are encoded, not interpolated raw", () => {
  const link = DEV_PATHS.dashboard("a b&c=d");
  assert.ok(!link.includes(" "), "a space would truncate the attribute");
  assert.equal(new URL(link, "http://x/").searchParams.get("d"), "a b&c=d");
  assert.equal(
    new URL(DEV_PATHS.inPage("a b&c=d"), "http://x/").searchParams.get("d"),
    "a b&c=d",
  );
});
