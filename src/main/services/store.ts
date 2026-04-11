import { app } from "electron";
import fs from "fs/promises";
import path from "path";

const storePath = path.join(app.getPath("userData"), "state.json");

let cache: Record<string, unknown> = {};
let loaded = false;

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  try {
    const raw = await fs.readFile(storePath, "utf-8");
    cache = JSON.parse(raw);
  } catch {
    cache = {};
  }
  loaded = true;
}

export async function storeGet<T>(key: string): Promise<T | undefined> {
  await ensureLoaded();
  return cache[key] as T | undefined;
}

export async function storeSet(key: string, value: unknown): Promise<void> {
  await ensureLoaded();
  cache[key] = value;
  await fs.writeFile(storePath, JSON.stringify(cache, null, 2), "utf-8");
}
