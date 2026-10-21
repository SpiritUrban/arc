import { application, module } from "@arc/framework/server";
import { listTasks, createTask } from "./server.ts";
import { TasksPage } from "./page.ts";
const tasks = module({
  id: "tasks",
  operations: [listTasks, createTask],
  web: { nodes: [TasksPage], entry: "examples/fullstack-tasks/browser.ts" },
});
export const createApp = () => application({ modules: [tasks] });
export default createApp();
