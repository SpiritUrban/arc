import { remoteApi } from "@arc/framework/fullstack";
import { selectedUser } from "../user-selection.ts";

export const orderClient = remoteApi({
  from: selectedUser,
  key: true,
  headers: (userId) => ({ authorization: `Bearer ${userId}` }),
});
