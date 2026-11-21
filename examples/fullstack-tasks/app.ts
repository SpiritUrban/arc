import { application } from "@arc/framework/server";
import { listTasks, createTask } from "./server.ts";

export const createApp = () => application({
  operations: [listTasks, createTask],
  web: "./page.tsx",
});

export default createApp();
