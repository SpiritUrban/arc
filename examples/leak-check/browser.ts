import { remote } from "@arc/framework/fullstack";
import { read } from "./server.ts";
// Цей файл використовують тести збірки. Якщо server.ts оголошений у serverModules,
// збірник підставляє в браузерний код лише контракт операції read.
export const resource = remote(read, { id: "leak.remote" });
