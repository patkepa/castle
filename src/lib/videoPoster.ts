const posterMetaKeys = new Set([
  "og:image",
  "og:image:secure_url",
  "twitter:image",
  "twitter:image:src",
]);

const htmlEntityPattern = /&(?:amp|apos|gt|lt|quot|#39);/giu;

function decodeHtmlAttribute(value: string) {
  return value.replace(htmlEntityPattern, (entity) => {
    switch (entity.toLocaleLowerCase()) {
      case "&amp;": return "&";
      case "&apos;":
      case "&#39;": return "'";
      case "&gt;": return ">";
      case "&lt;": return "<";
      case "&quot;": return '"';
      default: return entity;
    }
  });
}

function metaAttributes(tag: string) {
  const attributes = new Map<string, string>();
  for (const match of tag.matchAll(/([^\s=/>]+)\s*=\s*(["'])(.*?)\2/gisu)) {
    attributes.set(match[1].toLocaleLowerCase(), decodeHtmlAttribute(match[3]));
  }
  return attributes;
}

function safePosterUrl(value: string, pageUrl: string) {
  try {
    const resolved = new URL(value, pageUrl);
    return resolved.protocol === "https:" ? resolved.toString() : null;
  } catch {
    return null;
  }
}

export function extractVideoPosterUrl(html: string, pageUrl: string) {
  const candidates = new Map<string, string>();
  for (const match of html.matchAll(/<meta\b[^>]*>/gisu)) {
    const attributes = metaAttributes(match[0]);
    const key = (attributes.get("property") ?? attributes.get("name"))
      ?.toLocaleLowerCase();
    const content = attributes.get("content");
    if (key && content && posterMetaKeys.has(key) && !candidates.has(key)) {
      candidates.set(key, content);
    }
  }

  for (const key of posterMetaKeys) {
    const value = candidates.get(key);
    if (!value) continue;
    const posterUrl = safePosterUrl(value, pageUrl);
    if (posterUrl) return posterUrl;
  }
  return null;
}

export function parseVideoPosterResponse(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const posterUrl = (value as Record<string, unknown>).posterUrl;
  if (posterUrl === null) return null;
  return typeof posterUrl === "string" && safePosterUrl(posterUrl, posterUrl)
    ? posterUrl
    : null;
}
