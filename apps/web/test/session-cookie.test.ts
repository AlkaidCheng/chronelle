import { describe, expect, it } from "vitest";

import {
  readIssuedSession,
  readSessionToken,
  sessionPresent,
} from "../lib/session-cookie";

describe("session cookie helpers", () => {
  it("reads the session token from the cookie header unless a bearer header is present", () => {
    expect(readSessionToken(null, "a=1; chronelle_session=tok; b=2")).toBe(
      "tok",
    );
    expect(readSessionToken(null, "chronelle_session=tok")).toBe("tok");
    expect(readSessionToken(null, "chronelle_session_present=1")).toBeNull();
    expect(readSessionToken(null, "chronelle_session=")).toBeNull();
    expect(readSessionToken(null, null)).toBeNull();
    expect(readSessionToken("Bearer x", "chronelle_session=tok")).toBeNull();
  });

  it("detects the presence marker without matching the session cookie itself", () => {
    expect(sessionPresent("chronelle_session_present=1")).toBe(true);
    expect(sessionPresent("theme=dark; chronelle_session_present=1; x=y")).toBe(
      true,
    );
    expect(sessionPresent("chronelle_session_present=")).toBe(false);
    expect(sessionPresent("chronelle_session=tok")).toBe(false);
    expect(sessionPresent("")).toBe(false);
  });

  it("accepts only a sign-in body with a token and a valid expiry", () => {
    expect(
      readIssuedSession({
        accessToken: "t",
        expiresAt: "2030-01-01T00:00:00Z",
      }),
    ).toEqual({ token: "t", expiresAt: new Date("2030-01-01T00:00:00Z") });
    expect(
      readIssuedSession({ accessToken: "", expiresAt: "2030" }),
    ).toBeNull();
    expect(
      readIssuedSession({ accessToken: "t", expiresAt: "soon" }),
    ).toBeNull();
    expect(readIssuedSession(null)).toBeNull();
    expect(readIssuedSession("text")).toBeNull();
  });
});
