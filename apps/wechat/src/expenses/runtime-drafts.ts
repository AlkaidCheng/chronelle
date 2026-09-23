import { taroStorage } from "../runtime/taro-storage";
import { ExpenseDraftStore } from "./draft-store";

export function createRuntimeExpenseDraftStore(): ExpenseDraftStore {
  return new ExpenseDraftStore(taroStorage);
}
