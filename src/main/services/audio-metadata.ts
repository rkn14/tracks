import { parseFile } from "music-metadata";
import type { AudioMetadata } from "@shared/types";

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
  };
}
