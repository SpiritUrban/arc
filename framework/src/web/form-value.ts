import type { Writable } from "./reactive.js";

type FormValueBinding =
  | { kind: "value"; state: Writable<string>; initial: string }
  | { kind: "radio"; state: Writable<string>; initial: string }
  | { kind: "values"; state: Writable<string[]>; initial: string[] }
  | { kind: "checked"; state: Writable<boolean>; initial: boolean };

const formValues = new WeakMap<Element, FormValueBinding>();

function register(element: Element, binding: FormValueBinding, sync: () => void) {
  formValues.set(element, binding);
  const document = element.ownerDocument;
  const onReset = (event: Event) => {
    const form = event.target as HTMLFormElement | null;
    if (form?.localName !== "form" || (element as HTMLInputElement).form !== form)
      return;
    queueMicrotask(() => {
      if (event.defaultPrevented || formValues.get(element) !== binding) return;
      if (binding.kind !== "values" && Object.is(binding.state.get(), binding.initial)) {
        // The browser may have restored a different DOM default without changing ARC state.
        sync();
        return;
      }
      switch (binding.kind) {
        case "value":
        case "radio":
          binding.state.set(binding.initial);
          break;
        case "checked":
          binding.state.set(binding.initial);
          break;
        case "values":
          binding.state.set([...binding.initial]);
          break;
      }
    });
  };
  document.addEventListener("reset", onReset);
  return () => {
    if (formValues.get(element) === binding) formValues.delete(element);
    document.removeEventListener("reset", onReset);
  };
}

export function registerFormValue(element: Element, state: Writable<string>, sync: () => void) {
  return register(element, { kind: "value", state, initial: state.get() }, sync);
}

export function registerFormChecked(element: Element, state: Writable<boolean>, sync: () => void) {
  return register(element, { kind: "checked", state, initial: state.get() }, sync);
}

export function registerFormRadio(element: Element, state: Writable<string>, sync: () => void) {
  return register(element, { kind: "radio", state, initial: state.get() }, sync);
}

export function registerFormValues(element: Element, state: Writable<string[]>, sync: () => void) {
  return register(element, { kind: "values", state, initial: [...state.get()] }, sync);
}

export function formValue(element: Element) {
  return formValues.get(element);
}
