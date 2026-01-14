// scripts/ocr-run.ts
// Local runner for OCR + post-processing.
// Default behavior: quiet summary, no FULL TEXT, no file output.
// Optional flags:
//   --full         prints fullText
//   --items        prints first N OCR items
//   --n <number>   sets how many candidates/items to print (default 25)
//   --out <path>   writes a JSON dump to a file (opt-in)

import dotenv from "dotenv";
dotenv.config({ path: ".env" });

import fs from "node:fs";
import { extractLabeledValueUnitCandidates, extractLabelRows } from "../lib/ocrPost";
import { extractRawTextFromImage } from "../lib/ocrTest";

function getArg(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  const v = process.argv[idx + 1];
  if (!v || v.startsWith("--")) return null;
  return v;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function clampInt(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

async function main() {
  const imagePath = process.argv.find((a) => !a.startsWith("--") && a !== process.argv[0] && a !== process.argv[1]) 
    ?? "./test-label.jpg";

  const printFull = hasFlag("--full");
  const printItems = hasFlag("--items");
  const outPath = getArg("--out");

  const n = clampInt(Number(getArg("--n") ?? 25), 1, 200);

  console.log("OCR_key loaded?", Boolean(process.env.OCR_key));
  console.log("IMAGE PATH:", imagePath);

  const out = await extractRawTextFromImage(imagePath);

  // Step 4
  const labeled = extractLabeledValueUnitCandidates(out);

  // Step 5
  const grouped = extractLabelRows(out);

  console.log("\nLINE COUNT:", labeled.lines.length);
  console.log("LABELED CANDIDATES:", labeled.candidates.length);
  console.log("ROWS:", grouped.rows.length);

  console.log(`\nFIRST ${n} LABELED CANDIDATES:`);
  console.log(labeled.candidates.slice(0, n));

  console.log("\nROWS (primary):");
  for (const r of grouped.rows) {
    const p = r.primary;
    console.log(`- ${r.label}: ${p.value}${p.unit ?? ""}`);
  }

  if (printItems) {
    console.log(`\nFIRST ${n} ITEMS:`);
    console.log(out.items.slice(0, n));
    console.log("\nITEM COUNT:", out.items.length);
  }

  if (printFull) {
    console.log("\nFULL TEXT:\n", out.fullText);
  }

  // Optional write-out (opt-in)
  if (outPath) {
    const dump = {
      imagePath,
      lines: labeled.lines,
      labeledCandidates: labeled.candidates,
      rows: grouped.rows,
      meta: {
        itemCount: out.items.length,
        fullTextLength: out.fullText?.length ?? 0,
      },
    };
    fs.writeFileSync(outPath, JSON.stringify(dump, null, 2), "utf8");
    console.log("\nWROTE:", outPath);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
