import { useEffect, useRef, useState } from "react";
import { PetAvatar } from "./components/PetAvatar";
import { openControlPanel, quitApp, reportFrontendReady, startWindowDragging } from "./lib/desktop";
import { applyPetSize, PET_SIZE_KEY, readPetSize } from "./lib/petSize";
import { PET_SKIN_KEY, readSkin, type PetAction, type Skin } from "./lib/skins";

export default function PetOverlay() {
  const [skin, setSkin] = useState<Skin>(readSkin);
  const [action, setAction] = useState<PetAction>("idle");
  const [openError, setOpenError] = useState("");
  const resetTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const syncPreferences = (event: StorageEvent) => {
      if (event.key === PET_SKIN_KEY) setSkin(readSkin());
      if (event.key === PET_SIZE_KEY) void applyPetSize(readPetSize());
    };
    window.addEventListener("storage", syncPreferences);
    return () => window.removeEventListener("storage", syncPreferences);
  }, []);

  useEffect(() => {
    void applyPetSize(readPetSize());
    void reportFrontendReady("pet");
  }, []);

  async function openButler() {
    window.clearTimeout(resetTimer.current);
    setOpenError("");
    setAction("talk");
    try {
      await openControlPanel();
    } catch (error) {
      setOpenError(`打开失败：${String(error)}`);
    }
    resetTimer.current = window.setTimeout(() => setAction("idle"), 900);
  }

  return <main className={`pet-overlay ${skin === "snow" ? "snow-pet" : "queen-pet"}`}>
    <button
      className="pet-exit"
      type="button"
      title="退出 BA仔"
      aria-label="退出 BA仔"
      onMouseDown={(event) => event.stopPropagation()}
      onClick={() => void quitApp()}
    >×</button>
    <div
      className="pet-drag-surface"
      onMouseDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        void startWindowDragging().catch((error) => setOpenError(`移动失败：${String(error)}`));
      }}
      title="按住 BA仔拖动"
    >
      <PetAvatar skin={skin} action={action} label="按住 BA仔拖动" className="overlay-avatar" />
    </div>
    <button className={`overlay-hint ${openError ? "has-error" : ""}`} type="button" title={openError || "打开 BA仔 · 小猫管家"} onClick={() => void openButler()}>
      {openError ? "打开失败，点我重试" : "打开小猫管家 ↗"}
    </button>
  </main>;
}
