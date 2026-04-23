import { shell } from "electron";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { exec, execSync } from "child_process";
import { AUDIO_EXTENSIONS, type FileEntry, type Volume } from "@shared/types";

const audioExtSet = new Set<string>(AUDIO_EXTENSIONS);
const IS_WIN = process.platform === "win32";
const MAX_RETRIES = 4;
const RETRY_DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function escapeCmd(s: string): string {
  return s.replace(/"/g, '""');
}

function escapePS(s: string): string {
  return s.replace(/'/g, "''");
}

/** Check if we can write to a directory (catches Controlled Folder Access). */
async function canWriteToDir(dirPath: string): Promise<boolean> {
  const testFile = path.join(dirPath, `.tracks-write-test-${Date.now()}`);
  try {
    await fs.writeFile(testFile, "");
    await fs.unlink(testFile);
    return true;
  } catch {
    return false;
  }
}

async function robustRename(src: string, dest: string): Promise<void> {
  const dir = path.dirname(src);

  if (!(await canWriteToDir(dir))) {
    throw new Error(
      IS_WIN
        ? `Écriture bloquée dans ce dossier.\n\n` +
          `Cause probable : la « Protection contre les ransomware » de Windows bloque cette application.\n\n` +
          `Pour corriger :\n` +
          `1. Ouvrir Sécurité Windows → Protection contre les virus et menaces\n` +
          `2. Protection contre les ransomware → Gérer la protection\n` +
          `3. Autoriser une app via le Dispositif d'accès contrôlé aux dossiers\n` +
          `4. Ajouter electron.exe (dans node_modules\\electron\\dist\\)`
        : `Permissions insuffisantes pour écrire dans ${dir}.`,
    );
  }

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      await fs.rename(src, dest);
      return;
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EXDEV") break;
      if (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES") throw err;
      await sleep(RETRY_DELAY_MS * (attempt + 1));
    }
  }

  try {
    await fs.copyFile(src, dest);
    await fs.unlink(src);
    return;
  } catch {
    try { await fs.unlink(dest); } catch { /* cleanup */ }
  }

  if (IS_WIN) {
    try {
      execSync(
        `cmd /c move /Y "${escapeCmd(src)}" "${escapeCmd(dest)}"`,
        { timeout: 10000, windowsHide: true },
      );
      return;
    } catch { /* try next */ }

    try {
      execSync(
        `powershell -NoProfile -Command "Move-Item -LiteralPath '${escapePS(src)}' -Destination '${escapePS(dest)}' -Force"`,
        { timeout: 10000, windowsHide: true },
      );
      return;
    } catch { /* fall through */ }
  }

  throw new Error(
    `Renommage impossible. Le fichier est verrouillé par un autre programme. Fermez-le et réessayez.`,
  );
}

function isAudioFile(ext: string): boolean {
  return audioExtSet.has(ext.toLowerCase());
}

export async function listVolumes(): Promise<Volume[]> {
  if (process.platform === "win32") {
    return listWindowsVolumes();
  }
  return [{ name: "/", path: "/", label: "Root" }];
}

function listWindowsVolumes(): Promise<Volume[]> {
  return new Promise((resolve) => {
    const ps = `Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID, VolumeName, Size, FreeSpace | ConvertTo-Json -Compress`;
    exec(
      `powershell -NoProfile -Command "${ps}"`,
      { timeout: 5000 },
      (err, stdout) => {
        if (err) {
          resolve(fallbackWindowsVolumes());
          return;
        }
        try {
          const raw = JSON.parse(stdout);
          const disks = Array.isArray(raw) ? raw : [raw];
          resolve(
            disks.map((d) => ({
              name: d.DeviceID,
              path: `${d.DeviceID}\\`,
              label: d.VolumeName || d.DeviceID,
              sizeBytes: d.Size ?? undefined,
              freeBytes: d.FreeSpace ?? undefined,
            })),
          );
        } catch {
          resolve(fallbackWindowsVolumes());
        }
      },
    );
  });
}

async function fallbackWindowsVolumes(): Promise<Volume[]> {
  const volumes: Volume[] = [];
  for (let code = 65; code <= 90; code++) {
    const letter = String.fromCharCode(code);
    const root = `${letter}:\\`;
    try {
      await fs.access(root);
      volumes.push({ name: `${letter}:`, path: root, label: `${letter}:` });
    } catch {
      /* drive not accessible */
    }
  }
  return volumes;
}

export async function readDirectory(dirPath: string): Promise<FileEntry[]> {
  let entries;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const results: FileEntry[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    const ext = path.extname(entry.name).toLowerCase();
    const isDir = entry.isDirectory();

    if (!isDir && !isAudioFile(ext)) continue;

    try {
      const stat = await fs.stat(fullPath);
      results.push({
        name: entry.name,
        path: fullPath,
        isDirectory: isDir,
        size: stat.size,
        modifiedAt: stat.mtimeMs,
        extension: ext,
      });
    } catch {
      /* skip inaccessible entries */
    }
  }

  results.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });

  return results;
}

export async function rename(
  oldPath: string,
  newName: string,
): Promise<void> {
  const dir = path.dirname(oldPath);
  const newPath = path.join(dir, newName);
  await robustRename(oldPath, newPath);
}

export async function move(
  srcPath: string,
  destDir: string,
): Promise<string> {
  const name = path.basename(srcPath);
  const destPath = path.join(destDir, name);

  try {
    await robustRename(srcPath, destPath);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EXDEV" || (err instanceof Error && err.message.includes("Renommage impossible"))) {
      await crossDeviceMove(srcPath, destPath);
    } else {
      throw err;
    }
  }

  return destPath;
}

async function crossDeviceMove(src: string, dest: string): Promise<void> {
  const stat = await fs.stat(src);

  if (stat.isDirectory()) {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });
    for (const entry of entries) {
      await crossDeviceMove(
        path.join(src, entry.name),
        path.join(dest, entry.name),
      );
    }
    await fs.rm(src, { recursive: true, force: true });
  } else {
    await fs.copyFile(src, dest);
    await fs.unlink(src);
  }
}

export async function copyEntry(
  srcPath: string,
  destDir: string,
): Promise<string> {
  const srcNorm = path.resolve(srcPath).toLowerCase();
  const destDirNorm = path.resolve(destDir).toLowerCase();
  const name = path.basename(srcPath);
  const finalDest = path.resolve(destDir, name).toLowerCase();

  if (finalDest === srcNorm) {
    throw new Error("La source et la destination sont identiques");
  }

  if (destDirNorm === srcNorm || destDirNorm.startsWith(srcNorm + path.sep)) {
    throw new Error("Impossible de copier un dossier dans lui-même ou un sous-dossier");
  }

  if (finalDest.startsWith(srcNorm + path.sep)) {
    throw new Error("Impossible de copier un dossier dans un de ses sous-dossiers");
  }

  const destPath = path.join(destDir, name);
  const stat = await fs.stat(srcPath);

  if (stat.isDirectory()) {
    const snapshot = await fs.readdir(srcPath, { withFileTypes: true });
    await copyDirRecursive(srcPath, destPath, snapshot);
  } else {
    await fs.copyFile(srcPath, destPath);
  }

  return destPath;
}

async function copyDirRecursive(
  src: string,
  dest: string,
  preloadedEntries?: import("fs").Dirent[],
): Promise<void> {
  const srcNorm = path.resolve(src).toLowerCase();
  const destNorm = path.resolve(dest).toLowerCase();

  if (destNorm === srcNorm || destNorm.startsWith(srcNorm + path.sep)) {
    throw new Error("Copie récursive détectée, abandon");
  }

  await fs.mkdir(dest, { recursive: true });

  const entries = preloadedEntries ?? await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcChild = path.join(src, entry.name);
    const srcChildNorm = path.resolve(srcChild).toLowerCase();

    if (srcChildNorm === destNorm || destNorm.startsWith(srcChildNorm + path.sep)) {
      continue;
    }

    const destChild = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDirRecursive(srcChild, destChild);
    } else {
      await fs.copyFile(srcChild, destChild);
    }
  }
}

export async function exists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function deleteEntry(targetPath: string): Promise<void> {
  await shell.trashItem(targetPath);
}

export function showInExplorer(targetPath: string): void {
  shell.showItemInFolder(targetPath);
}

export function getHome(): string {
  return os.homedir();
}

export async function listMp3(
  dirPath: string,
): Promise<{ name: string; path: string }[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const results: { name: string; path: string }[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (path.extname(entry.name).toLowerCase() !== ".mp3") continue;
    results.push({ name: entry.name, path: path.join(dirPath, entry.name) });
  }

  results.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  return results;
}

/** Tous les fichiers audio reconnus (`AUDIO_EXTENSIONS`) dans un dossier (non récursif). */
export async function listFolderAudio(
  dirPath: string,
): Promise<{ name: string; path: string }[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const results: { name: string; path: string }[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!isAudioFile(ext)) continue;
    results.push({ name: entry.name, path: path.join(dirPath, entry.name) });
  }

  results.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  return results;
}

export async function getAllGenres(dirPath: string): Promise<string[]> {
  const { parseFile } = await import("music-metadata");
  const files = await listFolderAudio(dirPath);
  const genres = new Set<string>();

  for (const f of files) {
    try {
      const meta = await parseFile(f.path);
      if (meta.common.genre) {
        for (const g of meta.common.genre) genres.add(g);
      }
    } catch {
      /* skip unreadable files */
    }
  }

  return [...genres].sort();
}

export async function mkdir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath);
}

const CONVERTIBLE_EXTS = new Set([".wav", ".aiff", ".aif", ".flac"]);

export async function listConvertible(
  dirPath: string,
): Promise<{ name: string; path: string }[]> {
  const results: { name: string; path: string }[] = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        if (CONVERTIBLE_EXTS.has(ext)) {
          const relative = path.relative(dirPath, full);
          results.push({ name: relative, path: full });
        }
      }
    }
  }

  await walk(dirPath);
  results.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  return results;
}
