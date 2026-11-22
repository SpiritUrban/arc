import {
  createContext,
  useContext,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listUsers, ProfileError, saveUser } from "./api.ts";
import {
  demoUserId,
  profileSchema,
  type Profile,
  type User,
} from "./contracts.ts";

const usersKey = ["users"];
const emptyProfile: Profile = { name: "", email: "" };
const Selection = createContext<{ id: string; select(id: string): void }>({
  id: demoUserId,
  select() {},
});

export function UserSelection({ children }: { children: ReactNode }) {
  const [id, select] = useState(demoUserId);
  return (
    <Selection.Provider value={{ id, select }}>{children}</Selection.Provider>
  );
}

function ProfileForm({ user }: { user?: User }) {
  const [draft, setDraft] = useState<Profile>(user ?? emptyProfile);
  const [validation, setValidation] = useState<readonly string[]>([]);
  const { select } = useContext(Selection);
  const cache = useQueryClient();
  const mutation = useMutation({
    mutationFn: (profile: Profile) => saveUser(profile, user?.id),
    async onSuccess(saved) {
      if (user) {
        await cache.cancelQueries({ queryKey: usersKey });
        cache.setQueryData<User[]>(usersKey, (current) =>
          current?.map((item) => (item.id === saved.id ? saved : item)),
        );
      } else {
        select(saved.id);
        await cache.invalidateQueries({ queryKey: usersKey });
      }
    },
  });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutation.isPending) return;
    mutation.reset();
    const parsed = profileSchema.safeParse(draft);
    if (!parsed.success) {
      setValidation(
        parsed.error.issues.flatMap(({ path }) =>
          typeof path[0] === "string" ? [path[0]] : [],
        ),
      );
      return;
    }
    setValidation([]);
    try {
      const saved = await mutation.mutateAsync(parsed.data);
      setDraft((current) =>
        current === draft ? (user ? saved : emptyProfile) : current,
      );
    } catch {
      // TanStack Query keeps the failed response for the form to display.
    }
  }

  const error = mutation.error;
  const failure = error instanceof ProfileError ? error : undefined;
  const nameInvalid =
    validation.includes("name") || failure?.fields.includes("name");
  const duplicate = failure?.message === "EMAIL_EXISTS";
  const emailInvalid =
    validation.includes("email") || failure?.fields.includes("email");
  return (
    <form
      aria-label={
        user ? "Редагувати вибраного користувача" : "Новий користувач"
      }
      noValidate
      onSubmit={submit}
    >
      <div>
        <label>
          Ім’я
          <input
            name="name"
            required
            minLength={2}
            maxLength={100}
            autoComplete="name"
            value={draft.name}
            aria-invalid={!!nameInvalid}
            onChange={(event) =>
              setDraft({ ...draft, name: event.target.value })
            }
          />
        </label>
        {nameInvalid && (
          <p className="error" role="alert">
            Перевірте ім’я користувача.
          </p>
        )}
      </div>
      <div>
        <label>
          Email
          <input
            name="email"
            required
            type="email"
            autoComplete="email"
            value={draft.email}
            aria-invalid={!!emailInvalid || duplicate}
            onChange={(event) =>
              setDraft({ ...draft, email: event.target.value })
            }
          />
        </label>
        {(duplicate || emailInvalid) && (
          <p className="error" role="alert">
            {duplicate
              ? "Користувач із такою поштою вже існує."
              : "Перевірте адресу email."}
          </p>
        )}
      </div>
      <button
        className="button secondary"
        type="submit"
        disabled={mutation.isPending}
      >
        {user
          ? mutation.isPending
            ? "Зберігаємо…"
            : "Зберегти користувача"
          : mutation.isPending
            ? "Додаємо…"
            : "＋ Додати користувача"}
      </button>
      {error && !nameInvalid && !emailInvalid && !duplicate && (
        <p className="error" role="alert">
          {failure?.message === "USER_NOT_FOUND"
            ? "Користувача не знайдено."
            : "Не вдалося зберегти користувача."}
        </p>
      )}
    </form>
  );
}

export function UsersPanel() {
  const { id, select } = useContext(Selection);
  const [search, setSearch] = useState("");
  const users = useQuery({
    queryKey: usersKey,
    queryFn: ({ signal }) => listUsers(signal),
  });
  const current = users.data?.find((user) => user.id === id);
  const visible =
    users.data?.filter((user) =>
      `${user.name} ${user.email}`.toLowerCase().includes(search.toLowerCase()),
    ) ?? [];

  return (
    <section className="panel users-panel" id="users">
      <h2>Користувачі</h2>
      <p className="muted" role="status">
        {users.isFetching
          ? "Оновлюємо список…"
          : `${users.data?.length ?? 0} у вашому просторі`}
      </p>
      {users.isError && (
        <p className="error" role="alert">
          Не вдалося завантажити користувачів.
        </p>
      )}
      <label className="search-label">
        <span>Пошук користувачів</span>
        <input
          type="search"
          placeholder="Ім’я або email"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>
      <div className="user-list" aria-label="Користувачі">
        {!visible.length && !users.isPending && (
          <div className="empty">Користувачів не знайдено</div>
        )}
        {visible.map((user) => (
          <button
            type="button"
            key={user.id}
            aria-pressed={user.id === id}
            className={user.id === id ? "user-row selected" : "user-row"}
            onClick={() => select(user.id)}
          >
            <span className="avatar" aria-hidden="true">
              {user.name.slice(0, 2).toUpperCase()}
            </span>
            <span className="user-info">
              <strong>{user.name}</strong>
              <small>{user.email}</small>
            </span>
          </button>
        ))}
      </div>
      <div className="panel-divider" />
      <h3>Новий користувач</h3>
      <ProfileForm />
      {current && (
        <>
          <div className="panel-divider" />
          <h3>Редагувати вибраного користувача</h3>
          <ProfileForm key={current.id} user={current} />
        </>
      )}
    </section>
  );
}
