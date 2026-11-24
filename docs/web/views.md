# TSX-шаблони та bindings

Пишіть HTML у файлах `.tsx`. Статичний шаблон передавайте напряму в `template`, а функцію використовуйте, коли потрібні локальні поля стану. Шаблон має один кореневий HTML-елемент. Реактивні значення позначайте через `bind:…`, дії — через `on:…`.

```tsx
import { state, action, view } from "@arc/framework/web";

const count = state({ id: "counter.value", initial: 0 });
const increment = action({
  id: "counter.increment",
  needs: count,
  run(_, ctx) {
    ctx.set(count, count() + 1);
  },
});

export const Counter = view({
  id: "counter.page",
  template: (
    <section>
      <p>Лічильник: <strong>{count}</strong></p>
      <button type="button" onClick={increment}>Додати</button>
    </section>
  ),
});
```

Коли викликається `view()`, ARC виконує функцію шаблону й створює вузли bindings. Вони доступні в графі та Stand ще до монтування. DOM створюється окремо для кожного mount. Шаблон має бути чистим. Readable передавайте напряму, як `{count}`. В обчислювальному графі застосунку вирази на кшталт `{count() * 2}` теж реактивні; без ARC-компілятора вони обчислюються лише під час оголошення view.

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

Для read-only значень не потрібен префікс `bind:`: вставляйте readable як `{count}`, а властивості задавайте напряму — `disabled={busy}`, `class={style}`, `aria-pressed={selected}`. Так само можна передати `href`, `title`, `value`, `checked` та `data-*`.

Двосторонній зв’язок із формами задавайте явно:

| Директива | Що робить |
| --- | --- |
| `bind:value` | Синхронізує поле/select зі string state; radio-групу, checkbox-групу або `<select multiple>` — із відповідним string/string-array state |
| `bind:checked` | Синхронізує одиночний checkbox із writable boolean state |
| `bind:visible` | Керує видимістю через властивість `hidden` |

Події задавайте через JSX-пропси на кшталт `onClick`, `onSubmit`, `onChange` та `onKeyDown`. Вони приймають обробник або ARC action. Синтаксис `on:…` також лишається доступним.

Radio-кнопки однієї групи використовують спільний string state:

```tsx
<input type="radio" name="plan" value="basic" bind:value={plan} />
<input type="radio" name="plan" value="pro" bind:value={plan} />
```

`on:submit` скасовує стандартну навігацію та ігнорує повторний submit, поки дія виконується. ARC на цей час блокує кнопки надсилання без явного `bind:disabled`. У Stand дія з’єднана з event-вузлом ребром `TRIGGERS`; залежності даних видно через `BINDS`.

Read-only значення оновлюють DOM-властивість чи атрибут. `bind:value` окремо синхронізує поле зі станом у дві сторони; `bind:visible` керує видимістю.

Якщо `bind:value` отримує `undefined` під час створення елемента, поле працює зі звичайним `value`. Це дозволяє спільному компоненту приймати необов’язковий сигнал як пропс.

Нативний `form.reset()` або кнопка `type="reset"` відновлює початкові значення сигналів і прив’язаних полів. ARC враховує скасування події `reset` через `preventDefault()`.

Директиви прикріплюйте до елементів основного шаблону. Для `bind:children` можна повертати фрагменти й масиви елементів; при оновленні ARC замінює вміст контейнера. Події зі змінних рядків можна делегувати через binding на цьому контейнері. [Форми й списки](forms-and-events.md)

## Реактивний текст і обчислення

```tsx
<p>Замовлень: {visibleOrders().length}</p>
```

Передайте стан або похідне значення як дочірній вираз JSX. Значення, створені через `state`, `signal`, `derive`, і проєкції ресурсу читаються однаково — викликом без аргументів: `count()`, `visibleOrders()` або `users.data()`. ARC створить окремий текстовий вузол і оновлюватиме його значення. Для одноразового форматування, як-от `{count().toFixed(2)}`, не створюйте окремий `derive`. Метод `.get()` також лишається доступним для імперативного коду й інших `Readable`. `project(source, format)` потрібен для явного джерела в низькорівневих bindings. Stand показує ребро `BINDS` від джерела до елемента шаблону. Для спільного похідного значення використовуйте `derive`, а для двостороннього `bind:value` — writable string state.

Для умов, списків і обчислень із кількох джерел передавайте функцію як дочірній JSX-вузол. Вона обчислюється повторно, коли змінюються прочитані в ній реактивні значення. `render(() => …)` лишається доступним, якщо потрібні явні посилання на джерела. Для одного явного джерела використовуйте `render.from(source, template)`. Наприклад, `render.from(order.data, renderSummary)` у Workspace передає поточне замовлення в шаблон і додає джерело до графа.

```tsx
{() => users().map((user) => (
  <button type="button" onClick={(_, { set }) => set(selectedUser, user.id)}>
    {user.name}
  </button>
))}
```

ARC відстежує читання реактивних значень під час обчислення і замінює вміст ділянки при змінах. Обробники рядків очищаються разом із ділянкою. `set` із контексту події передає trace залежним оновленням. Stand показує ділянку як один вузол, а джерела, доступні лише через callback, можна підключити до статичного графа через `view.needs`.

## Реактивні JSX-вирази

ARC CLI та browser build автоматично вмикають reactive JSX для локальних TSX-модулів, імпортованих із точки входу застосунку або сторінки. Це однаково працює для файлових маршрутів, `web: "./page.tsx"` і `web: { nodes, entry }`, зокрема для спільних компонентів. У цих файлах pragma не потрібен. Поза графом ARC, коли TSX завантажується вручну через ARC importer, додайте `// @arc reactive-jsx`.

Режим потребує TypeScript 5.9. У JSX-виразах виклик реактивного значення без аргументів або прямий виклик `.get()` створює реактивну прив’язку. Функція `export default function Page()` стає кореневим `view` з ID зі шляху до файла.

Пряме читання іменованого джерела, як-от `users()`, `visibleOrders()` або `count()`, додає ребро `BINDS` до графа. ARC може запустити запит, на який посилається лише JSX. Якщо джерело читається всередині допоміжної функції, яка приховує його від шаблону, оголосіть його в `view.needs`.

```tsx
<button
  class={selected() ? "selected" : "idle"}
  aria-pressed={selected()}
  onClick={() => selected.set(!selected())}
>
  {selected() ? "Вибрано" : "Вибрати"}
</button>
```

Режим охоплює дочірні вирази JSX та атрибути `class`, `className`, `disabled`, `aria-…` і `data-…` HTML-елементів. ARC оновлює реактивні атрибути на наявному DOM-елементі. Сигнал, створений через `signal`, можна прочитати як `selected()`. Поля локального стану `view` теж є сигналами. Записи через `.set()` у синхронному `onClick` успадковують трасу події.

## Списки зі стабільними ключами

У TSX застосунку список можна написати через звичайний JSX.

```tsx
{users().map(user => (
  <button key={user.id} onClick={() => selected.set(user.id)}>
    {user.name}
  </button>
))}
```

ARC розпізнає пряму `.map()` із функцією від одного параметра, що повертає один JSX-елемент із `key`, і використовує той самий механізм, що й `each`. Ключ має бути стабільним рядком або числом.

`each(source, { key, render, empty })` зберігає DOM незмінених рядків. Джерелом може бути реактивне значення або функція, що читає кілька реактивних значень. `empty` задає необов’язковий елемент для порожнього списку.

У рядку можна використовувати `on:click`, реактивний текст, `bind:class`, `bind:aria-…` та `bind:data-…`. ARC оновлює прив’язки на наявному елементі й прибирає підписки та обробники, коли рядок видаляється. Stand записує події рядків під вузлом списку. Джерела, які читає лише функція списку, можна включити до статичного графа через `view.needs`.

## Локальний стан

Задайте початкові значення через `state`, а поля використовуйте в шаблоні.

Якщо локальне значення одне, передайте його напряму:

```tsx
const Counter = view({
  id: "counter.page",
  state: 0,
  template: (count) => <button onClick={() => count.update((n) => n + 1)}>{count}</button>,
});
```

ARC створює для нього локальний сигнал `counter.page.state.value`. Коли станів кілька або їм потрібні власні імена в графі, задайте об’єкт `state: { search: "" }`.

```tsx
const SearchPage = view({
  id: "search.page",
  state: { search: "" },
  template: ({ search }) => <input type="search" bind:value={search} />,
});
```

Для початкових примітивних значень достатньо об’єкта `state`. Якщо початковий стан треба обчислити або містить об’єкти, використовуйте фабрику `state: () => ({ ... })`. ARC викликає її для кожного монтування, тож тримайте без побічних ефектів. Кожен екземпляр отримує власні значення. Під час демонтажу ARC очищає їхні підписки, а Stand використовує стабільний ID `search.page.state.search`.

Другий аргумент шаблону зі `state` і `PageContext` надають `derive(sources, compute)`. Передайте один сигнал або список джерел. ARC створює обчислення для кожного монтування та звільняє його під час демонтажу.

```tsx
const SearchPage = view({
  id: "search.page",
  state: { search: "" },
  template({ search }, { derive }) {
    const term = derive(search, (value) => value.trim().toLowerCase());
    return <output>{term()}</output>;
  },
});
```

У TSX, який збирає ARC, ім’я змінної дає ID `search.page.derived.term`. Якщо компілятор не може вивести ім’я, ARC нумерує обчислення в порядку оголошення. Для фіксованого ID задайте ім’я явно через `derive("term", search, compute)`. [Список замовлень Workspace](../../examples/workspace/orders/page.tsx)

У кореневій функції сторінки використовуйте `local` із `PageContext`.

```tsx
import type { PageContext } from "@arc/framework/web";

export default function Page({ local }: PageContext) {
  const search = local("");
  return <input type="search" bind:value={search} />;
}
```

ARC створює новий сигнал під час кожного монтування. Для прямого оголошення `const search = local("")` ID у Stand містить назву змінної, наприклад `page:page.state.search` для `page.tsx`.

## Вкладені view

Вставте оголошений view як дочірній елемент статичного TSX-шаблону. Fragment групує кілька вузлів без зайвої HTML-обгортки.

```tsx
const WorkspacePage = view({
  id: "workspace.page",
  template: <main><><UsersPage /><OrdersPage /></></main>,
});
```

Оголошений `view` можна використовувати як JSX-тег, як звичайний компонент. Він лишається окремим вузлом графа зі своїм mount і lifecycle; звичайні функції-компоненти, що повертають TSX, залишаються легкими шаблонними компонентами. ARC додає вкладені view до графа, монтує їх разом із батьківським і очищає їхні підписки під час демонтажу. У браузерній точці входу імпортуйте `startWeb` з `@arc/framework/web` і викличте `startWeb(WorkspacePage, target)`. Повернений застосунок має метод `dispose()`.

## Явні bindings

Для нестандартного DOM-обробника оголосіть `binding()` і передайте його через `bind={binding}` у шаблоні. ARC додасть його до графа разом із вузлами директив.

Якщо view вже передає власний список `bindings`, він підтримує старий сценарій, у якому шаблон виконується на mount і використовує `bind={…}`. Для переходу на директиви приберіть цей список. Низькорівневий `setup({ document, scope, bind })` доступний для інтеграцій із прямим доступом до DOM.

[Життєвий цикл](lifecycle.md) · [Повний приклад Counter](../../examples/web-counter/page.tsx)
