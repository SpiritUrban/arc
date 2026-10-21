import { state, action, binding, view } from "@arc/framework/web";
import { remote, remoteClient } from "@arc/framework/fullstack";
import { ListTasks, CreateTask } from "./contracts.ts";
export const title = state({ id: "tasks.new-title", initial: "" });
export const tasks = remote(ListTasks, { id: "tasks.current" });
export const create = remoteClient(CreateTask, { id: "tasks.create-boundary" });
export const addTask = action({
  id: "tasks.add",
  needs: { title, create },
  invalidates: [tasks],
  async run(_, ctx) {
    const result = await create.call({ title: title.get() }, ctx);
    if (result.ok) ctx.set(title, "");
    return result;
  },
});
const inputValue = binding({
  id: "tasks.title-input",
  type: "property",
  name: "value",
  sources: [title],
});
const inputEvent = binding({
  id: "tasks.title-edit",
  type: "event",
  name: "input",
  sources: [],
  handler: (event, trace) => {
    title._trace = trace;
    title.set((event.target as HTMLInputElement).value);
  },
});
const click = binding({
  id: "tasks.add-click",
  type: "event",
  sources: [],
  handler: addTask,
});
const disabled = binding({
  id: "tasks.add-disabled",
  type: "property",
  name: "disabled",
  sources: [addTask.running],
});
const loading = binding({
  id: "tasks.loading-text",
  type: "text",
  sources: [tasks.loading],
  format: (loading) => (loading ? "Loading…" : ""),
});
const list = binding({
  id: "tasks.list-text",
  type: "text",
  sources: [tasks.data],
  format: (data: { title: string }[] | undefined) =>
    data?.map((task) => "• " + task.title).join("\n") ?? "No tasks yet",
});
const error = binding({
  id: "tasks.error-text",
  type: "text",
  sources: [addTask.error, tasks.error],
  format: (mutation, load) => {
    const failure = mutation ?? load;
    return failure
      ? (failure.error ?? failure.fault?.code ?? "Request failed")
      : "";
  },
});
export const TasksPage = view({
  id: "tasks.page",
  bindings: [inputValue, inputEvent, click, disabled, loading, list, error],
  setup({ document, bind }) {
    const main = document.createElement("main");
    main.style.cssText =
      "font:16px system-ui;max-width:650px;margin:50px auto;padding:24px;background:#f4f7fa;color:#15293d;border-radius:16px";
    const heading = document.createElement("h1");
    heading.textContent = "ARC Tasks";
    const note = document.createElement("p");
    note.textContent = "One application graph · browser → server → bindings";
    const input = document.createElement("input");
    input.placeholder = "Task title";
    input.setAttribute("aria-label", "Task title");
    input.style.cssText = "padding:10px;width:70%";
    const button = document.createElement("button");
    button.textContent = "Add";
    button.style.cssText = "padding:10px;margin-left:8px";
    const status = document.createElement("p"),
      errors = document.createElement("p"),
      items = document.createElement("pre");
    errors.setAttribute("role", "alert");
    errors.style.color = "#ad253a";
    items.style.whiteSpace = "pre-wrap";
    bind(inputValue, input);
    bind(inputEvent, input);
    bind(click, button);
    bind(disabled, button);
    bind(loading, status);
    bind(error, errors);
    bind(list, items);
    main.append(heading, note, input, button, status, errors, items);
    return main;
  },
});
