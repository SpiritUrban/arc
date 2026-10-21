import { operation, s, ok, error } from "../framework/src/index.ts";
operation({
  id: "typed",
  input: s.object({}),
  output: s.int(),
  errors: { MISSING: { status: 404, details: s.object({ id: s.uuid() }) } },
  run({ fail }) {
    // @ts-expect-error unknown business code
    fail("OTHER");
    // @ts-expect-error details required
    fail("MISSING");
    // @ts-expect-error wrong details field type
    fail("MISSING", { id: 123 });
    return fail("MISSING", { id: "00000000-0000-4000-8000-000000000001" });
  },
});
operation({
  id: "bad",
  input: s.object({}),
  output: s.int(),
  errors: { MISSING: 404 },
  // @ts-expect-error global error cannot return undeclared codes
  run: () => error("OTHER"),
});
const child = operation({
  id: "child",
  input: s.object({ n: s.int() }),
  output: s.int(),
  run: ({ input }) => ok(input.n),
});
operation({
  id: "parent",
  input: s.object({}),
  output: s.int(),
  calls: { child },
  async run({ call }) {
    // @ts-expect-error undeclared child
    await call("other", { n: 1 });
    // @ts-expect-error child input inferred
    await call("child", { n: "one" });
    return call("child", { n: 1 });
  },
});

import { operationContract } from "../framework/src/core-entry.ts";
import { remoteCall, remote } from "../framework/src/fullstack/client.ts";
const exposed = operationContract({
  id: "typed.remote",
  expose: { web: true },
  input: s.object({ name: s.string() }),
  output: s.int(),
  errors: { EXISTS: { status: 409, details: s.object({ name: s.string() }) } },
});
async function remoteTypes() {
  // @ts-expect-error remote input derives from contract
  await remoteCall(exposed, { name: 1 });
  const result = await remoteCall(exposed, { name: "name" });
  if (result.kind === "business_error") {
    const code: "EXISTS" = result.error;
    const details: string = result.details.name;
    void code;
    void details;
  }
  if (result.kind === "success") {
    const output: number = result.value;
    void output;
  }
  const resource = remote(exposed, {
    id: "typed.resource",
    input: () => ({ name: "name" }),
  });
  const projected = resource.result.get();
  if (projected?.kind === "business_error") {
    const name: string = projected.details.name;
    void name;
  }
}
