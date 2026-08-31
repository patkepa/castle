import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { FolderPage } from "../src/components/FolderPage.tsx";
import { LibraryViewToggle } from "../src/components/LibraryViewToggle.tsx";
import {
  PlaylistPlayer,
  PlaylistVideoGrid,
  PlaylistView,
} from "../src/features/playlists/PlaylistView.tsx";
import {
  createPlaylistVideos,
  findPlayableVideos,
  findYouTubeVideos,
  getPlayableVideo,
  getYouTubeVideoId,
  isVideoOnlyPlaylist,
} from "../src/features/playlists/playlistPresentation.ts";
import { handlePlaylistQueueKeyDown } from "../src/features/playlists/playlist_keyboard_navigation.ts";
import { togglePlaylistFullscreen } from "../src/features/playlists/playlist_page_keyboard_navigation.ts";
import {
  formatVideoTime,
  playlistProgressRatio,
  playlistResumeTime,
} from "../src/features/playlists/playlistState.ts";
import { CastlePlatformProvider } from "../src/platform/castle_platform_provider.tsx";
import { webCastlePlatform } from "../src/platform/web_castle_platform.ts";

const note = {
  id: "playlists/visual_math/neural_networks",
  section: "playlists",
  sectionLabel: "Playlists",
  relativePath: "visual_math/neural_networks.md",
  sourceFile: "playlists/visual_math/neural_networks.md",
  route: "/note/playlists/visual_math/neural_networks",
  title: "But what is a neural network?",
  excerpt: "https://www.youtube.com/watch?v=aircAruvnKk",
  tags: [],
  aliases: [],
  status: "",
  avatarUrl: "",
  modifiedAt: "2026-08-19T00:00:00.000Z",
  contentPath: "/content/playlists/visual_math/neural_networks.md",
  wordCount: 1,
  readingMinutes: 1,
  pinned: false,
};

function renderPlaylist(component) {
  return renderToStaticMarkup(
    createElement(
      CastlePlatformProvider,
      { platform: webCastlePlatform },
      createElement(MemoryRouter, null, component),
    ),
  );
}

test("finds supported YouTube video links without accepting lookalike hosts", () => {
  assert.equal(
    getYouTubeVideoId("https://www.youtube.com/watch?v=aircAruvnKk"),
    "aircAruvnKk",
  );
  assert.equal(getYouTubeVideoId("https://youtu.be/fNk_zzaMoSs?t=30"), "fNk_zzaMoSs");
  assert.equal(
    getYouTubeVideoId("https://youtube.com.example.com/watch?v=aircAruvnKk"),
    null,
  );
  assert.deepEqual(
    findYouTubeVideos(
      "Watch https://youtu.be/fNk_zzaMoSs and https://www.youtube.com/shorts/aircAruvnKk.",
    ).map((video) => video.youtubeVideoId),
    ["fNk_zzaMoSs", "aircAruvnKk"],
  );
});

test("builds a folder playlist from any notes with playable previews", () => {
  const videos = createPlaylistVideos([
    note,
    { ...note, id: "plain_note", excerpt: "A note without video." },
  ]);

  assert.equal(videos.length, 1);
  assert.equal(videos[0].note.title, "But what is a neural network?");
  assert.equal(videos[0].source.kind, "youtube");
  assert.equal(videos[0].source.videoId, "aircAruvnKk");
});

test("finds generic embeds and direct video links", () => {
  const videos = findPlayableVideos(`
    https://player.example.com/video/76979871
    https://media.example.com/embed/clip-123
    https://cdn.example.com/watch/clip.MP4?token=signed
    https://example.com/article-about-video
  `);

  assert.deepEqual(videos.map((video) => video.kind), [
    "embed",
    "embed",
    "file",
  ]);
  assert.equal(videos[0].embedUrl, "https://player.example.com/video/76979871");
  assert.equal(videos[1].embedUrl, "https://media.example.com/embed/clip-123");
  assert.equal(videos[2].url, "https://cdn.example.com/watch/clip.MP4?token=signed");
});

test("turns conventional watch links into same-origin playable embeds", () => {
  const video = getPlayableVideo(
    "https://video.example.com/view_video.php?viewkey=example_video_123",
  );

  assert.deepEqual(video, {
    embedUrl: "https://video.example.com/embed/example_video_123",
    kind: "embed",
    url: "https://video.example.com/view_video.php?viewkey=example_video_123",
  });
  assert.equal(
    getPlayableVideo("https://video.example.com/watch?viewkey=example_video_123"),
    null,
  );
});

test("shows conventional watch-link notes as video-only playlist items", () => {
  const watchLinkNote = {
    ...note,
    id: "playlists/tutorials/example_video",
    relativePath: "tutorials/example_video.md",
    sourceFile: "playlists/tutorials/example_video.md",
    route: "/note/playlists/tutorials/example_video",
    title: "Example video",
    excerpt: "https://video.example.com/view_video.php?viewkey=example_video_123",
  };
  const videos = createPlaylistVideos([watchLinkNote]);
  const markup = renderPlaylist(
    createElement(PlaylistVideoGrid, { onPlay: () => {}, videos }),
  );

  assert.equal(isVideoOnlyPlaylist([watchLinkNote], 0), true);
  assert.equal(videos.length, 1);
  assert.match(markup, /aria-label="Play Example video"/);
  assert.match(markup, /class="playlist-video-placeholder"/);
  assert.match(markup, /href="\/note\/playlists\/tutorials\/example_video"/);
});

test("rejects unsupported schemes and ordinary web pages", () => {
  assert.equal(getPlayableVideo("javascript:alert(1)"), null);
  assert.equal(getPlayableVideo("https://example.com/watch/123"), null);
  assert.equal(getPlayableVideo("https://notplayer.example.com/76979871"), null);
});

test("detects folders that contain only videos", () => {
  assert.equal(isVideoOnlyPlaylist([note], 0), true);
  assert.equal(
    isVideoOnlyPlaylist(
      [note, { ...note, id: "plain_note", excerpt: "A note without video." }],
      0,
    ),
    false,
  );
  assert.equal(isVideoOnlyPlaylist([note], 1), false);
});

test("defaults video-only folders to the video grid", () => {
  const markup = renderToStaticMarkup(
    createElement(
      CastlePlatformProvider,
      { platform: webCastlePlatform },
      createElement(
        MemoryRouter,
        { initialEntries: ["/browse/playlists/visual_math"] },
        createElement(
          Routes,
          null,
          createElement(Route, {
            path: "/browse/:sectionId/*",
            element: createElement(FolderPage, {
              folders: [],
              notes: [note],
              onTogglePinnedFolder: () => {},
              pinnedFolderRoutes: new Set(),
              sections: [
                {
                  id: "playlists",
                  label: "Playlists",
                  count: 1,
                  icon: "video",
                },
              ],
            }),
          }),
        ),
      ),
    ),
  );

  assert.match(markup, /class="playlist-grid"/);
  assert.match(markup, /data-library-layout="grid"/);
  assert.doesNotMatch(markup, /<iframe/);
});

test("restores playlist mode and the selected video from the URL", () => {
  const secondNote = {
    ...note,
    id: "playlists/visual_math/linear_algebra",
    route: "/note/playlists/visual_math/linear_algebra",
    title: "Essence of linear algebra",
    excerpt: "https://youtu.be/fNk_zzaMoSs",
  };
  const selectedVideoId = createPlaylistVideos([secondNote])[0].id;
  const entry = `/browse/playlists/visual_math?view=playlist&video=${encodeURIComponent(selectedVideoId)}`;
  const markup = renderToStaticMarkup(
    createElement(
      CastlePlatformProvider,
      { platform: webCastlePlatform },
      createElement(
        MemoryRouter,
        { initialEntries: [entry] },
        createElement(
          Routes,
          null,
          createElement(Route, {
            path: "/browse/:sectionId/*",
            element: createElement(FolderPage, {
              folders: [],
              notes: [note, secondNote],
              onTogglePinnedFolder: () => {},
              pinnedFolderRoutes: new Set(),
              sections: [{ id: "playlists", label: "Playlists", count: 2, icon: "video" }],
            }),
          }),
        ),
      ),
    ),
  );

  assert.match(markup, /class="playlist-player-view"/);
  assert.match(markup, /youtube-nocookie\.com\/embed\/fNk_zzaMoSs/);
  assert.match(markup, /2 of 2/);
  assert.doesNotMatch(markup, /autoplay=1/);
});

test("renders a responsive video grid of playable thumbnails with note links", () => {
  const videos = createPlaylistVideos([
    note,
    {
      ...note,
      id: "playlists/visual_math/linear_algebra",
      route: "/note/playlists/visual_math/linear_algebra",
      title: "Essence of linear algebra",
      excerpt: "https://youtu.be/fNk_zzaMoSs",
    },
  ]);
  const markup = renderPlaylist(
    createElement(PlaylistVideoGrid, { onPlay: () => {}, videos }),
  );

  assert.doesNotMatch(markup, /<iframe/);
  assert.match(markup, /data-library-layout="grid"/);
  assert.match(markup, /aria-label="Play But what is a neural network\?"/);
  assert.match(markup, /i\.ytimg\.com\/vi\/aircAruvnKk\/hqdefault\.jpg/);
  assert.match(markup, /href="\/note\/playlists\/visual_math\/neural_networks"/);
  assert.doesNotMatch(markup, /Watch on YouTube/);
  assert.equal(markup.match(/loading="lazy"/g)?.length, 2);
});

test("keeps generic video previews free of embedded player chrome", () => {
  const videos = createPlaylistVideos([{
    ...note,
    id: "embed_note",
    title: "An embedded video",
    excerpt: "https://video.example.com/view_video.php?viewkey=example_video_123",
  }]);
  const markup = renderPlaylist(
    createElement(PlaylistVideoGrid, { onPlay: () => {}, videos }),
  );

  assert.doesNotMatch(markup, /<iframe/);
  assert.match(markup, /class="playlist-video-placeholder"/);
  assert.doesNotMatch(markup, /video\.example\.com/);
  assert.match(markup, /class="playlist-card-play-button"/);
});

test("opens playlist view with the first video focused", () => {
  const videos = createPlaylistVideos([
    note,
    {
      ...note,
      id: "playlists/visual_math/linear_algebra",
      route: "/note/playlists/visual_math/linear_algebra",
      title: "Essence of linear algebra",
      excerpt: "https://youtu.be/fNk_zzaMoSs",
    },
  ]);
  const markup = renderPlaylist(
    createElement(PlaylistView, {
        videos,
      }),
  );

  assert.equal(markup.match(/<iframe/g)?.length, 1);
  assert.match(markup, /youtube-nocookie\.com\/embed\/aircAruvnKk/);
  assert.match(markup, /aria-label="Videos in this playlist"/);
  assert.match(markup, /aria-keyshortcuts="F"/);
  assert.match(markup, /data-playlist-fullscreen-target="true"/);
  assert.doesNotMatch(markup, /class="playlist-grid"/);
});

test("focuses the video chosen from the video grid", () => {
  const videos = createPlaylistVideos([
    note,
    {
      ...note,
      id: "playlists/visual_math/linear_algebra",
      route: "/note/playlists/visual_math/linear_algebra",
      title: "Essence of linear algebra",
      excerpt: "https://youtu.be/fNk_zzaMoSs",
    },
  ]);
  const markup = renderPlaylist(
    createElement(PlaylistView, {
        initialVideoId: videos[1].id,
        videos,
      }),
  );

  assert.match(markup, /youtube-nocookie\.com\/embed\/fNk_zzaMoSs/);
  assert.match(markup, /2 of 2/);
});

test("renders one focused player with an ordered playlist queue", () => {
  const videos = createPlaylistVideos([
    note,
    {
      ...note,
      id: "playlists/visual_math/linear_algebra",
      route: "/note/playlists/visual_math/linear_algebra",
      title: "Essence of linear algebra",
      excerpt: "https://youtu.be/fNk_zzaMoSs",
    },
  ]);
  const markup = renderPlaylist(
    createElement(PlaylistPlayer, {
        activeVideo: videos[0],
        onSelect: () => {},
        progressById: {
          [videos[1].id]: {
            completed: false,
            durationSeconds: 600,
            positionSeconds: 150,
            updatedAt: "2026-08-19T00:00:00.000Z",
          },
        },
        videos,
      }),
  );

  assert.equal(markup.match(/<iframe/g)?.length, 1);
  assert.match(markup, /class="media-default-skin media-default-skin--video playlist-videojs-skin"/);
  assert.match(markup, /youtube-nocookie\.com\/embed\/aircAruvnKk/);
  assert.doesNotMatch(markup, /autoplay=1/);
  assert.match(markup, /enablejsapi=1/);
  assert.match(markup, /aria-label="Media player"/);
  assert.match(markup, /aria-label="Seek"/);
  assert.match(markup, /aria-label="Videos in this playlist"/);
  assert.match(markup, /aria-current="true"/);
  assert.match(markup, /Continue Essence of linear algebra/);
  assert.match(markup, /1 of 2/);
  assert.doesNotMatch(markup, /class="playlist-now-playing"/);
  assert.doesNotMatch(markup, /aria-label="Previous video"/);
  assert.doesNotMatch(markup, /aria-label="Next video"/);
  assert.match(markup, /class="playlist-queue-actions"/);
  assert.doesNotMatch(markup, /All videos/);
  assert.match(markup, /class="playlist-queue-action"[^>]*>Note/);
  assert.match(markup, /role="switch"/);
  assert.doesNotMatch(markup, /Now playing ·/);
  assert.doesNotMatch(markup, /Continue at/);
  assert.doesNotMatch(markup, /· Video \d+/);
  assert.doesNotMatch(markup, /Watch on YouTube/);
});

test("renders generic embeds and native direct video playback", () => {
  const providerNotes = [
    {
      ...note,
      id: "embed_note",
      title: "An embedded video",
      excerpt: "https://player.example.com/video/76979871",
    },
    {
      ...note,
      id: "direct_note",
      title: "A direct video",
      excerpt: "https://cdn.example.com/video.webm?token=signed",
    },
  ];
  const videos = createPlaylistVideos(providerNotes);

  const embedMarkup = renderPlaylist(
    createElement(PlaylistPlayer, {
        activeVideo: videos[0],
        onSelect: () => {},
        videos,
      }),
  );
  assert.match(embedMarkup, /player\.example\.com\/video\/76979871/);
  assert.match(embedMarkup, /class="playlist-provider-player"/);
  assert.match(embedMarkup, /class="playlist-queue-entry"/);
  assert.doesNotMatch(embedMarkup, /class="playlist-thumbnail-embed"/);
  assert.match(embedMarkup, /class="playlist-video-placeholder"/);
  assert.match(
    embedMarkup,
    /sandbox="allow-same-origin allow-scripts allow-presentation"/,
  );
  assert.match(embedMarkup, />Video</);
  assert.doesNotMatch(embedMarkup, /Now playing ·/);

  const directMarkup = renderPlaylist(
    createElement(PlaylistPlayer, {
        activeVideo: videos[1],
        onSelect: () => {},
        videos,
      }),
  );
  assert.match(directMarkup, /<video playsinline=""/);
  assert.doesNotMatch(directMarkup, /<video autoplay=""/);
  assert.match(directMarkup, /class="media-default-skin media-default-skin--video playlist-videojs-skin"/);
  assert.match(directMarkup, /cdn\.example\.com\/video\.webm\?token=signed/);
  assert.doesNotMatch(directMarkup, /class="playlist-thumbnail-embed"/);
  assert.match(directMarkup, /class="playlist-video-placeholder"/);
});

test("keeps the active video visible when queue filtering has no matches", () => {
  const videos = createPlaylistVideos([
    note,
    {
      ...note,
      id: "playlists/visual_math/linear_algebra",
      title: "Essence of linear algebra",
      excerpt: "https://youtu.be/fNk_zzaMoSs",
    },
  ]);
  const markup = renderPlaylist(
    createElement(PlaylistPlayer, {
        activeVideo: videos[1],
        filterLabel: "calculus",
        filteredVideoIds: new Set(),
        onSelect: () => {},
        videos,
      }),
  );

  assert.match(markup, /The current video stays active/);
  assert.match(markup, /Essence of linear algebra, now playing/);
  assert.match(markup, /0 matching/);
});

test("renders the note alongside the still-mounted player", () => {
  const videos = createPlaylistVideos([note]);
  const markup = renderPlaylist(
    createElement(PlaylistPlayer, {
        activeVideo: videos[0],
        noteOpen: true,
        notes: [note],
        onSelect: () => {},
        videos,
      }),
  );

  assert.match(markup, /class="playlist-note-panel"/);
  assert.match(markup, /Playing alongside/);
  assert.match(markup, /Open full note/);
  assert.equal(markup.match(/<iframe/g)?.length, 1);
  assert.doesNotMatch(markup, /class="playlist-queue"/);
});

test("formats and evaluates persisted playback progress", () => {
  const progress = {
    completed: false,
    durationSeconds: 600,
    positionSeconds: 150,
    updatedAt: "2026-08-19T00:00:00.000Z",
  };

  assert.equal(formatVideoTime(65), "1:05");
  assert.equal(formatVideoTime(3_665), "1:01:05");
  assert.equal(playlistResumeTime(progress), 150);
  assert.equal(playlistProgressRatio(progress), 0.25);
  assert.equal(playlistResumeTime({ ...progress, completed: true }), 0);
});

test("moves focus through the playlist queue with arrow keys", () => {
  let focused = -1;
  const buttons = [0, 1, 2].map((index) => ({ focus: () => { focused = index; } }));
  let prevented = false;
  handlePlaylistQueueKeyDown({
    key: "ArrowDown",
    target: buttons[1],
    currentTarget: { querySelectorAll: () => buttons },
    preventDefault: () => { prevented = true; },
  });

  assert.equal(focused, 2);
  assert.equal(prevented, true);
});

test("toggles the playlist player fullscreen target", async () => {
  let requested = false;
  let exited = false;
  const target = {
    requestFullscreen: async () => { requested = true; },
  };
  const playerView = { querySelector: () => target };
  const fullscreenDocument = {
    exitFullscreen: async () => { exited = true; },
    fullscreenElement: null,
  };

  assert.equal(
    await togglePlaylistFullscreen(playerView, fullscreenDocument),
    true,
  );
  assert.equal(requested, true);

  fullscreenDocument.fullscreenElement = target;
  assert.equal(
    await togglePlaylistFullscreen(playerView, fullscreenDocument),
    true,
  );
  assert.equal(exited, true);
});

test("shows the Playlist toggle only when the folder makes it available", () => {
  const withoutPlaylist = renderToStaticMarkup(
    createElement(LibraryViewToggle, {
      value: "list",
      onChange: () => {},
    }),
  );
  const withPlaylist = renderToStaticMarkup(
    createElement(LibraryViewToggle, {
      playlistAvailable: true,
      value: "list",
      onChange: () => {},
    }),
  );

  assert.doesNotMatch(withoutPlaylist, /Playlist/);
  assert.match(withPlaylist, /Playlist/);
});
