import type { MouseEventHandler } from "react";
import { skins, type PetAction, type Skin } from "../lib/skins";

type PetAvatarProps = {
  action: PetAction;
  skin: Skin;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  label?: string;
  className?: string;
};

export function PetAvatar({ action, skin, onClick, label = "点击 BA仔", className = "" }: PetAvatarProps) {
  return <button className={`ba-cat ${action} ${className}`} type="button" aria-label={label} onClick={onClick}>
    <img src={skins[skin].image} alt={`${skins[skin].label} BA仔`} draggable={false} />
  </button>;
}
