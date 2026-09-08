import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  validatePrivateDeployConfig,
  validatePrivateDeployEnvironment,
  verifyCloudflareAccess,
} from "../scripts/check-private-deploy.mjs";

test("requires an HTTPS production origin for the Access probe", () => {
  assert.equal(validatePrivateDeployEnvironment({}).length, 1);
  assert.equal(
    validatePrivateDeployEnvironment({
      CASTLE_PRODUCTION_URL: "http://notes.example.com",
    }).length,
    1,
  );
  assert.deepEqual(
    validatePrivateDeployEnvironment({
      CASTLE_PRODUCTION_URL: "https://notes.example.com",
    }),
    [],
  );
});

test("requires public Worker routes to be disabled", () => {
  assert.equal(validatePrivateDeployConfig({}).length, 2);
  assert.deepEqual(
    validatePrivateDeployConfig({
      workers_dev: false,
      preview_urls: false,
    }),
    [],
  );
});

test("repository Wrangler config disables public Worker routes", async () => {
  const config = JSON.parse(
    await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
  );
  assert.deepEqual(validatePrivateDeployConfig(config), []);
});

test("accepts only a Cloudflare Access login redirect", async () => {
  const accessResponse = new Response(null, {
    status: 302,
    headers: {
      location:
        "https://example.cloudflareaccess.com/cdn-cgi/access/login/notes",
    },
  });
  const publicResponse = new Response("<h1>Private notes</h1>", {
    status: 200,
  });
  const deceptiveRedirect = new Response(null, {
    status: 302,
    headers: {
      location: "https://example.com/cdn-cgi/access/login/fake",
    },
  });

  assert.deepEqual(
    await verifyCloudflareAccess(
      "https://notes.example.com",
      async () => accessResponse,
    ),
    [],
  );
  assert.equal(
    (
      await verifyCloudflareAccess(
        "https://notes.example.com",
        async () => publicResponse,
      )
    ).length,
    1,
  );
  assert.equal(
    (
      await verifyCloudflareAccess(
        "https://notes.example.com",
        async () => deceptiveRedirect,
      )
    ).length,
    1,
  );
});
