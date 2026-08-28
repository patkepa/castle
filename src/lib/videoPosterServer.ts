import { extractVideoPosterUrl } from "./videoPoster";

const maximumHeadBytes = 512 * 1024;
const requestTimeoutMilliseconds = 12_000;

type PosterFetcher = (url: string, init?: RequestInit) => Promise<Response>;

export function parseVideoPosterInput(value: unknown) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => key !== "url")
  ) {
    throw new Error("Castle rejected an invalid video preview request.");
  }
  const rawUrl = (value as Record<string, unknown>).url;
  if (typeof rawUrl !== "string" || rawUrl.length === 0 || rawUrl.length > 4096) {
    throw new Error("Castle rejected an invalid video preview request.");
  }
  const url = new URL(rawUrl);
  const hostname = url.hostname.toLocaleLowerCase();
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    isPrivateAddress(hostname)
  ) {
    throw new Error("Castle rejected an unsafe video preview URL.");
  }
  return { url: url.toString() };
}

function isPrivateAddress(hostname: string) {
  if (hostname.includes(":")) return true;
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/u.test(part))) {
    return false;
  }
  const octets = parts.map(Number);
  if (octets.some((octet) => octet > 255)) return true;
  const [first, second] = octets;
  return first === 0 || first === 10 || first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    first >= 224;
}

async function readHtmlHead(response: Response) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let html = "";
  let bytesRead = 0;

  try {
    while (bytesRead < maximumHeadBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      html += decoder.decode(value, { stream: true });
      if (/<\/head\s*>/iu.test(html)) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return html;
}

export async function resolveVideoPosterWithFetcher(
  sourceUrl: string,
  fetcher: PosterFetcher,
) {
  const { url } = parseVideoPosterInput({ url: sourceUrl });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMilliseconds);
  try {
    const response = await fetcher(url, {
      headers: { accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLocaleLowerCase().includes("text/html")) return null;
    const html = await readHtmlHead(response);
    return extractVideoPosterUrl(html, response.url || url);
  } finally {
    clearTimeout(timeout);
  }
}
