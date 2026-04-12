export const APP_NAME = "Tracks";

export const DEFAULT_WINDOW_CONFIG = {
  width: 1280,
  height: 860,
  minWidth: 900,
  minHeight: 600,
} as const;

export const PLAYER_HEIGHT = 340;

export const STORE_KEYS = {
  LEFT_PANEL: "leftPanel",
  RIGHT_PANEL: "rightPanel",
  PLAYER_VOLUME: "playerVolume",
  OPENAI_API_KEY: "openaiApiKey",
  GENRE_PROMPT: "genrePrompt",
  LIBRARY_FOLDER: "libraryFolder",
} as const;
