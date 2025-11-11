import React, { useState, useRef, useEffect } from "react";
import exifr from "exifr";

const AUTO_DESCRIPTION_ENABLED =
  process.env.NEXT_PUBLIC_ENABLE_IMAGE_DESCRIPTION === "true";
const GEMINI_IMAGE_ENABLED =
  (process.env.NEXT_PUBLIC_ENABLE_GEMINI_IMAGE || "").toLowerCase() === "true";
const GEMINI_INPAINTING_ENABLED =
  (process.env.NEXT_PUBLIC_ENABLE_GEMINI_INPAINTING || "").toLowerCase() === "true";

console.log("GEMINI flag", process.env.NEXT_PUBLIC_ENABLE_GEMINI_IMAGE);

const MAX_PREVIEW_DIMENSION = 1024;
const PREVIEW_QUALITY = 0.7;
const DEFAULT_BRUSH_COLOR = "#00c8ff";
const MAX_UNDO_STATES = 15;
const TOOL_OPTIONS = [
  { id: "brush", label: "Brush", icon: "🖌️" },
  { id: "eraser", label: "Eraser", icon: "🧽" },
  { id: "eyedropper", label: "Eyedropper", icon: "🎯" },
];

const pickRandom = (items = []) => {
  if (!Array.isArray(items) || items.length === 0) return null;
  const index = Math.floor(Math.random() * items.length);
  return items[index];
};

const sampleItems = (items = [], count = 1) => {
  if (!Array.isArray(items) || items.length === 0 || count <= 0) return [];
  const pool = [...items];
  const result = [];
  const take = Math.min(count, pool.length);
  for (let i = 0; i < take; i += 1) {
    const index = Math.floor(Math.random() * pool.length);
    result.push(pool.splice(index, 1)[0]);
  }
  return result;
};

const hexToRgb = (hex = "") => {
  const sanitized = hex.replace("#", "");
  if (![3, 6].includes(sanitized.length)) {
    return { r: 0, g: 200, b: 255 };
  }
  const expanded =
    sanitized.length === 3
      ? sanitized
          .split("")
          .map((ch) => ch + ch)
          .join("")
      : sanitized;
  const intVal = parseInt(expanded, 16);
  return {
    r: (intVal >> 16) & 255,
    g: (intVal >> 8) & 255,
    b: intVal & 255,
  };
};

const rgbToHex = (r = 0, g = 0, b = 0) => {
  const toHex = (value) =>
    Math.max(0, Math.min(255, Math.round(value || 0)))
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

const rgbaFromHex = (hex, alpha = 1) => {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

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
    hints: [
      "Use stepped papyrus reedbeds and bamboo play decks to slow runoff along wetland edges.",
      "Float play pods over seasonal pools, linking them with woven palm bridges for refuge play.",
      "Carve rain-garden amphitheaters with shade sails so families can gather above stormwater.",
      "Mix terraced food gardens with kid-friendly water channels to drain courtyards after storms.",
    ],
    species: ["papyrus", "traveller's palm", "screw pine", "bamboo", "baobab saplings", "lemongrass", "water hyacinth mats"],
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
    hints: [
      "Lay floating play rafts tied to papyrus islands so kids can explore safer wetland zones.",
      "Build permeable play plazas that drain into rain gardens before water reaches Lake Victoria.",
      "Create raised mangrove boardwalk loops with shade hammocks for caregivers.",
      "Add colorful rainwater slides that channel overflow into reed-filtered splash basins.",
    ],
    species: ["papyrus", "raffia palm", "African fan palm", "mangrove seedlings", "water lettuce", "sisal ropes", "native reeds"],
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
  const drawingState = useRef({ active: false, lastX: 0, lastY: 0 });
  const undoStackRef = useRef([]);

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
  const [refinementLog, setRefinementLog] = useState([]);
  const [tool, setTool] = useState("brush");
  const [brushColor, setBrushColor] = useState(DEFAULT_BRUSH_COLOR);
  const [brushOpacity, setBrushOpacity] = useState(0.6);
  const [brushSize, setBrushSize] = useState(18);
  const [hasSketch, setHasSketch] = useState(false);
  const [canUndo, setCanUndo] = useState(false);

  const condenseText = (text = "", wordLimit = 110) => {
    const words = text.trim().split(/\s+/);
    if (!text.trim() || words.length <= wordLimit) return text.trim();
    return words.slice(0, wordLimit).join(" ");
  };

  const getCanvasContext = () => {
    if (!canvasRef.current) return null;
    return canvasRef.current.getContext("2d");
  };

  const getCanvasCoords = (event) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
    };
  };

  const canvasHasInk = () => {
    const canvas = canvasRef.current;
    if (!canvas) return false;
    const ctx = getCanvasContext();
    if (!ctx) return false;
    const { width, height } = canvas;
    if (!width || !height) return false;
    try {
      const { data } = ctx.getImageData(0, 0, width, height);
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] > 0) return true;
      }
      return false;
    } catch (error) {
      console.error("Canvas read failed:", error);
      return false;
    }
  };

  const clearCanvasLayer = () => {
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = getCanvasContext();
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }
    undoStackRef.current = [];
    setCanUndo(false);
    setHasSketch(false);
  };

  const saveCanvasState = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const snapshot = canvas.toDataURL("image/png");
    undoStackRef.current.push(snapshot);
    if (undoStackRef.current.length > MAX_UNDO_STATES) {
      undoStackRef.current.shift();
    }
    setCanUndo(undoStackRef.current.length > 0);
  };

  const restoreCanvasState = (snapshot) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = getCanvasContext();
    if (!ctx) return;
    if (!snapshot) {
      clearCanvasLayer();
      return;
    }
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      setHasSketch(canvasHasInk());
    };
    img.src = snapshot;
  };

  const handleUndoSketch = () => {
    if (!canvasRef.current) return;
    if (undoStackRef.current.length === 0) {
      clearCanvasLayer();
      return;
    }
    const snapshot = undoStackRef.current.pop();
    restoreCanvasState(snapshot);
    setCanUndo(undoStackRef.current.length > 0);
  };

  const handleClearSketch = () => {
    clearCanvasLayer();
  };

  const handlePointerDown = (event) => {
    if (!imageSrc || !canvasRef.current) return;
    event.preventDefault();
    const coords = getCanvasCoords(event);
    if (!coords) return;
    const ctx = getCanvasContext();
    if (!ctx) return;

    if (tool === "eyedropper") {
      const pixel = ctx
        .getImageData(Math.floor(coords.x), Math.floor(coords.y), 1, 1)
        .data;
      if (pixel[3] > 0) {
        setBrushColor(rgbToHex(pixel[0], pixel[1], pixel[2]));
        const sampledOpacity = Number((pixel[3] / 255).toFixed(2));
        setBrushOpacity(sampledOpacity > 0 ? sampledOpacity : brushOpacity);
        setTool("brush");
      }
      return;
    }

    saveCanvasState();
    drawingState.current = { active: true, lastX: coords.x, lastY: coords.y };
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = brushSize;
    ctx.strokeStyle = rgbaFromHex(brushColor, brushOpacity);
    ctx.globalCompositeOperation =
      tool === "eraser" ? "destination-out" : "source-over";
    ctx.beginPath();
    ctx.moveTo(coords.x, coords.y);
    ctx.lineTo(coords.x, coords.y);
    ctx.stroke();
  };

  const handlePointerMove = (event) => {
    if (!drawingState.current.active) return;
    event.preventDefault();
    const coords = getCanvasCoords(event);
    if (!coords) return;
    const ctx = getCanvasContext();
    if (!ctx) return;
    ctx.lineTo(coords.x, coords.y);
    ctx.stroke();
    drawingState.current.lastX = coords.x;
    drawingState.current.lastY = coords.y;
  };

  const endStroke = () => {
    if (!drawingState.current.active) return;
    drawingState.current.active = false;
    const ctx = getCanvasContext();
    if (ctx) {
      ctx.closePath();
      ctx.globalCompositeOperation = "source-over";
    }
    setHasSketch(canvasHasInk());
  };

  const handlePointerUp = () => endStroke();
  const handlePointerLeave = () => endStroke();
  const handlePointerCancel = () => endStroke();

  const buildGeminiPrompt = () => {
    const baseTag = scenarioType === "adaptation"
      ? includePlay
        ? "[Playful adaptation]"
        : "[Non-play resilience]"
      : "[Vulnerability assessment]";

    const locationSnippet = location
      ? `Context: ${location}.`
      : detectedCoordinates
        ? `Context: ${detectedCoordinates.latitude.toFixed(4)}, ${detectedCoordinates.longitude.toFixed(4)}.`
        : "";

    const hint = scenarioType === "adaptation"
      ? findHint(location, detectedCoordinates)
      : null;
    const hintSentence = hint?.hints?.length
      ? pickRandom(hint.hints)
      : hint?.hint || "";
    const hintSnippet = hintSentence ? `Local cues: ${hintSentence}` : "";
    const speciesList = hint?.species?.length
      ? sampleItems(hint.species, 2)
      : [];
    const speciesSnippet = speciesList.length
      ? `Species: ${speciesList.join(", ")}.`
      : "";

    const sketchSnippet = drawingNotes.trim()
      ? `Sketch notes: ${drawingNotes.trim()}.`
      : "";

    const userSnippet = imagePrompt.trim()
      ? `User description: ${condenseText(imagePrompt, 80)}.`
      : "";

    const focusSnippet = scenarioType === "adaptation"
      ? includePlay
        ? "Instruction: show climate-smart play adaptations with natural materials."
        : "Instruction: show low-impact climate adaptations; no play equipment."
      : includePlay
        ? "Instruction: describe vulnerability impacts on play only; no solutions."
        : "Instruction: describe vulnerability impacts on daily use only; no solutions.";

    const languageRule = detectLanguage(`${spaceDescription} ${transformation}`);
    const languageSnippet = languageRule ? `Respond in ${languageRule.label}.` : "";

    return [
      baseTag,
      locationSnippet,
      userSnippet,
      sketchSnippet,
      hintSnippet,
      speciesSnippet,
      focusSnippet,
      languageSnippet,
    ]
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  };

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

    clearCanvasLayer();
    setGeneratedImage(null);
    setConceptSourceImage(null);
    setImageSrc("");
    setLocationStatus("Reading image...");
    setLocation("");
    setDetectedCoordinates(null);
    setAutoDescription("");
    setAutoDescriptionStatus("");
    setRefinementLog([]);

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

    const hint = scenarioType === "adaptation"
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

  const requestConceptImage = async ({
    promptText,
    compositeDataUrl,
    baseDataUrl,
    maskData,
    useInpainting,
    sketchProvided = true,
  }) => {
    setImageGenerationStatus(
      sketchProvided
        ? "Generating AI concept image..."
        : "Generating AI concept image (no sketch guidance)..."
    );
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
      setImageGenerationStatus("Please upload an image and generate the prompt first.");
      return;
    }

    const geminiPrompt = buildGeminiPrompt();
    if (!geminiPrompt) {
      setImageGenerationStatus("Prompt is empty. Please describe the scene first.");
      return;
    }
    setRefinementLog([]);

    try {
      const canUseInpainting = GEMINI_INPAINTING_ENABLED && hasSketch;
      if (canUseInpainting) {
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
          promptText: geminiPrompt,
          baseDataUrl: baseData,
          maskData,
          useInpainting: true,
          sketchProvided: true,
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
          promptText: geminiPrompt,
          compositeDataUrl: compositeData,
          useInpainting: false,
          sketchProvided: hasSketch,
        });
      }
    } catch (error) {
      console.error("Prepare image failed:", error);
      setImageGenerationStatus("Could not prepare the image for generation.");
    }
  };

  const handleRefinement = async () => {
    if (!conceptSourceImage || !refinePrompt.trim()) return;
    const promptText = refinePrompt.trim();
    await requestConceptImage({
      promptText,
      compositeDataUrl: conceptSourceImage,
      useInpainting: false,
      sketchProvided: true,
    });
    setRefinementLog((prev) => [
      ...prev,
      {
        prompt: promptText,
        timestamp: new Date().toISOString(),
      },
    ]);
    setRefinePrompt("");
  };

  const handleDownloadSession = () => {
    if (!generatedImage) {
      setImageGenerationStatus("Generate an image before downloading the session.");
      return;
    }

    try {
      const exportedAt = new Date();
      const dateLabel = exportedAt.toLocaleDateString();
      const timeLabel = exportedAt.toLocaleTimeString();
      const timestampLabel = exportedAt.toISOString();
      const locationLabel = location
        ? location
        : detectedCoordinates
          ? `${detectedCoordinates.latitude.toFixed(4)}, ${detectedCoordinates.longitude.toFixed(4)}`
          : "Not provided";
      const refinementSummary = refinementLog.length
        ? refinementLog
            .map(
              ({ prompt, timestamp }, index) =>
                `${index + 1}. ${new Date(timestamp).toLocaleString()} — ${prompt}`
            )
            .join(" | ")
        : "None";
      const scoreText =
        scoreSummary && scoreSummary.averages
          ? `Matches: ${scoreSummary.matches}; Cost ${scoreSummary.averages.cost.toFixed(
            1
          )}/5; Ease ${scoreSummary.averages.ease.toFixed(1)}/5; Effectiveness ${scoreSummary.averages.effectiveness.toFixed(
            1
          )}/5`
          : "Not available";

      const dataFields = [
        { field: "Space description", value: spaceDescription || "Not provided" },
        { field: "Transformation", value: transformation || "Not provided" },
        { field: "Sketch notes", value: drawingNotes || "Not provided" },
        { field: "Scenario type", value: scenarioType },
        { field: "Include play", value: includePlay ? "Yes" : "No" },
        { field: "Generated prompt", value: imagePrompt || "Not generated" },
        { field: "Auto description", value: autoDescription || "Not requested" },
        { field: "Score summary", value: scoreText },
        { field: "Image status", value: imageGenerationStatus || "Not started" },
        { field: "Generated image (data URL)", value: generatedImage?.src || "Not available" },
      ];

      const headers = [
        "Field",
        "Value",
        "Location",
        "Date",
        "Timestamp",
        "Local Time",
        "Refinement log",
      ];
      const csvRows = [headers];
      dataFields.forEach(({ field, value }) => {
        csvRows.push([
          field,
          value,
          locationLabel,
          dateLabel,
          timestampLabel,
          timeLabel,
          refinementSummary,
        ]);
      });
      const csvContent = csvRows
        .map((row) =>
          row
            .map((cell) => {
              const str = String(cell ?? "");
              if (/[,"\n]/.test(str)) {
                return `"${str.replace(/"/g, '""')}"`;
              }
              return str;
            })
            .join(",")
        )
        .join("\n");
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `playful-session-${exportedAt.getTime()}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Excel export failed:", error);
      setImageGenerationStatus("Could not download the session file.");
    }
  };

  const sketchLegend = drawingNotes
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const canGenerateImage = Boolean(
    GEMINI_IMAGE_ENABLED && imageSrc && imagePrompt.trim()
  );
  const canvasCursor =
    tool === "eyedropper" ? "copy" : tool === "eraser" ? "cell" : "crosshair";
  const opacityPercent = Math.round(brushOpacity * 100);

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
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_280px]">
            <div className="relative border rounded overflow-hidden">
              <img
                ref={imageRef}
                src={imageSrc}
                alt="Uploaded"
                className="block w-full"
              />
              <canvas
                ref={canvasRef}
                className="absolute inset-0"
                style={{ touchAction: "none", cursor: canvasCursor }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerLeave={handlePointerLeave}
                onPointerCancel={handlePointerCancel}
              />
            </div>

            <div className="rounded border bg-white p-4 shadow-sm">
              <p className="text-sm font-semibold text-gray-800 mb-3">Sketch controls</p>
              <div className="flex gap-2 mb-3">
                {TOOL_OPTIONS.map(({ id, label, icon }) => (
                  <button
                    key={id}
                    type="button"
                    className={`flex-1 rounded border px-2 py-1 text-sm transition ${
                      tool === id
                        ? "bg-teal-600 text-white border-teal-600"
                        : "bg-white border-gray-300 text-gray-700 hover:border-gray-400"
                    }`}
                    onClick={() => setTool(id)}
                  >
                    <span className="mr-1" aria-hidden="true">
                      {icon}
                    </span>
                    {label}
                  </button>
                ))}
              </div>

              <div className="mb-3">
                <label className="block text-xs font-semibold uppercase text-gray-500 mb-1">
                  Brush color
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={brushColor}
                    onChange={(e) => setBrushColor(e.target.value)}
                    className="h-10 w-16 bg-transparent border border-gray-300 rounded cursor-pointer"
                    aria-label="Pick brush color"
                  />
                  <div className="flex-1">
                    <div className="flex justify-between text-xs text-gray-500">
                      <span>Opacity</span>
                      <span>{opacityPercent}%</span>
                    </div>
                    <input
                      type="range"
                      min="0.1"
                      max="1"
                      step="0.05"
                      value={brushOpacity}
                      onChange={(e) => setBrushOpacity(Number(e.target.value))}
                      className="w-full"
                    />
                  </div>
                </div>
              </div>

              <div className="mb-3">
                <div className="flex justify-between text-xs text-gray-500">
                  <span className="font-semibold uppercase">Brush size</span>
                  <span>{brushSize}px</span>
                </div>
                <input
                  type="range"
                  min="4"
                  max="80"
                  value={brushSize}
                  onChange={(e) => setBrushSize(Number(e.target.value))}
                  className="w-full"
                />
              </div>

              <div className="flex gap-2 mb-2 bg-gray-100 rounded p-2">
                <button
                  type="button"
                  className="flex-1 rounded border px-3 py-1 text-sm bg-white hover:bg-gray-50 flex items-center justify-center gap-2 transition disabled:text-gray-500 disabled:border-gray-400 disabled:bg-white disabled:shadow-none disabled:cursor-not-allowed shadow-sm"
                  onClick={handleUndoSketch}
                  disabled={!canUndo}
                >
                  <span aria-hidden="true">↺</span>
                  <span>Undo stroke</span>
                </button>
                <button
                  type="button"
                  className="flex-1 rounded border px-3 py-1 text-sm bg-white hover:bg-gray-50 flex items-center justify-center gap-2 transition disabled:text-gray-500 disabled:border-gray-400 disabled:bg-white disabled:shadow-none disabled:cursor-not-allowed shadow-sm"
                  onClick={handleClearSketch}
                  disabled={!hasSketch}
                >
                  <span aria-hidden="true">🧹</span>
                  <span>Clear sketch</span>
                </button>
              </div>

              <div className="border-t pt-3">
                <p className="text-xs font-semibold uppercase text-gray-500 mb-1">
                  Sketch legend
                </p>
                {sketchLegend.length ? (
                  <ul className="text-sm text-gray-700 list-disc list-inside space-y-1 max-h-32 overflow-auto">
                    {sketchLegend.map((item, index) => (
                      <li key={`${item}-${index}`}>{item}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-gray-500">
                    Add legend notes in Step 4 to remind Gemini what each color or shape represents.
                  </p>
                )}
              </div>
            </div>
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
              <div className="mt-3 border rounded p-3 bg-gray-50 text-gray-900">
                <strong className="text-gray-900">Suggested Prompt</strong>
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
                type="button"
                className={`mt-3 rounded px-4 py-2 text-white ${
                  canGenerateImage
                    ? "bg-purple-600 hover:bg-purple-500"
                    : "bg-purple-300 cursor-not-allowed"
                }`}
                onClick={handleGenerateImage}
                disabled={!canGenerateImage}
              >
                Generate AI Image Concept
              </button>
              <p className="text-xs text-gray-500 mt-2">
                {canGenerateImage
                  ? hasSketch
                    ? "Sketch detected. Gemini will follow both the prompt and your highlights."
                    : "No sketch yet—Gemini will rely on the photo and prompt. Add notes if you want to highlight areas."
                  : "Upload a photo and generate the prompt to enable this button."}
              </p>
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
                  <button
                    type="button"
                    className="inline-block mt-2 ml-2 px-3 py-1 bg-slate-700 text-white rounded hover:bg-slate-600"
                    onClick={handleDownloadSession}
                  >
                    Download session (.csv)
                  </button>

                  {!GEMINI_INPAINTING_ENABLED && (
                    <div className="mt-4">
                      <label className="block mb-2 text-sm font-medium text-gray-800">
                        Refine the AI image (describe the tweak)
                      </label>
                      <textarea
                        className="border p-2 w-full text-sm text-gray-900"
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
