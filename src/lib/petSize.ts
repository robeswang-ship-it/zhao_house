import { invoke } from "@tauri-apps/api/core";

export type PetSize = "small" | "medium" | "large";

export const PET_SIZE_KEY = "ba-zai-pet-size";

export const petSizes: Record<PetSize, { label: string; width: number; height: number }> = {
  small: { label: "迷你", width: 120, height: 155 },
  medium: { label: "小巧", width: 168, height: 215 },
  large: { label: "标准", width: 230, height: 285 },
};

export function readPetSize(): PetSize {
  const saved = window.localStorage.getItem(PET_SIZE_KEY);
  return saved === "small" || saved === "large" ? saved : "medium";
}

export async function applyPetSize(size: PetSize): Promise<void> {
  window.localStorage.setItem(PET_SIZE_KEY, size);
  if ("__TAURI_INTERNALS__" in window) await invoke("set_pet_size", { size });
}
