import dotenv from "dotenv";
dotenv.config({ path: ".env" });

import { extractValueUnitCandidates } from "../lib/ocrPost";
import { extractRawTextFromImage } from "../lib/ocrTest";


console.log("OCR_key loaded?", Boolean(process.env.OCR_key));

// If you run: npx tsx scripts/ocr-run.ts .\test-label-2.jpg
// then process.argv[2] will be ".\test-label-2.jpg"
const imagePath = process.argv[2] ?? "./test-label.jpg";

extractRawTextFromImage(imagePath)
  .then((out) => {
    const { lines, candidates } = extractValueUnitCandidates(out);

    console.log("\nLINE COUNT:", lines.length);
    console.log("\nFIRST 10 LINES:\n", lines.slice(0, 10));
    console.log("\nCANDIDATE COUNT:", candidates.length);
    console.log("\nFIRST 30 CANDIDATES:\n", candidates.slice(0, 30));
    console.log("IMAGE PATH:\n", imagePath);
    console.log("FULL TEXT:\n", out.fullText);
    console.log("\nITEM COUNT:", out.items.length);
    console.log("\nFIRST 10 ITEMS:\n", out.items.slice(0, 10));
  })
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
