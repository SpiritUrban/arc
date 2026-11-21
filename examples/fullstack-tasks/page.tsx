import { derive, project, view } from "@arc/framework/web";
import { remote, remoteForm, textField } from "@arc/framework/fullstack";
import { ListTasks, CreateTask } from "./contracts.ts";

// Список завантажується з ListTasks. Після створення форма оновлює той самий ресурс.
export const tasks = remote(ListTasks, { id: "tasks.current" });
const { fields, submit: createTask } = remoteForm(CreateTask, {
  fields: { title: textField() },
  refresh: [tasks],
});

const error = derive({
  id: "tasks.error-text",
  from: [createTask.error, tasks.error],
  compute: (mutation, load) => {
    const failure = mutation ?? load;
    if (!failure) return "";
    if (typeof failure === "object") {
      if ("error" in failure && typeof failure.error === "string")
        return failure.error;
      if (
        "fault" in failure &&
        typeof failure.fault === "object" &&
        failure.fault &&
        "code" in failure.fault &&
        typeof failure.fault.code === "string"
      )
        return failure.fault.code;
    }
    return "Request failed";
  },
});

// bind:value синхронізує поле зі станом, а bind:disabled блокує кнопку під час запиту.
export const TasksPage = view({
  id: "tasks.page",
  template: () => (
    <main style="font:16px system-ui;max-width:650px;margin:50px auto;padding:24px;background:#f4f7fa;color:#15293d;border-radius:16px">
      <h1>ARC Tasks</h1>
      <p>One application graph · browser → server → bindings</p>
      <form on:submit={createTask}>
        <input
          placeholder="Task title"
          aria-label="Task title"
          required
          maxlength="120"
          style="padding:10px;width:70%"
          bind:value={fields.title}
        />
        <button
          type="submit"
          style="padding:10px;margin-left:8px"
          bind:disabled={createTask.running}
        >
          Add
        </button>
      </form>
      <p
        bind:text={project(tasks.loading, (loading) =>
          loading ? "Loading…" : "",
        )}
      />
      <p role="alert" style="color:#ad253a" bind:text={error} />
      <pre
        style="white-space:pre-wrap"
        bind:text={project(tasks.data, (data) =>
          data?.length
            ? data.map(({ title }) => "• " + title).join("\n")
            : "No tasks yet",
        )}
      />
    </main>
  ),
});
