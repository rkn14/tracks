import { execFile } from "child_process";
import fs from "fs/promises";
import path from "path";
import type { ConvertProgress, ConvertResult } from "@shared/types";

const CONVERTIBLE_EXTS = new Set([".wav", ".aiff", ".aif", ".flac"]);

function ffmpegConvert(src: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      "ffmpeg",
      [
        "-i", src,
        "-y",
        "-codec:a", "libmp3lame",
        "-b:a", "320k",
        "-cutoff", "20000",
        "-joint_stereo", "0",
        "-map_metadata", "0",
        "-id3v2_version", "3",
        dest,
      ],
      { windowsHide: true, timeout: 600_000 },
      (err, _stdout, stderr) => {
        if (err) {
          const msg = stderr?.trim().split("\n").pop() ?? err.message;
          reject(new Error(msg));
        } else {
          resolve();
        }
      },
    );
  });
}

export async function convertDirectoryToMp3(
  dirPath: string,
  onProgress?: (p: ConvertProgress) => void,
): Promise<ConvertResult> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });

  const files = entries.filter((e) => {
    if (!e.isFile()) return false;
    const ext = path.extname(e.name).toLowerCase();
    return CONVERTIBLE_EXTS.has(ext);
  });

  const total = files.length;
  const result: ConvertResult = {
    converted: 0,
    skipped: 0,
    errors: [],
    sourceFiles: [],
  };

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const src = path.join(dirPath, file.name);
    const baseName = path.basename(file.name, path.extname(file.name));
    const dest = path.join(dirPath, `${baseName}.mp3`);

    onProgress?.({ current: i + 1, total, fileName: file.name });

    try {
      await fs.access(dest);
      result.skipped++;
      continue;
    } catch {
      /* mp3 doesn't exist yet — proceed */
    }

    try {
      await ffmpegConvert(src, dest);
      result.converted++;
      result.sourceFiles.push(src);
    } catch (err) {
      result.errors.push(`${file.name}: ${(err as Error).message}`);
    }
  }

  return result;
}
