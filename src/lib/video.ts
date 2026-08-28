import { getYouTubeVideoId } from "./youtube";

const inlineUrlPattern = /https?:\/\/[^\s<>"']+/giu;
const trailingUrlPunctuationPattern = /[),.;!?\]]+$/u;
const directVideoExtensionPattern = /\.(?:m3u8|m4v|mov|mp4|og[gv]|webm)$/iu;
const videoViewKeyPattern = /^[A-Za-z0-9_-]+$/u;

export type PlayableVideo =
  | {
      kind: "youtube";
      url: string;
      videoId: string;
    }
  | {
      embedUrl: string;
      kind: "embed";
      url: string;
    }
  | {
      kind: "file";
      url: string;
    };

function parseUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

function isEmbeddedPlayerUrl(url: URL) {
  const pathParts = url.pathname.split("/").filter(Boolean);
  return url.hostname.toLocaleLowerCase().startsWith("player.") ||
    pathParts.includes("embed");
}

function getConventionalEmbedUrl(url: URL) {
  if (url.pathname !== "/view_video.php") return null;

  const viewKey = url.searchParams.get("viewkey");
  if (!viewKey || !videoViewKeyPattern.test(viewKey)) return null;

  return new URL(`/embed/${encodeURIComponent(viewKey)}`, url.origin).toString();
}

export function getPlayableVideo(value: string): PlayableVideo | null {
  const url = parseUrl(value.trim());
  if (!url) return null;

  const youtubeVideoId = getYouTubeVideoId(url.toString());
  if (youtubeVideoId) {
    return { kind: "youtube", url: url.toString(), videoId: youtubeVideoId };
  }

  if (directVideoExtensionPattern.test(url.pathname)) {
    return { kind: "file", url: url.toString() };
  }

  const conventionalEmbedUrl = getConventionalEmbedUrl(url);
  if (conventionalEmbedUrl) {
    return { embedUrl: conventionalEmbedUrl, kind: "embed", url: url.toString() };
  }

  return isEmbeddedPlayerUrl(url)
    ? { embedUrl: url.toString(), kind: "embed", url: url.toString() }
    : null;
}

function playableVideoKey(video: PlayableVideo) {
  return video.kind === "youtube"
    ? `${video.kind}:${video.videoId}`
    : `${video.kind}:${video.url}`;
}

export function findPlayableVideos(content: string): PlayableVideo[] {
  const videos = new Map<string, PlayableVideo>();

  for (const match of content.matchAll(inlineUrlPattern)) {
    const rawUrl = match[0].replace(trailingUrlPunctuationPattern, "");
    const video = getPlayableVideo(rawUrl);
    if (video) videos.set(playableVideoKey(video), video);
  }

  return Array.from(videos.values());
}

export function playableVideoLabel(video: PlayableVideo) {
  switch (video.kind) {
    case "youtube":
      return "YouTube";
    case "embed":
      return "Video";
    case "file":
      return "Direct video";
  }
}
