import { application, module } from "@arc/framework/server";
import { listTasks, createTask } from "./server.ts";
import { TasksPage } from "./page.tsx";
// Модуль збирає серверні операції та описує браузерну частину одного застосунку.
const tasks = module({
  id: "tasks",
  operations: [listTasks, createTask],
  web: { nodes: [TasksPage], entry: "examples/fullstack-tasks/browser.ts" },
});
// Фабрика створює окремий екземпляр застосунку для запуску або тесту.
export const createApp = () => application({ modules: [tasks] });
export default createApp();
