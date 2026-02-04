// scripts/lock-tsconfig.js
// Purpose: Prevent Expo from leaving a root tsconfig that breaks vercel dev.
// Strategy: If tsconfig.json contains `extends: "expo/tsconfig.base"`,
// overwrite it with tsconfig.vercel-safe.json.
// Works on Windows and uses no external dependencies.

const fs = require("fs");
const path = require("path");

const root = process.cwd();
const tsconfigPath = path.join(root, "tsconfig.json");
const safePath = path.join(root, "tsconfig.vercel-safe.json");

// Optional delay so Expo can boot before we start enforcing (ms)
const START_DELAY_MS = 1500;

function readText(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

function writeSafe() {
  const safe = readText(safePath);
  if (!safe) {
    console.error(`[lock-tsconfig] Missing ${safePath}`);
    process.exit(1);
  }
  fs.writeFileSync(tsconfigPath, safe, "utf8");
  console.log("[lock-tsconfig] Restored vercel-safe tsconfig.json");
}

function needsFix(text) {
  if (!text) return false;
  // Tight match: only act if Expo base is present
  return text.includes('"extends": "expo/tsconfig.base"') || text.includes("'extends': 'expo/tsconfig.base'");
}

function checkAndFix() {
  const current = readText(tsconfigPath);
  if (needsFix(current)) writeSafe();
}

function main() {
  console.log(`[lock-tsconfig] Watching ${tsconfigPath}`);
  // Initial check
  checkAndFix();

  // Watch for changes
  try {
    fs.watch(tsconfigPath, { persistent: true }, () => {
      // Debounce-ish: small delay to allow atomic rename to complete
      setTimeout(checkAndFix, 50);
    });
  } catch (err) {
    console.error("[lock-tsconfig] fs.watch failed:", err);
    process.exit(1);
  }

  // Also poll every second as a fallback for Windows atomic writes
  setInterval(checkAndFix, 1000);
}

setTimeout(main, START_DELAY_MS);
