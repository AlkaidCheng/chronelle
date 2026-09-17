export const displayChoices = {
  appearance: ["system", "light", "dark"],
  palette: ["paper", "celadon", "neutral"],
  density: ["comfortable", "compact"],
  motion: ["system", "reduced"],
} as const;

export type DisplayPreference = keyof typeof displayChoices;
export type DisplayValue<K extends DisplayPreference> =
  (typeof displayChoices)[K][number];

export function displayStorageKey(name: DisplayPreference) {
  return `chronelle.${name}`;
}

export function parseDisplayPreference<K extends DisplayPreference>(
  name: K,
  value: unknown,
): DisplayValue<K> {
  const choices: readonly unknown[] = displayChoices[name];
  return choices.includes(value)
    ? (value as DisplayValue<K>)
    : displayChoices[name][0];
}

export const palettes = [
  { id: "paper" },
  { id: "celadon" },
  { id: "neutral" },
] as const satisfies readonly { id: DisplayValue<"palette"> }[];

export const displayBootstrap = `for(const [name,choices] of Object.entries(${JSON.stringify(displayChoices)})){try{const value=window.localStorage.getItem("chronelle."+name);if(choices.includes(value))document.documentElement.dataset[name]=value;}catch{}}`;
