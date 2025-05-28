import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { prompt } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: "Prompt is required" });
  }

  try {
    const gptResponse = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content:
            "You are a creative assistant helping young people design playful environments. Based on their input, generate a vivid, imaginative and descriptive design prompt they can use with an AI image generator like Krea."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.8
    });

    const refinedPrompt = gptResponse.choices[0].message.content;
    res.status(200).json({ output: refinedPrompt });
  } catch (error) {
    console.error("OpenAI API error:", error);
    res.status(500).json({ error: "Failed to generate prompt" });
  }
}
