import React, { useRef, useState } from "react";
import { Button } from "@/components/ui/button";

export default function PlayfulEnvironmentApp() {
  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);
  const [image, setImage] = useState(null);
  const [prompt, setPrompt] = useState("");
  const [response, setResponse] = useState("");

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    const img = new Image();
    img.onload = () => {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      setImage(img);
    };
    img.src = URL.createObjectURL(file);
  };

  const handleDraw = (e) => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    ctx.fillStyle = "rgba(255, 0, 0, 0.4)";
    ctx.beginPath();
    ctx.arc(x, y, 10, 0, 2 * Math.PI);
    ctx.fill();
  };

  const handlePromptSubmit = async () => {
    setResponse("Thinking of playful ideas...");
    const res = await fetch("/api/generate-play-prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    const data = await res.json();
    setResponse(data.output);
  };

  return (
    <div className="p-4 grid gap-4 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold">Playful Environment Designer</h1>
      <input
        type="file"
        accept="image/*"
        ref={fileInputRef}
        onChange={handleImageUpload}
      />
      <canvas
        ref={canvasRef}
        onClick={handleDraw}
        className="border rounded-md cursor-crosshair"
      />

      <textarea
        className="border rounded-md p-2 w-full"
        placeholder="Describe what playful features you want to add..."
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
      />
      <Button onClick={handlePromptSubmit}>Generate Design Prompt</Button>

      {response && (
        <div className="bg-gray-100 p-4 rounded-md">
          <strong>Suggested Prompt for Krea:</strong>
          <p>{response}</p>
        </div>
      )}
    </div>
  );
}
