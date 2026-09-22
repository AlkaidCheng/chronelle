import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerWeChatAuthenticationRoutes } from "../src/authentication/wechat-routes.js";
import { WeChatCredentialRejectedError } from "../src/errors.js";
import { registerHttpBoundary } from "../src/http-boundary.js";

describe("WeChat authentication routes", () => {
  const apps: ReturnType<typeof Fastify>[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("limits repeated exchange attempts by caller address", async () => {
    const app = Fastify();
    apps.push(app);
    registerHttpBoundary(app);
    app.decorate("authenticate", async () => undefined);
    const authentication = {
      exchange: vi.fn(async () => {
        throw new WeChatCredentialRejectedError();
      }),
      link: vi.fn(async () => undefined),
    };
    registerWeChatAuthenticationRoutes(app, {
      authentication,
      exchangesPerMinute: 1,
    });
    const request = () =>
      app.inject({
        method: "POST",
        url: "/api/auth/wechat",
        payload: { accessToken: "cloudbase-token-000000000000" },
      });

    const first = await request();
    const limited = await request();

    expect(first.statusCode).toBe(401);
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({
      error: {
        code: "authentication_limited",
        message: "Too many authentication attempts; try again in a minute.",
      },
    });
    expect(authentication.exchange).toHaveBeenCalledOnce();
  });
});
