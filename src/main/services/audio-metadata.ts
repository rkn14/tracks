import { parseFile } from "music-metadata";
import type {
  AudioMetadata,
  EssentiaAnalysis,
  ProfileScores,
} from "@shared/types";
import { TRACKS_PROFILE_TXXX_DESCRIPTION } from "@shared/constants";
import { parseProfileTagJson } from "@shared/profile-tag";

const TXXX_PREFIX = "TXXX:";

function profileFieldIdMatches(tagId: string): boolean {
  const id = tagId.trim();
  const want = TRACKS_PROFILE_TXXX_DESCRIPTION.toLowerCase();
  if (id.toLowerCase() === want) return true;
  if (id.toLowerCase() === `txxx:${want}`) return true;
  if (id.toLowerCase() === `vorbis:${want}`) return true;
  if (id.toLowerCase() === `vorbis comment:${want}`) return true;
  const up = id.toUpperCase();
  if (up.startsWith(TXXX_PREFIX)) {
    return id.slice(TXXX_PREFIX.length).toLowerCase() === want;
  }
  return false;
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
):
  | {
      scores: ProfileScores;
      essentia?: EssentiaAnalysis;
      activeProfileTags: string[];
    }
  | undefined {
  if (!native) return undefined;
  for (const tagType of Object.keys(native)) {
    for (const tag of native[tagType] ?? []) {
      if (!profileFieldIdMatches(tag.id)) continue;
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
    duration:
      format.duration == null
        ? undefined
        : Math.round(format.duration * 1000),
    cover,
    format: format.codec,
    bitrate: format.bitrate ? Math.round(format.bitrate / 1000) : undefined,
    sampleRate: format.sampleRate,
    bitsPerSample: format.bitsPerSample,
    channels: format.numberOfChannels,
    lossless: format.lossless,
    profileScores: profileTag?.scores,
    activeProfileTags: profileTag?.activeProfileTags,
    essentiaAnalysis: profileTag?.essentia,
  };
}
