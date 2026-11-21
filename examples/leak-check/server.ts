import { operation, resource, s, ok } from "@arc/framework/server";
// Тестове значення допомагає перевірити, що реалізація серверного ресурсу
// залишається на сервері після збірки браузерного коду.
const database = resource({
  id: "leak.db",
  open: () => ({ secret: "ARC_PRIVATE_DATABASE_SECRET" }),
});
export const read = operation({
  id: "leak.read",
  expose: { web: true },
  needs: { database },
  input: s.object({}),
  output: s.string(),
  run: () => ok("safe"),
});
