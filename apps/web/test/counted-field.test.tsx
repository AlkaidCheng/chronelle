// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { CountedField } from "../components/counted-field";

function Harness({ limit }: { readonly limit: number }) {
  const [value, setValue] = useState("");
  return (
    <CountedField
      hideLabel
      label="Nickname"
      limit={limit}
      onChange={setValue}
      value={value}
    />
  );
}

afterEach(cleanup);

describe("CountedField", () => {
  it("counts characters, stops at the limit, cuts a longer paste, and marks a full field", async () => {
    const user = userEvent.setup();
    render(<Harness limit={5} />);
    const input = screen.getByLabelText("Nickname");
    expect(input).toHaveAccessibleName("Nickname");
    expect(input).toHaveAccessibleDescription("0 / 5");
    await user.type(input, "abcdefg");
    expect(input).toHaveValue("abcde");
    expect(screen.getByText("5 / 5")).toHaveClass("field-count-full");
    await user.clear(input);
    expect(screen.getByText("0 / 5")).not.toHaveClass("field-count-full");
    await user.paste("1234567");
    expect(input).toHaveValue("12345");
    expect(screen.getByText("5 / 5")).toHaveClass("field-count-full");
  });
});
