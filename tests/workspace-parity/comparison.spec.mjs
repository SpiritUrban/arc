import { expect, test } from "@playwright/test";

const repetitions = 10;
const warmups = 2;
const delayMs = Number(process.env.WORKSPACE_API_DELAY_MS ?? 0);
const standLive = "http://127.0.0.1:4430/api/live";
function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const midpoint = sorted.length / 2;
  return {
    median: (sorted[midpoint - 1] + sorted[midpoint]) / 2,
    p90: sorted[Math.ceil(sorted.length * 0.9) - 1],
    values,
  };
}

async function standInteraction(request, traceId, eventType) {
  expect(traceId).toBeTruthy();
  let interaction;
  await expect
    .poll(async () => {
      const live = await (await request.get(standLive)).json();
      interaction = live.interactions.find(
        (entry) => entry.traceId === traceId,
      );
      return interaction?.browser.some(({ type }) => type === eventType);
    })
    .toBe(true);
  return interaction;
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
  const createOrder = react ? orders : "/_arc/call/orders.create";
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

      const selectedOrders = page.waitForResponse(
        (res) =>
          matches(res, listOrders, react ? "GET" : "POST") &&
          res.request().headers().authorization === `Bearer ${owner}`,
      );
      await page
        .getByRole("button", {
          name: new RegExp(`benchmark-${index}@example.com`),
        })
        .click();
      expect((await selectedOrders).ok()).toBe(true);
      await expect(page.getByText("Тут з’являться замовлення")).toBeVisible();
      const form = page.locator("form.order-form");
      await form.locator('[name="product"]').fill(sampleProduct);
      await form.locator('[name="quantity"]').fill("2");
      await page.evaluate((product) => {
        const form = document.querySelector("form.order-form");
        form.addEventListener(
          "submit",
          () => {
            performance.mark("workspace-submit");
            const rows = document.querySelector("table tbody");
            const observer = new MutationObserver(() => {
              if (
                [...rows.rows].some((row) => row.textContent.includes(product))
              ) {
                performance.mark("workspace-order-row");
                observer.disconnect();
              }
            });
            observer.observe(rows, {
              childList: true,
              characterData: true,
              subtree: true,
            });
          },
            { capture: true, once: true },
        );
      }, sampleProduct);
      const orderTraffic = (url) =>
        [createOrder, listOrders].includes(url.pathname);
      const pauseResponse = async (route) => {
        const response = await route.fetch();
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        await route.fulfill({ response });
      };
      if (delayMs > 0) await page.route(orderTraffic, pauseResponse);
      const calls = [];
      const track = (req) => {
        if (orderTraffic(new URL(req.url()))) calls.push(req);
      };
      page.on("request", track);
      const row = page.getByRole("row").filter({ hasText: sampleProduct });
      await form.getByRole("button", { name: /Створити/ }).click();
      await expect(row).toBeVisible();
      page.off("request", track);
      expect(
        calls.map((req) => [new URL(req.url()).pathname, req.method()]),
      ).toEqual([
        [createOrder, "POST"],
        ...(react ? [[listOrders, "GET"]] : []),
      ]);
      const responses = await Promise.all(calls.map((req) => req.response()));
      expect(responses.every((res) => res?.ok())).toBe(true);
      await Promise.all(responses.map((res) => res.finished()));
      const [write, read] = calls.map((req) => req.timing());
      expect(write.responseEnd).toBeGreaterThanOrEqual(0);
      if (read) expect(read.responseEnd).toBeGreaterThanOrEqual(0);
      const [submit, rowReady] = await page.evaluate(() =>
        ["workspace-submit", "workspace-order-row"].map(
          (name) =>
            performance.timeOrigin +
            performance.getEntriesByName(name)[0].startTime,
        ),
      );
      const profile = {
        submitMs: rowReady - submit,
        beforeWriteMs: write.startTime - submit,
        writeMs: write.responseEnd,
        ...(read
          ? {
              beforeReadMs: read.startTime - (write.startTime + write.responseEnd),
              readMs: read.responseEnd,
              afterReadMs: rowReady - (read.startTime + read.responseEnd),
            }
          : { afterWriteMs: rowReady - (write.startTime + write.responseEnd) }),
      };
      const response = responses[0];
      const traced =
        react || index < warmups
          ? undefined
          : await standInteraction(
              request,
              await response.headerValue("x-arc-trace-id"),
              "action.finished",
            );
      if (index >= warmups)
        samples.push({
          ...startup,
          ...profile,
          ...(traced && {
            createOperationMs: traced.server.find(
              ({ operation }) => operation === "orders.create",
            ).duration,
          }),
        });
      if (delayMs > 0) await page.unroute(orderTraffic, pauseResponse);

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
          const trace = await standInteraction(
            request,
            await response.headerValue("x-arc-trace-id"),
            "action.finished",
          );
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
    delayMs,
    readyMs: stats(samples.map(({ readyMs }) => readyMs)),
    submitMs: stats(samples.map(({ submitMs }) => submitMs)),
    submitRequests: { writes: 1, reads: react ? 1 : 0 },
    submitPhases: Object.fromEntries(
      [
        "beforeWriteMs",
        "writeMs",
        ...(react
          ? ["beforeReadMs", "readMs", "afterReadMs"]
          : ["afterWriteMs", "createOperationMs"]),
      ].map((key) => [key, stats(samples.map((sample) => sample[key]))]),
    ),
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
