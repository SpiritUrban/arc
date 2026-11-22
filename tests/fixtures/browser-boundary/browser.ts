import { remote } from "@arc/framework/fullstack";
import { read } from "./server.ts";

// This fixture checks that browser builds only include the remote contract descriptor.
export const resource = remote(read, { id: "leak.remote" });
