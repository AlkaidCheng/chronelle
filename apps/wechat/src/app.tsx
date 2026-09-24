// Load first: schemas read the validation mode when they are created, and
// queries and requests construct AbortController, which WeChat lacks.
import "./runtime/validation";
import "./runtime/abort-controller";

import {
  focusManager,
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import Taro from "@tarojs/taro";
import { type PropsWithChildren, useEffect } from "react";

import { SessionProvider } from "./auth/session-context";
import { AppRuntimeProvider } from "./runtime/app-runtime";
import {
  bindQueryLifecycle,
  type QueryLifecycleSource,
} from "./runtime/query-lifecycle";

import "./app.scss";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: 10 * 60_000,
      refetchOnReconnect: true,
      refetchOnWindowFocus: true,
      retry: 2,
      staleTime: 30_000,
    },
  },
});

const lifecycleSource: QueryLifecycleSource = {
  getOnline: async () => {
    try {
      return (await Taro.getNetworkType()).networkType !== "none";
    } catch {
      return true;
    }
  },
  onShow: (listener) => {
    const callback = () => listener();
    Taro.onAppShow(callback);
    return () => Taro.offAppShow(callback);
  },
  onHide: (listener) => {
    const callback = () => listener();
    Taro.onAppHide(callback);
    return () => Taro.offAppHide(callback);
  },
  onNetworkChange: (listener) => {
    const callback = (result: Taro.onNetworkStatusChange.CallbackResult) =>
      listener(result.isConnected);
    Taro.onNetworkStatusChange(callback);
    return () => Taro.offNetworkStatusChange(callback);
  },
};

export default function App({ children }: PropsWithChildren) {
  useEffect(
    () =>
      bindQueryLifecycle(lifecycleSource, {
        setFocused: (focused) => focusManager.setFocused(focused),
        setOnline: (online) => onlineManager.setOnline(online),
      }),
    [],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AppRuntimeProvider>
        <SessionProvider>{children}</SessionProvider>
      </AppRuntimeProvider>
    </QueryClientProvider>
  );
}
