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
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
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
  await robustRename(srcPath, destPath);
  return destPath;
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
