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

type XiphWritable = {
  getFieldFirstValue: (key: string) => string;
  setFieldAsStrings: (key: string, ...values: string[]) => void;
  removeField: (key: string) => void;
};

export async function writeProfileScores(
  filePath: string,
  scores: ProfileScores,
  essentia?: EssentiaAnalysis,
  activeProfileTags?: string[],
): Promise<void> {
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== ".mp3" && ext !== ".flac") {
    throw new Error(
      "Les notes profil ne sont prises en charge que pour les fichiers MP3 et FLAC",
    );
  }

  const normalized = normalizeProfileScores(scores);
  const json = serializeProfileTag(normalized, essentia, activeProfileTags);
  const fieldName = TRACKS_PROFILE_TXXX_DESCRIPTION;

  const file: ReturnType<typeof File.createFromPath> = File.createFromPath(
    filePath,
  );
  try {
    if (ext === ".mp3") {
      const tag = file.getTag(TagTypes.Id3v2, true);
      if (!tag || typeof (tag as Id3v2Tag).getFramesByClassType !== "function") {
        throw new Error("Impossible d'obtenir le tag ID3v2");
      }
      const id3Tag = tag as Id3v2Tag;

      const frames = id3Tag.getFramesByClassType<UserTextInformationFrame>(
        FrameClassType.UserTextInformationFrame,
      );
      const existing = UserTextInformationFrame.findUserTextInformationFrame(
        frames,
        fieldName,
        true,
      );
      if (existing) {
        id3Tag.removeFrame(existing);
      }

      const frame = UserTextInformationFrame.fromDescription(fieldName);
      frame.text = [json];
      id3Tag.addFrame(frame);
    } else {
      const xiph = file.getTag(
        TagTypes.Xiph,
        true,
      ) as unknown as XiphWritable;
      if (!xiph?.removeField || !xiph.setFieldAsStrings) {
        throw new Error("Impossible d'obtenir le commentaire Vorbis/FLAC");
      }
      xiph.removeField(fieldName);
      xiph.setFieldAsStrings(fieldName, json);
    }

    file.save();
  } finally {
    file.dispose();
  }
}
