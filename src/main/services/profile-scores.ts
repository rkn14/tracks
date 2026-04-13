import path from "path";
import {
  File,
  TagTypes,
  Id3v2UserTextInformationFrame as UserTextInformationFrame,
  Id3v2FrameClassType as FrameClassType,
} from "node-taglib-sharp";
import type { Id3v2Tag } from "node-taglib-sharp";
import type { EssentiaAnalysis, ProfileScores } from "@shared/types";
import { TRACKS_PROFILE_TXXX_DESCRIPTION } from "@shared/constants";
import {
  defaultProfileScores,
  normalizeProfileScores,
} from "@shared/profile-scores";
import { serializeProfileTag } from "@shared/profile-tag";

export { defaultProfileScores, normalizeProfileScores };

export async function writeProfileScores(
  filePath: string,
  scores: ProfileScores,
  essentia?: EssentiaAnalysis,
): Promise<void> {
  if (path.extname(filePath).toLowerCase() !== ".mp3") {
    throw new Error("Les notes profil ne sont prises en charge que pour les fichiers MP3");
  }

  const normalized = normalizeProfileScores(scores);
  const json = serializeProfileTag(normalized, essentia);

  let file: ReturnType<typeof File.createFromPath> | null = null;
  try {
    file = File.createFromPath(filePath);
    const tag = file.getTag(TagTypes.Id3v2, true);
    // Ne pas utiliser `instanceof Id3v2Tag` : avec le bundling Electron, deux copies du module
    // peuvent faire échouer le test alors que l’objet est bien un tag ID3v2.
    if (!tag || typeof (tag as Id3v2Tag).getFramesByClassType !== "function") {
      throw new Error("Impossible d'obtenir le tag ID3v2");
    }
    const id3Tag = tag as Id3v2Tag;

    const frames = id3Tag.getFramesByClassType<UserTextInformationFrame>(
      FrameClassType.UserTextInformationFrame,
    );
    const existing = UserTextInformationFrame.findUserTextInformationFrame(
      frames,
      TRACKS_PROFILE_TXXX_DESCRIPTION,
      true,
    );
    if (existing) {
      id3Tag.removeFrame(existing);
    }

    const frame = UserTextInformationFrame.fromDescription(TRACKS_PROFILE_TXXX_DESCRIPTION);
    frame.text = [json];
    id3Tag.addFrame(frame);
    file.save();
  } finally {
    file?.dispose();
  }
}
