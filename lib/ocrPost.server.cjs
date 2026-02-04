// lib/ocrPost.server.cjs
// CommonJS wrapper for serverless (no TS/ESM issues)

/* -----------------------------
   Utilities
------------------------------ */

function finite(n, fallback = 0) {
  const x = typeof n === "number" ? n : Number(n);
  return Number.isFinite(x) ? x : fallback;
}

function normalizeLineForExtraction(line) {
  let s = line.replace(/(\d),(?=\d{3}\b)/g, "$1");
  s = s.replace(/\bO\s*mg\b/gi, "0mg");
  return s;
}

function normalizeBBox(vertices, pageWidth, pageHeight) {
  if (!Array.isArray(vertices) || vertices.length === 0) return null;

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  for (const v of vertices) {
    const x = finite(v?.x, 0);
    const y = finite(v?.y, 0);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  if (!Number.isFinite(minX) || !pageWidth || !pageHeight) return null;

  return {
    x0: minX / pageWidth,
    y0: minY / pageHeight,
    x1: maxX / pageWidth,
    y1: maxY / pageHeight,
  };
}

/* -----------------------------
   Token helpers
------------------------------ */

function isNumericToken(t) {
  if (!t || !t.text || !t.bbox) return false;
  if (/%/.test(t.text)) return false;
  return /\d/.test(t.text) && /\b(g|mg|kj|kcal|cal)\b/i.test(t.text);
}

function xCenter(bbox) {
  return (bbox.x0 + bbox.x1) / 2;
}

function yCenter(bbox) {
  return (bbox.y0 + bbox.y1) / 2;
}

/* -----------------------------
   Column detection
------------------------------ */

function clusterColumns(tokens) {
  if (!tokens.length) return [];

  const xs = tokens
    .map((t) => ({ x: xCenter(t.bbox), token: t }))
    .sort((a, b) => a.x - b.x);

  const clusters = [];
  const THRESHOLD = 0.08;

  for (const item of xs) {
    const last = clusters[clusters.length - 1];
    if (!last || Math.abs(item.x - last.meanX) > THRESHOLD) {
      clusters.push({ tokens: [item.token], meanX: item.x });
    } else {
      last.tokens.push(item.token);
      last.meanX =
        (last.meanX * (last.tokens.length - 1) + item.x) /
        last.tokens.length;
    }
  }

  while (clusters.length > 3) {
    let minDist = Infinity;
    let mergeIdx = 0;

    for (let i = 0; i < clusters.length - 1; i++) {
      const d = Math.abs(clusters[i].meanX - clusters[i + 1].meanX);
      if (d < minDist) {
        minDist = d;
        mergeIdx = i;
      }
    }

    const a = clusters[mergeIdx];
    const b = clusters[mergeIdx + 1];
    clusters.splice(mergeIdx, 2, {
      tokens: a.tokens.concat(b.tokens),
      meanX:
        (a.meanX * a.tokens.length + b.meanX * b.tokens.length) /
        (a.tokens.length + b.tokens.length),
    });
  }

  return clusters.map((c, idx) => {
    const xs = c.tokens.map((t) => xCenter(t.bbox));
    return {
      id: idx,
      xMin: Math.min(...xs),
      xMax: Math.max(...xs),
      tokenCount: c.tokens.length,
    };
  });
}

/* -----------------------------
   Row detection
------------------------------ */

function groupTokensIntoRows(tokens, yTolerance = 0.015) {
  const rows = [];

  for (const t of tokens) {
    const midY = yCenter(t.bbox);
    let row = rows.find((r) => Math.abs(r.midY - midY) <= yTolerance);
    if (!row) {
      row = { midY, tokens: [] };
      rows.push(row);
    }
    row.tokens.push(t);
  }

  rows.sort((a, b) => a.midY - b.midY);
  for (const r of rows) {
    r.tokens.sort((a, b) => a.bbox.x0 - b.bbox.x0);
  }

  return rows;
}

function classifyRowColumns(rowTokens) {
  const label = [];
  const perServe = [];
  const per100g = [];

  for (const t of rowTokens) {
    const x = xCenter(t.bbox);
    if (t.text.includes("%")) continue;

    if (x < 0.33) label.push(t);
    else if (x < 0.66) perServe.push(t);
    else per100g.push(t);
  }

  return { label, perServe, per100g };
}

function isLikelyNutritionRow(row) {
  const text = `${row.labelText} ${row.perServeText} ${row.per100gText}`.toLowerCase();
  if (!/\d/.test(text)) return false;
  if (!/(g|mg|kj|kcal|cal)\b/.test(text)) return false;
  if (/(avg|average|quantity|daily|intake)/.test(text)) return false;
  return true;
}

function matchNutrientKey(labelText) {
  const s = labelText.toLowerCase();

  if (s.startsWith("energy")) return "energy";
  if (s.startsWith("protein")) return "protein";
  if (s.startsWith("fat")) return "fat_total";
  if (s.includes("satur")) return "saturated";
  if (s.startsWith("carbohydrate") || s.startsWith("carbs")) return "carbohydrate";
  if (s.includes("sugars")) return "sugars";
  if (s.includes("fibre") || s.includes("fiber")) return "fibre";
  if (s.includes("sodium")) return "sodium";

  return null;
}

function parseValue(text) {
  const m = text.match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

function normaliseParsedNutrients(parsed) {
  if (!parsed || typeof parsed !== "object") return {};

  const out = {};

  // Energy (special case: kJ vs kcal)
  if (parsed.energy_kj) {
  if (Number.isFinite(parsed.energy_kj.perServe)) out.energy_kj = parsed.energy_kj.perServe;
  if (Number.isFinite(parsed.energy_kj.per100g)) out.energy_kj_100g = parsed.energy_kj.per100g;
}

if (parsed.energy_kcal) {
  if (Number.isFinite(parsed.energy_kcal.perServe)) out.energy_kcal = parsed.energy_kcal.perServe;
  if (Number.isFinite(parsed.energy_kcal.per100g)) out.energy_kcal_100g = parsed.energy_kcal.per100g;
}


  if (parsed.protein) {
    if (Number.isFinite(parsed.protein.perServe))
      out.protein_g = parsed.protein.perServe;
    if (Number.isFinite(parsed.protein.per100g))
      out.protein_g_100g = parsed.protein.per100g;
  }

  if (parsed.fat_total) {
    if (Number.isFinite(parsed.fat_total.perServe))
      out.fat_g = parsed.fat_total.perServe;
    if (Number.isFinite(parsed.fat_total.per100g))
      out.fat_g_100g = parsed.fat_total.per100g;
  }

  if (parsed.carbohydrate) {
    if (Number.isFinite(parsed.carbohydrate.perServe))
      out.carbs_g = parsed.carbohydrate.perServe;
    if (Number.isFinite(parsed.carbohydrate.per100g))
      out.carbs_g_100g = parsed.carbohydrate.per100g;
  }

  if (parsed.sugars) {
    if (Number.isFinite(parsed.sugars.perServe))
      out.sugars_g = parsed.sugars.perServe;
    if (Number.isFinite(parsed.sugars.per100g))
      out.sugars_g_100g = parsed.sugars.per100g;
  }

  if (parsed.fibre) {
    if (Number.isFinite(parsed.fibre.perServe))
      out.fibre_g = parsed.fibre.perServe;
    if (Number.isFinite(parsed.fibre.per100g))
      out.fibre_g_100g = parsed.fibre.per100g;
  }

  if (parsed.sodium) {
    if (Number.isFinite(parsed.sodium.perServe))
      out.sodium_mg = parsed.sodium.perServe;
    if (Number.isFinite(parsed.sodium.per100g))
      out.sodium_mg_100g = parsed.sodium.per100g;
  }

  return out;
}



/* -----------------------------
   Main OCR post-processor
------------------------------ */

function ocrPost(r0, options = {}) {
  const debugEnabled = options.debug === true;
  const tokens = [];

  const fullText =
    r0?.fullTextAnnotation?.text ||
    r0?.textAnnotations?.[0]?.description ||
    "";

  const visionLines = fullText
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  const dropped = [];
  let lines = [];

  for (const line of visionLines) {
    let reason = null;

    if (line.includes("%")) reason = "PERCENT_LINE";
    else if (/less than/i.test(line)) reason = "LESS_THAN";
    else {
      const x = normalizeLineForExtraction(line).toLowerCase();
      if (x.includes("daily value")) reason = "DAILY_VALUE";
      else if (x.includes("caloric needs")) reason = "CALORIC_NEEDS";
      else if (x.includes("calories per gram")) reason = "CALORIES_PER_GRAM";
    }

    if (reason) {
      if (debugEnabled) dropped.push({ line, reason });
      continue;
    }

    lines.push(line);
  }

  const result = { lines };

  /* ---- Token extraction ---- */
  if (debugEnabled) {
    const pages = r0?.fullTextAnnotation?.pages || [];
    for (let p = 0; p < pages.length; p++) {
      const page = pages[p];
      const pageWidth = finite(page?.width);
      const pageHeight = finite(page?.height);

      const blocks = page?.blocks || [];
      for (let b = 0; b < blocks.length; b++) {
        const block = blocks[b];
        const paragraphs = block?.paragraphs || [];

        for (let pa = 0; pa < paragraphs.length; pa++) {
          const para = paragraphs[pa];
          const words = para?.words || [];

          for (let w = 0; w < words.length; w++) {
            const word = words[w];
            const symbols = word?.symbols || [];
            const text = symbols.map((s) => s?.text || "").join("");
            if (!text) continue;

            const bbox = normalizeBBox(
              word?.boundingBox?.vertices,
              pageWidth,
              pageHeight
            );
            if (!bbox) continue;

            tokens.push({
              text,
              bbox,
              confidence: finite(word?.confidence, null),
              blockId: b,
              paraId: pa,
            });
          }
        }
      }
    }
  }

  if (debugEnabled) {
    result.debug = {
      tokens,
      vision: { fullText, lines: visionLines },
      filtering: { keptLines: lines, droppedLines: dropped },
    };

    const numericTokens = tokens.filter(isNumericToken);
    result.debug.columns = clusterColumns(numericTokens);

    const rows = groupTokensIntoRows(tokens);
    result.debug.rows = rows.map((r) => {
      const cols = classifyRowColumns(r.tokens);
      return {
        y: r.midY,
        labelText: cols.label.map((t) => t.text).join(" "),
        perServeText: cols.perServe.map((t) => t.text).join(" "),
        per100gText: cols.per100g.map((t) => t.text).join(" "),
        raw: cols,
      };
    });

    result.debug.nutritionRows = result.debug.rows.filter(isLikelyNutritionRow);

    const nutrients = {};

    for (const row of result.debug.nutritionRows) {
    const key = matchNutrientKey(row.labelText);
    if (!key) continue;

    // ✅ STEP 2: FIBRE (robust, unit-tolerant)
    if (key === "fibre") {
      const parseFibre = (text) => {
        if (!text) return null;

        // extract number even if unit missing
        const num = text.match(/(\d+(?:\.\d+)?)/)?.[1];
        if (!num) return null;

        const value = Number(num);
        if (!Number.isFinite(value)) return null;

        // accept g OR missing unit (labels often omit it)
        if (/\bg\b/i.test(text) || !/(mg|kj|kcal|cal)\b/i.test(text)) {
          return value;
        }

        return null;
      };

      const perServe = parseFibre(row.perServeText);
      const per100g = parseFibre(row.per100gText);

      nutrients.fibre = {
        perServe,
        per100g,
        source: "ocr",
      };

      continue; // 🚫 prevent generic parser touching fibre
    }


    // ✅ STEP 1: ENERGY unit differentiation (kJ vs kcal)
    if (key === "energy") {
      const parseEnergy = (text) => {
        if (!text) return null;

        const num = text.match(/(\d+(?:\.\d+)?)/)?.[1];
        if (!num) return null;

        const value = Number(num);
        if (!Number.isFinite(value)) return null;

        if (/kj\b/i.test(text)) return { unit: "kj", value };
        if (/(kcal|cal)\b/i.test(text)) return { unit: "kcal", value };
        return null;
      };

      const ps = parseEnergy(row.perServeText);
      const p100 = parseEnergy(row.per100gText);

      if (ps) {
        const k = ps.unit === "kj" ? "energy_kj" : "energy_kcal";
        nutrients[k] = { ...(nutrients[k] || {}), perServe: ps.value, source: "ocr" };
      }
      if (p100) {
        const k = p100.unit === "kj" ? "energy_kj" : "energy_kcal";
        nutrients[k] = { ...(nutrients[k] || {}), per100g: p100.value, source: "ocr" };
      }

      continue; // 🚫 skip generic assignment for energy
    }

    // default (non-energy)
    const perServe = parseValue(row.perServeText);
    const per100g = parseValue(row.per100gText);

    nutrients[key] = {
      perServe,
      per100g,
      source: "ocr",
    };
  }

result.debug.parsedNutrients = nutrients;

  }

 if (debugEnabled && result.debug?.parsedNutrients) {
  result.debug.normalisedNutrients =
    normaliseParsedNutrients(result.debug.parsedNutrients);
}

// production payload
result.nutrients =
  normaliseParsedNutrients(result.debug?.parsedNutrients);
 

  return result;
}

module.exports = { ocrPost };