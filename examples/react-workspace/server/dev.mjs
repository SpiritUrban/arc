import { createServer } from "vite";
import { apiServer, listen } from "./api.mjs";

const api = apiServer();
const apiPort = await listen(api, 0);
try {
  const web = await createServer({
    server: {
      host: "127.0.0.1",
      port: Number(process.env.PORT ?? 5173),
      strictPort: true,
      proxy: { "^/api(?:/|$)": `http://127.0.0.1:${apiPort}` },
    },
  });
  await web.listen();
  web.printUrls();
} catch (error) {
  api.close();
  throw error;
}
