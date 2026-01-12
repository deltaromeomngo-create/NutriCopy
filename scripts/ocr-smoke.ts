import dotenv from "dotenv";
dotenv.config({ path: ".env" });

import { extractLabeledValueUnitCandidates, extractLabelRows } from "../lib/ocrPost";
import { extractRawTextFromImage } from "../lib/ocrTest";

function assert(cond: any, msg: string) {
  if (!cond) throw new Error(`SMOKE FAIL: ${msg}`);
}

async function runOne(imagePath: string) {
  console.log("\n=== SMOKE:", imagePath, "===");

  const out = await extractRawTextFromImage(imagePath);

  const labeled = extractLabeledValueUnitCandidates(out);

  // Must produce some labeled candidates
  assert(labeled.candidates.length >= 8, `expected >= 8 labeled candidates, got ${labeled.candidates.length}`);

  // No percent candidates
  assert(!labeled.candidates.some((c) => c.unit === "%"), "found % candidate (DV leak)");

  // Serving Size grams label should be "Serving Size" if present
  const serving = labeled.candidates.find((c) => c.unit === "g" && /serving size/i.test(c.line));
  if (serving) {
    assert(serving.label === "Serving Size", `Serving Size grams label wrong: "${serving.label}"`);
  }

  const rows = extractLabelRows(out).rows;
  assert(rows.length >= 5, `expected >= 5 grouped rows, got ${rows.length}`);

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
