export const editFormOptions = { resetOnSuccess: false } as const;

const currency = new Intl.NumberFormat("uk-UA", {
  style: "currency",
  currency: "UAH",
  maximumFractionDigits: 0,
});

export const money = (value: number) => currency.format(value);
// ARC передає бізнес-помилки в error, а збої виконання в fault. Тут перетворюємо їх на текст для UI.
export function failureMessage(failure: unknown): string {
  if (!failure) return "";
  if (typeof failure === "object") {
    const fault = "fault" in failure ? failure.fault : undefined;
    const code = fault && typeof fault === "object" && "code" in fault ? fault.code : undefined;
    if (code === "UNAUTHORIZED")
      return "Виберіть користувача, щоб працювати із замовленнями.";
    if (code === "VALIDATION_ERROR" || ("issues" in failure && failure.issues))
      return "Перевірте введені дані.";
  }
  return "Не вдалося виконати запит. Перевірте дані та спробуйте ще раз.";
}
