import assert from "node:assert/strict";
import test from "node:test";
import {
  extractVideoPosterUrl,
  parseVideoPosterResponse,
} from "../src/lib/videoPoster.ts";
import {
  parseVideoPosterInput,
  resolveVideoPosterWithFetcher,
} from "../src/lib/videoPosterServer.ts";

test("extracts a clean poster from provider-neutral page metadata", () => {
  const html = `
    <html><head>
      <meta content="/images/poster.jpg?size=large&amp;frame=4" property="og:image">
      <meta name="twitter:image" content="https://cdn.example.com/fallback.jpg">
    </head></html>
  `;
  assert.equal(
    extractVideoPosterUrl(html, "https://video.example.com/watch/123"),
    "https://video.example.com/images/poster.jpg?size=large&frame=4",
  );
});

test("ignores unsafe poster metadata and malformed responses", () => {
  assert.equal(
    extractVideoPosterUrl(
      '<meta property="og:image" content="http://127.0.0.1/private.jpg">',
      "https://video.example.com/watch/123",
    ),
    null,
  );
  assert.equal(parseVideoPosterResponse({ posterUrl: "javascript:alert(1)" }), null);
  assert.equal(parseVideoPosterResponse({ posterUrl: null }), null);
});

test("accepts public HTTPS video pages and rejects local network targets", () => {
  assert.deepEqual(
    parseVideoPosterInput({ url: "https://video.example.com/watch/123" }),
    { url: "https://video.example.com/watch/123" },
  );
  assert.throws(
    () => parseVideoPosterInput({ url: "https://127.0.0.1/watch/123" }),
    /unsafe video preview URL/,
  );
  assert.throws(
    () => parseVideoPosterInput({ url: "http://video.example.com/watch/123" }),
    /unsafe video preview URL/,
  );
});

test("resolves a poster from the fetched page head", async () => {
  const requests = [];
  const posterUrl = await resolveVideoPosterWithFetcher(
    "https://video.example.com/watch/123",
    async (url, init) => {
      requests.push({ url, init });
      return new Response(
        '<html><head><meta property="og:image" content="https://cdn.example.com/poster.webp"></head><body>ignored</body></html>',
        { headers: { "content-type": "text/html; charset=utf-8" } },
      );
    },
  );

  assert.equal(posterUrl, "https://cdn.example.com/poster.webp");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://video.example.com/watch/123");
  assert.equal(requests[0].init.headers.accept, "text/html,application/xhtml+xml");
});
