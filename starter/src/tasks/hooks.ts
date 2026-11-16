import { useSyncExternalStore } from "react";
import { tasks, type Task } from "./store";

export const useTasks = (): Task[] => useSyncExternalStore(tasks.subscribe, tasks.getAll);
export const useTask = (id: string | null | undefined): Task | undefined =>
  useSyncExternalStore(tasks.subscribe, () => (id ? tasks.get(id) : undefined));
