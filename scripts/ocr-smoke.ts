import dotenv from "dotenv";
dotenv.config({ path: ".env" });

import { extractLabeledValueUnitCandidates, extractLabelRows, extractServingMeta } from "../lib/ocrPost";
import { extractRawTextFromImage } from "../lib/ocrTest";

function assert(cond: any, msg: string) {
  if (!cond) throw new Error(`SMOKE FAIL: ${msg}`);
}

function hasLabel(rows: { label: string }[], label: string) {
  const key = label.trim().toLowerCase();
  return rows.some((r) => r.label.trim().toLowerCase() === key);
}

async function runOne(imagePath: string) {
  console.log("\n=== SMOKE:", imagePath, "===");

  const out = await extractRawTextFromImage(imagePath);

  const labeled = extractLabeledValueUnitCandidates(out);

  // Must produce some labeled candidates
  assert(labeled.candidates.length >= 8, `expected >= 8 labeled candidates, got ${labeled.candidates.length}`);

  // No percent candidates (DV must not leak into candidates)
  assert(!labeled.candidates.some((c) => c.unit === "%"), "found % unit candidate (DV leak)");
  assert(!labeled.candidates.some((c) => c.raw.includes("%")), "found % in raw candidate (DV leak)");

  // Serving Size grams label should be "Serving Size" if present
  const serving = labeled.candidates.find((c) => c.unit === "g" && /serving\s*size/i.test(c.line));
  if (serving) {
    assert(serving.label === "Serving Size", `Serving Size grams label wrong: "${serving.label}"`);
  }

  const { rows, lines } = extractLabelRows(out);

  // Must have some grouped rows
  assert(rows.length >= 5, `expected >= 5 grouped rows, got ${rows.length}`);

  // Rows should not have digits inside labels (prevents "Carbohydrate 12.2g" style labels)
  assert(!rows.some((r) => /\d/.test(r.label)), "found digit in row.label (label extraction regression)");

  // Rows should not include column/header garbage
  assert(!rows.some((r) => /per\s*100|per\s*serv/i.test(r.label)), "found header row label (per serving/per 100g)");

  // Minimal “sanity labels” per style (don’t overfit; just ensure it’s sane)
  // US fixture tends to have Calories; AU fixtures tend to have Energy.
  const hasCalories = hasLabel(rows, "Calories");
  const hasEnergy = hasLabel(rows, "Energy");

  assert(hasCalories || hasEnergy, "expected either Calories or Energy row");

  // Common nutrients that should usually be present across fixtures
  assert(rows.some((r) => /protein/i.test(r.label)), 'expected a row whose label contains "Protein"');
  assert(hasLabel(rows, "Sodium"), "expected Sodium row");

  // Serving meta should resolve at least serving size for AU fixtures; for US it may vary
  const meta = extractServingMeta(lines);
  if (/test-label-2|test-label-3/i.test(imagePath)) {
    assert(meta.servingSize?.value != null, "expected servingSize meta for AU fixture");
    assert(meta.servingSize?.unit === "g", `expected servingSize unit "g", got "${meta.servingSize?.unit}"`);
  }

  console.log("PASS");
}

async function main() {
  console.log("OCR_key loaded?", Boolean(process.env.OCR_key));

  const fixtures = [
    "./test-label-1.jpg",
    "./test-label-2.jpeg",
    "./test-label-3.jpeg",
  ];

  for (const p of fixtures) {
    await runOne(p);
  }

  console.log("\nALL SMOKE TESTS PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
