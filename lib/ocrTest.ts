/// <reference types="node" />

import fs from "node:fs";

export async function extractRawTextFromImage(imagePath: string) {
  const VISION_API_KEY = process.env.OCR_key;
  if (!VISION_API_KEY) {
    throw new Error("Missing OCR_key in environment (.env in project root).");
  }

  const imageBuffer = fs.readFileSync(imagePath);
  const base64Image = imageBuffer.toString("base64");

  // Sanity checks (to avoid sending an empty/invalid request)
  if (!base64Image || base64Image.length < 100) {
    throw new Error("Image base64 appears empty/too small. Check the file path.");
  }

  const payload = {
    requests: [
      {
        image: { content: base64Image },
        features: [{ type: "DOCUMENT_TEXT_DETECTION", maxResults: 1 }],
      },
    ],
  };


  const res = await fetch(
    `https://vision.googleapis.com/v1/images:annotate?key=${VISION_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );

  const raw = await res.text();

  if (!res.ok) {
    console.error("RAW VISION ERROR BODY:", raw);
    throw new Error(`Vision API error (${res.status}): ${raw}`);
  }

  const json: any = JSON.parse(raw);

  const annotations =
    json.responses?.[0]?.textAnnotations ??
    json.responses?.[0]?.fullTextAnnotation?.pages ??
    [];

  // Prefer fullTextAnnotation when available
  const fullText =
    json.responses?.[0]?.fullTextAnnotation?.text ??
    json.responses?.[0]?.textAnnotations?.[0]?.description ??
    "";

  const items = (json.responses?.[0]?.textAnnotations ?? []).slice(1).map((a: any) => ({
    text: a.description,
    boundingBox: a.boundingPoly?.vertices ?? [],
  }));

  return { fullText, items };
}
