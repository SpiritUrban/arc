import {
  module,
  operation,
  type Needs,
  type Operation,
  type OperationContract,
  type Route,
} from "./core.js";
import type { Infer } from "./schema.js";

type Handler<C extends OperationContract, N extends Needs> = Operation<
  Infer<C["input"]>,
  Infer<C["output"]>,
  N,
  C["errors"],
  {}
>["run"];

export type HandlerContext<
  C extends OperationContract,
  N extends Needs,
> = Parameters<Handler<C, N>>[0];

type HandlerClass = abstract new (...args: never[]) => object;
const handlerDefinitions = new WeakMap<
  object,
  (owner: HandlerClass) => { operation: Operation; route?: Route }
>();

/** Attach a contract and explicit resource dependencies to a public static method. */
export function handles<C extends OperationContract, N extends Needs = {}>(
  contract: C,
  options: {
    needs?: N;
    effects?: string[];
    route?: Omit<Route, "operation">;
  } = {},
) {
  return <Owner extends HandlerClass>(
    method: (
      this: Owner,
      ctx: HandlerContext<NoInfer<C>, NoInfer<N>>,
    ) => ReturnType<Handler<NoInfer<C>, NoInfer<N>>>,
    context: ClassMethodDecoratorContext<Owner, typeof method>,
  ) => {
    if (!context.static || context.private) {
      throw new TypeError("@handles requires a public static method");
    }

    const { needs, effects, route } = options;
    handlerDefinitions.set(method, (owner) => {
      const op = operation(contract, {
        needs,
        effects,
        run: (ctx) => method.call(owner as Owner, ctx),
      });
      return { operation: op, route: route && { ...route, operation: op } };
    });
  };
}

/** Collect the decorated methods of a class into an ARC server module. */
export function handlerModule(id: string, handlers: HandlerClass) {
  const operations: Operation[] = [];
  const routes: Route[] = [];
  for (const key of Reflect.ownKeys(handlers)) {
    const method = Object.getOwnPropertyDescriptor(handlers, key)?.value;
    const define = handlerDefinitions.get(method);
    if (!define) continue;
    const { operation, route } = define(handlers);
    operations.push(operation);
    if (route) routes.push(route);
  }
  return module({ id, operations, routes });
}
