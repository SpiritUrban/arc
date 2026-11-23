// Браузерна частина користувачів. Мережевий ресурс завантажує записи,
// локальний пошук фільтрує їх, а вибір рядка змінює список замовлень.
import { derive, view } from "@arc/framework/web";
import { mutation } from "@arc/framework/fullstack";
import { CreateUser, UpdateUser, type User } from "./contracts.ts";
import { failureMessage } from "../ui.ts";
import { activeUser, selectedUser, users } from "../user-selection.ts";

// CreateUser — спільний контракт. На сервері його виконує createUser у ./server.ts.
export const addUser = mutation(CreateUser, {
  needs: selectedUser,
  refresh: users,
  onSuccess(user, ctx) {
    ctx.set(selectedUser, user.id);
  },
});
const updateUser = mutation(UpdateUser, {
  update: users.replaceBy("id"),
});

function ProfileForm({ user }: { user?: ReturnType<typeof User.parse> }) {
  const editing = user !== undefined;
  const form = editing ? updateUser : addUser;
  const { running, error } = form;
  const title = editing ? "Редагувати вибраного користувача" : "Новий користувач";
  const submitLabel = editing ? "Зберегти користувача" : "＋ Додати користувача";
  const pendingLabel = editing ? "Зберігаємо…" : "Додаємо…";
  const duplicate = () => form.failed("EMAIL_EXISTS");

  function message() {
    if (!editing)
      return failureMessage(duplicate() ? users().error : error() ?? users().error);
    if (updateUser.failed("USER_NOT_FOUND")) return "Користувача не знайдено.";
    return duplicate() || form.invalid() ? "" : failureMessage(error());
  }

  return (
    <>
      <div class="panel-divider"></div>
      <h3>{title}</h3>
      <form data-form={!editing || undefined} data-edit-user={editing || undefined} onSubmit={form}>
        {user && <input type="hidden" name="id" value={user.id} />}
        <label>
          Ім’я
          <input
            data-name
            name="name"
            required
            minlength="2"
            maxlength="100"
            placeholder={editing ? undefined : "Олена Коваль"}
            autocomplete="name"
            value={user?.name}
            aria-invalid={editing ? form.invalid("name") : undefined}
          />
        </label>
        {editing && (
          <p class="error" role="alert">
            {form.invalid("name") && "Перевірте ім’я користувача."}
          </p>
        )}
        <label>
          Email
          <input
            data-email
            name="email"
            required
            type="email"
            placeholder={editing ? undefined : "olena@example.com"}
            autocomplete="email"
            value={user?.email}
            aria-invalid={duplicate() || (editing && form.invalid("email"))}
          />
        </label>
        <p class="error" role="alert" data-email-error>
          {duplicate()
            ? "Користувач із такою поштою вже існує."
            : editing && form.invalid("email") && "Перевірте адресу email."}
        </p>
        <button class="button secondary" type="submit">
          {running() ? pendingLabel : submitLabel}
        </button>
        <p class="error" role="alert" data-error>{message()}</p>
      </form>
    </>
  );
}

function editProfile(user: ReturnType<typeof User.parse> | undefined) {
  return user ? <ProfileForm user={user} /> : null;
}

export const UsersPage = view({
  id: "users.page",
  needs: [addUser, updateUser],
  state: { search: "" },
  template({ search }, { own }) {
    const visible = own(derive({
      id: "users.page.visible",
      from: [users.data, search],
      compute(users, search) {
        const term = search.toLowerCase();
        return (users ?? []).filter((user) =>
          `${user.name} ${user.email}`.toLowerCase().includes(term),
        );
      },
    }));

    return (
      <section class="panel users-panel">
        <div class="panel-heading">
          <div>
            <span class="eyebrow">КОМАНДА</span>
            <h2>Користувачі</h2>
          </div>
          <span class="badge">LIVE</span>
        </div>
        <p class="muted" data-status>
          {users().loading
            ? "Оновлюємо список…"
            : `${users().data?.length ?? 0} у вашому просторі`}
        </p>
        <label class="search-label">
          <span>Пошук</span>
          <input
            data-search
            placeholder="Ім’я або email"
            type="search"
            bind:value={search}
          />
        </label>
        <div class="user-list" data-list aria-label="Користувачі">
          {!visible().length && <div class="empty">Користувачів не знайдено</div>}
          {visible().map((user) => (
            <button
              key={user.id}
              type="button"
              class={
                selectedUser() === user.id ? "user-row selected" : "user-row"
              }
              data-user={user.id}
              aria-pressed={selectedUser() === user.id}
              onClick={() => selectedUser.set(user.id)}
            >
              <span class="avatar">{user.name.slice(0, 2).toUpperCase()}</span>
              <span class="user-info">
                <strong>{user.name}</strong>
                <small>{user.email}</small>
              </span>
              <span class="select-mark">
                {selectedUser() === user.id ? "✓" : "→"}
              </span>
            </button>
          ))}
        </div>
        <ProfileForm />
        {editProfile(activeUser())}
      </section>
    );
  },
});
