import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

if (typeof HTMLElement !== "undefined")
  HTMLElement.prototype.scrollIntoView = vi.fn();
