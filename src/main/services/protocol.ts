import { net, protocol } from "electron";
import { pathToFileURL } from "url";

/**
 * Must be called BEFORE app.whenReady().
 * Registers the `track://` scheme as privileged so it can be used
 * with fetch / Audio / WaveSurfer from the renderer.
 */
export function registerScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: "track",
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
      },
    },
  ]);
}

/**
 * Must be called AFTER app.whenReady().
 * Handles `track:///C:/path/to/file.mp3` → local file read.
 */
export function registerProtocolHandler(): void {
  protocol.handle("track", (request) => {
    const url = new URL(request.url);
    let filePath = decodeURIComponent(url.pathname);

    if (process.platform === "win32" && filePath.startsWith("/")) {
      filePath = filePath.slice(1);
    }

    return net.fetch(pathToFileURL(filePath).href);
  });
}
