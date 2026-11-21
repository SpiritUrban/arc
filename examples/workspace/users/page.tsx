// @arc reactive-jsx
// Браузерна частина користувачів. Мережевий ресурс завантажує записи,
// локальний пошук фільтрує їх, а вибір рядка змінює список замовлень.
import { each, view } from "@arc/framework/web";
import { remoteForm } from "@arc/framework/fullstack";
import { CreateUser } from "./contracts.ts";
import { failureMessage } from "../ui.ts";
import { selectedUser, usersData } from "../user-selection.ts";

// CreateUser — спільний контракт. На сервері його виконує createUser у ./server.ts.
const { submit: addUser } = remoteForm(CreateUser, {
  needs: [selectedUser],
  refresh: [usersData],
  onSuccess(user, ctx) {
    ctx.set(selectedUser, user.id);
  },
});

export { addUser };

export const UsersPage = view({
  id: "users.page",
  needs: { usersData, selectedUser },
  state: () => ({ search: "" }),
  template: ({ search }) => (
    <section class="panel users-panel">
      <div class="panel-heading">
        <div>
          <span class="eyebrow">КОМАНДА</span>
          <h2>Користувачі</h2>
        </div>
        <span class="badge">LIVE</span>
      </div>
      <p class="muted" data-status>
        {usersData.loading.get()
          ? "Оновлюємо список…"
          : `${usersData.data.get()?.length ?? 0} у вашому просторі`}
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
        {each(
          () => {
            const query = search.get().toLowerCase();
            return (usersData.data.get() ?? []).filter((user) =>
              `${user.name} ${user.email}`.toLowerCase().includes(query),
            );
          },
          {
            key: (user) => user.id,
            empty: <div class="empty">Користувачів не знайдено</div>,
            render(user) {
              return (
                <button
                  type="button"
                  class={selectedUser.get() === user.id ? "user-row selected" : "user-row"}
                  data-user={user.id}
                  aria-pressed={selectedUser.get() === user.id}
                  on:click={(_, { set }) => set(selectedUser, user.id)}
                >
                  <span class="avatar">{user.name.slice(0, 2).toUpperCase()}</span>
                  <span class="user-info">
                    <strong>{user.name}</strong>
                    <small>{user.email}</small>
                  </span>
                  <span class="select-mark">
                    {selectedUser.get() === user.id ? "✓" : "→"}
                  </span>
                </button>
              );
            },
          },
        )}
      </div>
      <div class="panel-divider"></div>
      <h3>Новий користувач</h3>
      {/* Під час submit дія читає поля зі стану. addUser.running блокує кнопку до завершення. */}
      <form data-form on:submit={addUser}>
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
        <label>
          Email
          <input
            data-email
            required
            type="email"
            placeholder="olena@example.com"
            autocomplete="email"
            name="email"
          />
        </label>
        <button
          class="button secondary"
          type="submit"
          bind:disabled={addUser.running}
        >
          ＋ Додати користувача
        </button>
      </form>
      <p class="error" role="alert" data-error>
        {failureMessage(addUser.error.get() ?? usersData.error.get())}
      </p>
    </section>
  ),
});
