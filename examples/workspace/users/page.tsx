// Браузерна частина користувачів. Мережевий ресурс завантажує записи,
// локальний пошук фільтрує їх, а вибір рядка змінює список замовлень.
import { view } from "@arc/framework/web";
import { mutation } from "@arc/framework/fullstack";
import { CreateUser, UpdateUser } from "./contracts.ts";
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


export const UsersPage = view({
  id: "users.page",
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
          <label>
            Ім’я
            <input
              data-name
              required
              minlength="2"
              maxlength="100"
              placeholder="Олена Коваль"
              autocomplete="name"
              name="name"
            />
          </label>
          <div>
            <label>
              Email
              <input
                data-email
                required
                type="email"
                placeholder="olena@example.com"
                autocomplete="email"
                name="email"
                aria-invalid={addUser.failed("EMAIL_EXISTS")}
              />
            </label>
            <p class="error" role="alert" data-email-error>
              {addUser.failed("EMAIL_EXISTS") && "Користувач із такою поштою вже існує."}
            </p>
          </div>
          <button class="button secondary" type="submit" disabled={addUser().running}>
            {addUser().running ? "Додаємо…" : "＋ Додати користувача"}
          </button>
        </form>
        <p class="error" role="alert" data-error>
          {failureMessage(
            (addUser.failed("EMAIL_EXISTS") ? undefined : addUser().error) ??
              users().error,
          )}
        </p>
        {activeUser() && (
          <>
            <div class="panel-divider"></div>
            <h3>Редагувати вибраного користувача</h3>
            <form data-edit-user onSubmit={updateUser}>
              <input type="hidden" name="id" value={activeUser()!.id} />
              <label>
                Ім’я
                <input
                  name="name"
                  required
                  minlength="2"
                  maxlength="100"
                  value={activeUser()!.name}
                  aria-invalid={updateUser.invalid("name")}
                />
              </label>
              <p class="error" role="alert">
                {updateUser.invalid("name") && "Перевірте ім’я користувача."}
              </p>
              <label>
                Email
                <input
                  name="email"
                  required
                  type="email"
                  value={activeUser()!.email}
                  aria-invalid={updateUser.invalid("email") || updateUser.failed("EMAIL_EXISTS")}
                />
              </label>
              <p class="error" role="alert">
                {updateUser.failed("EMAIL_EXISTS")
                  ? "Користувач із такою поштою вже існує."
                  : updateUser.invalid("email") && "Перевірте адресу email."}
              </p>
              <button class="button secondary" type="submit" disabled={updateUser().running}>
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
        )}
      </section>
    );
  },
});
