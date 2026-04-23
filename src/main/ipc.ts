import { BrowserWindow, type IpcMain, app, dialog } from "electron";
import fs from "fs/promises";
import {
  IpcChannel,
  type DjAddChildPlaylistParams,
  type DjAddLibraryFilesToPlaylistParams,
  type DjAddTrackToPlaylistParams,
  type DjRemoveTrackFromPlaylistParams,
  type DjReorderPlaylistTracksParams,
  type EssentiaAnalysis,
  type ProfileScores,
} from "@shared/types";
import {
  listVolumes,
  readDirectory,
  rename,
  move,
  deleteEntry,
  showInExplorer,
  getHome,
  listConvertible,
  listMp3,
  listFolderAudio,
  getAllGenres,
  mkdir,
  copyEntry,
  exists,
} from "./services/filesystem";
import { getAudioMetadata } from "./services/audio-metadata";
import { convertFileToMp3 } from "./services/convert";
import { writeGenresToMp3s, writeMetadata } from "./services/tag-writer";
import { writeProfileScores } from "./services/profile-scores";
import { extractEssentiaFromFile } from "./services/essentia-extractor";
import { fetchGenresFromAI } from "./services/ai";
import { storeGet, storeSet } from "./services/store";
import {
  djDbAddChildPlaylist,
  djDbAddLibraryFilesToPlaylist,
  djDbAddTrackToPlaylist,
  djDbConnectFromStore,
  djDbGetPlaylistTracks,
  djDbGetPlaylistTree,
  djDbRemoveTrackFromPlaylist,
  djDbReorderPlaylistTracks,
} from "./services/engine-dj-db";

export function registerIpcHandlers(ipcMain: IpcMain): void {
  // ── Window ───────────────────────────────────
  ipcMain.handle(IpcChannel.APP_GET_VERSION, () => app.getVersion());

  ipcMain.on(IpcChannel.WINDOW_MINIMIZE, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  ipcMain.on(IpcChannel.WINDOW_MAXIMIZE, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win?.isMaximized()) win.unmaximize();
    else win?.maximize();
  });

  ipcMain.on(IpcChannel.WINDOW_CLOSE, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  // ── File system ──────────────────────────────
  ipcMain.handle(IpcChannel.FS_LIST_VOLUMES, () => listVolumes());

  ipcMain.handle(IpcChannel.FS_READ_DIRECTORY, (_, dirPath: string) =>
    readDirectory(dirPath),
  );

  ipcMain.handle(
    IpcChannel.FS_RENAME,
    (_, oldPath: string, newName: string) => rename(oldPath, newName),
  );

  ipcMain.handle(IpcChannel.FS_MOVE, (_, srcPath: string, destDir: string) =>
    move(srcPath, destDir),
  );

  ipcMain.handle(IpcChannel.FS_DELETE, (_, targetPath: string) =>
    deleteEntry(targetPath),
  );

  ipcMain.on(IpcChannel.FS_SHOW_IN_EXPLORER, (_, targetPath: string) =>
    showInExplorer(targetPath),
  );

  ipcMain.handle(IpcChannel.FS_GET_HOME, () => getHome());

  ipcMain.handle(IpcChannel.FS_LIST_CONVERTIBLE, (_, dirPath: string) =>
    listConvertible(dirPath),
  );

  ipcMain.handle(IpcChannel.FS_LIST_MP3, (_, dirPath: string) =>
    listMp3(dirPath),
  );

  ipcMain.handle(IpcChannel.FS_LIST_FOLDER_AUDIO, (_, dirPath: string) =>
    listFolderAudio(dirPath),
  );

  ipcMain.handle(IpcChannel.FS_GET_ALL_GENRES, (_, dirPath: string) =>
    getAllGenres(dirPath),
  );

  ipcMain.handle(IpcChannel.FS_MKDIR, (_, dirPath: string) =>
    mkdir(dirPath),
  );

  ipcMain.handle(IpcChannel.FS_COPY, (_, srcPath: string, destDir: string) =>
    copyEntry(srcPath, destDir),
  );

  ipcMain.handle(IpcChannel.FS_EXISTS, (_, targetPath: string) =>
    exists(targetPath),
  );

  // ── Audio ────────────────────────────────────
  ipcMain.handle(IpcChannel.AUDIO_GET_METADATA, (_, filePath: string) =>
    getAudioMetadata(filePath),
  );

  ipcMain.handle(IpcChannel.AUDIO_CONVERT_FILE, (_, filePath: string) =>
    convertFileToMp3(filePath),
  );

  ipcMain.handle(IpcChannel.AUDIO_READ_FILE, async (_, filePath: string) => {
    const buffer = await fs.readFile(filePath);
    return buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    );
  });

  ipcMain.handle(
    IpcChannel.AUDIO_WRITE_GENRES,
    (_, dirPath: string, genres: string[]) => writeGenresToMp3s(dirPath, genres),
  );

  ipcMain.handle(
    IpcChannel.AUDIO_WRITE_METADATA,
    (_, filePath: string, meta: import("@shared/types").WritableMetadata) =>
      writeMetadata(filePath, meta),
  );

  ipcMain.handle(
    IpcChannel.AUDIO_WRITE_PROFILE_SCORES,
    (
      _,
      filePath: string,
      scores: ProfileScores,
      essentia?: EssentiaAnalysis,
      activeProfileTags?: string[],
    ) => writeProfileScores(filePath, scores, essentia, activeProfileTags),
  );

  ipcMain.handle(IpcChannel.AUDIO_ESSENTIA_EXTRACT, (_, filePath: string) =>
    extractEssentiaFromFile(filePath),
  );

  // ── AI ─────────────────────────────────────
  ipcMain.handle(
    IpcChannel.AI_FETCH_GENRES,
    (_, prompt: string, apiKey: string) => fetchGenresFromAI(prompt, apiKey),
  );

  // ── Dialog ───────────────────────────────────
  ipcMain.handle(IpcChannel.DIALOG_SELECT_FOLDER, async (event, title?: string) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win!, {
      title: title ?? "Sélectionner un dossier",
      properties: ["openDirectory"],
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  // ── Store ────────────────────────────────────
  ipcMain.handle(IpcChannel.STORE_GET, (_, key: string) => storeGet(key));

  ipcMain.handle(
    IpcChannel.STORE_SET,
    (_, key: string, value: unknown) => storeSet(key, value),
  );

  // ── Engine DJ SQLite library ───────────────
  ipcMain.handle(IpcChannel.ENGINE_DJ_DB_CONNECT, () => djDbConnectFromStore());

  ipcMain.handle(IpcChannel.ENGINE_DJ_DB_PLAYLIST_TREE, () =>
    djDbGetPlaylistTree(),
  );

  ipcMain.handle(
    IpcChannel.ENGINE_DJ_DB_PLAYLIST_TRACKS,
    (_, listId: number) => djDbGetPlaylistTracks(listId),
  );

  ipcMain.handle(
    IpcChannel.ENGINE_DJ_DB_ADD_CHILD_PLAYLIST,
    (_, params: DjAddChildPlaylistParams) =>
      djDbAddChildPlaylist(params.parentListId, params.title),
  );

  ipcMain.handle(
    IpcChannel.ENGINE_DJ_DB_ADD_TRACK_TO_PLAYLIST,
    (_, params: DjAddTrackToPlaylistParams) =>
      djDbAddTrackToPlaylist(params.destListId, params.trackId),
  );

  ipcMain.handle(
    IpcChannel.ENGINE_DJ_DB_REMOVE_TRACK_FROM_PLAYLIST,
    (_, params: DjRemoveTrackFromPlaylistParams) =>
      djDbRemoveTrackFromPlaylist(params.listId, params.entityId),
  );

  ipcMain.handle(
    IpcChannel.ENGINE_DJ_DB_REORDER_PLAYLIST_TRACKS,
    (_, params: DjReorderPlaylistTracksParams) =>
      djDbReorderPlaylistTracks(params.listId, params.entityIds),
  );

  ipcMain.handle(
    IpcChannel.ENGINE_DJ_DB_ADD_LIBRARY_FILES_TO_PLAYLIST,
    (_, params: DjAddLibraryFilesToPlaylistParams) =>
      djDbAddLibraryFilesToPlaylist(params.destListId, params.filePaths),
  );
}
