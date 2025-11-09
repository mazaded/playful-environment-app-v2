import React, { useState, useRef, useEffect } from "react";
import exifr from "exifr";

const AUTO_DESCRIPTION_ENABLED =
  process.env.NEXT_PUBLIC_ENABLE_IMAGE_DESCRIPTION === "true";
const GEMINI_IMAGE_ENABLED =
  (process.env.NEXT_PUBLIC_ENABLE_GEMINI_IMAGE || "").toLowerCase() === "true";
const GEMINI_INPAINTING_ENABLED =
  (process.env.NEXT_PUBLIC_ENABLE_GEMINI_INPAINTING || "").toLowerCase() === "true";

const MAX_PREVIEW_DIMENSION = 1024;
const PREVIEW_QUALITY = 0.7;

const LANGUAGE_RULES = [
  {
    code: "fr",
    label: "French",
    keywords: [" le ", " la ", " les ", " des ", " avec ", " pour ", " dans ", " une ", " un ", " sur ", " du ", " au "],
    diacritics: /[àâçéèêëîïôûùüÿœæ]/i,
  },
];

const LOCATION_HINTS = [
  {
    name: "antananarivo_madagascar",
    test: (location = "", coords) => {
      const locMatch = /antananarivo|madagascar/i.test(location);
      if (locMatch) return true;
      if (!coords) return false;
      const { latitude, longitude } = coords;
      return latitude <= -17 && latitude >= -20.5 && longitude >= 46 && longitude <= 49.5;
    },
    hint: "Consider papyrus reedbeds, traveller's palms, screw pines, and raised bamboo play decks to slow floods around Antananarivo's wetlands.",
    species: ["papyrus reedbeds", "traveller's palm", "screw pine", "bamboo decking"],
  },
  {
    name: "kisumu_kenya",
    test: (location = "", coords) => {
      const locMatch = /kisumu|lake victoria|kenya/i.test(location);
      if (locMatch) return true;
      if (!coords) return false;
      const { latitude, longitude } = coords;
      return latitude <= 0 && latitude >= -1.2 && longitude >= 34 && longitude <= 35.8;
    },
    hint: "Consider papyrus wetlands, raffia palms, African fan palms, and elevated boardwalk play routes to handle Lake Victoria flood pulses.",
    species: ["papyrus", "raffia palm", "African fan palm"],
  },
];

const detectLanguage = (text = "") => {
  const normalized = ` ${text.toLowerCase()} `;
  return (
    LANGUAGE_RULES.find(({ keywords = [], diacritics }) => {
      let hits = 0;
      keywords.forEach((kw) => {
        if (normalized.includes(kw)) hits += 1;
      });
      if (diacritics && diacritics.test(text)) hits += 2;
      return hits >= 2;
    }) || null
  );
};

const findHint = (location, coords) =>
  LOCATION_HINTS.find(({ test }) => test(location, coords)) || null;

const createPreview = (dataUrl) =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const { width, height } = img;
      const scale = Math.min(1, MAX_PREVIEW_DIMENSION / Math.max(width, height));
      const canvas = document.createElement("canvas");
      canvas.width = width * scale;
      canvas.height = height * scale;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", PREVIEW_QUALITY));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });

export default function PlayfulEnvironmentDesigner() {
  const canvasRef = useRef(null);
  const imageRef = useRef(null);
  const fileInputRef = useRef(null);

  const [imageSrc, setImageSrc] = useState("");
  const [spaceDescription, setSpaceDescription] = useState("");
  const [transformation, setTransformation] = useState("");
  const [scenarioType, setScenarioType] = useState("adaptation");
  const [includePlay, setIncludePlay] = useState(true);
  const [location, setLocation] = useState("");
  const [locationStatus, setLocationStatus] = useState("");
  const [detectedCoordinates, setDetectedCoordinates] = useState(null);
  const [drawingNotes, setDrawingNotes] = useState("");
  const [autoDescription, setAutoDescription] = useState("");
  const [autoDescriptionStatus, setAutoDescriptionStatus] = useState("");
  const [imagePrompt, setImagePrompt] = useState("");
  const [promptWarning, setPromptWarning] = useState("");
  const [response, setResponse] = useState("");
  const [scoreSummary, setScoreSummary] = useState(null);
  const [scoreStatus, setScoreStatus] = useState("");
  const [imageGenerationStatus, setImageGenerationStatus] = useState("");
  const [generatedImage, setGeneratedImage] = useState(null);
  const [conceptSourceImage, setConceptSourceImage] = useState(null);
  const [refinePrompt, setRefinePrompt] = useState("");

  useEffect(() => {
    if (!imageSrc || !canvasRef.current || !imageRef.current) return;
    const canvas = canvasRef.current;
    const base = imageRef.current;
    canvas.width = base.clientWidth;
    canvas.height = base.clientHeight;
  }, [imageSrc]);

  useEffect(() => {
    if (!imagePrompt.trim() || !GEMINI_IMAGE_ENABLED) {
      setScoreSummary(null);
      setScoreStatus("");
      return;
    }

    const controller = new AbortController();
    const run = async () => {
      try {
        setScoreStatus("Scoring interventions...");
        const res = await fetch("/api/score-interventions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ location, prompt: imagePrompt }),
          signal: controller.signal,
        });

        if (!res.ok) {
          setScoreStatus("Unable to score interventions.");
          setScoreSummary(null);
          return;
        }

        const data = await res.json();
        if (!data.matches || !data.averages) {
          setScoreStatus("No matching interventions found.");
          setScoreSummary(null);
          return;
        }

        setScoreStatus("");
        setScoreSummary(data);
      } catch (error) {
        if (error.name !== "AbortError") {
          console.error("Score lookup failed:", error);
          setScoreStatus("Unable to score interventions.");
          setScoreSummary(null);
        }
      }
    };

    run();
    return () => controller.abort();
  }, [imagePrompt, location]);

  const handleImageUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImageSrc("");
    setLocationStatus("Reading image...");
    setLocation("");
    setDetectedCoordinates(null);
    setAutoDescription("");
    setAutoDescriptionStatus("");

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      setImageSrc(result);
      if (AUTO_DESCRIPTION_ENABLED && typeof result === "string") {
        generateImageDescription(result);
      }
    };
    reader.readAsDataURL(file);

    try {
      const gps = await exifr.gps(file);
      if (gps?.latitude && gps?.longitude) {
        const latitude = Number(gps.latitude);
        const longitude = Number(gps.longitude);
        setDetectedCoordinates({ latitude, longitude });
        setLocationStatus("Looking up the detected coordinates...");

        const params = new URLSearchParams({ lat: `${latitude}`, lon: `${longitude}` });
        const res = await fetch(`/api/reverse-geocode?${params.toString()}`);
        if (res.ok) {
          const data = await res.json();
          if (data.displayName) {
            setLocation(data.displayName);
            setLocationStatus("Location detected; you can edit it below.");
          } else {
            setLocationStatus("Coordinates found, but we couldn't map them to a place. Please type it manually.");
          }
        } else {
          setLocationStatus("Reverse geocoding failed. Please type the location manually.");
        }
      } else {
        setLocationStatus("No GPS metadata found; please type the location.");
      }
    } catch (error) {
      console.error("EXIF read failed:", error);
      setLocationStatus("We couldn't read GPS data; please type the location.");
    }
  };

  const generateImageDescription = async (dataUrl) => {
    setAutoDescriptionStatus("Analyzing the image...");
    try {
      const preview = await createPreview(dataUrl);
      const res = await fetch("/api/describe-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageData: preview }),
      });
      const data = await res.json();
      if (res.ok && data.description) {
        setAutoDescription(data.description);
        setAutoDescriptionStatus("Suggested description ready. You can use or edit it.");
      } else {
        setAutoDescriptionStatus("We couldn't auto-describe this image.");
      }
    } catch (error) {
      console.error("Auto description failed:", error);
      setAutoDescriptionStatus("We couldn't auto-describe this image.");
    }
  };

  const handleDraw = (event) => {
    if (!imageSrc) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (event.clientX - rect.left) * scaleX;
    const y = (event.clientY - rect.top) * scaleY;
    ctx.fillStyle = "rgba(0, 200, 255, 0.4)";
    ctx.beginPath();
    ctx.arc(x, y, 12, 0, 2 * Math.PI);
    ctx.fill();
  };

  const handlePromptSubmit = async () => {
    const thinkingMessage = scenarioType === "adaptation"
      ? "Thinking of playful ideas..."
      : "Analyzing the vulnerability...";
    setResponse(thinkingMessage);
    setImagePrompt("");
    setPromptWarning("");

    const baseTag = scenarioType === "adaptation"
      ? includePlay
        ? `[Playful adaptation]`
        : `[Non-play resilience]`
      : `[Vulnerability assessment]`;

    const locationContext = location
      ? `Location: ${location}. `
      : detectedCoordinates
        ? `Coordinates: ${detectedCoordinates.latitude.toFixed(4)}, ${detectedCoordinates.longitude.toFixed(4)}. `
        : "";

    const hint = scenarioType === "adaptation" && includePlay
      ? findHint(location, detectedCoordinates)
      : null;
    const hintContext = hint?.hint ? ` Climate adaptation hint: ${hint.hint}` : "";
    const speciesContext = hint?.species?.length
      ? ` Native species ideas: ${hint.species.slice(0, 2).join(", ")}.`
      : "";

    const languageRule = detectLanguage(`${spaceDescription} ${transformation}`);
    const languageInstruction = languageRule ? ` Respond in ${languageRule.label}.` : "";
    const sketchContext = drawingNotes.trim() ? ` Sketch notes: ${drawingNotes.trim()}.` : "";

    const scenarioDetailFallback = scenarioType === "adaptation"
      ? includePlay
        ? "inclusive, nature-based play elements that support local families"
        : "climate-adaptive measures that support community resilience"
      : includePlay
        ? "the climate vulnerability currently affecting play"
        : "the climate vulnerability affecting daily use";

    const scenarioDetail = transformation.trim() || scenarioDetailFallback;
    const mentionsRemoval = /(remove|take\s?away|no longer|get rid of)/i.test(transformation);
    const imageSubject = spaceDescription.trim() || "the place shown in the image";

    const mainInstruction = scenarioType === "adaptation"
      ? `Using the provided image of ${imageSubject}, please ${mentionsRemoval ? "address" : "add"} ${scenarioDetail} in the scene. Ensure the proposal respects the existing surroundings in the image.`
      : `Using the provided image of ${imageSubject}, describe the vulnerability (${scenarioDetail}) as it appears in the scene. Ensure the description references the existing surroundings and highlights who is affected.`;

    const focusContext = scenarioType === "adaptation"
      ? includePlay
        ? " Describe nature-based flood/heat measures with playful touches."
        : " Describe nature-based flood/heat measures only."
      : includePlay
        ? " Describe the vulnerability, who it affects, and how it disrupts play. Do not propose interventions."
        : " Describe the vulnerability, who it affects, and how it impacts everyday use. Do not propose interventions.";

    const fullPrompt = `${baseTag} ${locationContext}${mainInstruction}${sketchContext}${hintContext}${speciesContext}${focusContext}${languageInstruction}`;

    try {
      const res = await fetch("/api/generate-play-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: fullPrompt }),
      });
      const data = await res.json();
      if (res.ok && data.output) {
        setResponse(data.output);
        setImagePrompt(data.output);
      } else {
        setResponse(data.error || "Failed to generate a prompt.");
      }
    } catch (error) {
      console.error("Prompt generation failed:", error);
      setResponse("An error occurred. Please try again.");
    }
  };

  const requestConceptImage = async ({ promptText, compositeDataUrl, baseDataUrl, maskData, useInpainting }) => {
    setImageGenerationStatus("Generating AI concept image...");
    setGeneratedImage(null);

    try {
      let payload;
      if (useInpainting) {
        const basePreview = await createPreview(baseDataUrl);
        payload = {
          prompt: promptText,
          mode: "inpainting",
          baseImageData: basePreview,
          maskData,
        };
      } else {
        const preview = await createPreview(compositeDataUrl);
        payload = {
          prompt: promptText,
          mode: "composite",
          imageData: preview,
        };
      }

      const res = await fetch("/api/generate-visual-concept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (res.ok && data.imageBase64) {
        const src = `data:${data.mimeType || "image/png"};base64,${data.imageBase64}`;
        setGeneratedImage({ src, mimeType: data.mimeType || "image/png" });
        if (!useInpainting) setConceptSourceImage(src);
        setImageGenerationStatus("Concept image ready.");
      } else {
        setImageGenerationStatus(data.error || "Failed to generate image.");
      }
    } catch (error) {
      console.error("Concept image generation failed:", error);
      setImageGenerationStatus("Failed to generate the concept image.");
    }
  };

  const handleGenerateImage = async () => {
    if (!GEMINI_IMAGE_ENABLED) return;
    if (!canvasRef.current || !imageRef.current || !imagePrompt.trim()) {
      setImageGenerationStatus("Please upload an image, draw, and edit the prompt first.");
      return;
    }

    try {
      if (GEMINI_INPAINTING_ENABLED) {
        const baseCanvas = document.createElement("canvas");
        const baseImage = imageRef.current;
        baseCanvas.width = baseImage.naturalWidth || baseImage.width;
        baseCanvas.height = baseImage.naturalHeight || baseImage.height;
        const baseCtx = baseCanvas.getContext("2d");
        baseCtx.drawImage(baseImage, 0, 0, baseCanvas.width, baseCanvas.height);
        const baseData = baseCanvas.toDataURL("image/png");

        const maskCanvas = document.createElement("canvas");
        maskCanvas.width = baseCanvas.width;
        maskCanvas.height = baseCanvas.height;
        const maskCtx = maskCanvas.getContext("2d");
        maskCtx.fillStyle = "black";
        maskCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
        maskCtx.drawImage(canvasRef.current, 0, 0, maskCanvas.width, maskCanvas.height);
        const imgData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
        const { data } = imgData;
        for (let i = 0; i < data.length; i += 4) {
          const alpha = data[i + 3];
          if (alpha > 0) {
            data[i] = 255;
            data[i + 1] = 255;
            data[i + 2] = 255;
            data[i + 3] = 255;
          } else {
            data[i] = 0;
            data[i + 1] = 0;
            data[i + 2] = 0;
            data[i + 3] = 255;
          }
        }
        maskCtx.putImageData(imgData, 0, 0);
        const maskData = maskCanvas.toDataURL("image/png");

        await requestConceptImage({
          promptText: imagePrompt,
          baseDataUrl: baseData,
          maskData,
          useInpainting: true,
        });
      } else {
        const compositeCanvas = document.createElement("canvas");
        const baseImage = imageRef.current;
        compositeCanvas.width = baseImage.naturalWidth || baseImage.width;
        compositeCanvas.height = baseImage.naturalHeight || baseImage.height;
        const compositeCtx = compositeCanvas.getContext("2d");
        compositeCtx.drawImage(baseImage, 0, 0, compositeCanvas.width, compositeCanvas.height);
        compositeCtx.drawImage(canvasRef.current, 0, 0, compositeCanvas.width, compositeCanvas.height);
        const compositeData = compositeCanvas.toDataURL("image/png");

        setConceptSourceImage(compositeData);
        await requestConceptImage({
          promptText: imagePrompt,
          compositeDataUrl: compositeData,
          useInpainting: false,
        });
      }
    } catch (error) {
      console.error("Prepare image failed:", error);
      setImageGenerationStatus("Could not prepare the image for generation.");
    }
  };

  const handleRefinement = async () => {
    if (!conceptSourceImage || !refinePrompt.trim()) return;
    await requestConceptImage({
      promptText: refinePrompt.trim(),
      compositeDataUrl: conceptSourceImage,
      useInpainting: false,
    });
    setRefinePrompt("");
  };

  return (
    <div className="p-4 grid gap-6 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold text-center mb-4">Playful Environment Designer</h1>

      <div>
        <label className="block mb-2 font-medium">Step 1: Upload an image</label>
        <input
          type="file"
          accept="image/*"
          ref={fileInputRef}
          onChange={handleImageUpload}
          className="hidden"
        />
        <button
          type="button"
          className="rounded px-4 py-2 text-white"
          style={{ backgroundColor: "#8d4ec4" }}
          onClick={() => fileInputRef.current?.click()}
        >
          Choose a photo
        </button>
      </div>

      {imageSrc && (
        <div className="grid gap-4">
          <div className="relative border rounded overflow-hidden">
            <img
              ref={imageRef}
              src={imageSrc}
              alt="Uploaded"
              className="block w-full"
            />
            <canvas
              ref={canvasRef}
              className="absolute inset-0 cursor-crosshair"
              onClick={handleDraw}
            />
          </div>

          <div>
            <label className="block mb-2 font-medium">Step 2: Confirm the location</label>
            <input
              className="border p-2 w-full"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Town / city / country"
            />
            <div className="text-sm text-gray-500 mt-1">{locationStatus}</div>
            {(location || detectedCoordinates) && (
              <button
                type="button"
                className="text-sm text-blue-600 underline mt-1"
                onClick={() => {
                  setLocation("");
                  setDetectedCoordinates(null);
                  setLocationStatus("Location cleared.");
                }}
              >
                Clear location
              </button>
            )}
          </div>

          <div>
            <label className="block mb-2 font-medium">
              Step 3: {scenarioType === "vulnerability"
                ? "Describe the vulnerable areas in the image. What is happening? Who is affected?"
                : "Describe space or place in image. What is it? What is in it?"}
            </label>
            {AUTO_DESCRIPTION_ENABLED && (
              <div className="mb-2 rounded border border-gray-200 bg-gray-50 p-3 text-sm text-black">
                {autoDescriptionStatus}
                {autoDescription && (
                  <div className="mt-2">
                    <p className="mb-2">{autoDescription}</p>
                    <button
                      className="rounded bg-blue-500 text-white px-3 py-1 mr-2"
                      onClick={() => {
                        setSpaceDescription(autoDescription);
                        setAutoDescriptionStatus("Description inserted; feel free to edit.");
                      }}
                    >
                      Use this description
                    </button>
                    <button
                      className="rounded border px-3 py-1"
                      onClick={() => {
                        setAutoDescription("");
                        setAutoDescriptionStatus("Description dismissed.");
                      }}
                    >
                      Dismiss
                    </button>
                  </div>
                )}
              </div>
            )}
            <textarea
              className="border p-2 w-full text-black bg-white"
              rows={2}
              value={spaceDescription}
              onChange={(e) => setSpaceDescription(e.target.value)}
            />
          </div>

          <div>
            <label className="block mb-2 font-medium">Step 4: Sketch notes (color + meaning)</label>
            <textarea
              className="border p-2 w-full"
              rows={2}
              placeholder="e.g., Green arcs = papyrus reedbed"
              value={drawingNotes}
              onChange={(e) => setDrawingNotes(e.target.value)}
            />
          </div>

          <div>
            <label className="block mb-2 font-medium">Step 5: What are you describing?</label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="scenario"
                  value="adaptation"
                  checked={scenarioType === "adaptation"}
                  onChange={() => setScenarioType("adaptation")}
                />
                Adaptation
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="scenario"
                  value="vulnerability"
                  checked={scenarioType === "vulnerability"}
                  onChange={() => setScenarioType("vulnerability")}
                />
                Vulnerability
              </label>
            </div>
          </div>

          <div>
            <label className="block mb-2 font-medium">Include play opportunities?</label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="play"
                  checked={includePlay}
                  onChange={() => setIncludePlay(true)}
                />
                Yes
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="play"
                  value="no"
                  checked={!includePlay}
                  onChange={() => setIncludePlay(false)}
                />
                No
              </label>
            </div>
          </div>

          <div>
            <label className="block mb-2 font-medium">
              Step 6: {scenarioType === "adaptation"
                ? "How would you like to transform this place?"
                : "Describe the vulnerability. How does it emerge?"}
            </label>
            <textarea
              className="border p-2 w-full"
              rows={3}
              value={transformation}
              onChange={(e) => setTransformation(e.target.value)}
            />
          </div>

          <div>
            <button
              className="rounded bg-teal-600 text-white px-4 py-2"
              onClick={handlePromptSubmit}
            >
              Generate AI Prompt
            </button>
            {response && (
              <div className="mt-3 border rounded p-3 bg-gray-50">
                <strong>Suggested Prompt</strong>
                <textarea
                  className="border p-2 w-full mt-2 text-sm text-black bg-white"
                  rows={3}
                  value={imagePrompt}
                  onChange={(e) => {
                    const next = e.target.value;
                    setImagePrompt(next);
                    const wordCount = next.trim() ? next.trim().split(/\s+/).length : 0;
                    setPromptWarning(wordCount > 80 ? "This prompt is getting long; consider trimming." : "");
                  }}
                />
                {promptWarning && (
                  <p className="text-sm text-amber-600 mt-1">{promptWarning}</p>
                )}
              </div>
            )}
          </div>

          {GEMINI_IMAGE_ENABLED && response && (
            <div className="border rounded p-4 bg-white shadow-sm">
              {scoreStatus && <p className="text-sm text-gray-600">{scoreStatus}</p>}
              {!scoreStatus && scoreSummary && (
                <p className="text-sm text-gray-700">
                  Matched interventions: {scoreSummary.matches} · Average cost {scoreSummary.averages.cost.toFixed(1)} /5 · Ease {scoreSummary.averages.ease.toFixed(1)} /5 · Effectiveness {scoreSummary.averages.effectiveness.toFixed(1)} /5
                </p>
              )}

              <button
                className="mt-3 rounded bg-purple-600 text-white px-4 py-2"
                onClick={handleGenerateImage}
              >
                Generate AI Image Concept
              </button>
              {imageGenerationStatus && (
                <p className="text-sm text-gray-600 mt-2">{imageGenerationStatus}</p>
              )}

              {generatedImage && (
                <div className="mt-4">
                  <img src={generatedImage.src} alt="AI concept" className="rounded border" />
                  <a
                    href={generatedImage.src}
                    download="concept-image.png"
                    className="inline-block mt-2 px-3 py-1 bg-green-600 text-white rounded"
                  >
                    Download image
                  </a>

                  {!GEMINI_INPAINTING_ENABLED && (
                    <div className="mt-4">
                      <label className="block mb-2 text-sm font-medium">Refine the AI image (describe the tweak)</label>
                      <textarea
                        className="border p-2 w-full text-sm"
                        rows={2}
                        value={refinePrompt}
                        onChange={(e) => setRefinePrompt(e.target.value)}
                      />
                      <button
                        className="mt-2 px-3 py-1 bg-indigo-600 text-white rounded disabled:opacity-50"
                        disabled={!refinePrompt.trim()}
                        onClick={handleRefinement}
                      >
                        Apply refinement
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
