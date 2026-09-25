import { ApiClientError } from "@livtales/api-client";

export function isTemporaryReadError(error: unknown): boolean {
  return (
    error instanceof ApiClientError &&
    ((error.status === 0 && error.code === "network_error") ||
      error.status === 408 ||
      error.status === 429 ||
      (error.status >= 500 && error.status <= 599))
  );
}
