import { BrowserWindow, type IpcMain, app } from "electron";
import fs from "fs/promises";
import { IpcChannel } from "@shared/types";
import {
  listVolumes,
  readDirectory,
  rename,
  move,
  deleteEntry,
  showInExplorer,
  getHome,
  listConvertible,
} from "./services/filesystem";
import { getAudioMetadata } from "./services/audio-metadata";
import { convertFileToMp3 } from "./services/convert";
import { storeGet, storeSet } from "./services/store";

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

  // ── Store ────────────────────────────────────
  ipcMain.handle(IpcChannel.STORE_GET, (_, key: string) => storeGet(key));

  ipcMain.handle(
    IpcChannel.STORE_SET,
    (_, key: string, value: unknown) => storeSet(key, value),
  );
}
