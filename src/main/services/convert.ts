import { execFile } from "child_process";
import path from "path";
import type { ConvertFileResult } from "@shared/types";

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

export async function convertFileToMp3(
  filePath: string,
): Promise<ConvertFileResult> {
  const dir = path.dirname(filePath);
  const baseName = path.basename(filePath, path.extname(filePath));
  const dest = path.join(dir, `${baseName}.mp3`);

  try {
    await ffmpegConvert(filePath, dest);
    return { ok: true, sourcePath: filePath, destPath: dest };
  } catch (err) {
    return {
      ok: false,
      sourcePath: filePath,
      destPath: dest,
      error: (err as Error).message,
    };
  }
}
