import type { FastifyInstance } from "fastify";
import type { GoogleSignIn } from "../src/server/google.js";
import { Buffer } from "node:buffer";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/server/app.js";
import { openDb } from "../src/server/db.js";

const CLIENT_ID = "client-123.apps.googleusercontent.com";

function b64(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

/** Shaped like Google's: signature checks are skipped because the token arrives straight from the token endpoint. */
function idToken(claims: Record<string, unknown>): string {
  return `${b64({ alg: "RS256", typ: "JWT" })}.${b64(claims)}.c2ln`;
}

describe("sign in with Google", () => {
  let dir: string;
  let app: FastifyInstance;
  let db: ReturnType<typeof openDb>;
  let claims: Record<string, unknown>;
  let tokenRequests: URLSearchParams[];

  async function start(google: Partial<GoogleSignIn> | null = {}, { setup = true } = {}) {
    dir = await mkdtemp(path.join(tmpdir(), "printmax-google-"));
    db = openDb(":memory:");
    tokenRequests = [];
    const fetchToken: typeof fetch = async (_url, init) => {
      tokenRequests.push(new URLSearchParams(String(init?.body)));
      return Response.json({ id_token: idToken(claims) });
    };
    app = await buildApp({
      db,
      uploadDir: dir,
      google: google && {
        clientId: CLIENT_ID,
        clientSecret: "shh",
        allowedDomains: ["reside.church", "gc.org.au"],
        redirectUri: "https://print.example.org/api/auth/google/callback",
        fetch: fetchToken,
        ...google,
      },
    });
    if (setup)
      await app.inject({ method: "POST", url: "/api/auth/setup", payload: { name: "Admin", email: "admin@reside.church", password: "correct horse" } });
  }

  /** Runs the redirect out to Google and back, with the claims Google would put in the ID token. */
  async function signIn(overrides: Record<string, unknown> = {}, tamper?: (state: string) => string) {
    const out = await app.inject({ method: "GET", url: "/api/auth/google" });
    expect(out.statusCode).toBe(302);
    const location = new URL(out.headers.location as string);
    const flow = out.cookies.find(c => c.name === "printmax_google")!;
    const state = location.searchParams.get("state")!;
    claims = {
      iss: "https://accounts.google.com",
      aud: CLIENT_ID,
      sub: "1001",
      email: "pat@reside.church",
      email_verified: true,
      hd: "reside.church",
      name: "Pat Example",
      nonce: location.searchParams.get("nonce"),
      exp: Math.floor(Date.now() / 1000) + 600,
      ...overrides,
    };
    const back = await app.inject({
      method: "GET",
      url: `/api/auth/google/callback?code=abc&state=${encodeURIComponent(tamper ? tamper(state) : state)}`,
      headers: { cookie: `printmax_google=${flow.value}` },
    });
    const session = back.cookies.find(c => c.name === "printmax_session");
    return { out: location, back, session };
  }

  async function me(session: { value: string } | undefined) {
    return (await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: `printmax_session=${session?.value}` } })).json();
  }

  beforeEach(async () => {
    claims = {};
  });

  afterEach(async () => {
    await app.close();
    db.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("is off, and its routes absent, unless configured", async () => {
    await start(null);
    expect((await app.inject({ method: "GET", url: "/api/auth/me" })).json().googleSignIn).toBe(false);
    expect((await app.inject({ method: "GET", url: "/api/auth/google" })).statusCode).toBe(404);
  });

  it("sends the browser to Google with PKCE, a state and a nonce", async () => {
    await start();
    expect((await app.inject({ method: "GET", url: "/api/auth/me" })).json().googleSignIn).toBe(true);
    const { out } = await signIn();
    expect(out.origin + out.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(out.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(out.searchParams.get("redirect_uri")).toBe("https://print.example.org/api/auth/google/callback");
    expect(out.searchParams.get("scope")).toBe("openid email profile");
    expect(out.searchParams.get("code_challenge_method")).toBe("S256");
    expect(tokenRequests[0]!.get("code_verifier")).toMatch(/^[\w-]{43,}$/);
    expect(tokenRequests[0]!.get("client_secret")).toBe("shh");
  });

  it("registers a new account on an allowed domain with the user role", async () => {
    await start();
    const { back, session } = await signIn();
    expect(back.statusCode).toBe(302);
    expect(back.headers.location).toBe("/");
    expect((await me(session)).user).toMatchObject({ email: "pat@reside.church", name: "Pat Example", role: "user", hasPassword: false });
  });

  it("signs the same Google account into the same printmax account, even after an email change", async () => {
    await start();
    const first = await me((await signIn()).session);
    const second = await me((await signIn({ email: "pat.example@reside.church" })).session);
    expect(second.user.id).toBe(first.user.id);
  });

  it("links an existing account by its verified email and keeps its role", async () => {
    await start();
    const { session } = await signIn({ email: "Admin@reside.church", sub: "2002" });
    expect((await me(session)).user).toMatchObject({ email: "admin@reside.church", role: "admin", hasPassword: true });
  });

  it.each([
    ["an email on another domain", { email: "pat@gmail.com", hd: undefined }],
    ["a personal account using an allowed address", { hd: undefined }],
    ["a Workspace outside the allowed domains", { email: "pat@reside.church", hd: "elsewhere.org" }],
    ["an unverified email", { email_verified: false }],
    ["a token for another client", { aud: "someone-else" }],
    ["a token from another issuer", { iss: "https://evil.example" }],
    ["an expired token", { exp: Math.floor(Date.now() / 1000) - 60 }],
    ["a replayed nonce", { nonce: "old" }],
  ])("refuses %s", async (_label, overrides) => {
    await start();
    const { back, session } = await signIn(overrides);
    expect(back.statusCode).toBe(302);
    expect(back.headers.location).toMatch(/^\/\?google_error=[a-z]+$/);
    expect(session).toBeUndefined();
  });

  it("refuses a callback whose state does not match the browser's", async () => {
    await start();
    const { back, session } = await signIn({}, () => "forged");
    expect(back.headers.location).toMatch(/^\/\?google_error=[a-z]+$/);
    expect(session).toBeUndefined();
    expect(tokenRequests).toHaveLength(0);
  });

  it("stays closed until the first administrator exists, so setup cannot be locked out", async () => {
    await start({}, { setup: false });
    const out = await app.inject({ method: "GET", url: "/api/auth/google" });
    expect(out.headers.location).toBe("/?google_error=setup");
    const flow = Buffer.from(JSON.stringify({ state: "s", nonce: "n", verifier: "v" })).toString("base64url");
    claims = { iss: "https://accounts.google.com", aud: CLIENT_ID, sub: "1", email: "pat@reside.church", email_verified: true, hd: "reside.church", nonce: "n", exp: Math.floor(Date.now() / 1000) + 600 };
    const back = await app.inject({ method: "GET", url: "/api/auth/google/callback?code=abc&state=s", headers: { cookie: `printmax_google=${flow}` } });
    expect(back.headers.location).toBe("/?google_error=setup");
    expect(tokenRequests).toHaveLength(0);
    const setup = await app.inject({ method: "POST", url: "/api/auth/setup", payload: { name: "Admin", email: "admin@reside.church", password: "correct horse" } });
    expect(setup.statusCode).toBe(201);
  });

  it("sends the browser back to the sign-in page when Google cannot be reached", async () => {
    await start({ fetch: async () => Promise.reject(new TypeError("fetch failed")) });
    const { back, session } = await signIn();
    expect(back.headers.location).toBe("/?google_error=unavailable");
    expect(session).toBeUndefined();
  });

  it("refuses a callback with no flow cookie", async () => {
    await start();
    const back = await app.inject({ method: "GET", url: "/api/auth/google/callback?code=abc&state=x" });
    expect(back.headers.location).toMatch(/^\/\?google_error=[a-z]+$/);
    expect(tokenRequests).toHaveLength(0);
  });

  it("does not let a Google-only account sign in with a blank password", async () => {
    await start();
    await signIn();
    const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "pat@reside.church", password: "" } });
    expect(res.statusCode).toBe(401);
  });
});
