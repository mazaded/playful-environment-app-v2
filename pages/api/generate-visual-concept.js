const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_IMAGE_MODEL =
  process.env.GEMINI_IMAGE_MODEL || "gemini-2.0-flash-exp";

const GEMINI_IMAGE_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent`;

const parseDataUrl = (dataUrl = "") => {
  if (typeof dataUrl !== "string") return null;
  const match = dataUrl.match(/^data:(.+?);base64,(.+)$/);
  if (!match) return null;
  return {
    mimeType: match[1],
    data: match[2],
  };
};

const pickImagePart = (candidate) => {
  if (!candidate?.content?.parts) return null;
  return (
    candidate.content.parts.find(
      (part) =>
        part?.inline_data?.data &&
        typeof part.inline_data.data === "string" &&
        /^image\//.test(part.inline_data.mime_type || "")
    ) || null
  );
};

const conceptInstruction =
  "You help urban designers imagine inclusive, climate-adaptive play spaces. Keep existing surroundings recognizable while translating the instruction into a polished concept rendering.";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST requests are allowed." });
  }

  if (!GEMINI_API_KEY) {
    return res
      .status(500)
      .json({ error: "GEMINI_API_KEY is not configured on the server." });
  }

  const {
    prompt,
    mode = "composite",
    imageData,
    baseImageData,
    maskData,
  } = req.body || {};

  if (!prompt || typeof prompt !== "string") {
    return res
      .status(400)
      .json({ error: "A prompt describing the concept is required." });
  }

  const parsedImage = imageData ? parseDataUrl(imageData) : null;
  const parsedBase = baseImageData ? parseDataUrl(baseImageData) : null;
  const parsedMask = maskData ? parseDataUrl(maskData) : null;

  if (mode === "composite" && !parsedImage) {
    return res
      .status(400)
      .json({ error: "Composite mode requires imageData." });
  }

  if (mode === "inpainting" && (!parsedBase || !parsedMask)) {
    return res.status(400).json({
      error: "Inpainting mode requires baseImageData and maskData.",
    });
  }

  const parts = [
    {
      text: `${conceptInstruction}\nInstruction: ${prompt.trim()}`,
    },
  ];

  if (mode === "composite" && parsedImage) {
    parts.push({
      inline_data: {
        mime_type: parsedImage.mimeType,
        data: parsedImage.data,
      },
    });
    parts.push({
      text: "Use this composite sketch as a reference and enhance it realistically.",
    });
  }

  if (mode === "inpainting" && parsedBase && parsedMask) {
    parts.push({
      inline_data: {
        mime_type: parsedBase.mimeType,
        data: parsedBase.data,
      },
    });
    parts.push({
      inline_data: {
        mime_type: parsedMask.mimeType,
        data: parsedMask.data,
      },
    });
    parts.push({
      text: "Respect the mask: white pixels mark the areas to modify. Leave black areas unchanged.",
    });
  }

  try {
    const response = await fetch(
      `${GEMINI_IMAGE_ENDPOINT}?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts,
            },
          ],
          generationConfig: {
            temperature: 0.65,
            topP: 0.8,
            topK: 32,
            maxOutputTokens: 2048,
          },
        }),
      }
    );

    if (!response.ok) {
      const errPayload = await response.json().catch(() => ({}));
      console.error("Gemini image error:", errPayload);
      return res
        .status(response.status)
        .json({ error: "Gemini could not generate the concept image." });
    }

    const data = await response.json();
    const candidate =
      data?.candidates?.find(
        (item) => item?.finishReason === "STOP" || item?.finishReason === "MAX_TOKENS"
      ) || data?.candidates?.[0];

    const imagePart = pickImagePart(candidate);
    if (!imagePart) {
      console.error("Gemini returned no image:", data);
      return res
        .status(502)
        .json({ error: "Gemini did not return an image. Please try again." });
    }

    return res.status(200).json({
      imageBase64: imagePart.inline_data.data,
      mimeType: imagePart.inline_data.mime_type || "image/png",
    });
  } catch (error) {
    console.error("Gemini image request failed:", error);
    return res
      .status(500)
      .json({ error: "Failed to generate the concept image." });
  }
}
