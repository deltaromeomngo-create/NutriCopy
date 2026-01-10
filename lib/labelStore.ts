// lib/labelStore.ts
import { Platform } from "react-native";
import type { LabelData } from "./mockLabel";

const STORAGE_KEY = "nutricopy.currentLabel";

let currentLabel: LabelData | null = null;

function safeParse(json: string): LabelData | null {
  try {
    return JSON.parse(json) as LabelData;
  } catch {
    return null;
  }
}

export function setCurrentLabel(label: LabelData) {
  currentLabel = label;

  // Persist on web so refresh doesn't wipe the current label
  if (Platform.OS === "web") {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(label));
    } catch {
      // ignore storage errors (private mode etc.)
    }
  }
}

export function getCurrentLabel(): LabelData | null {
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
