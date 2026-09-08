import type { Note } from "../../types";
import {
  findPlayableVideos,
  type PlayableVideo,
} from "../../lib/video";

export {
  findPlayableVideos,
  getPlayableVideo,
  playableVideoLabel,
} from "../../lib/video";
export {
  findYouTubeVideos,
  getYouTubeVideoId,
  youtubeEmbedUrl,
} from "../../lib/youtube";

export interface PlaylistVideo {
  id: string;
  note: Note;
  source: PlayableVideo;
}

export function createPlaylistVideos(notes: readonly Note[]): PlaylistVideo[] {
  return notes.flatMap((note) =>
    findPlayableVideos(note.preview || note.excerpt).map((source) => ({
      id: `${note.id}:${source.kind}:${
        source.kind === "youtube" ? source.videoId : source.url
      }`,
      note,
      source,
    })),
  );
}

export function isVideoOnlyPlaylist(
  notes: readonly Note[],
  directFolderCount: number,
) {
  if (notes.length === 0 || directFolderCount > 0) return false;
  const videoNoteIds = new Set(
    createPlaylistVideos(notes).map((video) => video.note.id),
  );
  return videoNoteIds.size === notes.length;
}
