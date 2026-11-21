import type { Writable } from "./reactive.js";

const formValues = new WeakMap<Element, { state: Writable<string>; initial: string }>();

export function registerFormValue(element: Element, state: Writable<string>) {
  formValues.set(element, { state, initial: state.get() });
  return () => { formValues.delete(element); };
}

export function formValue(element: Element) {
  return formValues.get(element);
}
