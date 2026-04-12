import { File } from "node-taglib-sharp";
import type { WritableMetadata } from "@shared/types";
import fs from "fs/promises";
import path from "path";

export async function writeMetadata(
  filePath: string,
  meta: WritableMetadata,
): Promise<void> {
  let file: ReturnType<typeof File.createFromPath> | null = null;
  try {
    file = File.createFromPath(filePath);
    if (meta.title !== undefined) file.tag.title = meta.title;
    if (meta.artist !== undefined) file.tag.performers = meta.artist ? [meta.artist] : [];
    if (meta.album !== undefined) file.tag.album = meta.album;
    if (meta.genre !== undefined) file.tag.genres = meta.genre ? meta.genre.split(/\s*[,;/]\s*/) : [];
    if (meta.year !== undefined) file.tag.year = meta.year;
    if (meta.label !== undefined) file.tag.publisher = meta.label;
    if (meta.bpm !== undefined) file.tag.beatsPerMinute = meta.bpm;
    file.save();
  } finally {
    file?.dispose();
  }
}

export async function writeGenresToMp3s(
  dirPath: string,
  genres: string[],
): Promise<number> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  let count = 0;

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (path.extname(entry.name).toLowerCase() !== ".mp3") continue;

    const fullPath = path.join(dirPath, entry.name);
    let file: ReturnType<typeof File.createFromPath> | null = null;

    try {
      file = File.createFromPath(fullPath);
      const existing = file.tag.genres ?? [];
      const lowerSet = new Set(existing.map((g) => g.toLowerCase()));
      const merged = [...existing];
      for (const g of genres) {
        if (!lowerSet.has(g.toLowerCase())) {
          merged.push(g);
          lowerSet.add(g.toLowerCase());
        }
      }
      file.tag.genres = merged;
      file.save();
      count++;
    } catch {
      /* skip files that can't be written */
    } finally {
      file?.dispose();
    }
  }

  return count;
}
