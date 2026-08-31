import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Icon } from "@patkepa/kantzen-ui/primitives";
import {
  selectError,
  selectPlayback,
  selectSource,
  selectTime,
} from "@videojs/react";
import { YouTubeVideo } from "@videojs/react/media/youtube-video";
import {
  Video,
  VideoPlayer as VideoJsPlayer,
  VideoSkin,
  usePlayer,
} from "@videojs/react/video";
import { Link } from "react-router-dom";
import { LibraryBrowser } from "../../components/library_browser";
import { NoteMarkdown } from "../../components/NoteMarkdown";
import { shortcutCatalog } from "../../keyboard/shortcut_catalog";
import {
  useGeneratedResource,
  validateNoteContent,
} from "../../lib/generatedData";
import type { CastlePlatform } from "../../platform/castle_platform";
import { useCastlePlatform } from "../../platform/castle_platform_provider";
import type { Note } from "../../types";
import { ContextMenuTarget } from "../context_menu/CastleContextMenu";
import { createNoteContextMenu } from "../context_menu/context_menu_models";
import { handlePlaylistQueueKeyDown } from "./playlist_keyboard_navigation";
import { usePlaylistPageKeyboardNavigation } from "./playlist_page_keyboard_navigation";
import type { PlaylistVideo } from "./playlistPresentation";
import { playableVideoLabel, youtubeEmbedUrl } from "./playlistPresentation";
import {
  formatVideoTime,
  playlistProgressRatio,
  playlistResumeTime,
  readPlaylistFolderState,
  readPlaylistProgress,
  savePlaylistFolderState,
  savePlaylistVideoProgress,
  type PlaylistVideoProgress,
} from "./playlistState";

const emptyProgress: Record<string, PlaylistVideoProgress> = {};
const noop = () => {};
const videoPosterRequests = new Map<string, Promise<string | null>>();

function youtubeThumbnailUrl(videoId: string) {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

function requestVideoPoster(platform: CastlePlatform, sourceUrl: string) {
  let request = videoPosterRequests.get(sourceUrl);
  if (!request) {
    request = platform.mediaPreviews.resolveVideoPoster(sourceUrl).catch(() => null);
    videoPosterRequests.set(sourceUrl, request);
  }
  return request;
}

function VideoPlayer({
  autoPlay,
  onEnded,
  onProgress,
  resumeAt,
  video,
}: {
  autoPlay: boolean;
  onEnded: () => void;
  onProgress: (positionSeconds: number, durationSeconds: number) => void;
  resumeAt: number;
  video: PlaylistVideo;
}) {
  const { source } = video;
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const mediaAutoPlay = autoPlay && resumeAt === 0;
  const retry = () => {
    setError("");
    setReady(false);
    setAttempt((current) => current + 1);
  };
  const status = (
    <PlayerStatus
      error={error}
      ready={ready}
      onRetry={retry}
      sourceUrl={source.url}
    />
  );

  if (source.kind === "youtube") {
    return (
      <div className="playlist-player-frame playlist-videojs-player">
        <VideoJsPlayer key={attempt} contentTitle={video.note.title}>
          <VideoSkin
            className="playlist-videojs-skin"
            data-playlist-fullscreen-target="true"
          >
            <YouTubeVideo
              autoplay={mediaAutoPlay}
              playsInline
              source={{
                src: youtubeEmbedUrl(source.videoId),
                engine: {
                  youtube: {
                    referrerPolicy: "strict-origin-when-cross-origin",
                  },
                },
              }}
            />
          </VideoSkin>
          <PlaylistMediaBridge
            autoPlay={autoPlay}
            onEnded={onEnded}
            onError={setError}
            onProgress={onProgress}
            onReady={() => setReady(true)}
            resumeAt={resumeAt}
          />
        </VideoJsPlayer>
        {status}
      </div>
    );
  }

  if (source.kind === "file") {
    return (
      <div className="playlist-player-frame playlist-videojs-player">
        <VideoJsPlayer key={attempt} contentTitle={video.note.title}>
          <VideoSkin
            className="playlist-videojs-skin"
            data-playlist-fullscreen-target="true"
          >
            <Video
              autoPlay={mediaAutoPlay}
              playsInline
              preload="metadata"
              src={source.url}
              title={`${video.note.title} — direct video`}
            />
          </VideoSkin>
          <PlaylistMediaBridge
            autoPlay={autoPlay}
            onEnded={onEnded}
            onError={setError}
            onProgress={onProgress}
            onReady={() => setReady(true)}
            resumeAt={resumeAt}
          />
        </VideoJsPlayer>
        {status}
      </div>
    );
  }

  return (
    <div className="playlist-player-frame" data-playlist-fullscreen-target="true">
      <iframe
        key={attempt}
        allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
        allowFullScreen
        className="playlist-provider-player"
        onError={() => setError("This embedded video could not be loaded.")}
        onLoad={() => setReady(true)}
        referrerPolicy="strict-origin-when-cross-origin"
        sandbox="allow-same-origin allow-scripts allow-presentation"
        src={source.embedUrl}
        title={`${video.note.title} — ${playableVideoLabel(source)} video`}
      />
      {status}
    </div>
  );
}

function PlaylistMediaBridge({
  autoPlay,
  onEnded,
  onError,
  onProgress,
  onReady,
  resumeAt,
}: {
  autoPlay: boolean;
  onEnded: () => void;
  onError: (message: string) => void;
  onProgress: (positionSeconds: number, durationSeconds: number) => void;
  onReady: () => void;
  resumeAt: number;
}) {
  const store = usePlayer();
  const source = usePlayer((state) => selectSource(state as object));
  const time = usePlayer((state) => selectTime(state as object));
  const playback = usePlayer((state) => selectPlayback(state as object));
  const error = usePlayer((state) => selectError(state as object));
  const media = {
    canPlay: source?.canPlay ?? false,
    currentTime: time?.currentTime ?? 0,
    duration: time?.duration ?? 0,
    ended: playback?.ended ?? false,
    error: error?.error ?? null,
  };
  const restored = useRef(false);
  const endedHandled = useRef(false);

  useEffect(() => {
    if (media.canPlay || media.duration > 0) onReady();
  }, [media.canPlay, media.duration, onReady]);

  useEffect(() => {
    if (restored.current || resumeAt <= 0 || (!media.canPlay && media.duration <= 0)) {
      return;
    }
    restored.current = true;
    void store.seek(resumeAt).then(() => {
      if (autoPlay) void store.play();
    });
  }, [autoPlay, media.canPlay, media.duration, resumeAt, store]);

  useEffect(() => {
    if (media.currentTime > 0 || media.duration > 0) {
      onProgress(media.currentTime, media.duration);
    }
  }, [media.currentTime, media.duration, onProgress]);

  useEffect(() => {
    if (!media.ended) {
      endedHandled.current = false;
      return;
    }
    if (endedHandled.current) return;
    endedHandled.current = true;
    onEnded();
  }, [media.ended, onEnded]);

  useEffect(() => {
    if (!media.error) return;
    onError(media.error.message || "This video could not be played.");
  }, [media.error, onError]);

  return null;
}

function PlayerStatus({
  error,
  onRetry,
  ready,
  sourceUrl,
}: {
  error: string;
  onRetry: () => void;
  ready: boolean;
  sourceUrl: string;
}) {
  if (ready && !error) return null;
  return (
    <div
      className={`playlist-player-status${error ? " playlist-player-status--error" : ""}`}
      role={error ? "alert" : "status"}
    >
      <Icon icon={error ? "warning-sign" : "refresh"} size={22} aria-hidden="true" />
      <p>{error || "Loading video…"}</p>
      {error ? (
        <div>
          <button type="button" onClick={onRetry}>Try again</button>
          <a href={sourceUrl} rel="noreferrer" target="_blank">Open source</a>
        </div>
      ) : null}
    </div>
  );
}

function PlaylistThumbnail({ video }: { video: PlaylistVideo }) {
  const platform = useCastlePlatform();
  const sourceUrl = video.source.url;
  const shouldResolvePoster = video.source.kind === "embed";
  const [posterUrl, setPosterUrl] = useState("");

  useEffect(() => {
    if (!shouldResolvePoster) return;
    let active = true;
    void requestVideoPoster(platform, sourceUrl).then((resolvedUrl) => {
      if (active && resolvedUrl) setPosterUrl(resolvedUrl);
    });
    return () => {
      active = false;
    };
  }, [platform, shouldResolvePoster, sourceUrl]);

  if (video.source.kind === "youtube") {
    return (
      <img alt="" loading="lazy" src={youtubeThumbnailUrl(video.source.videoId)} />
    );
  }
  if (posterUrl) {
    return (
      <img
        alt=""
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
        src={posterUrl}
      />
    );
  }
  return (
    <span aria-hidden="true" className="playlist-video-placeholder">
      <Icon icon="video" size={24} aria-hidden="true" />
    </span>
  );
}

function VideoProgressIndicator({ progress }: { progress?: PlaylistVideoProgress }) {
  const ratio = playlistProgressRatio(progress);
  if (ratio <= 0) return null;
  return (
    <span
      aria-hidden="true"
      className="playlist-progress-track"
      style={{ "--playlist-progress": ratio } as CSSProperties}
    >
      <span />
    </span>
  );
}

export function PlaylistView({
  collectionKey = "playlist",
  collectionTitle = "Playlist",
  filterLabel = "",
  filteredVideoIds,
  initialAutoPlay = false,
  initialVideoId,
  notes,
  onActiveVideoChange = noop,
  onInitialAutoPlayConsumed = noop,
  videos,
}: {
  collectionKey?: string;
  collectionTitle?: string;
  filterLabel?: string;
  filteredVideoIds?: ReadonlySet<string>;
  initialAutoPlay?: boolean;
  initialVideoId?: string;
  notes?: readonly Note[];
  onActiveVideoChange?: (videoId: string) => void;
  onInitialAutoPlayConsumed?: () => void;
  videos: readonly PlaylistVideo[];
}) {
  const persistedFolder = useMemo(
    () => readPlaylistFolderState(collectionKey),
    [collectionKey],
  );
  const [activeVideoId, setActiveVideoId] = useState(
    () => initialVideoId ?? persistedFolder?.activeVideoId ?? videos[0]?.id ?? null,
  );
  const [autoPlay, setAutoPlay] = useState(initialAutoPlay);
  const [autoplayNext, setAutoplayNext] = useState(
    () => persistedFolder?.autoplayNext ?? true,
  );
  const [noteOpen, setNoteOpen] = useState(false);
  const [progressById, setProgressById] = useState(() => readPlaylistProgress());
  const progressRef = useRef(progressById);
  const lastPersistedSecond = useRef(new Map<string, number>());
  const activeVideo =
    videos.find((video) => video.id === activeVideoId) ?? videos[0] ?? null;

  useEffect(() => {
    if (initialAutoPlay) onInitialAutoPlayConsumed();
  }, [initialAutoPlay, onInitialAutoPlayConsumed]);

  useEffect(() => {
    if (!initialVideoId || !videos.some((video) => video.id === initialVideoId)) return;
    setActiveVideoId(initialVideoId);
  }, [initialVideoId, videos]);

  useEffect(() => {
    if (!activeVideo) return;
    savePlaylistFolderState(collectionKey, { activeVideoId: activeVideo.id });
    onActiveVideoChange(activeVideo.id);
  }, [activeVideo, collectionKey, onActiveVideoChange]);

  const selectVideo = useCallback((videoId: string, shouldAutoPlay = true) => {
    setAutoPlay(shouldAutoPlay);
    setActiveVideoId(videoId);
    const escapedId = typeof CSS === "undefined" ? videoId : CSS.escape(videoId);
    document.querySelector<HTMLElement>(`.playlist-queue-item[data-video-id="${escapedId}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, []);

  const recordProgress = useCallback((
    videoId: string,
    positionSeconds: number,
    durationSeconds: number,
    completed = false,
  ) => {
    const roundedPosition = Math.max(0, Math.floor(positionSeconds));
    const roundedDuration = Math.max(0, Math.floor(durationSeconds));
    const derivedCompleted = completed || (
      roundedDuration > 0 && roundedPosition / roundedDuration >= 0.95
    );
    const next = {
      completed: derivedCompleted,
      durationSeconds: roundedDuration,
      positionSeconds: derivedCompleted ? roundedDuration : roundedPosition,
      updatedAt: new Date().toISOString(),
    };
    const previous = progressRef.current[videoId];
    if (
      previous?.completed === next.completed &&
      previous?.durationSeconds === next.durationSeconds &&
      previous?.positionSeconds === next.positionSeconds
    ) return;

    progressRef.current = { ...progressRef.current, [videoId]: next };
    setProgressById(progressRef.current);
    const lastSaved = lastPersistedSecond.current.get(videoId) ?? -10;
    if (derivedCompleted || Math.abs(roundedPosition - lastSaved) >= 5) {
      savePlaylistVideoProgress(videoId, next);
      lastPersistedSecond.current.set(videoId, roundedPosition);
    }
  }, []);

  const handleEnded = useCallback(() => {
    if (!activeVideo) return;
    const current = progressRef.current[activeVideo.id];
    recordProgress(
      activeVideo.id,
      current?.durationSeconds ?? 0,
      current?.durationSeconds ?? 0,
      true,
    );
    const activeIndex = videos.findIndex((video) => video.id === activeVideo.id);
    const nextVideo = videos[activeIndex + 1];
    if (autoplayNext && nextVideo) selectVideo(nextVideo.id, true);
  }, [activeVideo, autoplayNext, recordProgress, selectVideo, videos]);

  const toggleAutoplayNext = () => {
    setAutoplayNext((current) => {
      const next = !current;
      savePlaylistFolderState(collectionKey, { autoplayNext: next });
      return next;
    });
  };

  if (!activeVideo) return null;

  return (
    <PlaylistPlayer
      activeVideo={activeVideo}
      autoPlay={autoPlay}
      autoplayNext={autoplayNext}
      collectionTitle={collectionTitle}
      filterLabel={filterLabel}
      filteredVideoIds={filteredVideoIds}
      noteOpen={noteOpen}
      notes={notes ?? videos.map((video) => video.note)}
      onEnded={handleEnded}
      onOpenNote={() => setNoteOpen(true)}
      onCloseNote={() => setNoteOpen(false)}
      onProgress={(position, duration) =>
        recordProgress(activeVideo.id, position, duration)}
      onSelect={selectVideo}
      onToggleAutoplayNext={toggleAutoplayNext}
      progressById={progressById}
      videos={videos}
    />
  );
}

export function PlaylistVideoGrid({
  onPlay,
  videos,
}: {
  onPlay: (videoId: string) => void;
  videos: readonly PlaylistVideo[];
}) {
  const [progressById] = useState(() => readPlaylistProgress());
  return (
    <LibraryBrowser className="playlist-grid" viewMode="grid">
      {videos.map((video) => {
        const progress = progressById[video.id];
        const resumeAt = playlistResumeTime(progress);
        return (
          <ContextMenuTarget key={video.id} menu={createNoteContextMenu(video.note)}>
            <article className="playlist-card">
              <div className="playlist-card-player">
                <PlaylistThumbnail video={video} />
                <button
                  aria-label={`${resumeAt > 0 ? "Continue" : "Play"} ${video.note.title}`}
                  className="playlist-card-play-button"
                  onClick={() => onPlay(video.id)}
                  type="button"
                >
                  <span className="playlist-card-play" aria-hidden="true">
                    <Icon icon="play" size={18} />
                  </span>
                </button>
                {progress?.durationSeconds ? (
                  <span className="playlist-duration-badge">
                    {formatVideoTime(progress.durationSeconds)}
                  </span>
                ) : null}
                <VideoProgressIndicator progress={progress} />
              </div>
              <footer className="playlist-card-footer">
                <Link
                  aria-keyshortcuts="Space"
                  className="playlist-card-note"
                  data-library-item="true"
                  to={video.note.route}
                >
                  <span>{video.note.title}</span>
                  <small>
                    {progress?.completed
                      ? "Watched · Open note"
                      : "Open note"}
                  </small>
                </Link>
              </footer>
            </article>
          </ContextMenuTarget>
        );
      })}
    </LibraryBrowser>
  );
}

export function PlaylistPlayer({
  activeVideo,
  autoPlay = false,
  autoplayNext = true,
  collectionTitle = "Playlist",
  filterLabel = "",
  filteredVideoIds,
  noteOpen = false,
  notes = [],
  onCloseNote = noop,
  onEnded = noop,
  onOpenNote = noop,
  onProgress = noop,
  onSelect,
  onToggleAutoplayNext = noop,
  progressById = emptyProgress,
  videos,
}: {
  activeVideo: PlaylistVideo;
  autoPlay?: boolean;
  autoplayNext?: boolean;
  collectionTitle?: string;
  filterLabel?: string;
  filteredVideoIds?: ReadonlySet<string>;
  noteOpen?: boolean;
  notes?: readonly Note[];
  onCloseNote?: () => void;
  onEnded?: () => void;
  onOpenNote?: () => void;
  onProgress?: (positionSeconds: number, durationSeconds: number) => void;
  onSelect: (videoId: string, autoPlay?: boolean) => void;
  onToggleAutoplayNext?: () => void;
  progressById?: Record<string, PlaylistVideoProgress>;
  videos: readonly PlaylistVideo[];
}) {
  const playerViewRef = useRef<HTMLElement>(null);
  const activeIndex = videos.findIndex((video) => video.id === activeVideo.id);
  const activeProgress = progressById[activeVideo.id];
  const resumeAt = playlistResumeTime(activeProgress);
  const filteredVideos = filteredVideoIds
    ? videos.filter((video) => filteredVideoIds.has(video.id))
    : videos;
  const queueVideos = filteredVideos.some((video) => video.id === activeVideo.id)
    ? filteredVideos
    : [activeVideo, ...filteredVideos];
  const knownRemainingSeconds = videos
    .slice(activeIndex + 1)
    .reduce((total, video) => total + (progressById[video.id]?.durationSeconds ?? 0), 0);
  usePlaylistPageKeyboardNavigation({ playerViewRef });

  return (
    <section
      ref={playerViewRef}
      aria-keyshortcuts={shortcutCatalog.playlistFullscreen.ariaKeyShortcuts}
      className="playlist-player-view"
      aria-label="Playlist player"
      data-note-open={noteOpen || undefined}
    >
      <div className="playlist-player-stage">
        <VideoPlayer
          key={activeVideo.id}
          autoPlay={autoPlay}
          onEnded={onEnded}
          onProgress={onProgress}
          resumeAt={resumeAt}
          video={activeVideo}
        />
      </div>

      {noteOpen ? (
        <PlaylistNotePanel note={activeVideo.note} notes={notes} onClose={onCloseNote} />
      ) : (
        <aside className="playlist-queue" aria-label="Videos in this playlist">
          <header className="playlist-queue-header">
            <div>
              <span>{filteredVideoIds ? "Filtered queue" : "Up next"}</span>
              <h2>{collectionTitle}</h2>
              {knownRemainingSeconds > 0 ? (
                <p>{formatVideoTime(knownRemainingSeconds)} remaining</p>
              ) : null}
            </div>
            <span>
              {activeIndex + 1} of {videos.length}
              {filteredVideoIds ? ` · ${filteredVideos.length} matching` : ""}
            </span>
          </header>
          {filteredVideoIds && filteredVideos.length === 0 ? (
            <p className="playlist-queue-filter-note">
              No queue items match “{filterLabel}”. The current video stays active.
            </p>
          ) : null}
          <div className="playlist-queue-list" onKeyDown={handlePlaylistQueueKeyDown}>
            {queueVideos.map((video) => {
              const isActive = video.id === activeVideo.id;
              const progress = progressById[video.id];
              const continueAt = playlistResumeTime(progress);
              return (
                <ContextMenuTarget key={video.id} menu={createNoteContextMenu(video.note)}>
                  <div className="playlist-queue-entry">
                    <span className="playlist-queue-thumbnail">
                      <PlaylistThumbnail video={video} />
                      {isActive ? (
                        <span className="playlist-queue-playing" aria-hidden="true">
                          <Icon icon="play" size={12} />
                        </span>
                      ) : null}
                      {progress?.durationSeconds ? (
                        <span className="playlist-duration-badge">
                          {formatVideoTime(progress.durationSeconds)}
                        </span>
                      ) : null}
                      <VideoProgressIndicator progress={progress} />
                    </span>
                    <button
                      aria-current={isActive ? "true" : undefined}
                      aria-label={
                        isActive
                          ? `${video.note.title}, now playing`
                          : `${continueAt > 0 ? "Continue" : "Play"} ${video.note.title}`
                      }
                      className="playlist-queue-item"
                      data-video-id={video.id}
                      onClick={() => onSelect(video.id, true)}
                      type="button"
                    >
                      <span className="playlist-queue-copy">
                        <strong>{video.note.title}</strong>
                        <small>
                          {progress?.completed
                            ? "Watched"
                            : playableVideoLabel(video.source)}
                        </small>
                      </span>
                    </button>
                  </div>
                </ContextMenuTarget>
              );
            })}
          </div>
          <div className="playlist-queue-preferences">
            <button
              aria-checked={autoplayNext}
              onClick={onToggleAutoplayNext}
              role="switch"
              type="button"
            >
              <Icon icon="repeat" size={14} aria-hidden="true" />
              <span>Auto-play next</span>
              <strong>{autoplayNext ? "On" : "Off"}</strong>
            </button>
          </div>
          <footer className="playlist-queue-actions">
            <button className="playlist-queue-action" onClick={onOpenNote} type="button">
              Note
              <Icon icon="document" size={12} aria-hidden="true" />
            </button>
            <a
              className="playlist-queue-action"
              href={activeVideo.source.url}
              rel="noreferrer"
              target="_blank"
            >
              Source
              <Icon icon="share" size={12} aria-hidden="true" />
            </a>
          </footer>
        </aside>
      )}
      <p className="sr-only" aria-live="polite">
        Now playing {activeVideo.note.title}, video {activeIndex + 1} of {videos.length}.
      </p>
    </section>
  );
}

function PlaylistNotePanel({
  note,
  notes,
  onClose,
}: {
  note: Note;
  notes: readonly Note[];
  onClose: () => void;
}) {
  const { data, error, loading, reload } = useGeneratedResource(
    note.contentPath,
    validateNoteContent,
    "Playlist note",
  );

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <aside className="playlist-note-panel" aria-label={`Note: ${note.title}`}>
      <header>
        <div>
          <span>Playing alongside</span>
          <h2>{note.title}</h2>
        </div>
        <button aria-label="Close note" onClick={onClose} type="button">
          <Icon icon="small-cross" size={16} aria-hidden="true" />
        </button>
      </header>
      <div className="playlist-note-content">
        {loading ? (
          <div className="playlist-note-status" role="status">
            <Icon icon="refresh" size={18} aria-hidden="true" />
            <p>Loading note…</p>
          </div>
        ) : error ? (
          <div className="playlist-note-status" role="alert">
            <Icon icon="warning-sign" size={18} aria-hidden="true" />
            <p>The note could not be loaded.</p>
            <button onClick={reload} type="button">Try again</button>
          </div>
        ) : data?.content ? (
          <NoteMarkdown
            content={data.content}
            headings={data.headings}
            note={note}
            notes={notes}
          />
        ) : (
          <div className="playlist-note-status">
            <Icon icon="document" size={18} aria-hidden="true" />
            <p>This note does not have any body content yet.</p>
          </div>
        )}
      </div>
      <footer><Link to={note.route}>Open full note</Link></footer>
    </aside>
  );
}
