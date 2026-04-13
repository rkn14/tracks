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
  FS_LIST_MP3: "fs:list-mp3",
  FS_GET_ALL_GENRES: "fs:get-all-genres",
  FS_MKDIR: "fs:mkdir",
  FS_COPY: "fs:copy",
  FS_EXISTS: "fs:exists",

  AUDIO_GET_METADATA: "audio:get-metadata",
  AUDIO_READ_FILE: "audio:read-file",
  AUDIO_CONVERT_FILE: "audio:convert-file",
  AUDIO_CONVERT_PROGRESS: "audio:convert-progress",
  AUDIO_WRITE_GENRES: "audio:write-genres",
  AUDIO_WRITE_METADATA: "audio:write-metadata",
  AUDIO_WRITE_PROFILE_SCORES: "audio:write-profile-scores",
  AUDIO_ESSENTIA_EXTRACT: "audio:essentia-extract",

  DIALOG_SELECT_FOLDER: "dialog:select-folder",

  AI_FETCH_GENRES: "ai:fetch-genres",

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

/** Stored in ID3 TXXX `tracks.app/profileScores` as JSON. All values 0–100, default 50. */
export interface ProfileScores {
  global: number;
  energy: number;
  quantizedGroovy: number;
  melodicRhythmic: number;
  darkLight: number;
  softHard: number;
}

/** Analyse locale (Essentia), stockée dans le même TXXX que les scores, clé `essentia`. */
export interface EssentiaAnalysis {
  bpm?: number;
  /** Tonalité en anglais, ex. « C major », « A minor ». */
  key?: string;
}

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
  profileScores?: ProfileScores;
  /** Données Essentia persistées dans le TXXX custom (pas les tags BPM/key ID3). */
  essentiaAnalysis?: EssentiaAnalysis;
}

export interface WritableMetadata {
  title?: string;
  artist?: string;
  album?: string;
  genre?: string;
  year?: number;
  label?: string;
  bpm?: number;
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

// ── AI ──────────────────────────────────────────

export interface AIGenreResult {
  genres: string[];
  certaintyPercentage: number;
  comment: string;
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
    listMp3: (dirPath: string) => Promise<{ name: string; path: string }[]>;
    getAllGenres: (dirPath: string) => Promise<string[]>;
    mkdir: (dirPath: string) => Promise<void>;
    copy: (srcPath: string, destDir: string) => Promise<string>;
    exists: (targetPath: string) => Promise<boolean>;
  };

  audio: {
    getMetadata: (filePath: string) => Promise<AudioMetadata>;
    readFile: (filePath: string) => Promise<ArrayBuffer>;
    convertFile: (filePath: string) => Promise<ConvertFileResult>;
    onConvertProgress: (
      cb: (progress: ConvertProgress) => void,
    ) => () => void;
    writeGenres: (dirPath: string, genres: string[]) => Promise<number>;
    writeMetadata: (filePath: string, meta: WritableMetadata) => Promise<void>;
    writeProfileScores: (
      filePath: string,
      scores: ProfileScores,
      essentia?: EssentiaAnalysis,
    ) => Promise<void>;
    extractEssentia: (
      filePath: string,
    ) => Promise<Required<Pick<EssentiaAnalysis, "bpm" | "key">>>;
    fetchGenres: (prompt: string, apiKey: string) => Promise<AIGenreResult>;
  };

  dialog: {
    selectFolder: (title?: string) => Promise<string | null>;
  };

  store: {
    get: <T>(key: string) => Promise<T | undefined>;
    set: (key: string, value: unknown) => Promise<void>;
  };
}
