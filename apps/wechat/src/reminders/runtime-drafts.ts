import { taroStorage } from "../runtime/taro-storage";
import { ReminderDraftStore } from "./draft-store";

export function createRuntimeReminderDraftStore(): ReminderDraftStore {
  return new ReminderDraftStore(taroStorage);
}
