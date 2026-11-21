import { webResource } from "@arc/framework/web";
// webResource завантажує дані із зовнішнього HTTP API. У тестах можна передати свій fetcher.
export function externalTodo(fetcher: typeof fetch = globalThis.fetch) {
  return webResource<{ title: string }>({
    id: "external.todo",
    async load(_, { signal }) {
      // Передаємо signal у fetch, щоб ARC міг скасувати запит при зупинці ресурсу.
      const response = await fetcher(
        "https://jsonplaceholder.typicode.com/todos/1",
        { signal },
      );
      if (!response.ok) throw Error("External request failed");
      return response.json();
    },
  });
}
