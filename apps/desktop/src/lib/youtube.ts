const youtubeHosts = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtu.be",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);
const youtubeVideoIdPattern = /^[A-Za-z0-9_-]{11}$/;
const inlineUrlPattern = /https?:\/\/[^\s<>"']+/giu;
const trailingUrlPunctuationPattern = /[),.;!?\]]+$/u;

export function getYouTubeVideoId(content: string): string | null {
  const candidate = content.trim();
  if (!candidate || /\s/.test(candidate)) return null;

  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!youtubeHosts.has(url.hostname.toLocaleLowerCase())) return null;

    const pathParts = url.pathname.split("/").filter(Boolean);
    const videoId = url.hostname.toLocaleLowerCase().endsWith("youtu.be")
      ? pathParts[0]
      : url.pathname === "/watch"
        ? url.searchParams.get("v")
        : ["embed", "shorts", "live"].includes(pathParts[0])
          ? pathParts[1]
          : null;

    return videoId && youtubeVideoIdPattern.test(videoId) ? videoId : null;
  } catch {
    return null;
  }
}

export function findYouTubeVideos(content: string) {
  const videos = new Map<string, string>();
  const directVideoId = getYouTubeVideoId(content);
  if (directVideoId) {
    videos.set(directVideoId, content.trim());
  } else {
    for (const match of content.matchAll(inlineUrlPattern)) {
      const url = match[0].replace(trailingUrlPunctuationPattern, "");
      const videoId = getYouTubeVideoId(url);
      if (videoId && !videos.has(videoId)) videos.set(videoId, url);
    }
  }
  return Array.from(videos, ([youtubeVideoId, url]) => ({
    url,
    youtubeVideoId,
  }));
}

export function youtubeEmbedUrl(videoId: string) {
  return `https://www.youtube-nocookie.com/embed/${videoId}`;
}
