import { test } from "node:test";
import assert from "node:assert/strict";
import { handler, test as testOperation, ok, error } from "@arc/framework";
import { createTasksApp, getTask, tasksRepository } from "./tasks.ts";

const id = "00000000-0000-4000-8000-000000000001";

test("operation: repository can be replaced without HTTP", async () => {
  const result = await testOperation(getTask)
    .provide(tasksRepository, {
      create: (title) => ({ id, title, done: false }),
      find: () => undefined,
    })
    .run({ id });

  assert.deepEqual(result, error("TASK_NOT_FOUND"));
});

test("application: created task can be read over HTTP", async () => {
  const app = createTasksApp();
  await app.compile();
  await app.start();
  try {
    const fetch = handler(app);
    const created = await fetch(
      new Request("http://localhost/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Read the ARC documentation" }),
      }),
    );
    assert.equal(created.status, 201);
    const task = await created.json();
    assert.equal(task.done, false);

    const read = await fetch(new Request(`http://localhost/tasks/${task.id}`));
    assert.equal(read.status, 200);
    assert.deepEqual(await read.json(), task);
    assert.deepEqual(await app.execute("tasks.get", { id: task.id }), ok(task));

    const invalid = await fetch(
      new Request("http://localhost/tasks/not-a-uuid"),
    );
    assert.equal(invalid.status, 400);
  } finally {
    await app.close();
  }
});
