import { screen } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";

/**
 * Opens the full editor for a new task the way a person does: the add row,
 * then More at the composer's foot. The first row is enough; every row of
 * a collection offers the editor.
 */
export async function openTaskEditor(user: UserEvent): Promise<void> {
  const rows = await screen.findAllByRole("button", { name: /^Add a task/ });
  const row = rows[0];
  if (row === undefined) throw new Error("No add row to open");
  await user.click(row);
  await user.click(await screen.findByRole("button", { name: /^More: / }));
}
