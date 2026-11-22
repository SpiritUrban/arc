import { remoteApi } from "@arc/framework/fullstack";
import { selectedUser } from "../user-selection.ts";

export const orderClient = remoteApi({
  from: [selectedUser],
  key: (userId) => userId,
  headers: (userId) => ({ authorization: `Bearer ${userId}` }),
});
