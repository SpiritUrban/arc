# TSX-шаблони та bindings

Пишіть HTML у файлах `.tsx`. У `template` поверніть один кореневий HTML-елемент. У ньому позначте реактивні значення через `bind:…`, а дії через `on:…`.

```tsx
import { state, action, view } from "@arc/framework/web";

const count = state({ id: "counter.value", initial: 0 });
const increment = action({
  id: "counter.increment",
  needs: { count },
  run(_, ctx) {
    ctx.set(count, count.get() + 1);
  },
});

export const Counter = view({
  id: "counter.page",
  template: () => (
    <section>
      <p>Лічильник: <strong bind:text={count} /></p>
      <button type="button" on:click={increment}>Додати</button>
    </section>
  ),
});
```

Коли викликається `view()`, ARC виконує функцію шаблону й створює вузли bindings. Вони доступні в графі та Stand ще до монтування. DOM створюється окремо для кожного mount. Шаблон має бути чистим. Дані, які змінюються, передавайте через bindings, бо вираз `{count.get()}` прочитає значення лише під час оголошення view.

## Налаштування TypeScript

У `tsconfig.json` задайте ARC як JSX runtime:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "@arc/framework/web"
  }
}
```

ARC CLI використовує esbuild для браузерної збірки. Якщо graph entrypoint імпортує `.tsx`, використовуйте TSX-завантажувач під час розробки або скомпілюйте застосунок у JavaScript перед запуском Node.

## Директиви

| Директива | Що приймає та робить |
| --- | --- |
| `bind:text` | Читає state або derive й оновлює текст |
| `bind:value` | Синхронізує текстове значення поля з writable string state через два вузли, property та input event |
| `bind:disabled` | Оновлює DOM-властивість `disabled` із реактивного boolean |
| `bind:visible` | Керує видимістю через властивість `hidden` |
| `bind:children` | Замінює вміст контейнера реактивними TSX-елементами або текстом |
| `on:click`, `on:submit` та інші `on:…` | Підписуються на DOM-подію та викликають функцію або ARC action без аргументів |

`on:submit` скасовує стандартну навігацію та ігнорує повторний submit, поки дія виконується. ARC на цей час блокує кнопки надсилання без явного `bind:disabled`. У Stand дія з’єднана з event-вузлом ребром `TRIGGERS`; залежності даних видно через `BINDS`.

Директиви прикріплюйте до елементів основного шаблону. Для `bind:children` можна повертати фрагменти й масиви елементів; при оновленні ARC замінює вміст контейнера. Події зі змінних рядків можна делегувати через binding на цьому контейнері. [Форми й списки](forms-and-events.md)

## Реактивний текст і обчислення

```tsx
import { project } from "@arc/framework/web";

<p>Замовлень: {project(visibleOrders, (orders) => orders.length)}</p>
```

Передайте стан або похідне значення як дочірній вираз JSX, наприклад `<p>Кількість: {count}</p>`. ARC створить окремий текстовий вузол і оновлюватиме його значення. `project(source, format)` обчислює текст із явно вказаного джерела. Його також приймають `bind:text`, `bind:children`, `bind:disabled` та `bind:visible`. Stand показує ребро `BINDS` від джерела до елемента шаблону. Для спільного похідного значення використовуйте `derive`, а для двостороннього `bind:value` — writable string state.

Для умов, списків і обчислень із кількох джерел використовуйте `render(() => …)`.

```tsx
{render(() => users.get().map((user) => (
  <button type="button" on:click={(_, { set }) => set(selectedUser, user.id)}>
    {user.name}
  </button>
)))}
```

ARC відстежує виклики `.get()` під час обчислення і замінює вміст ділянки при змінах. Обробники рядків очищаються разом із ділянкою. `set` із контексту події передає trace залежним оновленням. Stand показує ділянку як один вузол, а джерела, доступні лише через callback, можна підключити до статичного графа через `view.needs`.

## Реактивні JSX-вирази

Експериментальний режим ARC CLI і браузерної збірки потребує TypeScript 5.9. Додайте `// @arc reactive-jsx` на початку TSX-файлу, щоб вирази з викликом сигналу без аргументів або прямим викликом `.get()` автоматично створювали реактивні прив’язки.

```tsx
// @arc reactive-jsx
<button
  class={selected() ? "selected" : "idle"}
  aria-pressed={selected()}
  onClick={() => selected.set(!selected())}
>
  {selected() ? "Вибрано" : "Вибрати"}
</button>
```

Режим охоплює дочірні вирази JSX та атрибути `class`, `className`, `aria-…` і `data-…` HTML-елементів. ARC оновлює реактивні атрибути на наявному DOM-елементі. Сигнал, створений через `signal`, можна прочитати як `selected()`. Поля локального стану `view` теж є сигналами. Записи через `.set()` у синхронному `onClick` успадковують трасу події.

## Списки зі стабільними ключами

У файлі з `// @arc reactive-jsx` можна написати список через звичайний JSX.

```tsx
{users().map(user => (
  <button key={user.id} onClick={() => selected.set(user.id)}>
    {user.name}
  </button>
))}
```

ARC розпізнає пряму `.map()` із функцією від одного параметра, що повертає один JSX-елемент із `key`, і використовує той самий механізм, що й `each`. Ключ має бути стабільним рядком або числом.

`each(source, { key, render, empty })` зберігає DOM незмінених рядків. Джерелом може бути реактивне значення або функція, що читає кілька значень через `.get()`. `empty` задає необов’язковий елемент для порожнього списку.

У рядку можна використовувати `on:click`, реактивний текст, `bind:class`, `bind:aria-…` та `bind:data-…`. ARC оновлює прив’язки на наявному елементі й прибирає підписки та обробники, коли рядок видаляється. Stand записує події рядків під вузлом списку. Джерела, які читає лише функція списку, можна включити до статичного графа через `view.needs`.

## Локальний стан

Задайте початкові значення через `state`, а поля використовуйте в шаблоні.

```tsx
const SearchPage = view({
  id: "search.page",
  state: () => ({ search: "" }),
  template: ({ search }) => <input type="search" bind:value={search} />,
});
```

ARC викликає ініціалізатор під час побудови графа й для кожного монтування, тож тримайте його без побічних ефектів. Кожен екземпляр отримує власні значення. Під час демонтажу ARC очищає їхні підписки, а Stand використовує стабільний ID `search.page.state.search`.

## Вкладені view

Вставте оголошений view як дочірній елемент статичного TSX-шаблону.

```tsx
const WorkspacePage = view({
  id: "workspace.page",
  template: () => <main>{UsersPage}{OrdersPage}</main>,
});
```

ARC додає вкладені view до графа з шаблону, монтує їх разом із батьківським view і очищає їхні підписки під час демонтажу. У браузерній точці входу імпортуйте `startWeb` з `@arc/framework/web` і викличте `startWeb(WorkspacePage, target)`. Повернений застосунок має метод `dispose()`.

## Явні bindings

Для нестандартного DOM-обробника оголосіть `binding()` і передайте його через `bind={binding}` у шаблоні. ARC додасть його до графа разом із вузлами директив.

Якщо view вже передає власний список `bindings`, він підтримує старий сценарій, у якому шаблон виконується на mount і використовує `bind={…}`. Для переходу на директиви приберіть цей список. Низькорівневий `setup({ document, scope, bind })` доступний для інтеграцій із прямим доступом до DOM.

[Життєвий цикл](lifecycle.md) · [Повний приклад Counter](../../examples/web-counter/page.tsx)
