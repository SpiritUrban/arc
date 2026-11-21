export const money = (value: number) =>
  new Intl.NumberFormat("uk-UA", {
    style: "currency",
    currency: "UAH",
    maximumFractionDigits: 0,
  }).format(value);
// ARC передає бізнес-помилки в error, а збої виконання в fault. Тут перетворюємо їх на текст для UI.
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
