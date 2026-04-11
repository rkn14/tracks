/** IPC channel names – single source of truth for main ↔ renderer communication. */
export const IpcChannel = {
  APP_GET_VERSION: "app:get-version",

  WINDOW_MINIMIZE: "window:minimize",
  WINDOW_MAXIMIZE: "window:maximize",
  WINDOW_CLOSE: "window:close",

  FS_LIST_VOLUMES: "fs:list-volumes",
  FS_READ_DIRECTORY: "fs:read-directory",
  FS_RENAME: "fs:rename",
  FS_MOVE: "fs:move",
  FS_DELETE: "fs:delete",
  FS_SHOW_IN_EXPLORER: "fs:show-in-explorer",
  FS_GET_HOME: "fs:get-home",
  FS_LIST_CONVERTIBLE: "fs:list-convertible",

  AUDIO_GET_METADATA: "audio:get-metadata",
  AUDIO_READ_FILE: "audio:read-file",
  AUDIO_CONVERT_FILE: "audio:convert-file",
  AUDIO_CONVERT_PROGRESS: "audio:convert-progress",

  STORE_GET: "store:get",
  STORE_SET: "store:set",
} as const;

export type IpcChannelValue =
  (typeof IpcChannel)[keyof typeof IpcChannel];

// ── File system ────────────────────────────────

export interface Volume {
  name: string;
  path: string;
  label: string;
  sizeBytes?: number;
  freeBytes?: number;
}

export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modifiedAt: number;
  extension: string;
}

export const AUDIO_EXTENSIONS = [
  ".mp3",
  ".wav",
  ".aiff",
  ".aif",
  ".flac",
  ".ogg",
] as const;

export type AudioExtension = (typeof AUDIO_EXTENSIONS)[number];

// ── Audio metadata ─────────────────────────────

export interface AudioMetadata {
  title?: string;
  artist?: string;
  album?: string;
  genre?: string;
  year?: number;
  label?: string;
  bpm?: number;
  duration?: number;
  cover?: string;
  format?: string;
  bitrate?: number;
  sampleRate?: number;
  bitsPerSample?: number;
  channels?: number;
  lossless?: boolean;
}

// ── Conversion ──────────────────────────────────

export interface ConvertProgress {
  current: number;
  total: number;
  fileName: string;
}

export interface ConvertFileResult {
  ok: boolean;
  sourcePath: string;
  destPath: string;
  error?: string;
}

// ── Persistence ────────────────────────────────

export interface PanelState {
  currentPath: string;
}

export interface AppState {
  leftPanel: PanelState;
  rightPanel: PanelState;
  playerVolume: number;
}

// ── Preload API ────────────────────────────────

export interface ElectronApi {
  getAppVersion: () => Promise<string>;

  window: {
    minimize: () => void;
    maximize: () => void;
    close: () => void;
  };

  fs: {
    listVolumes: () => Promise<Volume[]>;
    readDirectory: (dirPath: string) => Promise<FileEntry[]>;
    rename: (oldPath: string, newPath: string) => Promise<void>;
    move: (srcPath: string, destDir: string) => Promise<string>;
    delete: (targetPath: string) => Promise<void>;
    showInExplorer: (targetPath: string) => void;
    getHome: () => Promise<string>;
    listConvertible: (dirPath: string) => Promise<{ name: string; path: string }[]>;
  };

  audio: {
    getMetadata: (filePath: string) => Promise<AudioMetadata>;
    readFile: (filePath: string) => Promise<ArrayBuffer>;
    convertFile: (filePath: string) => Promise<ConvertFileResult>;
    onConvertProgress: (
      cb: (progress: ConvertProgress) => void,
    ) => () => void;
  };

  store: {
    get: <T>(key: string) => Promise<T | undefined>;
    set: (key: string, value: unknown) => Promise<void>;
  };
}
