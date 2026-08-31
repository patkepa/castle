import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("web deployment blocks framing and restricts active content", async () => {
  const headers = await readFile(
    new URL("../public/_headers", import.meta.url),
    "utf8",
  );

  assert.match(headers, /^\s*X-Frame-Options: DENY$/m);
  assert.match(headers, /Content-Security-Policy:.*default-src 'self'/);
  assert.match(headers, /Content-Security-Policy:.*script-src 'self'/);
  assert.match(
    headers,
    /Content-Security-Policy:.*script-src 'self' https:\/\/www\.youtube\.com/,
  );
  assert.match(headers, /Content-Security-Policy:.*object-src 'none'/);
  assert.match(headers, /Content-Security-Policy:.*media-src 'self' blob: https: http:/);
  assert.match(headers, /Content-Security-Policy:.*frame-src https: http:/);
  assert.match(headers, /Content-Security-Policy:.*frame-ancestors 'none'/);
  assert.match(
    headers,
    /\/app-assets\/\*[\s\S]*Cache-Control: public, max-age=31536000, immutable/,
  );
  assert.match(
    headers,
    /\/generated\/notes\/\*[\s\S]*Cache-Control: public, max-age=31536000, immutable/,
  );
  assert.match(
    headers,
    /\/generated\/avatars\/\*[\s\S]*Cache-Control: public, max-age=31536000, immutable/,
  );
  assert.match(
    headers,
    /\/generated\/catalog\.json[\s\S]*Cache-Control: private, no-cache, must-revalidate/,
  );
  assert.match(
    headers,
    /\/generated\/bootstrap\.json[\s\S]*Cache-Control: private, no-cache, must-revalidate/,
  );
});
