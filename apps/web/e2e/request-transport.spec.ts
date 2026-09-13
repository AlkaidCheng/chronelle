import { createServer } from "node:http";
import { once } from "node:events";
import { expect, test } from "./fixtures";

test("keeps verification requests separate from browser connections", async ({
  request,
  page,
}) => {
  const server = createServer((incoming, response) => {
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        connection: incoming.headers.connection,
        port: incoming.socket.remotePort,
      }),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    if (address === null || typeof address === "string")
      throw new Error("The verification server requires a TCP address.");
    const url = `http://127.0.0.1:${address.port}`;
    const first = await (await request.get(url)).json();
    const second = await (await request.get(url)).json();
    expect(first.connection).toBe("close");
    expect(second.connection).toBe("close");
    expect(second.port).not.toBe(first.port);
    const browser = await page.goto(url);
    expect(await browser?.json()).toMatchObject({ connection: "keep-alive" });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
