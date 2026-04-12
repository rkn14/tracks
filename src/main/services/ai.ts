import { net } from "electron";
import type { AIGenreResult } from "@shared/types";

export async function fetchGenresFromAI(
  prompt: string,
  apiKey: string,
): Promise<AIGenreResult> {
  const body = JSON.stringify({
    model: "gpt-4.1-mini",
    messages: [
      {
        role: "system",
        content:
          'You are a music genre classifier. Always respond with valid JSON in the format: {"genres": ["genre1", "genre2"], "certainty_percentage": 85, "comment": "short explanation"}',
      },
      { role: "user", content: prompt },
    ],
    temperature: 0.3,
    response_format: { type: "json_object" },
  });

  return new Promise((resolve, reject) => {
    const request = net.request({
      method: "POST",
      url: "https://api.openai.com/v1/chat/completions",
    });

    request.setHeader("Content-Type", "application/json");
    request.setHeader("Authorization", `Bearer ${apiKey}`);

    let data = "";

    request.on("response", (response) => {
      response.on("data", (chunk) => {
        data += chunk.toString();
      });

      response.on("end", () => {
        try {
          const json = JSON.parse(data);

          if (json.error) {
            reject(new Error(json.error.message ?? "OpenAI API error"));
            return;
          }

          const content = json.choices?.[0]?.message?.content;
          if (!content) {
            reject(new Error("Réponse vide de l'API OpenAI"));
            return;
          }

          const parsed = JSON.parse(content);

          if (!Array.isArray(parsed.genres)) {
            reject(new Error("Format inattendu : genres manquants"));
            return;
          }

          resolve({
            genres: parsed.genres.map((g: unknown) => String(g)),
            certaintyPercentage: Number(parsed.certainty_percentage) || 0,
            comment: String(parsed.comment ?? ""),
          });
        } catch (err) {
          reject(new Error(`Erreur parsing réponse OpenAI: ${(err as Error).message}`));
        }
      });
    });

    request.on("error", (err) => {
      reject(new Error(`Erreur réseau OpenAI: ${err.message}`));
    });

    request.write(body);
    request.end();
  });
}
