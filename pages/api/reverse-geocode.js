const NOMINATIM_BASE_URL =
  process.env.NOMINATIM_BASE_URL ||
  "https://nominatim.openstreetmap.org/reverse";
const NOMINATIM_USER_AGENT =
  process.env.NOMINATIM_USER_AGENT ||
  "playful-environment-app/1.0 (mailto:you@example.com)";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Only GET requests are allowed." });
  }

  const { lat, lon } = req.query;
  if (!lat || !lon) {
    return res
      .status(400)
      .json({ error: "Both lat and lon query parameters are required." });
  }

  try {
    const url = new URL(NOMINATIM_BASE_URL);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("lat", lat);
    url.searchParams.set("lon", lon);
    url.searchParams.set("zoom", "14");
    url.searchParams.set("addressdetails", "1");

    const response = await fetch(url.toString(), {
      headers: {
        "User-Agent": NOMINATIM_USER_AGENT,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      console.error("Reverse geocode failed:", await response.text());
      return res
        .status(response.status)
        .json({ error: "Reverse geocoding failed." });
    }

    const data = await response.json();
    return res.status(200).json({
      displayName: data?.display_name || "",
      address: data?.address || {},
      lat: data?.lat,
      lon: data?.lon,
    });
  } catch (error) {
    console.error("Reverse geocoding exception:", error);
    return res.status(500).json({
      error: "Reverse geocoding failed due to a network or server error.",
    });
  }
}
