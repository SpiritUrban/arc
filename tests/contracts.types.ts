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
