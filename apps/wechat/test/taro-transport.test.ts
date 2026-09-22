import { describe, expect, it } from "vitest";

import {
  runJsonTransportContract,
  type TransportContractCall,
  type TransportContractHarness,
} from "../../../packages/api-client/test/transport-contract";
import { createWeChatApiClient } from "../src/api/client";
import {
  createTaroJsonTransport,
  type TaroRequest,
  type TaroRequestOptions,
  type TaroRequestResult,
  type TaroRequestTask,
} from "../src/api/taro-transport";

function task(
  run: (
    resolve: (result: TaroRequestResult) => void,
    reject: (error: unknown) => void,
  ) => void,
  onAbort: () => void,
): TaroRequestTask {
  let rejectTask: (error: unknown) => void = () => undefined;
  const promise = new Promise<TaroRequestResult>((resolve, reject) => {
    rejectTask = reject;
    run(resolve, reject);
  }) as TaroRequestTask;
  promise.abort = () => {
    onAbort();
    rejectTask({ errMsg: "request:fail abort" });
  };
  return promise;
}

function taroHarness(): TransportContractHarness {
  const calls: TransportContractCall[] = [];
  const request: TaroRequest = (options) => {
    const call: TransportContractCall = {
      abortCount: 0,
      body: options.body,
      headers: options.headers,
      method: options.method,
      timeoutMs: options.timeoutMs,
      url: options.url,
    };
    calls.push(call);
    return task(
      (resolve, reject) => {
        if (options.url.endsWith("/success")) {
          resolve({ data: '{"accepted":true}', statusCode: 201 });
        } else if (options.url.endsWith("/invalid")) {
          resolve({ data: "upstream unavailable", statusCode: 502 });
        } else if (options.url.endsWith("/network")) {
          reject({ errMsg: "request:fail offline" });
        }
      },
      () => {
        call.abortCount += 1;
      },
    );
  };
  return { calls, transport: createTaroJsonTransport(request) };
}

runJsonTransportContract("Taro", taroHarness);

const userId = "019d6e7d-0000-7000-8000-000000000001";
const workspaceId = "019d6e7d-0000-7000-8000-000000000002";

function resolvedTask(result: TaroRequestResult): TaroRequestTask {
  const promise = Promise.resolve(result) as TaroRequestTask;
  promise.abort = () => undefined;
  return promise;
}

describe("WeChat API client", () => {
  it("uses one Taro transport for public health and protected session reads", async () => {
    const calls: TaroRequestOptions[] = [];
    const request: TaroRequest = (options) => {
      calls.push(options);
      if (options.url.endsWith("/api/health")) {
        return resolvedTask({
          data: {
            service: "chronelle-api",
            status: "ok",
            timestamp: "2026-09-22T06:00:00.000Z",
          },
          statusCode: 200,
        });
      }
      return resolvedTask({
        data: {
          principal: { type: "user", userId, workspaceId },
          user: {
            id: userId,
            displayName: "Planner",
            email: null,
            username: "planner",
          },
          workspace: { id: workspaceId, displayName: "Personal" },
          availableWorkspaces: [
            {
              id: workspaceId,
              displayName: "Personal",
              personal: true,
              ownerDisplayName: "Planner",
              role: "owner",
            },
          ],
        },
        statusCode: 200,
      });
    };
    const client = createWeChatApiClient({
      baseUrl: "https://api.example.test/",
      getCredential: () => ({ accessToken: "opaque-session", workspaceId }),
      request,
    });

    await expect(client.getHealth()).resolves.toMatchObject({ status: "ok" });
    await expect(client.getSession()).resolves.toMatchObject({
      principal: { userId, workspaceId },
    });
    expect(calls.map(({ url }) => url)).toEqual([
      "https://api.example.test/api/health",
      "https://api.example.test/api/auth/session",
    ]);
    expect(calls[0]?.headers.authorization).toBeUndefined();
    expect(calls[1]?.headers).toMatchObject({
      authorization: "Bearer opaque-session",
      "x-workspace-id": workspaceId,
    });
  });
});
