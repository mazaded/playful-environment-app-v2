const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_CHAT_ENDPOINT =
  process.env.OPENAI_VISION_ENDPOINT ||
  "https://api.openai.com/v1/chat/completions";
const OPENAI_VISION_MODEL =
  process.env.OPENAI_VISION_MODEL || "gpt-4o-mini";

const DEFAULT_PROMPT =
  "Describe this photo in two concise sentences. Mention landforms, vegetation, weather, and people if present.";

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

  if (!OPENAI_API_KEY) {
    return res
      .status(500)
      .json({ error: "OPENAI_API_KEY is not configured on the server." });
  }

  const { imageData, prompt } = req.body || {};
  if (!imageData) {
    return res.status(400).json({ error: "imageData is required." });
  }

  const parsed = parseDataUrl(imageData);
  if (!parsed) {
    return res
      .status(400)
      .json({ error: "imageData must be a base64 data URL." });
  }

  try {
    const response = await fetch(OPENAI_CHAT_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_VISION_MODEL,
        temperature: 0.2,
        max_tokens: 200,
        messages: [
          {
            role: "system",
            content:
              "You are a concise urban design analyst. Describe only what you see; keep the description to two short sentences.",
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: prompt?.trim() || DEFAULT_PROMPT,
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:${parsed.mimeType};base64,${parsed.data}`,
                },
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const errPayload = await response.json().catch(() => ({}));
      console.error("OpenAI vision error:", errPayload);
      return res
        .status(response.status)
        .json({ error: "Unable to describe the image. Please try again." });
    }

    const data = await response.json();
    const messageContent = data?.choices?.[0]?.message?.content;
    const textOutput =
      Array.isArray(messageContent)
        ? messageContent
            .map((part) => part.text)
            .filter(Boolean)
            .join(" ")
            .trim()
        : typeof messageContent === "string"
          ? messageContent.trim()
          : "";

    if (!textOutput) {
      console.error("OpenAI vision returned no text:", data);
      return res.status(502).json({
        error: "OpenAI did not return a usable description.",
      });
    }

    return res.status(200).json({ description: textOutput });
  } catch (error) {
    console.error("OpenAI vision request failed:", error);
    return res.status(500).json({ error: "Unable to describe the image." });
  }
}
