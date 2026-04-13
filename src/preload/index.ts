import { contextBridge, ipcRenderer } from "electron";
import { IpcChannel, type ElectronApi } from "@shared/types";

const electronApi: ElectronApi = {
  getAppVersion: () => ipcRenderer.invoke(IpcChannel.APP_GET_VERSION),

  window: {
    minimize: () => ipcRenderer.send(IpcChannel.WINDOW_MINIMIZE),
    maximize: () => ipcRenderer.send(IpcChannel.WINDOW_MAXIMIZE),
    close: () => ipcRenderer.send(IpcChannel.WINDOW_CLOSE),
  },

  fs: {
    listVolumes: () => ipcRenderer.invoke(IpcChannel.FS_LIST_VOLUMES),
    readDirectory: (dirPath) =>
      ipcRenderer.invoke(IpcChannel.FS_READ_DIRECTORY, dirPath),
    rename: (oldPath, newPath) =>
      ipcRenderer.invoke(IpcChannel.FS_RENAME, oldPath, newPath),
    move: (srcPath, destDir) =>
      ipcRenderer.invoke(IpcChannel.FS_MOVE, srcPath, destDir),
    delete: (targetPath) =>
      ipcRenderer.invoke(IpcChannel.FS_DELETE, targetPath),
    showInExplorer: (targetPath) =>
      ipcRenderer.send(IpcChannel.FS_SHOW_IN_EXPLORER, targetPath),
    getHome: () => ipcRenderer.invoke(IpcChannel.FS_GET_HOME),
    listConvertible: (dirPath) =>
      ipcRenderer.invoke(IpcChannel.FS_LIST_CONVERTIBLE, dirPath),
    listMp3: (dirPath) =>
      ipcRenderer.invoke(IpcChannel.FS_LIST_MP3, dirPath),
    getAllGenres: (dirPath) =>
      ipcRenderer.invoke(IpcChannel.FS_GET_ALL_GENRES, dirPath),
    mkdir: (dirPath) =>
      ipcRenderer.invoke(IpcChannel.FS_MKDIR, dirPath),
    copy: (srcPath, destDir) =>
      ipcRenderer.invoke(IpcChannel.FS_COPY, srcPath, destDir),
    exists: (targetPath) =>
      ipcRenderer.invoke(IpcChannel.FS_EXISTS, targetPath),
  },

  audio: {
    getMetadata: (filePath) =>
      ipcRenderer.invoke(IpcChannel.AUDIO_GET_METADATA, filePath),
    readFile: (filePath) =>
      ipcRenderer.invoke(IpcChannel.AUDIO_READ_FILE, filePath),
    convertFile: (filePath) =>
      ipcRenderer.invoke(IpcChannel.AUDIO_CONVERT_FILE, filePath),
    onConvertProgress: (cb) => {
      const handler = (_: unknown, progress: unknown) =>
        cb(progress as Parameters<typeof cb>[0]);
      ipcRenderer.on(IpcChannel.AUDIO_CONVERT_PROGRESS, handler);
      return () => {
        ipcRenderer.removeListener(IpcChannel.AUDIO_CONVERT_PROGRESS, handler);
      };
    },
    writeGenres: (dirPath, genres) =>
      ipcRenderer.invoke(IpcChannel.AUDIO_WRITE_GENRES, dirPath, genres),
    writeMetadata: (filePath, meta) =>
      ipcRenderer.invoke(IpcChannel.AUDIO_WRITE_METADATA, filePath, meta),
    writeProfileScores: (filePath, scores, essentia) =>
      ipcRenderer.invoke(
        IpcChannel.AUDIO_WRITE_PROFILE_SCORES,
        filePath,
        scores,
        essentia,
      ),
    extractEssentia: (filePath) =>
      ipcRenderer.invoke(IpcChannel.AUDIO_ESSENTIA_EXTRACT, filePath),
    fetchGenres: (prompt, apiKey) =>
      ipcRenderer.invoke(IpcChannel.AI_FETCH_GENRES, prompt, apiKey),
  },

  dialog: {
    selectFolder: (title?) =>
      ipcRenderer.invoke(IpcChannel.DIALOG_SELECT_FOLDER, title),
  },

  store: {
    get: (key) => ipcRenderer.invoke(IpcChannel.STORE_GET, key),
    set: (key, value) => ipcRenderer.invoke(IpcChannel.STORE_SET, key, value),
  },
};

contextBridge.exposeInMainWorld("electronApi", electronApi);
