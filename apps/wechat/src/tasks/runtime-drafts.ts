import { taroStorage } from "../runtime/taro-storage";
import { TaskDraftStore } from "./draft-store";

export function createRuntimeTaskDraftStore(): TaskDraftStore {
  return new TaskDraftStore(taroStorage);
}
