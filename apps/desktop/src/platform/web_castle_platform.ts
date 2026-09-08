import type { CastlePlatform } from "./castle_platform";
import { parseVideoPosterResponse } from "../lib/videoPoster";

const webCapabilities = Object.freeze({
  editContent: false,
  createContent: false,
  moveContent: false,
  deleteContent: false,
});

export const webCastlePlatform: CastlePlatform = Object.freeze({
  runtime: "web",
  capabilities: webCapabilities,
  contentMutations: null,
  mediaPreviews: Object.freeze({
    async resolveVideoPoster(sourceUrl: string) {
      const response = await fetch(
        `/__castle/video-poster?url=${encodeURIComponent(sourceUrl)}`,
      );
      if (!response.ok) return null;
      return parseVideoPosterResponse(await response.json());
    },
  }),
  knowledgeQueries: null,
  aiChat: null,
  desktopServices: null,
});
