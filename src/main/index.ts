import { app, BrowserWindow, ipcMain } from "electron";
import { registerScheme, registerProtocolHandler } from "./services/protocol";
import { createMainWindow } from "./window";
import { registerIpcHandlers } from "./ipc";

registerScheme();

function bootstrap(): void {
  registerProtocolHandler();

  registerIpcHandlers(ipcMain);
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
}

app.whenReady().then(bootstrap);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
