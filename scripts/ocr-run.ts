import dotenv from "dotenv";
dotenv.config({ path: ".env" });

import { extractRawTextFromImage } from "../lib/ocrTest";

console.log("OCR_key loaded?", Boolean(process.env.OCR_key));

extractRawTextFromImage("./test-label.jpg")
  .then((out) => {
    console.log("FULL TEXT:\n", out.fullText);
    console.log("\nITEM COUNT:", out.items.length);
    console.log("\nFIRST 10 ITEMS:\n", out.items.slice(0, 10));
  })
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
