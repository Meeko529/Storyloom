import { ImageRequireSource } from "react-native";

export type MascotKind = "cat" | "fox" | "crane" | "shiba" | "dragon" | "inkdrop";

export const DEFAULT_MASCOT: MascotKind = "cat";

export const MASCOT_OPTIONS: Array<{ id: MascotKind; label: string; source: ImageRequireSource }> = [
  { id: "cat", label: "小猫", source: require("../assets/images/mascot-cat.png") },
  { id: "fox", label: "小狐狸", source: require("../assets/images/mascot-fox.png") },
  { id: "crane", label: "纸鹤", source: require("../assets/images/mascot-crane.png") },
  { id: "shiba", label: "柴犬", source: require("../assets/images/mascot-shiba.png") },
  { id: "dragon", label: "小龙", source: require("../assets/images/mascot-dragon.png") },
  { id: "inkdrop", label: "墨滴精灵", source: require("../assets/images/mascot-inkdrop.png") },
];

export function mascotSource(id: string | null | undefined): ImageRequireSource {
  return MASCOT_OPTIONS.find((option) => option.id === id)?.source ?? MASCOT_OPTIONS[0].source;
}

export function normalizeMascotKind(value: string | null | undefined): MascotKind {
  return MASCOT_OPTIONS.some((option) => option.id === value) ? (value as MascotKind) : DEFAULT_MASCOT;
}
