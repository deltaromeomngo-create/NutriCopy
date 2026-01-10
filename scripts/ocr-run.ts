import dotenv from "dotenv";
import path from "node:path";

dotenv.config({ path: ".env" });

import { extractRawTextFromImage } from "../lib/ocrTest";

console.log("OCR_key loaded?", Boolean(process.env.OCR_key));

// Usage:
//   npx tsx scripts/ocr-run.ts
//   npx tsx scripts/ocr-run.ts .\test-label-2.jpg
const arg = process.argv[2] || "./test-label.jpg";
const imagePath = path.isAbsolute(arg) ? arg : path.resolve(process.cwd(), arg);

extractRawTextFromImage(imagePath)
  .then((out) => {
    console.log("IMAGE PATH:\n", imagePath);
    console.log("FULL TEXT:\n", out.fullText);
    console.log("\nITEM COUNT:", out.items.length);
    console.log("\nFIRST 10 ITEMS:\n", out.items.slice(0, 10));
  })
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
