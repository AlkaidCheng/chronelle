import { createFetchJsonTransport } from "../src/index.js";
import {
  runJsonTransportContract,
  type TransportContractCall,
  type TransportContractHarness,
} from "./transport-contract.js";

function fetchHarness(): TransportContractHarness {
  const calls: TransportContractCall[] = [];
  const fetch = async (
    input: string | URL | Request,
    options?: RequestInit,
  ): Promise<Response> => {
    const url = String(input);
    const call: TransportContractCall = {
      abortCount: 0,
      body:
        typeof options?.body === "string"
          ? options.body
          : options?.body?.toString(),
      headers: Object.fromEntries(new Headers(options?.headers).entries()),
      method: (options?.method ?? "GET") as TransportContractCall["method"],
      timeoutMs: 100,
      url,
    };
    calls.push(call);
    if (url.endsWith("/success")) {
      return new Response('{"accepted":true}', { status: 201 });
    }
    if (url.endsWith("/invalid")) {
      return new Response("upstream unavailable", { status: 502 });
    }
    if (url.endsWith("/network")) {
      throw new Error("offline");
    }
    return new Promise((_, reject) => {
      options?.signal?.addEventListener(
        "abort",
        () => {
          call.abortCount += 1;
          reject(new Error("aborted"));
        },
        { once: true },
      );
    });
  };
  return {
    calls,
    transport: createFetchJsonTransport(fetch),
  };
}

runJsonTransportContract("Fetch", fetchHarness);
