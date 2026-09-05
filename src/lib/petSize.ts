import { invoke } from "@tauri-apps/api/core";

export type PetSize = "small" | "medium" | "large";

export const PET_SIZE_KEY = "ba-zai-pet-size";

export const petSizes: Record<PetSize, { label: string; width: number; height: number }> = {
  small: { label: "小巧", width: 176, height: 220 },
  medium: { label: "标准", width: 230, height: 285 },
  large: { label: "大只", width: 300, height: 370 },
};

export function readPetSize(): PetSize {
  const saved = window.localStorage.getItem(PET_SIZE_KEY);
  return saved === "small" || saved === "large" ? saved : "medium";
}

export async function applyPetSize(size: PetSize): Promise<void> {
  window.localStorage.setItem(PET_SIZE_KEY, size);
  if ("__TAURI_INTERNALS__" in window) await invoke("set_pet_size", { size });
}

export async function startPetDragging(): Promise<void> {
  if ("__TAURI_INTERNALS__" in window) await invoke("start_pet_drag");
}
