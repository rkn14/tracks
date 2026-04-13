import { parseFile } from "music-metadata";
import type { AudioMetadata, EssentiaAnalysis, ProfileScores } from "@shared/types";
import { TRACKS_PROFILE_TXXX_DESCRIPTION } from "@shared/constants";
import { parseProfileTagJson } from "@shared/profile-tag";

const TXXX_PREFIX = "TXXX:";

function profileTxxxIdMatches(tagId: string): boolean {
  const id = tagId.trim();
  if (!id.toUpperCase().startsWith(TXXX_PREFIX)) return false;
  const desc = id.slice(TXXX_PREFIX.length);
  return (
    desc.toLowerCase() === TRACKS_PROFILE_TXXX_DESCRIPTION.toLowerCase()
  );
}

function valueToJsonString(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "string") return raw;
  if (typeof raw === "number" || typeof raw === "boolean") return String(raw);
  if (Array.isArray(raw)) return raw.map(valueToJsonString).join("");
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (typeof o.text === "string") return o.text;
    if (Array.isArray(o.text)) return o.text.map(String).join("");
  }
  return String(raw);
}

function parseProfileTagFromNative(
  native: Record<string, Array<{ id: string; value: unknown }>> | undefined,
): { scores: ProfileScores; essentia?: EssentiaAnalysis } | undefined {
  if (!native) return undefined;
  for (const tagType of Object.keys(native)) {
    for (const tag of native[tagType] ?? []) {
      if (!profileTxxxIdMatches(tag.id)) continue;
      const str = valueToJsonString(tag.value);
      if (!str.trim()) return undefined;
      return parseProfileTagJson(str);
    }
  }
  return undefined;
}

export async function getAudioMetadata(
  filePath: string,
): Promise<AudioMetadata> {
  const metadata = await parseFile(filePath);
  const { common, format } = metadata;

  let cover: string | undefined;
  const picture = common.picture?.[0];
  if (picture) {
    const b64 = Buffer.from(picture.data).toString("base64");
    cover = `data:${picture.format};base64,${b64}`;
  }

  const profileTag = parseProfileTagFromNative(metadata.native);

  return {
    title: common.title,
    artist: common.artist,
    album: common.album,
    genre: common.genre?.[0],
    year: common.year,
    label: common.label?.[0],
    bpm: common.bpm,
    duration: format.duration,
    cover,
    format: format.codec,
    bitrate: format.bitrate ? Math.round(format.bitrate / 1000) : undefined,
    sampleRate: format.sampleRate,
    bitsPerSample: format.bitsPerSample,
    channels: format.numberOfChannels,
    lossless: format.lossless,
    profileScores: profileTag?.scores,
    essentiaAnalysis: profileTag?.essentia,
  };
}
