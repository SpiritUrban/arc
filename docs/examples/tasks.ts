import { randomUUID } from "node:crypto";
import {
  application,
  http,
  module,
  operation,
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
export type Task = Infer<typeof Task>;

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

export const createTask = operation({
  id: "tasks.create",
  input: s.object({ title: s.string({ min: 1, max: 200 }) }),
  output: Task,
  needs: { tasks: tasksRepository },
  run: ({ input, tasks }) => ok(tasks.create(input.title)),
});

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

export const tasks = module({
  id: "tasks",
  operations: [createTask, getTask],
  routes: [
    http.post("/tasks", createTask, { status: 201 }),
    http.get("/tasks/:id", getTask),
  ],
});

export function createTasksApp() {
  return application({ modules: [tasks] });
}

export default createTasksApp();
