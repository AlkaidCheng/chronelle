import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import Home from "../app/page";

describe("Home", () => {
  it("renders the Chronelle product foundation", () => {
    const markup = renderToStaticMarkup(createElement(Home));

    expect(markup).toContain("Chronelle");
    expect(markup).toContain("Your life, connected across time.");
    expect(markup).toContain("Canonical objects");
  });
});
