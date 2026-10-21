import { resource, operation, ok } from "@arc/framework/server";
import { ListTasks, CreateTask, type Task } from "./contracts.ts";
const tasksRepository = resource({
  id: "tasks.repository",
  instrument: ["list", "create"],
  open() {
    const tasks: { id: string; title: string }[] = [];
    return {
      async list() {
        return [...tasks];
      },
      async create(title: string) {
        if (tasks.some((task) => task.title === title)) return undefined;
        const task = { id: crypto.randomUUID(), title };
        tasks.push(task);
        return task;
      },
    };
  },
});
export const listTasks = operation({
  ...ListTasks,
  needs: { tasks: tasksRepository },
  async run({ tasks }) {
    return ok(await tasks.list());
  },
});
export const createTask = operation({
  ...CreateTask,
  needs: { tasks: tasksRepository },
  async run({ input, tasks, fail }) {
    const task = await tasks.create(input.title);
    return task ? ok(task) : fail("TITLE_EXISTS", { title: input.title });
  },
});
