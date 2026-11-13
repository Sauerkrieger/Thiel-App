import "server-only";

const MODEL = "gemini-flash-lite-latest";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

async function generate(prompt: string, inlineData?: { data: string; mimeType: string }): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not configured.");
  const parts: Array<Record<string, unknown>> = [{ text: prompt }];
  if (inlineData) parts.push({ inlineData });
  const response = await fetch(`${ENDPOINT}?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts }], generationConfig: { temperature: 0, maxOutputTokens: 2000 } }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Gemini error (${response.status}): ${detail.slice(0, 300)}`);
  }
  const json = await response.json().catch(() => null);
  const text = (json?.candidates?.[0]?.content?.parts ?? []).map((part: { text?: string }) => part.text ?? "").join("").trim();
  if (!text) throw new Error("Gemini returned no response.");
  return text;
}

export async function transcribeAudio(buffer: Buffer, mimeType: string): Promise<string> {
  return generate("Transcribe this German voice message verbatim. Return only the transcript, without quotation marks or additional text.", { data: buffer.toString("base64"), mimeType });
}

export async function translateText(text: string, language: string): Promise<string> {
  return generate(`Translate the following message text into ${language}. Return only the translation, without explanation and without quotation marks.\n\n${text}`);
}
