export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const key = process.env.OCR_key;
  if (!key) return res.status(500).json({ error: "Missing OCR_key on server" });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const imageBase64 = body?.imageBase64;

    if (!imageBase64 || typeof imageBase64 !== "string" || imageBase64.length < 1000) {
      return res.status(400).json({ error: "Missing/invalid imageBase64" });
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
    if (!visionRes.ok) return res.status(visionRes.status).json({ error: raw });

    const json = JSON.parse(raw);
    const r0 = json.responses?.[0] ?? {};
    const fullText = r0.fullTextAnnotation?.text ?? r0.textAnnotations?.[0]?.description ?? "";
    const items = (r0.textAnnotations ?? []).slice(1).map((a) => ({
      text: a.description,
      boundingBox: a.boundingPoly?.vertices ?? [],
    }));

    return res.status(200).json({ fullText, items });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message ?? e) });
  }
}
