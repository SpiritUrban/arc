// Браузерна частина користувачів. Мережевий ресурс завантажує записи,
// локальний пошук фільтрує їх, а вибір рядка змінює список замовлень.
import { each, render, view } from "@arc/framework/web";
import { mutation, setFrom } from "@arc/framework/fullstack";
import { CreateUser, UpdateUser, UserProfile, type User } from "./contracts.ts";
import { editFormOptions, failureMessage } from "../ui.ts";
import { activeUser, selectedUser, users } from "../user-selection.ts";

const profiles = users.dataOr([], "profiles");

// CreateUser — спільний контракт. На сервері його виконує createUser у ./server.ts.
export const addUser = mutation(CreateUser, {
  update: [users.insertBy(), setFrom(selectedUser, "id")],
});
const updateUser = mutation(UpdateUser, {
  ...editFormOptions,
  update: users.replaceBy(),
});

function ProfileForm({ user }: { user?: User }) {
  const editing = user !== undefined;
  const form = editing ? updateUser : addUser;
  const { name, email } = form.fieldsFor(UserProfile);
  const title = editing ? "Редагувати вибраного користувача" : "Новий користувач";
  const submitLabel = editing ? "Зберегти користувача" : "＋ Додати користувача";
  const pendingLabel = editing ? "Зберігаємо…" : "Додаємо…";

  function message() {
    if (editing && updateUser.failed("USER_NOT_FOUND")) return "Користувача не знайдено.";
    const error = email.failed() || (editing && form.invalid()) ? undefined : form.error();
    return failureMessage(error ?? (editing ? undefined : users.error()));
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
          {render.when(form.running, pendingLabel, submitLabel)}
        </button>
        <p class="error" role="alert" data-error>{message()}</p>
      </form>
    </>
  );
}

export const UsersPage = view({
  id: "users.page",
  state: { search: "" },
  template({ search }, { derive }) {
    const visible = derive([profiles, search], (profiles, search) => {
      const term = search.toLowerCase();
      return profiles.filter((user) =>
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
        <p class="muted" data-status role="status">
          {users.loading()
            ? "Оновлюємо список…"
            : `${profiles().length} у вашому просторі`}
        </p>
        {render.present(users.error,
          <button type="button" class="button secondary" onClick={users.refresh}>
            Повторити завантаження
          </button>,
        )}
        <label class="search-label">
          <span>Пошук</span>
          <input
            data-search
            placeholder="Ім’я або email"
            type="search"
            bind:value={search}
          />
        </label>
        <div class="user-list" data-list aria-label="Користувачі" aria-busy={users.loading}>
          {each(visible, {
            empty: <div class="empty">Користувачів не знайдено</div>,
            render: (user) => (
              <button
                type="button"
                class="user-row"
                data-user={user.id}
                aria-pressed={selectedUser.is(user.id)}
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
        {render.present(activeUser, (user) => <ProfileForm user={user} />, { needs: updateUser })}
      </section>
    );
  },
});
