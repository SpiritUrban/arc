import { expect, test } from "@playwright/test";

const demo = "00000000-0000-4000-8000-000000000001";
const isReact = (info) => info.project.name === "react";
const userRow = (page, name) =>
  page.getByRole("button", { name: new RegExp(name) });
const createUserForm = (page) => page.locator("#users form").first();
const editUserForm = (page) => page.locator("#users form").nth(1);
const history = (page) => page.getByRole("table");
const orderRow = (page, product) =>
  history(page).getByRole("row").filter({ hasText: product });
const createOrderForm = (page) => page.locator("form.order-form").first();
const orderDetail = (page) =>
  page.getByRole("region", { name: "Замовлення", exact: true });
const orderPath = (info, suffix = "") =>
  (isReact(info) ? "/api/orders" : "/orders") + suffix;

function auth(owner) {
  return { authorization: `Bearer ${owner}`, accept: "application/json" };
}

async function fixture(request, info, prefix, products) {
  const created = await request.post(isReact(info) ? "/api/users" : "/users", {
    data: {
      name: `${prefix} User`,
      email: `${prefix.toLowerCase()}@example.com`,
    },
  });
  expect(created.status()).toBe(201);
  const user = await created.json();
  const rows = [];
  for (const [product, quantity] of products) {
    const response = await request.post(orderPath(info), {
      data: { product, quantity },
      headers: auth(user.id),
    });
    expect(response.status()).toBe(201);
    rows.push(await response.json());
  }
  return { user, rows };
}

function transport(info, operation) {
  if (!isReact(info)) return `/_arc/call/${operation}`;
  if (operation === "users.create") return "/api/users";
  if (operation === "orders.cancel") return "/api/orders/cancel";
  return "/api/orders";
}

async function hold(page, pathname, matches, { delayResponse = false } = {}) {
  let arrived;
  let unblock;
  const request = new Promise((resolve) => {
    arrived = resolve;
  });
  const released = new Promise((resolve) => {
    unblock = resolve;
  });
  const urlMatches = (url) => url.pathname === pathname;
  const delayed = [];
  const handler = (route) => {
    if (!matches(route.request())) return route.fallback();
    const complete = async () => {
      const response = delayResponse ? await route.fetch() : undefined;
      arrived(route.request());
      await released;
      const delivery = response
        ? route.fulfill({ response })
        : route.continue();
      await delivery.catch(() => {});
    };
    const pending = complete();
    delayed.push(pending);
    return pending;
  };
  await page.route(urlMatches, handler);
  return {
    request,
    get count() {
      return delayed.length;
    },
    async release() {
      unblock();
      await Promise.all(delayed);
      await page.unroute(urlMatches, handler);
    },
  };
}

async function fillProfile(form, name, email) {
  await form.locator('[name="name"]').fill(name);
  await form.locator('[name="email"]').fill(email);
}

test("NAV-01 BUILD-01 · browser navigation and built assets", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Робочий простір" });
  await expect(nav.getByRole("link", { name: "Огляд" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await nav.getByRole("link", { name: "Замовлення" }).click();
  await expect(page).toHaveURL(/\/orders$/);
  await expect(nav.getByRole("link", { name: "Замовлення" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/orders$/);
  const id = "00000000-0000-4000-8000-000000000099";
  expect((await page.goto(`/orders/${id}`)).status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: "Деталі замовлення" }),
  ).toBeVisible();
  await expect(orderDetail(page).getByRole("alert")).toContainText(
    "недоступне",
  );
  expect(
    (
      await request.get("/missing-page", { headers: { accept: "text/html" } })
    ).status(),
  ).toBe(404);
  const src = await page.locator("script[src]").first().getAttribute("src");
  expect(new URL(src, page.url()).origin).toBe(new URL(page.url()).origin);
  const asset = await request.get(src);
  expect(asset.ok()).toBeTruthy();
  expect(await asset.text()).not.toMatch(
    /node:http|node:fs|randomUUID as|auth\.currentUser/,
  );
});

test("USR-01–03 · search, create, select and edit a profile", async ({
  page,
}, info) => {
  await page.goto("/");
  const demoRow = userRow(page, "Demo User");
  await expect(demoRow).toHaveAttribute("aria-pressed", "true");
  const create = createUserForm(page);
  await fillProfile(create, "X", "bad-email");
  await create.getByRole("button", { name: /Додати користувача/ }).click();
  await expect(create.locator('[name="name"]')).toHaveValue("X");
  await expect(create.locator('[name="email"]')).toHaveValue("bad-email");
  if (isReact(info)) {
    await expect(create.locator('[name="email"]')).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  } else {
    expect(
      await create
        .locator('[name="email"]')
        .evaluate((input) => input.validity.typeMismatch),
    ).toBe(true);
  }

  await fillProfile(create, "Olena Parity", "olena.parity@example.com");
  const pending = await hold(
    page,
    transport(info, "users.create"),
    (request) => request.method() === "POST",
  );
  try {
    await create.getByRole("button", { name: /Додати користувача/ }).click();
    await expect(
      create.getByRole("button", { name: /Додаємо/ }),
    ).toBeDisabled();
  } finally {
    await pending.release();
  }
  const olena = userRow(page, "Olena Parity");
  await expect(olena).toHaveAttribute("aria-pressed", "true");
  await expect(create.locator('[name="name"]')).toHaveValue("");
  const search = page.locator('#users input[type="search"]');
  for (const term of ["OLENA", "olena.parity@example.com"]) {
    await search.fill(term);
    await expect(olena).toBeVisible();
    await expect(demoRow).toHaveCount(0);
  }
  await search.fill("");
  await demoRow.click();
  await expect(demoRow).toHaveAttribute("aria-pressed", "true");
  await olena.click();

  const edit = editUserForm(page);
  await fillProfile(edit, "Olena Updated", "olena.updated@example.com");
  const save = edit.getByRole("button", { name: "Зберегти користувача" });
  if (isReact(info)) {
    await save.click();
    await expect(userRow(page, "Olena Updated")).toHaveAttribute("aria-pressed", "true");
  } else {
    const saving = await hold(page, transport(info, "users.update"), () => true);
    try {
      await save.click();
      const update = await saving.request;
      expect(update.postDataJSON().id).toBe(await olena.getAttribute("data-user"));
      await demoRow.click();
      await expect(edit.locator('[name="name"]')).toHaveValue("Demo User");
    } finally {
      await saving.release();
    }
    await expect(userRow(page, "Olena Updated")).toBeVisible();
    await expect(demoRow).toHaveAttribute("aria-pressed", "true");
    await expect(edit.locator('[name="email"]')).toHaveValue("demo@example.com");
    await userRow(page, "Olena Updated").click();
  }
  await fillProfile(edit, "Olena Updated", "demo@example.com");
  await edit.getByRole("button", { name: "Зберегти користувача" }).click();
  await expect(
    edit.getByRole("alert").filter({ hasText: "вже існує" }),
  ).toBeVisible();
  await expect(edit.locator('[name="email"]')).toHaveValue("demo@example.com");
  await expect(userRow(page, "Olena Updated")).toContainText(
    "olena.updated@example.com",
  );
  await fillProfile(create, "Duplicate User", "demo@example.com");
  await create.getByRole("button", { name: /Додати користувача/ }).click();
  await expect(
    page.locator("#users").getByRole("alert").filter({ hasText: "вже існує" }),
  ).toHaveCount(2);
  await expect(create.locator('[name="name"]')).toHaveValue("Duplicate User");
});

test("ORD-01–03 · form, filters, totals and a delayed owner query", async ({
  page,
  request,
}, info) => {
  const { user, rows } = await fixture(request, info, "History", [
    ["Блокнот А5", 3],
    ["Папір", 1],
  ]);
  const cancel = await request.post(orderPath(info, "/cancel"), {
    data: { id: rows[1].id },
    headers: auth(user.id),
  });
  expect(cancel.ok()).toBeTruthy();
  await page.goto("/orders");
  await expect(page.getByText("Тут з’являться замовлення")).toBeVisible();
  await userRow(page, user.name).click();
  await expect(orderRow(page, "Блокнот А5")).toBeVisible();
  const form = createOrderForm(page);
  await form.locator('[name="quantity"]').fill("101");
  await form.getByRole("button", { name: /Створити/ }).click();
  await expect(form.locator('[name="quantity"]')).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(form.locator('[name="product"]')).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await form.locator('[name="product"]').fill("ARC Блокнот");
  await form.locator('[name="quantity"]').fill("2");
  await form.getByRole("button", { name: /Створити/ }).click();
  await expect(orderRow(page, "ARC Блокнот")).toContainText(/50\s*(?:₴|грн)/);
  await expect(form.locator('[name="product"]')).toHaveValue("");
  await expect(form.locator('[name="quantity"]')).toHaveValue("1");

  const search = page.getByPlaceholder("Назва товару");
  const status = page.getByLabel("Статус");
  await search.fill("БЛОКНОТ");
  await expect(history(page).locator("tbody tr")).toHaveCount(2);
  await status.selectOption("cancelled");
  await expect(page.getByText("Замовлень не знайдено")).toBeVisible();
  await search.fill("");
  await expect(history(page).locator("tbody tr")).toHaveCount(1);
  await expect(orderRow(page, "Папір")).toBeVisible();
  await expect(page.locator(".summary-grid")).toContainText("03");
  await expect(page.locator(".summary-grid")).toContainText("150");
  await status.selectOption("all");

  await userRow(page, "Demo User").click();
  await expect(orderRow(page, "Блокнот А5")).toHaveCount(0);
  const delayed = await hold(
    page,
    transport(info, "orders.list"),
    (req) => req.headers().authorization === `Bearer ${user.id}`,
    { delayResponse: true },
  );
  try {
    await userRow(page, user.name).click();
    await expect(orderRow(page, "Блокнот А5")).toBeVisible();
    await delayed.request;
    await userRow(page, "Demo User").click();
    await expect(orderRow(page, "Блокнот А5")).toHaveCount(0);
  } finally {
    await delayed.release();
  }
  await expect(page.getByText("Тут з’являться замовлення")).toBeVisible();
  await expect(orderRow(page, "Блокнот А5")).toHaveCount(0);
});

for (const listIncludesOrder of [false, true]) {
  test(`ARC create during the first list read (row already in response: ${listIncludesOrder})`, async ({
    page,
    request,
  }, info) => {
    test.skip(isReact(info));
    const { user } = await fixture(request, info, `Cold${listIncludesOrder}`, [
      ["Existing order", 1],
    ]);
    const list = transport(info, "orders.list");
    const isOwner = (req) => req.headers().authorization === `Bearer ${user.id}`;
    const held = await hold(page, list, isOwner, {
      delayResponse: !listIncludesOrder,
    });
    const reads = [];
    page.on("request", (req) => {
      if (new URL(req.url()).pathname === list && isOwner(req)) reads.push(req);
    });
    const product = "Created during cold read";
    try {
      await page.goto("/orders");
      await userRow(page, user.name).click();
      await held.request;
      const form = createOrderForm(page);
      await form.locator('[name="product"]').fill(product);
      await form.getByRole("button", { name: /Створити/ }).click();
      await expect(form.locator('[name="product"]')).toHaveValue("");
      await expect(history(page).locator("tbody tr")).toHaveCount(0);
    } finally {
      await held.release();
    }
    await expect(orderRow(page, "Existing order")).toHaveCount(1);
    await expect(orderRow(page, product)).toHaveCount(1);
    expect(reads).toHaveLength(1);
  });
}

test("ARC late create updates the original owner's cached list", async ({
  page,
  request,
}, info) => {
  test.skip(isReact(info));
  const { user } = await fixture(request, info, "LateCreate", [
    ["Original order", 1],
  ]);
  const product = "Late confirmed order";
  await page.goto("/orders");
  await userRow(page, user.name).click();
  await expect(orderRow(page, "Original order")).toBeVisible();
  const form = createOrderForm(page);
  const create = await hold(page, transport(info, "orders.create"), () => true);
  try {
    await form.locator('[name="product"]').fill(product);
    await form.getByRole("button", { name: /Створити/ }).click();
    await create.request;
    await userRow(page, "Demo User").click();
    await expect(page.getByText("Тут з’являться замовлення")).toBeVisible();
  } finally {
    await create.release();
  }
  await expect(form.locator('[name="product"]')).toHaveValue("");
  await expect(orderRow(page, product)).toHaveCount(0);

  const returning = await hold(page, transport(info, "orders.list"), (req) =>
    req.headers().authorization === `Bearer ${user.id}`,
  );
  try {
    await userRow(page, user.name).click();
    await returning.request;
    await expect(orderRow(page, product)).toHaveCount(1);
  } finally {
    await returning.release();
  }
  await expect(page.locator("[data-loading]")).toBeEmpty();
  await expect(orderRow(page, product)).toHaveCount(1);
});

test("ORD-04–06 · ownership, detail update and independent cancellation", async ({
  page,
  request,
}, info) => {
  const { user, rows } = await fixture(request, info, "Detail", [
    ["ARC Блокнот", 2],
    ["Блокнот А5", 3],
    ["Папір", 1],
  ]);
  const [first, second, third] = rows;
  const member = orderPath(info, `/${first.id}`);
  for (const response of [
    await request.get(member, { headers: auth(demo) }),
    await request.put(member, {
      headers: auth(demo),
      data: { product: "Чужа зміна", quantity: 2 },
    }),
    await request.post(orderPath(info, "/cancel"), {
      headers: auth(demo),
      data: { id: first.id },
    }),
  ]) {
    expect(response.status()).toBe(404);
    expect((await response.json()).error).toBe("ORDER_NOT_FOUND");
  }
  expect(
    (
      await request.get(member, { headers: { accept: "application/json" } })
    ).status(),
  ).toBe(401);
  await page.goto(`/orders/${first.id}`);
  await expect(orderDetail(page).getByRole("alert")).toContainText(
    "недоступне",
  );
  await userRow(page, user.name).click();
  await expect(
    orderDetail(page).getByRole("heading", { name: first.product }),
  ).toBeVisible();
  await page.getByRole("link", { name: "← Усі замовлення" }).click();
  await expect(orderRow(page, first.product)).toBeVisible();
  await expect(page.getByText("Завантажуємо замовлення…")).toHaveCount(0);
  await orderRow(page, first.product).getByRole("link").click();
  await expect(
    orderDetail(page).getByRole("heading", { name: first.product }),
  ).toBeVisible();
  await expect(
    orderDetail(page).getByText("Завантажуємо замовлення…"),
  ).toHaveCount(0);

  const reads = { edit: 0, back: 0 };
  let phase = "edit";
  page.on("request", (req) => {
    const path = new URL(req.url()).pathname;
    if (
      isReact(info)
        ? req.method() === "GET" && path.startsWith("/api/orders")
        : /^\/_arc\/call\/orders\.(get|list)$/.test(path)
    )
      reads[phase]++;
  });
  const edit = orderDetail(page)
    .getByRole("button", { name: "Зберегти зміни" })
    .locator("xpath=ancestor::form");
  await expect(edit.locator('[name="product"]')).toHaveValue(first.product);
  await expect(edit.locator('[name="quantity"]')).toHaveValue("2");
  await edit.locator('[name="quantity"]').fill("0");
  await edit.getByRole("button", { name: "Зберегти зміни" }).click();
  await expect(edit.locator('[name="quantity"]')).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(
    edit.getByRole("alert").filter({ hasText: "від 1 до 100" }),
  ).toBeVisible();
  await expect(edit.locator('[name="quantity"]')).toHaveValue("0");
  if (!isReact(info)) {
    await expect(edit.locator('[name="id"]')).toHaveCount(0);
    await edit.evaluate((form, id) => {
      const field = document.createElement("input");
      field.type = "hidden";
      field.name = "id";
      field.value = id;
      form.append(field);
    }, second.id);
  }
  await edit.locator('[name="product"]').fill("Робочий блокнот");
  await edit.locator('[name="quantity"]').fill("4");
  await edit.getByRole("button", { name: "Зберегти зміни" }).click();
  await expect(
    orderDetail(page).getByRole("heading", { name: "Робочий блокнот" }),
  ).toBeVisible();
  expect(reads.edit).toBe(0);
  phase = "back";
  const listRefresh = await hold(
    page,
    transport(info, "orders.list"),
    (req) => req.headers().authorization === `Bearer ${user.id}`,
  );
  try {
    await page.getByRole("link", { name: "← Усі замовлення" }).click();
    await expect(orderRow(page, "Робочий блокнот")).toBeVisible();
    await expect(page.locator(".summary-grid")).toContainText("200");
  } finally {
    await listRefresh.release();
  }
  await expect(page.getByText("Завантажуємо замовлення…")).toHaveCount(0);
  await test.info().attach("order-reads", {
    body: JSON.stringify(reads),
    contentType: "application/json",
  });
  console.log(`${info.project.name} order reads: ${JSON.stringify(reads)}`);

  const firstButton = orderRow(page, "Робочий блокнот").getByRole("button", {
    name: /Скасувати|Скасовуємо/,
  });
  const secondButton = orderRow(page, second.product).getByRole("button", {
    name: /Скасувати|Скасовуємо/,
  });
  const firstHold = await hold(
    page,
    transport(info, "orders.cancel"),
    (req) => req.postDataJSON()?.id === first.id,
  );
  const secondHold = await hold(
    page,
    transport(info, "orders.cancel"),
    (req) => req.postDataJSON()?.id === second.id,
  );
  try {
    await firstButton.click();
    await expect(firstButton).toBeDisabled();
    await firstButton.dispatchEvent("click");
    await expect(secondButton).toBeEnabled();
    await secondButton.click();
    await expect(secondButton).toBeDisabled();
    await firstHold.request;
    await secondHold.request;
    const external = await request.post(orderPath(info, "/cancel"), {
      headers: auth(user.id),
      data: { id: first.id },
    });
    expect(external.ok()).toBeTruthy();
    const readsBeforeConflict = reads.back;
    await firstHold.release();
    await expect(
      orderRow(page, "Робочий блокнот")
        .getByRole("alert")
        .filter({ hasText: "вже скасовано" }),
    ).toBeVisible();
    if (!isReact(info)) {
      await expect(orderRow(page, "Робочий блокнот")).toContainText(
        "Скасовано",
      );
      await expect(firstButton).toHaveCount(0);
      expect(reads.back).toBe(readsBeforeConflict);
    }
    await expect(secondButton).toBeDisabled();
    await secondHold.release();
    await expect(orderRow(page, second.product)).toContainText("Скасовано");
    expect(firstHold.count).toBe(1);
    expect(secondHold.count).toBe(1);
  } finally {
    await firstHold.release();
    await secondHold.release();
  }

  await orderRow(page, third.product).getByRole("link").click();
  if (!isReact(info)) {
    await expect(
      orderDetail(page).getByRole("heading", { name: third.product }),
    ).toBeVisible();
    await expect(
      orderDetail(page).getByText("Завантажуємо замовлення…"),
    ).toHaveCount(0);
    const external = await request.post(orderPath(info, "/cancel"), {
      headers: auth(user.id),
      data: { id: third.id },
    });
    expect(external.ok()).toBeTruthy();
  }
  const readsBeforeDetailConflict = reads.back;
  await orderDetail(page)
    .getByRole("button", { name: /Скасувати/ })
    .click();
  await expect(
    orderDetail(page).getByText("Скасовано", { exact: true }),
  ).toBeVisible();
  if (!isReact(info)) {
    await expect(
      orderDetail(page).getByRole("alert").filter({ hasText: "вже скасовано" }),
    ).toBeVisible();
    expect(reads.back).toBe(readsBeforeDetailConflict);
  }
  await expect(
    orderDetail(page).getByRole("button", { name: "Зберегти зміни" }),
  ).toHaveCount(0);
  const repeated = await request.post(orderPath(info, "/cancel"), {
    headers: auth(user.id),
    data: { id: third.id },
  });
  expect(repeated.status()).toBe(409);
  await page.getByRole("link", { name: "← Усі замовлення" }).click();
  await expect(orderRow(page, third.product)).toContainText("Скасовано");
});
