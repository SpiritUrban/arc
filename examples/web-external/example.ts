import { webResource } from "@arc/framework/web";
/** External data needs no ARC server. Inject fetch for deterministic tests. */
export function externalTodo(fetcher: typeof fetch = globalThis.fetch) {
  return webResource<{ title: string }>({
    id: "external.todo",
    async load(_, { signal }) {
      const response = await fetcher(
        "https://jsonplaceholder.typicode.com/todos/1",
        { signal },
      );
      if (!response.ok) throw Error("External request failed");
      return response.json();
    },
  });
}
