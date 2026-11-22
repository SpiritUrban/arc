import type { Writable } from "./reactive.js";

type FormValueBinding =
  | { kind: "value"; state: Writable<string>; initial: string }
  | { kind: "checked"; state: Writable<boolean>; initial: boolean };

const formValues = new WeakMap<Element, FormValueBinding>();

export function registerFormValue(element: Element, state: Writable<string>) {
  formValues.set(element, { kind: "value", state, initial: state.get() });
  return () => { formValues.delete(element); };
}

export function registerFormChecked(element: Element, state: Writable<boolean>) {
  formValues.set(element, { kind: "checked", state, initial: state.get() });
  return () => { formValues.delete(element); };
}

export function formValue(element: Element) {
  return formValues.get(element);
}
