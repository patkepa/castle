export interface PlaylistVideoProgress {
  completed: boolean;
  durationSeconds: number;
  positionSeconds: number;
  updatedAt: string;
}

export interface PlaylistFolderState {
  activeVideoId: string;
  autoplayNext: boolean;
}

interface PersistedPlaylistState {
  schemaVersion: 1;
  folders: Record<string, PlaylistFolderState>;
  videos: Record<string, PlaylistVideoProgress>;
}

const playlistStateStorageKey = "castle.playlists.v1";
const maximumProgressEntries = 500;

const emptyPlaylistState: PersistedPlaylistState = {
  schemaVersion: 1,
  folders: {},
  videos: {},
};

export function readPlaylistState(): PersistedPlaylistState {
  if (typeof window === "undefined") return emptyPlaylistState;

  try {
    const value: unknown = JSON.parse(
      window.localStorage.getItem(playlistStateStorageKey) ?? "null",
    );
    return parsePlaylistState(value);
  } catch {
    return emptyPlaylistState;
  }
}

export function readPlaylistFolderState(folderKey: string) {
  return readPlaylistState().folders[folderKey] ?? null;
}

export function readPlaylistProgress() {
  return readPlaylistState().videos;
}

export function savePlaylistFolderState(
  folderKey: string,
  update: Partial<PlaylistFolderState>,
) {
  const current = readPlaylistState();
  const previous = current.folders[folderKey] ?? {
    activeVideoId: "",
    autoplayNext: true,
  };
  writePlaylistState({
    ...current,
    folders: {
      ...current.folders,
      [folderKey]: { ...previous, ...update },
    },
  });
}

export function savePlaylistVideoProgress(
  videoId: string,
  progress: Omit<PlaylistVideoProgress, "updatedAt">,
) {
  const current = readPlaylistState();
  const videos = {
    ...current.videos,
    [videoId]: {
      ...progress,
      durationSeconds: finitePositive(progress.durationSeconds),
      positionSeconds: finitePositive(progress.positionSeconds),
      updatedAt: new Date().toISOString(),
    },
  };
  const entries = Object.entries(videos);
  const trimmedVideos = entries.length <= maximumProgressEntries
    ? videos
    : Object.fromEntries(
        entries
          .sort(([, left], [, right]) => right.updatedAt.localeCompare(left.updatedAt))
          .slice(0, maximumProgressEntries),
      );

  writePlaylistState({ ...current, videos: trimmedVideos });
  return trimmedVideos[videoId];
}

export function playlistResumeTime(progress?: PlaylistVideoProgress) {
  if (!progress || progress.completed || progress.positionSeconds < 5) return 0;
  if (
    progress.durationSeconds > 0 &&
    progress.positionSeconds >= progress.durationSeconds - 10
  ) {
    return 0;
  }
  return progress.positionSeconds;
}

export function playlistProgressRatio(progress?: PlaylistVideoProgress) {
  if (!progress) return 0;
  if (progress.completed) return 1;
  if (progress.durationSeconds <= 0) return 0;
  return Math.min(1, Math.max(0, progress.positionSeconds / progress.durationSeconds));
}

export function formatVideoTime(seconds: number) {
  const rounded = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(rounded / 3_600);
  const minutes = Math.floor((rounded % 3_600) / 60);
  const remainingSeconds = rounded % 60;

  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`
    : `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function writePlaylistState(state: PersistedPlaylistState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(playlistStateStorageKey, JSON.stringify(state));
  } catch {
    // Web storage is a best-effort convenience; playback remains functional without it.
  }
}

function parsePlaylistState(value: unknown): PersistedPlaylistState {
  if (!isRecord(value) || value.schemaVersion !== 1) return emptyPlaylistState;

  const folders = isRecord(value.folders)
    ? Object.fromEntries(
        Object.entries(value.folders).flatMap(([key, folder]) => {
          if (
            !isRecord(folder) ||
            typeof folder.activeVideoId !== "string" ||
            typeof folder.autoplayNext !== "boolean"
          ) {
            return [];
          }
          return [[key, {
            activeVideoId: folder.activeVideoId,
            autoplayNext: folder.autoplayNext,
          }]];
        }),
      )
    : {};
  const videos = isRecord(value.videos)
    ? Object.fromEntries(
        Object.entries(value.videos).flatMap(([key, progress]) => {
          if (
            !isRecord(progress) ||
            typeof progress.completed !== "boolean" ||
            typeof progress.durationSeconds !== "number" ||
            typeof progress.positionSeconds !== "number" ||
            typeof progress.updatedAt !== "string"
          ) {
            return [];
          }
          return [[key, {
            completed: progress.completed,
            durationSeconds: finitePositive(progress.durationSeconds),
            positionSeconds: finitePositive(progress.positionSeconds),
            updatedAt: progress.updatedAt,
          }]];
        }),
      )
    : {};

  return { schemaVersion: 1, folders, videos };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finitePositive(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}
