"use client";

import { useId } from "react";
import { useAppearance } from "../lib/use-appearance";

export function AppearanceControl() {
  const name = useId();
  const { appearance, setAppearance } = useAppearance();
  return (
    <fieldset className="appearance-control">
      <legend className="visually-hidden">Appearance</legend>
      {(["system", "light", "dark"] as const).map((value) => (
        <label key={value}>
          <input
            checked={appearance === value}
            name={name}
            onChange={() => setAppearance(value)}
            type="radio"
            value={value}
          />
          <span>
            {value[0]?.toUpperCase()}
            {value.slice(1)}
          </span>
        </label>
      ))}
    </fieldset>
  );
}
