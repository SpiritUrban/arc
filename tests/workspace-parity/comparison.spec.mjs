import { expect, test } from "@playwright/test";

const repetitions = 10;
const warmups = 2;
function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const midpoint = sorted.length / 2;
  return {
    median: (sorted[midpoint - 1] + sorted[midpoint]) / 2,
    p90: sorted[Math.ceil(sorted.length * 0.9) - 1],
    values,
  };
}

test("Workspace startup, submit and stale-order diagnosis", async ({
  browser,
  request,
  baseURL,
}, info) => {
  test.setTimeout(120_000);
  const react = info.project.name === "react";
  const users = react ? "/api/users" : "/users";
  const orders = react ? "/api/orders" : "/orders";
  const listUsers = react ? users : "/_arc/call/users.list";
  const listOrders = react ? orders : "/_arc/call/orders.list";
  const cancel = react ? orders + "/cancel" : "/_arc/call/orders.cancel";
  const samples = [];
  let diagnosis;
  for (let index = 0; index < warmups + repetitions; index++) {
    const fixture = await request.post(users, {
      data: { name: "Benchmark User", email: `benchmark-${index}@example.com` },
    });
    expect(fixture.status()).toBe(201);
    const owner = (await fixture.json()).id;
    const context = await browser.newContext({ baseURL });
    try {
      const page = await context.newPage();
      const sampleProduct = `Benchmark product ${index}`;
      const matches = (res, path, method) =>
        new URL(res.url()).pathname === path &&
        res.request().method() === method;
      const initial = Promise.all([
        page.waitForResponse((res) =>
          matches(res, listUsers, react ? "GET" : "POST"),
        ),
        page.waitForResponse((res) =>
          matches(res, listOrders, react ? "GET" : "POST"),
        ),
      ]);
      await page.goto("/orders", { waitUntil: "commit" });
      expect((await initial).every((res) => res.ok())).toBe(true);
      await expect(
        page.getByRole("button", { name: /Demo User/ }),
      ).toBeVisible();
      await expect(page.getByText("Тут з’являться замовлення")).toBeVisible();
      const startup = await page.evaluate(() => {
        const scripts = performance
          .getEntriesByType("resource")
          .filter((entry) => new URL(entry.name).pathname.endsWith(".js"));
        return {
          readyMs: performance.now(),
          decodedJsBytes: scripts.reduce(
            (sum, entry) => sum + entry.decodedBodySize,
            0,
          ),
          wireJsBytes: scripts.reduce(
            (sum, entry) => sum + entry.encodedBodySize,
            0,
          ),
          scriptRequests: scripts.length,
        };
      });

      await page
        .getByRole("button", {
          name: new RegExp(`benchmark-${index}@example.com`),
        })
        .click();
      await expect(page.getByText("Тут з’являться замовлення")).toBeVisible();
      const form = page.locator("form.order-form");
      await form.locator('[name="product"]').fill(sampleProduct);
      await form.locator('[name="quantity"]').fill("2");
      await page.evaluate(() => {
        const form = document.querySelector("form.order-form");
        form.addEventListener(
          "submit",
          () => performance.mark("workspace-submit"),
          { once: true },
        );
      });
      const row = page.getByRole("row").filter({ hasText: sampleProduct });
      await form.getByRole("button", { name: /Створити/ }).click();
      await expect(row).toBeVisible();
      const submitMs = await page.evaluate(
        () =>
          performance.now() -
          performance.getEntriesByName("workspace-submit")[0].startTime,
      );
      if (index >= warmups) samples.push({ ...startup, submitMs });

      if (index === warmups + repetitions - 1) {
        // Simulate the same stale list on both stacks by cancelling outside the page.
        const headers = {
          authorization: `Bearer ${owner}`,
          accept: "application/json",
        };
        const orderList = await request.get(orders, { headers });
        const order = (await orderList.json()).find(
          ({ product }) => product === sampleProduct,
        );
        expect(order).toBeTruthy();
        expect(
          (
            await request.post(orders + "/cancel", {
              headers,
              data: { id: order.id },
            })
          ).ok(),
        ).toBe(true);
        const failed = page.waitForResponse((response) =>
          matches(response, cancel, "POST"),
        );
        await row.getByRole("button", { name: /Скасувати/ }).click();
        const response = await failed;
        expect(response.status()).toBe(409);
        const { error } = await response.json();
        expect(error).toBe("ORDER_ALREADY_CANCELLED");
        await expect(row.getByRole("alert")).toContainText("вже скасовано");
        diagnosis = {
          http: response.status(),
          error,
          staleRow: (await row.innerText()).includes("Створено"),
        };
        if (!react) {
          const traceId = await response.headerValue("x-arc-trace-id");
          expect(traceId).toBeTruthy();
          const readTrace = async () => {
            const live = await (
              await request.get("http://127.0.0.1:4430/api/live")
            ).json();
            return live.interactions.find((entry) => entry.traceId === traceId);
          };
          await expect
            .poll(async () =>
              (await readTrace())?.browser.some(
                ({ type }) => type === "action.finished",
              ),
            )
            .toBe(true);
          const trace = await readTrace();
          diagnosis.browserNodes = [
            ...new Set(
              trace.browser.map(({ type, node }) => `${type} ${node}`),
            ),
          ];
          diagnosis.serverOperation = trace.server.map(
            ({ operation, status, spans }) => ({
              operation,
              status,
              spans: spans.map(({ node }) => node),
            }),
          );
        }
      }
    } finally {
      await context.close();
    }
  }

  const report = {
    stack: info.project.name,
    node: process.version,
    chromium: browser.version(),
    repetitions,
    warmups,
    readyMs: stats(samples.map(({ readyMs }) => readyMs)),
    submitMs: stats(samples.map(({ submitMs }) => submitMs)),
    clientJs: samples.map(
      ({ decodedJsBytes, wireJsBytes, scriptRequests }) => ({
        decodedJsBytes,
        wireJsBytes,
        scriptRequests,
      }),
    )[0],
    diagnosis,
  };
  console.log("WORKSPACE_BENCH " + JSON.stringify(report));
  await info.attach("workspace-benchmark", {
    body: JSON.stringify(report, null, 2),
    contentType: "application/json",
  });
});
