// Браузерна частина користувачів. Мережевий ресурс завантажує записи,
// локальний пошук фільтрує їх, а вибір рядка змінює список замовлень.
import { each, render, view } from "@arc/framework/web";
import { mutation, setFrom } from "@arc/framework/fullstack";
import { CreateUser, UpdateUser, type User } from "./contracts.ts";
import { failureMessage } from "../ui.ts";
import { activeUser, selectedUser, users } from "../user-selection.ts";

// CreateUser — спільний контракт. На сервері його виконує createUser у ./server.ts.
export const addUser = mutation(CreateUser, {
  update: [users.insertBy(), setFrom(selectedUser, "id")],
  fieldErrors: { email: "EMAIL_EXISTS" },
});
const updateUser = mutation(UpdateUser, {
  update: users.replaceBy(),
  fieldErrors: { email: "EMAIL_EXISTS" },
  resetOnSuccess: false,
});

function ProfileForm({ user }: { user?: ReturnType<typeof User.parse> }) {
  const editing = user !== undefined;
  const form = editing ? updateUser : addUser;
  const { name, email } = form.fieldsFor("name", "email");
  const title = editing ? "Редагувати вибраного користувача" : "Новий користувач";
  const submitLabel = editing ? "Зберегти користувача" : "＋ Додати користувача";
  const pendingLabel = editing ? "Зберігаємо…" : "Додаємо…";

  function message() {
    if (!editing)
      return failureMessage((email.failed() ? undefined : form.error()) ?? users.error());
    if (updateUser.failed("USER_NOT_FOUND")) return "Користувача не знайдено.";
    return email.failed() || form.invalid() ? "" : failureMessage(form.error());
  }

  return (
    <>
      <div class="panel-divider"></div>
      <h3>{title}</h3>
      <form
        data-form={!editing || undefined}
        data-edit-user={editing || undefined}
        onSubmit={user ? updateUser.with("id", user.id) : addUser}
      >
        <label>
          Ім’я
          <input
            data-name
            {...name.input}
            placeholder={editing ? undefined : "Олена Коваль"}
            autocomplete="name"
            value={user?.name}
          />
        </label>
        {editing && (
          <p class="error" role="alert">
            {name.errorMessage("Перевірте ім’я користувача.")}
          </p>
        )}
        <label>
          Email
          <input
            data-email
            {...email.input}
            placeholder={editing ? undefined : "olena@example.com"}
            autocomplete="email"
            value={user?.email}
          />
        </label>
        <p class="error" role="alert" data-email-error>
          {email.errorMessage({
            failed: "Користувач із такою поштою вже існує.",
            invalid: editing ? "Перевірте адресу email." : undefined,
          })}
        </p>
        <button class="button secondary" type="submit">
          {form.running() ? pendingLabel : submitLabel}
        </button>
        <p class="error" role="alert" data-error>{message()}</p>
      </form>
    </>
  );
}

export const UsersPage = view({
  id: "users.page",
  needs: [addUser, updateUser],
  state: { search: "" },
  template({ search }, { derive }) {
    const visible = derive([users.data, search], (users, search) => {
      const term = search.toLowerCase();
      return (users ?? []).filter((user) =>
        `${user.name} ${user.email}`.toLowerCase().includes(term),
      );
    });

    return (
      <section id="users" class="panel users-panel">
        <div class="panel-heading">
          <div>
            <span class="eyebrow">КОМАНДА</span>
            <h2>Користувачі</h2>
          </div>
          <span class="badge">LIVE</span>
        </div>
        <p class="muted" data-status>
          {users.loading()
            ? "Оновлюємо список…"
            : `${users.data()?.length ?? 0} у вашому просторі`}
        </p>
        {users.error() ? (
          <button type="button" class="button secondary" onClick={users.refresh}>
            Повторити завантаження
          </button>
        ) : null}
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
          {each(visible, {
            empty: <div class="empty">Користувачів не знайдено</div>,
            render: (user) => (
              <button
                type="button"
                class="user-row"
                data-user={user.id}
                aria-pressed={selectedUser() === user.id}
                onClick={selectedUser.setTo(user.id)}
              >
                <span class="avatar">{user.name.slice(0, 2).toUpperCase()}</span>
                <span class="user-info">
                  <strong>{user.name}</strong>
                  <small>{user.email}</small>
                </span>
                <span class="select-mark" aria-hidden="true"></span>
              </button>
            ),
          })}
        </div>
        <ProfileForm />
        {render.present(activeUser, (user) => <ProfileForm user={user} />)}
      </section>
    );
  },
});
