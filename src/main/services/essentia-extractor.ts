import { spawn } from "child_process";
import { randomUUID } from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { app } from "electron";
import type { EssentiaAnalysis } from "@shared/types";

function essentiaRootDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "essentia")
    : path.join(process.cwd(), "resources", "essentia");
}

function extractorExecutablePath(): string {
  const root = essentiaRootDir();
  if (process.platform === "win32") {
    return path.join(root, "win-i686", "streaming_extractor_music.exe");
  }
  if (process.platform === "darwin") {
    return path.join(root, "darwin-x64", "streaming_extractor_music");
  }
  if (process.platform === "linux") {
    return path.join(root, "linux-x86_64", "streaming_extractor_music");
  }
  throw new Error("Plateforme non prise en charge pour l’extracteur Essentia.");
}

function coerceStatsScalar(v: unknown): unknown {
  if (v && typeof v === "object" && !Array.isArray(v) && "mean" in (v as object)) {
    return (v as { mean?: unknown }).mean;
  }
  return v;
}

function parseBpmFromRhythm(rhythm: unknown): number | undefined {
  if (!rhythm || typeof rhythm !== "object") return undefined;
  const raw = coerceStatsScalar((rhythm as Record<string, unknown>).bpm);
  const n = typeof raw === "number" ? raw : Number(raw);
  if (Number.isFinite(n) && n > 0) return n;
  return undefined;
}

function parseKeyFromTonal(tonal: unknown): string | undefined {
  if (!tonal || typeof tonal !== "object") return undefined;
  const t = tonal as Record<string, unknown>;

  const kk = coerceStatsScalar(t.key_key);
  const ks = coerceStatsScalar(t.key_scale);
  const keyStr = typeof kk === "string" ? kk.trim() : "";
  const scaleStr = typeof ks === "string" ? ks.trim() : "";
  if (keyStr) {
    return scaleStr ? `${keyStr} ${scaleStr}` : keyStr;
  }

  const edma = t.key_edma;
  if (edma && typeof edma === "object" && !Array.isArray(edma)) {
    const e = edma as Record<string, unknown>;
    const keyPart = String(coerceStatsScalar(e.key) ?? "").trim();
    const scalePart = String(coerceStatsScalar(e.scale) ?? "").trim();
    if (keyPart && scalePart) return `${keyPart} ${scalePart}`;
    if (keyPart) return keyPart;
  }

  const ck = coerceStatsScalar(t.chords_key);
  const cs = coerceStatsScalar(t.chords_scale);
  const cKey = typeof ck === "string" ? ck.trim() : "";
  const cScale = typeof cs === "string" ? cs.trim() : "";
  if (cKey) {
    return cScale ? `${cKey} ${cScale}` : cKey;
  }

  return undefined;
}

function parseEssentiaMusicJson(data: unknown): EssentiaAnalysis {
  if (!data || typeof data !== "object") {
    throw new Error("Réponse JSON Essentia invalide.");
  }
  const root = data as Record<string, unknown>;
  const rhythm = root.rhythm;
  const tonal = root.tonal;

  const bpmRaw = parseBpmFromRhythm(rhythm);
  const keyRaw = parseKeyFromTonal(tonal);

  const out: EssentiaAnalysis = {};
  if (bpmRaw !== undefined) {
    out.bpm = Math.round(bpmRaw * 10) / 10;
  }
  if (keyRaw) {
    out.key = keyRaw;
  }
  if (out.bpm === undefined && out.key === undefined) {
    throw new Error("Impossible de lire le BPM ou la tonalité dans le JSON Essentia.");
  }
  return out;
}

function runExtractor(exe: string, audioPath: string, jsonPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, [audioPath, jsonPath], {
      windowsHide: true,
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (err) => {
      reject(err);
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        const tail = stderr.trim().split("\n").filter(Boolean).pop();
        reject(
          new Error(
            tail ??
              (code !== null
                ? `L’extracteur Essentia s’est terminé avec le code ${code}.`
                : "L’extracteur Essentia s’est terminé de façon inattendue."),
          ),
        );
      }
    });
  });
}

/**
 * Lance l’extracteur natif `streaming_extractor_music` (binaire AcousticBrainz / Essentia 2.1)
 * sur un fichier audio et renvoie BPM + tonalité lus depuis le JSON produit.
 */
export async function extractEssentiaFromFile(
  filePath: string,
): Promise<Required<Pick<EssentiaAnalysis, "bpm" | "key">>> {
  if (!filePath.toLowerCase().endsWith(".mp3")) {
    throw new Error("Seuls les fichiers MP3 sont pris en charge pour l’analyse Essentia.");
  }

  await fs.access(filePath);

  const exe = extractorExecutablePath();
  await fs.access(exe).catch(() => {
    throw new Error(
      "Binaire Essentia introuvable. Vérifiez que le dossier resources/essentia est présent.",
    );
  });

  if (process.platform !== "win32") {
    await fs.chmod(exe, 0o755).catch(() => undefined);
  }

  const outJson = path.join(os.tmpdir(), `tracks-essentia-${randomUUID()}.json`);

  try {
    await runExtractor(exe, filePath, outJson);
    const raw = await fs.readFile(outJson, "utf8");
    const parsed: unknown = JSON.parse(raw);
    const analysis = parseEssentiaMusicJson(parsed);
    if (analysis.bpm === undefined || analysis.key === undefined) {
      throw new Error("Analyse incomplète : BPM ou tonalité manquant.");
    }
    return { bpm: analysis.bpm, key: analysis.key };
  } finally {
    await fs.unlink(outJson).catch(() => undefined);
  }
}
