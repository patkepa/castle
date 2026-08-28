import { readFile } from "node:fs/promises";

const ACCESS_LOGIN_PATH = "/cdn-cgi/access/login";
const viewerRoot = new URL("../", import.meta.url);
const wranglerConfigUrl = new URL("wrangler.jsonc", viewerRoot);

export function validatePrivateDeployEnvironment(environment) {
  const errors = [];
  const productionUrl = environment.CASTLE_PRODUCTION_URL;

  if (!productionUrl) {
    errors.push(
      "Deployment blocked: set CASTLE_PRODUCTION_URL to the Cloudflare Access-protected HTTPS origin.",
    );
    return errors;
  }

  try {
    const parsed = new URL(productionUrl);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      errors.push(
        "CASTLE_PRODUCTION_URL must be an HTTPS URL without credentials, a query, or a fragment.",
      );
    }
  } catch {
    errors.push("CASTLE_PRODUCTION_URL must be a valid URL.");
  }

  return errors;
}

export function validatePrivateDeployConfig(config) {
  const errors = [];

  if (config.workers_dev !== false) {
    errors.push(
      "Deployment blocked: wrangler.jsonc must set workers_dev to false.",
    );
  }
  if (config.preview_urls !== false) {
    errors.push(
      "Deployment blocked: wrangler.jsonc must set preview_urls to false.",
    );
  }

  return errors;
}

export async function verifyCloudflareAccess(productionUrl, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl(productionUrl, {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
      headers: {
        Accept: "text/html",
      },
    });
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : String(reason);
    return [`Cloudflare Access probe failed: ${message}`];
  }

  const location = response.headers.get("location");
  if (isAccessLoginRedirect(response.status, location, productionUrl)) return [];

  return [
    "Deployment blocked: an unauthenticated request to " +
      `${productionUrl} returned ${response.status} without a Cloudflare Access login redirect.`,
  ];
}

function isAccessLoginRedirect(status, location, productionUrl) {
  if (![301, 302, 303, 307, 308].includes(status) || !location) return false;

  try {
    const production = new URL(productionUrl);
    const redirect = new URL(location, production);
    return (
      redirect.pathname.startsWith(ACCESS_LOGIN_PATH) &&
      (redirect.origin === production.origin ||
        redirect.hostname.endsWith(".cloudflareaccess.com"))
    );
  } catch {
    return false;
  }
}

async function runPrivateDeployCheck() {
  const environmentErrors = validatePrivateDeployEnvironment(process.env);
  const config = JSON.parse(await readFile(wranglerConfigUrl, "utf8"));
  const configErrors = validatePrivateDeployConfig(config);
  const errors = [...environmentErrors, ...configErrors];

  if (errors.length === 0) {
    errors.push(
      ...(await verifyCloudflareAccess(process.env.CASTLE_PRODUCTION_URL)),
    );
  }

  if (errors.length > 0) {
    for (const error of errors) console.error(error);
    process.exitCode = 1;
    return;
  }

  console.log(
    "Private deployment check passed: public Worker routes are disabled and Cloudflare Access challenged the production origin.",
  );
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  await runPrivateDeployCheck();
}
