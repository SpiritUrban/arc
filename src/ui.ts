import { binding, type Writable } from "@arc/framework/web";
export const escapeHTML = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export const money = (value: number) =>
  new Intl.NumberFormat("uk-UA", {
    style: "currency",
    currency: "UAH",
    maximumFractionDigits: 0,
  }).format(value);
export function inputBindings(id: string, source: Writable<string>) {
  return [
    binding({
      id: id + ".value",
      type: "property",
      name: "value",
      sources: [source],
    }),
    binding({
      id: id + ".edit",
      type: "event",
      name: "input",
      sources: [source],
      handler(event, trace) {
        source._trace = trace;
        source.set((event.target as HTMLInputElement).value);
      },
    }),
  ] as const;
}
export function failureMessage(failure: any): string {
  if (!failure) return "";
  if (failure.error === "EMAIL_EXISTS")
    return "Користувач із такою поштою вже існує.";
  if (failure.fault?.code === "UNAUTHORIZED")
    return "Виберіть користувача, щоб працювати із замовленнями.";
  if (failure.fault?.code === "VALIDATION_ERROR" || failure.issues)
    return "Перевірте введені дані.";
  return "Не вдалося виконати запит. Перевірте дані та спробуйте ще раз.";
}
