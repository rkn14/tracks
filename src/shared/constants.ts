export const APP_NAME = "Tracks";

export const DEFAULT_WINDOW_CONFIG = {
  width: 1280,
  height: 860,
  minWidth: 900,
  minHeight: 600,
} as const;

export const PLAYER_HEIGHT = 340;

/** ID3 TXXX description for JSON profile scores (0–100), default 50 per axis. */
export const TRACKS_PROFILE_TXXX_DESCRIPTION = "tracks.app/profileScores";

export const STORE_KEYS = {
  LEFT_PANEL: "leftPanel",
  RIGHT_PANEL: "rightPanel",
  PLAYER_VOLUME: "playerVolume",
  OPENAI_API_KEY: "openaiApiKey",
  GENRE_PROMPT: "genrePrompt",
  LIBRARY_FOLDER: "libraryFolder",
} as const;
