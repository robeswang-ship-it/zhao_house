import queenSkin from "../assets/skins/queen-handdrawn.png";
import snowSkin from "../assets/skins/snow-handdrawn.png";

export type Skin = "queen" | "snow";
export type PetAction = "idle" | "talk" | "focus" | "celebrate" | "kick";

export const PET_SKIN_KEY = "ba-zai-skin";

export const skins: Record<Skin, { label: string; detail: string; image: string }> = {
  queen: { label: "女王花猫", detail: "头像同款手绘黑白花 · 小皇冠", image: queenSkin },
  snow: { label: "雪天女王", detail: "冰蓝披肩 · 雪花皇冠", image: snowSkin },
};

export function readSkin(): Skin {
  return window.localStorage.getItem(PET_SKIN_KEY) === "snow" ? "snow" : "queen";
}

export function saveSkin(skin: Skin) {
  window.localStorage.setItem(PET_SKIN_KEY, skin);
}
