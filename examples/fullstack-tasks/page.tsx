import { mutation, query } from "@arc/framework/fullstack";
import type { PageContext } from "@arc/framework/web";
import { ListTasks, CreateTask } from "./contracts.ts";

const tasks = query(ListTasks);
const addTask = mutation(CreateTask, { refresh: tasks });

export const title = "ARC Tasks";

export default function Page({ local, derive }: PageContext) {
  const search = local("");
  const visibleTasks = derive([tasks.data, search], (rows, search) => {
    const term = search.toLowerCase();
    return rows?.filter((task) => task.title.toLowerCase().includes(term)) ?? [];
  });

  return (
    <main style="font:16px system-ui;max-width:650px;margin:50px auto;padding:24px;background:#f4f7fa;color:#15293d;border-radius:16px">
      <h1>ARC Tasks</h1>
      <form onSubmit={addTask}>
        <input
          name="title"
          placeholder="Task title"
          aria-label="Task title"
          required
          maxlength="120"
          style="padding:10px;width:70%"
        />
        <button type="submit" style="padding:10px;margin-left:8px">Add</button>
      </form>
      <input type="search" aria-label="Search tasks" bind:value={search} />
      {tasks().loading && <p>Loading…</p>}
      <p role="alert" style="color:#ad253a">
        {addTask.failed("TITLE_EXISTS")
          ? "A task with that title already exists."
          : addTask().error || tasks().error ? "Request failed" : ""}
      </p>
      <ul data-tasks>
        {visibleTasks().map((task) => <li key={task.id}>{task.title}</li>)}
      </ul>
      {!tasks().loading && !tasks().data?.length && <p>No tasks yet</p>}
    </main>
  );
}
