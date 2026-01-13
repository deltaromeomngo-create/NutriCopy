// api/ocr.js
// Vercel Serverless Function (Node) — OCR thin spike endpoint
// CommonJS module export (works without "type": "module")

async function readJsonBody(req) {
  // Vercel dev can set req.body OR not; we handle both.
  if (req.body && typeof req.body === "object") return req.body;

  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return null;
    }
  }

  // Raw stream read
  const chunks = [];
  await new Promise((resolve, reject) => {
    req.on("data", (c) => chunks.push(c));
    req.on("end", resolve);
    req.on("error", reject);
  });

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function handler(req, res) {
  try {
    // CORS for browser/expo-web testing
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") return res.status(204).end();

    if (req.method === "GET") {
      return res.status(405).json({
        error: "Method Not Allowed",
        hint: "POST JSON: { imageBase64: '...base64...' }",
      });
    }

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method Not Allowed" });
    }

    const key = process.env.OCR_key;
    if (!key) {
      return res.status(500).json({
        error: "Missing OCR_key env var",
        hint: "Set OCR_key in Vercel + pull envs for local dev",
      });
    }

    const body = await readJsonBody(req);
    if (!body) return res.status(400).json({ error: "Invalid JSON" });

    let imageBase64 = body.imageBase64;
    if (typeof imageBase64 !== "string") {
      return res.status(400).json({
        error: "Missing imageBase64",
        expected: "{ imageBase64: '...base64...' }",
      });
    }

    // allow data URLs
    imageBase64 = imageBase64.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "");

    if (!imageBase64 || imageBase64.length < 100) {
      return res.status(400).json({
        error: "imageBase64 too small/empty",
        hint: "Base64 must be the bytes of the image, not a filename.",
      });
    }

    if (imageBase64.length > 8_000_000) {
      return res.status(413).json({
        error: "Payload too large",
        hint: "Send a smaller/compressed image.",
      });
    }


    const payload = {
      requests: [
        {
          image: { content: imageBase64 },
          features: [{ type: "DOCUMENT_TEXT_DETECTION", maxResults: 1 }],
        },
      ],
    };

    const visionRes = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );

    const raw = await visionRes.text();

    if (!visionRes.ok) {
      return res.status(visionRes.status).json({
        error: "Vision API error",
        status: visionRes.status,
        body: raw,
      });
    }

    const json = JSON.parse(raw);
    const r0 = json?.responses?.[0] || {};

    const fullText =
      r0?.fullTextAnnotation?.text ||
      r0?.textAnnotations?.[0]?.description ||
      "";

    const items = (r0?.textAnnotations || [])
      .slice(1)
      .map((a) => ({
        text: a.description,
        boundingBox: a.boundingPoly?.vertices || [],
      }));

    return res.status(200).json({ fullText, items });
  } catch (err) {
    // Always respond; prevents NO_RESPONSE_FROM_FUNCTION
    return res.status(500).json({
      error: "Server error",
      message: (err && err.message) ? err.message : String(err),
    });
  }
}

module.exports = handler;
