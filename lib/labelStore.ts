// lib/labelStore.ts
import { Platform } from "react-native";
import type { LabelData } from "./mockLabel";

const STORAGE_KEY = "nutricopy.currentLabel";

export type StoredLabel = LabelData & {
  rawLines?: string[];
  debug?: any; // dev-only, opaque payload from /api/ocr when requested
  imageBase64?: string; // DEV ONLY: scan preview for OCR overlay
  fileName?: string; // web-only: name of uploaded image

  // --- timing ---
  labelReadyAtMs?: number;
  timeToExportMs?: number;
};


let currentLabel: StoredLabel | null = null;

function safeParse(json: string): StoredLabel | null {
  try {
    return JSON.parse(json) as StoredLabel;
  } catch {
    return null;
  }
}

export function setCurrentLabel(
  label: LabelData,
  options?: {
    rawLines?: string[];
    debug?: any;
    imageBase64?: string; // DEV ONLY
    fileName?: string; // web-only: name of uploaded image
  }
) {
  const stored: StoredLabel = {
  ...label,
  rawLines: options?.rawLines,
  debug: options?.debug,
  imageBase64: options?.imageBase64,
  fileName: options?.fileName,

  // timing
  labelReadyAtMs: Date.now(),
  timeToExportMs: undefined,
  };


  currentLabel = stored;

  if (Platform.OS === "web") {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    } catch {
      // ignore storage errors
    }
  }
}


export function getCurrentLabel(): StoredLabel | null {
  if (currentLabel) return currentLabel;

  if (Platform.OS === "web") {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = safeParse(raw);
      currentLabel = parsed;
      return parsed;
    } catch {
      return null;
    }
  }

  return null;
}

export function updateCurrentLabel(patch: Partial<StoredLabel>) {
  const existing = getCurrentLabel();
  if (!existing) return;

  const next: StoredLabel = { ...existing, ...patch };
  currentLabel = next;

  if (Platform.OS === "web") {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore storage errors
    }
  }
}


export function clearCurrentLabel() {
  currentLabel = null;

  if (Platform.OS === "web") {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }
}
