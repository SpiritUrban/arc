import { remote } from "@arc/framework/fullstack";
import { read } from "./server.ts";
export const resource = remote(read, { id: "leak.remote" });
