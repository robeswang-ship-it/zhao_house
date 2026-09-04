import { useEffect, useRef, useState } from "react";
import { PetAvatar } from "./components/PetAvatar";
import { checkForUpdate, isDesktopApp, openControlPanel } from "./lib/desktop";
import { PET_SKIN_KEY, readSkin, type PetAction, type Skin } from "./lib/skins";

export default function PetOverlay() {
  const [skin, setSkin] = useState<Skin>(readSkin);
  const [action, setAction] = useState<PetAction>("idle");
  const [hasUpdate, setHasUpdate] = useState(false);
  const resetTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const syncSkin = (event: StorageEvent) => {
      if (event.key === PET_SKIN_KEY) setSkin(readSkin());
    };
    window.addEventListener("storage", syncSkin);
    return () => window.removeEventListener("storage", syncSkin);
  }, []);

  useEffect(() => {
    if (!isDesktopApp()) return;
    let active = true;
    void checkForUpdate()
      .then(async (update) => {
        if (active && update) setHasUpdate(true);
        await update?.update.close();
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  function openButler() {
    window.clearTimeout(resetTimer.current);
    setAction("talk");
    void openControlPanel();
    resetTimer.current = window.setTimeout(() => setAction("idle"), 900);
  }

  return <main className={`pet-overlay ${skin === "snow" ? "snow-pet" : "queen-pet"}`}>
    <span className="overlay-halo overlay-halo-one" aria-hidden="true" />
    <span className="overlay-halo overlay-halo-two" aria-hidden="true" />
    <button className="pet-drag-handle" data-tauri-drag-region type="button" title="按住这里拖动 BA仔" aria-label="按住拖动 BA仔">↕</button>
    <PetAvatar skin={skin} action={action} onClick={openButler} label="点击 BA仔，打开小猫管家" className="overlay-avatar" />
    {hasUpdate && <span className="overlay-update-badge">新</span>}
    <p className="overlay-hint">点我打开小管家</p>
  </main>;
}
