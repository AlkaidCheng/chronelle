import { describe, expect, it } from "vitest";

import { weChatSessionStorageKey } from "../src/auth/session-store";
import { eventDraftStorageKey } from "../src/events/draft-store";
import { expenseDraftStorageKey } from "../src/expenses/draft-store";
import { reminderDraftStorageKey } from "../src/reminders/draft-store";
import { taskDraftStorageKey } from "../src/tasks/draft-store";

/**
 * Installed Mini Programs already hold these keys, so they keep the
 * Chronelle spelling (docs/architecture.md, "Names that keep Chronelle").
 * The literals are written out on purpose: a rename must fail here.
 */
describe("names installed Mini Programs already store", () => {
  it("keeps the session and editor draft storage keys", () => {
    expect(weChatSessionStorageKey).toBe("chronelle.session.v1");
    expect(eventDraftStorageKey).toBe("chronelle.event-drafts.v1");
    expect(taskDraftStorageKey).toBe("chronelle.task-drafts.v1");
    expect(expenseDraftStorageKey).toBe("chronelle.expense-drafts.v1");
    expect(reminderDraftStorageKey).toBe("chronelle.reminder-drafts.v1");
  });
});
