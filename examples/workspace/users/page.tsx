// Браузерна частина користувачів. Мережевий ресурс завантажує записи,
// локальний пошук фільтрує їх, а вибір рядка змінює список замовлень.
import { view } from "@arc/framework/web";
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

function ProfileFields({ saved }: { saved?: ReturnType<typeof User.parse> }) {
  const editing = saved !== undefined;
  const form = editing ? updateUser : addUser;
  const duplicate = () => form.failed("EMAIL_EXISTS");
  const invalidName = () => editing && form.invalid("name");
  const invalidEmail = () => editing && form.invalid("email");

  return (
    <>
      <label>
        Ім’я
        <input
          data-name={editing ? undefined : ""}
          name="name"
          required
          minlength="2"
          maxlength="100"
          placeholder={editing ? undefined : "Олена Коваль"}
          autocomplete="name"
          value={saved?.name}
          aria-invalid={editing ? invalidName() : undefined}
        />
      </label>
      {editing && (
        <p class="error" role="alert">
          {invalidName() && "Перевірте ім’я користувача."}
        </p>
      )}
      <div>
        <label>
          Email
          <input
            data-email={editing ? undefined : ""}
            name="email"
            required
            type="email"
            placeholder={editing ? undefined : "olena@example.com"}
            autocomplete="email"
            value={saved?.email}
            aria-invalid={duplicate() || invalidEmail()}
          />
        </label>
        <p class="error" role="alert" data-email-error={editing ? undefined : ""}>
          {duplicate()
            ? "Користувач із такою поштою вже існує."
            : invalidEmail() && "Перевірте адресу email."}
        </p>
      </div>
    </>
  );
}

function renderProfileEditor(saved: ReturnType<typeof User.parse> | undefined) {
  if (!saved) return null;
  return (
    <>
      <div class="panel-divider"></div>
      <h3>Редагувати вибраного користувача</h3>
      <form data-edit-user onSubmit={updateUser}>
        <input type="hidden" name="id" value={saved.id} />
        <ProfileFields saved={saved} />
        <button class="button secondary" type="submit">
          {updateUser().running ? "Зберігаємо…" : "Зберегти користувача"}
        </button>
        <p class="error" role="alert">
          {updateUser.failed("USER_NOT_FOUND")
            ? "Користувача не знайдено."
            : updateUser().error && !updateUser.invalid() && !updateUser.failed("EMAIL_EXISTS")
              ? failureMessage(updateUser().error)
              : ""}
        </p>
      </form>
    </>
  );
}

export const UsersPage = view({
  id: "users.page",
  needs: updateUser,
  state: { search: "" },
  template: ({ search }) => {

    function visible() {
      const query = search().toLowerCase();
      return (users().data ?? []).filter((user) =>
        `${user.name} ${user.email}`.toLowerCase().includes(query),
      );
    }

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
        <div class="panel-divider"></div>
        <h3>Новий користувач</h3>
        <form data-form onSubmit={addUser}>
          <ProfileFields />
          <button class="button secondary" type="submit">
            {addUser().running ? "Додаємо…" : "＋ Додати користувача"}
          </button>
        </form>
        <p class="error" role="alert" data-error>
          {failureMessage(
            (addUser.failed("EMAIL_EXISTS") ? undefined : addUser().error) ??
              users().error,
          )}
        </p>
        {renderProfileEditor(activeUser())}
      </section>
    );
  },
});
