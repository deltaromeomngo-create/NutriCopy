// api/ocr.js
// Vercel Serverless Function — OCR thin spike
// CommonJS ONLY

const { ocrPost } = require("../lib/ocrPost.server.cjs");
const { isSubscribedForRequest } = require("../lib/entitlement.server.cjs");

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;

  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return null;
    }
  }

  let raw = "";
  for await (const chunk of req) raw += chunk;
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

module.exports = async function handler(req, res) {
  try {
    // --- CORS (preflight-safe) ---
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");

    const acrh = req.headers["access-control-request-headers"];
    res.setHeader(
      "Access-Control-Allow-Headers",
      typeof acrh === "string" && acrh.length ? acrh : "Content-Type"
    );
    res.setHeader("Access-Control-Max-Age", "86400");

    if (req.method === "OPTIONS") return res.status(204).end();

    // --- Health check ---
    if (req.method === "GET") {
      return res.status(200).json({ ok: true, message: "Function alive" });
    }

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method Not Allowed" });
    }

    // 🔒 SUBSCRIPTION GATE
    const DEV =
      process.env.NODE_ENV !== "production" ||
      process.env.VERCEL_ENV === "development";

    // DEV BYPASS (local only)
    if (!DEV) {
      const subscribed = await isSubscribedForRequest(req, res);
      if (!subscribed) {
        return res.status(403).json({
          error: "NOT_SUBSCRIBED",
          message: "Subscription required to scan labels",
        });
      }
    }


    const body = await readJsonBody(req);
    if (!body) return res.status(400).json({ error: "Invalid JSON" });

    // --- STUB MODE ---
    if (body.useStub === true) {
      const r0 = {
        fullTextAnnotation: {
          text: [
            "Nutrition Facts",
            "Serving Size 1 cup (114g)",
            "Calories 90",
            "Protein 3g",
            "Total Fat 3g",
            "Sodium 300mg",
            "Total Carbohydrate 13g",
          ].join("\n"),
        },
        textAnnotations: [{ description: "Nutrition Facts" }],
      };

      const debug = body?.debug === true;
      return res.status(200).json(ocrPost(r0, { debug }));

    }

    // --- REAL MODE ---
    const key = process.env.OCR_key;
    if (!key) {
      return res.status(500).json({
        error: "Missing OCR_key env var",
      });
    }

    let imageBase64 = body.imageBase64;
    if (typeof imageBase64 !== "string") {
      return res.status(400).json({ error: "Missing imageBase64" });
    }

    imageBase64 = imageBase64.replace(
      /^data:image\/[a-zA-Z0-9.+-]+;base64,/,
      ""
    );

    if (!imageBase64 || imageBase64.length < 100) {
      return res.status(400).json({ error: "imageBase64 too small" });
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
        error: "VISION_ERROR",
      });
    }

    const json = JSON.parse(raw);
    const r0 = json?.responses?.[0];
    if (!r0) {
      return res.status(500).json({ error: "Bad Vision response" });
    }

    const debug = body?.debug === true;
    return res.status(200).json(ocrPost(r0, { debug }));

  } catch (err) {
  console.error("OCR SERVER ERROR:", err);
  return res.status(500).json({
    error: "SERVER_ERROR",
    message: String(err?.message || err),
    stack: err?.stack,
  });
}


};
