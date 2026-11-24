import type { Writable } from "./reactive.js";

type FormValueBinding =
  | { kind: "value"; state: Writable<string>; initial: string }
  | { kind: "radio"; state: Writable<string>; initial: string }
  | { kind: "values"; state: Writable<string[]>; initial: string[] }
  | { kind: "checked"; state: Writable<boolean>; initial: boolean };

type FormRegistration = {
  element: Element;
  binding: FormValueBinding;
  sync: () => void;
};

const formValues = new WeakMap<Element, FormRegistration>();
const documentFields = new WeakMap<Document, Set<FormRegistration>>();

function restore({ binding, sync }: FormRegistration) {
  if (binding.kind !== "values" && Object.is(binding.state.get(), binding.initial)) {
    // A native reset can change the DOM even when ARC state is already initial.
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
}

function onReset(event: Event) {
  const form = event.target as HTMLFormElement | null;
  if (form?.localName !== "form") return;
  const fields = documentFields.get(form.ownerDocument);
  if (!fields) return;
  const matching: FormRegistration[] = [];
  for (const registration of fields) {
    if ((registration.element as HTMLInputElement).form === form) matching.push(registration);
  }
  if (!matching.length) return;
  queueMicrotask(() => {
    if (event.defaultPrevented) return;
    for (const registration of matching) {
      if (formValues.get(registration.element) === registration) restore(registration);
    }
  });
}

function register(element: Element, binding: FormValueBinding, sync: () => void) {
  const registration = { element, binding, sync };
  formValues.set(element, registration);
  const document = element.ownerDocument;
  let fields = documentFields.get(document);
  if (!fields) {
    fields = new Set();
    documentFields.set(document, fields);
    document.addEventListener("reset", onReset);
  }
  const registered = fields;
  registered.add(registration);
  return () => {
    if (formValues.get(element) === registration) formValues.delete(element);
    if (registered.delete(registration) && !registered.size) {
      documentFields.delete(document);
      document.removeEventListener("reset", onReset);
    }
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
  return formValues.get(element)?.binding;
}
