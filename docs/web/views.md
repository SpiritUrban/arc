# Views та bindings

MVP використовує imperative DOM builder, без JSX/template compiler та VDOM.

```ts
import { state, binding, view, mount } from "@arc/framework/web";
const count = state({ id: "counter.value", initial: 0 });
const text = binding({ id: "counter.text", type: "text", sources: [count] });
const page = view({
  id: "counter.page",
  bindings: [text],
  setup({ document, bind }) {
    const span = document.createElement("span");
    bind(text, span);
    return span;
  },
});
const instance = mount(page, document.querySelector("#app")!);
count.set(1); // тільки text binding
instance.unmount();
```

Binding types: text, property, attribute, event, visible. sources — явні readable dependencies; name задає property/attribute/event name, format перетворює source values. Для event задайте handler (action або callback(event,trace)) та необов’язкове input значення. Помилки event handler перехоплюються як binding.error telemetry.

View setup виконується один раз на mount. IR містить binding nodes та BINDS source → binding; view залежить від bindings. `needs` додає явні graph dependencies, `owned` задає nodes, які треба активувати/звільнити разом із view. Instance scope знімає listeners/subscriptions і прибирає DOM на unmount; application dispose також unmount усі instances.

Приклад Tasks показує двосторонній input через окремі property та input-event bindings. Список MVP відображається text formatter; keyed list reconciliation не реалізований.
