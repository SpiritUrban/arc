import { randomUUID } from "node:crypto";
import {
  application,
  http,
  module,
  operation,
  operationContract,
  resource,
  s,
  ok,
  error,
  type Infer,
} from "@arc/framework";

export const Task = s.object({
  id: s.uuid(),
  title: s.string({ min: 1, max: 200 }),
  done: s.boolean(),
});
// Тип TypeScript виводиться зі схеми Task, яка також використовується для перевірки даних.
export type Task = Infer<typeof Task>;

// open створює сховище у пам’яті. Операції отримують його через needs.
export const tasksRepository = resource({
  id: "tasks.repository",
  scope: "application",
  effects: ["memory.read", "memory.write"],
  open() {
    const tasks = new Map<string, Task>();
    return {
      create(title: string): Task {
        const task = { id: randomUUID(), title, done: false };
        tasks.set(task.id, task);
        return task;
      },
      find(id: string): Task | undefined {
        return tasks.get(id);
      },
    };
  },
});

const CreateTask = operationContract({
  id: "tasks.create",
  input: s.object({ title: s.string({ min: 1, max: 200 }) }),
  output: Task,
});

const createTaskRoute = http.post("/tasks", CreateTask, {
  status: 201,
  needs: { tasks: tasksRepository },
  run: ({ input, tasks }) => ok(tasks.create(input.title)),
});

export const createTask = createTaskRoute.operation;

export const getTask = operation({
  id: "tasks.get",
  input: s.object({ id: s.uuid() }),
  output: Task,
  needs: { tasks: tasksRepository },
  errors: { TASK_NOT_FOUND: 404 },
  run({ input, tasks }) {
    const task = tasks.find(input.id);
    return task ? ok(task) : error("TASK_NOT_FOUND");
  },
});

// Модуль об’єднує операції та вказує, які HTTP-маршрути їх викликають.
export const tasks = module({
  id: "tasks",
  operations: [getTask],
  routes: [createTaskRoute, http.get("/tasks/:id", getTask)],
});

export function createTasksApp() {
  return application({ modules: [tasks] });
}

export default createTasksApp();
