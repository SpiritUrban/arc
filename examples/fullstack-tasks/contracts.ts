import { s, operationContract } from "@arc/framework/core";
export const Task = s.object({
  id: s.uuid(),
  title: s.string({ min: 1, max: 120 }),
});
export const CreateTaskInput = s.object({
  title: s.string({ min: 1, max: 120 }),
});
export const ListTasks = operationContract({
  id: "tasks.list",
  expose: { web: true },
  input: s.object({}),
  output: Task.array(),
});
export const CreateTask = operationContract({
  id: "tasks.create",
  expose: { web: true },
  input: CreateTaskInput,
  output: Task,
  errors: {
    TITLE_EXISTS: { status: 409, details: s.object({ title: s.string() }) },
  },
});
