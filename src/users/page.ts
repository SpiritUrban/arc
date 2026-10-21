import { state, derive, action, binding, view } from "@arc/framework/web";
import { remote, remoteClient } from "@arc/framework/fullstack";
import { ListUsers, CreateUser } from "./contracts.ts";
import { escapeHTML, failureMessage, inputBindings } from "../ui.ts";
export const selectedUser = state({
  id: "workspace.selected-user",
  initial: "00000000-0000-4000-8000-000000000001",
});
export const usersData = remote(ListUsers, { id: "users.current" });
const name = state({ id: "users.new-name", initial: "" });
const email = state({ id: "users.new-email", initial: "" });
const search = state({ id: "users.search", initial: "" });
const create = remoteClient(CreateUser, { id: "users.create.remote" });
export const addUser = action({
  id: "users.add",
  needs: { name, email, create, selectedUser },
  invalidates: [usersData],
  async run(_, ctx) {
    const result = await create.call(
      { name: name.get().trim(), email: email.get().trim() },
      ctx,
    );
    if (result.ok) {
      ctx.set(name, "");
      ctx.set(email, "");
      ctx.set(selectedUser, result.value.id);
    }
    return result;
  },
});
export const activeUser = derive({
  id: "users.active",
  from: [usersData.data, selectedUser],
  compute: (users, id) => users?.find((u) => u.id === id),
});
const filtered = derive({
  id: "users.filtered",
  from: [usersData.data, search],
  compute: (users, query) =>
    (users ?? []).filter((u) =>
      `${u.name} ${u.email}`.toLowerCase().includes(query.toLowerCase()),
    ),
});
const nameFields = inputBindings("users.name", name),
  emailFields = inputBindings("users.email", email),
  searchFields = inputBindings("users.query", search);
const list = binding({
  id: "users.list.rows",
  type: "property",
  name: "innerHTML",
  sources: [filtered, selectedUser],
  format: (users, selected) =>
    users.length
      ? users
          .map(
            (u: any) =>
              `<button type="button" class="user-row ${u.id === selected ? "selected" : ""}" data-user="${escapeHTML(u.id)}" aria-pressed="${u.id === selected}"><span class="avatar">${escapeHTML(u.name.slice(0, 2).toUpperCase())}</span><span class="user-info"><strong>${escapeHTML(u.name)}</strong><small>${escapeHTML(u.email)}</small></span><span class="select-mark">${u.id === selected ? "✓" : "→"}</span></button>`,
          )
          .join("")
      : '<div class="empty">Користувачів не знайдено</div>',
});
const select = binding({
  id: "users.select",
  type: "event",
  sources: [selectedUser],
  handler(event, trace) {
    const row = (event.target as Element).closest("[data-user]");
    if (row) {
      selectedUser._trace = trace;
      selectedUser.set(row.getAttribute("data-user")!);
    }
  },
});
const submit = binding({
  id: "users.submit",
  type: "event",
  name: "submit",
  sources: [],
  handler(event, trace) {
    event.preventDefault();
    if (!addUser.running.get()) return addUser.execute(undefined, { trace });
  },
});
// Declared action dependency keeps the event callback's call explicit in the graph.
submit.dependencies = [...(submit.dependencies ?? []), addUser];
submit.relations = [
  ...(submit.relations ?? []),
  { to: addUser, kind: "TRIGGERS" },
];
const disabled = binding({
  id: "users.submit.disabled",
  type: "property",
  name: "disabled",
  sources: [addUser.running],
});
const errors = binding({
  id: "users.errors",
  type: "text",
  sources: [addUser.error, usersData.error],
  format: (a, b) => failureMessage(a ?? b),
});
const status = binding({
  id: "users.status",
  type: "text",
  sources: [usersData.loading, usersData.data],
  format: (loading, data) =>
    loading ? "Оновлюємо список…" : `${data?.length ?? 0} у вашому просторі`,
});
export const UsersPage = view({
  id: "users.page",
  bindings: [
    ...nameFields,
    ...emailFields,
    ...searchFields,
    list,
    select,
    submit,
    disabled,
    errors,
    status,
  ],
  setup({ document, bind }) {
    const section = document.createElement("section");
    section.className = "panel users-panel";
    section.innerHTML = `<div class="panel-heading"><div><span class="eyebrow">КОМАНДА</span><h2>Користувачі</h2></div><span class="badge">LIVE</span></div><p class="muted" data-status></p><label class="search-label"><span>Пошук</span><input data-search placeholder="Ім’я або email" type="search" /></label><div class="user-list" data-list aria-label="Користувачі"></div><div class="panel-divider"></div><h3>Новий користувач</h3><form data-form><label>Ім’я<input data-name required minlength="2" maxlength="100" placeholder="Олена Коваль" autocomplete="name" /></label><label>Email<input data-email required type="email" placeholder="olena@example.com" autocomplete="email" /></label><button class="button secondary" type="submit">＋ Додати користувача</button></form><p class="error" role="alert" data-error></p>`;
    const at = (s: string) => section.querySelector(s)!;
    for (const b of nameFields) bind(b, at("[data-name]"));
    for (const b of emailFields) bind(b, at("[data-email]"));
    for (const b of searchFields) bind(b, at("[data-search]"));
    bind(list, at("[data-list]"));
    bind(select, at("[data-list]"));
    bind(submit, at("[data-form]"));
    bind(disabled, at("button[type=submit]"));
    bind(errors, at("[data-error]"));
    bind(status, at("[data-status]"));
    return section;
  },
});
