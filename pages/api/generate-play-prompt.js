const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_CHAT_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const SYSTEM_PROMPT =
  "Produce a concise (max 35 words) response about playful environments. When asked to add or adapt, share an inclusive, nature-forward idea using locally sourced natural materials, native vegetation, and relevant cultural cues. When asked to describe a vulnerability, summarise how it appears, who it affects, and how it relates to play in the scene. Mirror any requested language.";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST requests are allowed" });
  }

  const { prompt } = req.body;

  if (!OPENAI_API_KEY) {
    return res
      .status(500)
      .json({ error: "OPENAI_API_KEY is not configured on the server." });
  }

  try {
    const response = await fetch(OPENAI_CHAT_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.6,
        max_tokens: 180,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!response.ok) {
      const errorPayload = await response.json().catch(() => ({}));
      console.error("OpenAI error:", errorPayload);
      return res
        .status(response.status)
        .json({ error: "Error generating prompt" });
    }

    const data = await response.json();
    const textOutput =
      data?.choices?.[0]?.message?.content?.trim() || "";

    if (!textOutput) {
      console.error("OpenAI returned no content:", data);
      return res
        .status(502)
        .json({ error: "OpenAI did not return any text. Please try again." });
    }

    const output = textOutput.split(/\s+/).slice(0, 35).join(" ");
    return res.status(200).json({ output });
  } catch (error) {
    console.error("OpenAI request failed:", error);
    return res.status(500).json({ error: "Error generating prompt" });
  }
}
