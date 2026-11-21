import { resource, operation, ok } from "@arc/framework/server";
import { ListTasks, CreateTask, Task } from "./contracts.ts";
// Сховище створюється в open і тримає задачі в пам’яті до зупинки застосунку.
// instrument вказує ARC, виклики яких методів фіксувати в трасуванні.
const tasksRepository = resource({
  id: "tasks.repository",
  instrument: ["list", "create"],
  open() {
    const tasks: ReturnType<typeof Task.parse>[] = [];
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
// Сервер додає реалізацію run до спільного контракту. ARC передає ресурс tasks через needs.
export const listTasks = operation(ListTasks, {
  needs: { tasks: tasksRepository },
  async run({ tasks }) {
    return ok(await tasks.list());
  },
});
// fail повертає очікувану бізнес-помилку, оголошену в контракті.
export const createTask = operation(CreateTask, {
  needs: { tasks: tasksRepository },
  async run({ input, tasks, fail }) {
    const task = await tasks.create(input.title);
    return task ? ok(task) : fail("TITLE_EXISTS", { title: input.title });
  },
});
