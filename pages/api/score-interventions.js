const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE_ID =
  process.env.AIRTABLE_TABLE_ID || process.env.AIRTABLE_TABLE_NAME;

const KEYWORD_FIELDS = (
  process.env.AIRTABLE_KEYWORD_FIELDS || "Keywords,keywords,Tags,Focus"
)
  .split(",")
  .map((field) => field.trim())
  .filter(Boolean);

const LOCATION_FIELDS = (
  process.env.AIRTABLE_LOCATION_FIELDS || "Location,Region,Country"
)
  .split(",")
  .map((field) => field.trim())
  .filter(Boolean);

const NUMERIC_FIELDS = [
  ["cost", "Cost", "Average cost"],
  ["ease", "Ease"],
  ["effectiveness", "Effectiveness"],
];

const normalizeTokens = (text = "") =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter(Boolean);

const extractKeywords = (fields = {}) => {
  const keywords = new Set();
  KEYWORD_FIELDS.forEach((key) => {
    const value = fields[key];
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach((entry) =>
        normalizeTokens(entry).forEach((token) => keywords.add(token))
      );
      return;
    }
    normalizeTokens(value).forEach((token) => keywords.add(token));
  });
  return Array.from(keywords);
};

const extractLocationTokens = (fields = {}) => {
  const locations = new Set();
  LOCATION_FIELDS.forEach((key) => {
    const value = fields[key];
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach((entry) =>
        normalizeTokens(entry).forEach((token) => locations.add(token))
      );
      return;
    }
    normalizeTokens(value).forEach((token) => locations.add(token));
  });
  return Array.from(locations);
};

const extractScore = (fields = {}, candidates = []) => {
  for (const name of candidates) {
    const value = fields[name];
    const numericValue = Number(value);
    if (Number.isFinite(numericValue)) {
      return numericValue;
    }
  }
  return null;
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST requests are allowed." });
  }

  if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID || !AIRTABLE_TABLE_ID) {
    return res.status(500).json({
      error:
        "Airtable credentials are missing. Please set AIRTABLE_API_KEY, AIRTABLE_BASE_ID, and AIRTABLE_TABLE_ID.",
    });
  }

  const { prompt = "", location = "" } = req.body || {};
  if (!prompt && !location) {
    return res
      .status(400)
      .json({ error: "Prompt or location context is required." });
  }

  const airtableUrl = new URL(
    `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(
      AIRTABLE_TABLE_ID
    )}`
  );
  airtableUrl.searchParams.set("pageSize", "100");

  try {
    const response = await fetch(airtableUrl, {
      headers: {
        Authorization: `Bearer ${AIRTABLE_API_KEY}`,
      },
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      console.error("Airtable lookup failed:", payload);
      return res
        .status(response.status)
        .json({ error: "Unable to fetch interventions from Airtable." });
    }

    const data = await response.json();
    const promptTokens = new Set(normalizeTokens(prompt));
    const locationTokens = new Set(normalizeTokens(location));

    const matches = [];
    data?.records?.forEach((record) => {
      const { fields = {} } = record;
      const keywords = extractKeywords(fields);
      if (!keywords.length) return;
      const hasKeywordMatch = keywords.some((token) =>
        promptTokens.has(token)
      );
      if (!hasKeywordMatch) return;

      const recordLocations = extractLocationTokens(fields);
      const locationMatch =
        !locationTokens.size ||
        !recordLocations.length ||
        recordLocations.some((token) => locationTokens.has(token));

      if (!locationMatch) return;

      const cost = extractScore(fields, NUMERIC_FIELDS[0]);
      const ease = extractScore(fields, NUMERIC_FIELDS[1]);
      const effectiveness = extractScore(fields, NUMERIC_FIELDS[2]);
      matches.push({
        id: record.id,
        name: fields.Name || fields.Title || "Untitled intervention",
        cost,
        ease,
        effectiveness,
      });
    });

    if (!matches.length) {
      return res.status(200).json({
        matches: 0,
        averages: null,
        items: [],
      });
    }

    const sum = matches.reduce(
      (acc, curr) => {
        if (Number.isFinite(curr.cost)) {
          acc.cost.total += curr.cost;
          acc.cost.count += 1;
        }
        if (Number.isFinite(curr.ease)) {
          acc.ease.total += curr.ease;
          acc.ease.count += 1;
        }
        if (Number.isFinite(curr.effectiveness)) {
          acc.effectiveness.total += curr.effectiveness;
          acc.effectiveness.count += 1;
        }
        return acc;
      },
      {
        cost: { total: 0, count: 0 },
        ease: { total: 0, count: 0 },
        effectiveness: { total: 0, count: 0 },
      }
    );

    const averageOf = ({ total, count }) =>
      count ? Number((total / count).toFixed(2)) : null;

    return res.status(200).json({
      matches: matches.length,
      averages: {
        cost: averageOf(sum.cost),
        ease: averageOf(sum.ease),
        effectiveness: averageOf(sum.effectiveness),
      },
      items: matches,
    });
  } catch (error) {
    console.error("Score calculation failed:", error);
    return res.status(500).json({
      error: "Unable to score interventions. Check Airtable connectivity.",
    });
  }
}
