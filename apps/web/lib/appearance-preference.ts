export type Appearance = "system" | "light" | "dark";

export const appearanceStorageKey = "chronelle.appearance";

export function parseAppearance(value: unknown): Appearance {
  return value === "light" || value === "dark" ? value : "system";
}

export const appearanceBootstrap = `try{const value=window.localStorage.getItem(${JSON.stringify(appearanceStorageKey)});if(value==="light"||value==="dark")document.documentElement.dataset.appearance=value;}catch{}`;
