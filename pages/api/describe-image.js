const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_VISION_MODEL =
  process.env.GEMINI_VISION_MODEL || "gemini-1.5-flash-latest";

const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_VISION_MODEL}:generateContent`;

const DEFAULT_PROMPT =
  "Provide two short sentences describing what is happening in this photo, including notable landforms, vegetation, weather, and people. Keep it factual.";

const parseDataUrl = (dataUrl = "") => {
  if (typeof dataUrl !== "string") return null;
  const match = dataUrl.match(/^data:(.+?);base64,(.+)$/);
  if (!match) return null;
  return {
    mimeType: match[1],
    data: match[2],
  };
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST requests are allowed." });
  }

  if (!GEMINI_API_KEY) {
    return res
      .status(500)
      .json({ error: "GEMINI_API_KEY is not configured on the server." });
  }

  const { imageData, prompt } = req.body || {};
  if (!imageData) {
    return res.status(400).json({ error: "imageData is required." });
  }

  const parsedImage = parseDataUrl(imageData);
  if (!parsedImage) {
    return res
      .status(400)
      .json({ error: "imageData must be a base64 data URL." });
  }

  try {
    const response = await fetch(`${GEMINI_ENDPOINT}?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { text: prompt?.trim() || DEFAULT_PROMPT },
              {
                inline_data: {
                  mime_type: parsedImage.mimeType,
                  data: parsedImage.data,
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.15,
          topK: 32,
          topP: 0.8,
          maxOutputTokens: 200,
        },
      }),
    });

    if (!response.ok) {
      const errPayload = await response.json().catch(() => ({}));
      console.error("Gemini describe-image error:", errPayload);
      return res.status(response.status).json({
        error: "Unable to describe the image. Please try again.",
      });
    }

    const data = await response.json();
    const textPart =
      data?.candidates?.[0]?.content?.parts?.find(
        (part) => typeof part.text === "string"
      )?.text || "";

    if (!textPart) {
      console.error("Gemini describe-image returned no text:", data);
      return res.status(502).json({
        error: "Gemini did not return a usable description.",
      });
    }

    return res.status(200).json({ description: textPart.trim() });
  } catch (error) {
    console.error("Gemini describe-image request failed:", error);
    return res.status(500).json({ error: "Unable to describe the image." });
  }
}
