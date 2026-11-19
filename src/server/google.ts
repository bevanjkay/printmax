import type { UserRow } from "./auth.js";
import type { Db } from "./db.js";
import { Buffer } from "node:buffer";
import { createHash, randomBytes } from "node:crypto";
import { findUserByEmail, getUser } from "./auth.js";
import { now } from "./db.js";

export interface GoogleSignIn {
  clientId: string;
  clientSecret: string;
  /** Email domains that may sign in; the account must also belong to a Google Workspace on one of them. */
  allowedDomains: string[];
  /** Must match an authorised redirect URI on the OAuth client exactly. */
  redirectUri: string;
  fetch?: typeof fetch;
}

export interface GoogleFlow {
  state: string;
  nonce: string;
  verifier: string;
}

export interface GoogleIdentity {
  sub: string;
  email: string;
  name: string;
}

/** Why a Google sign-in was refused. Only the code reaches the browser, so a crafted link cannot put words on the sign-in page. */
export type GoogleRefusalCode = "expired" | "cancelled" | "rejected" | "unverified" | "domain" | "conflict";

export class GoogleRefusal extends Error {
  constructor(public readonly code: GoogleRefusalCode, message: string) {
    super(message);
    this.name = "GoogleRefusal";
  }
}

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);

function secret(): string {
  return randomBytes(32).toString("base64url");
}

export function startFlow(): GoogleFlow {
  return { state: secret(), nonce: secret(), verifier: secret() };
}

export function authorizationUrl(cfg: GoogleSignIn, flow: GoogleFlow): string {
  const url = new URL(AUTHORIZE_URL);
  url.search = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state: flow.state,
    nonce: flow.nonce,
    code_challenge: createHash("sha256").update(flow.verifier).digest("base64url"),
    code_challenge_method: "S256",
    // Only Workspace accounts carry `hd`, which identityFromIdToken requires.
    hd: cfg.allowedDomains.length === 1 ? cfg.allowedDomains[0]! : "*",
    prompt: "select_account",
  }).toString();
  return url.toString();
}

export async function exchangeCode(cfg: GoogleSignIn, code: string, flow: GoogleFlow): Promise<string> {
  const res = await (cfg.fetch ?? fetch)(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: cfg.redirectUri,
      grant_type: "authorization_code",
      code_verifier: flow.verifier,
    }).toString(),
  });
  const body = await res.json().catch(() => ({})) as { id_token?: unknown };
  if (!res.ok || typeof body.id_token !== "string")
    throw new GoogleRefusal("rejected", "Google did not accept the sign-in");
  return body.id_token;
}

function domainOf(email: string): string {
  return email.slice(email.lastIndexOf("@") + 1).toLowerCase();
}

/**
 * The token came straight from Google's token endpoint over TLS, authenticated with the client
 * secret, so OpenID Connect Core 3.1.3.7 lets the client skip the signature check; the claims are not.
 */
export function identityFromIdToken(cfg: GoogleSignIn, idToken: string, nonce: string): GoogleIdentity {
  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8"));
  }
  catch {
    throw new GoogleRefusal("rejected", "Google sent an unreadable sign-in");
  }
  const allowed = new Set(cfg.allowedDomains.map(d => d.toLowerCase()));
  const { iss, aud, exp, sub, email, hd, name } = claims;
  if (typeof iss !== "string" || !ISSUERS.has(iss) || aud !== cfg.clientId || claims.nonce !== nonce)
    throw new GoogleRefusal("rejected", "the Google sign-in was not meant for printmax");
  if (typeof exp !== "number" || exp * 1000 <= Date.now())
    throw new GoogleRefusal("expired", "the Google sign-in expired; try again");
  if (typeof sub !== "string" || typeof email !== "string" || claims.email_verified !== true)
    throw new GoogleRefusal("unverified", "that Google account has no verified email");
  // An address alone proves nothing: anyone can make a personal Google account on any address.
  if (!allowed.has(domainOf(email)) || typeof hd !== "string" || !allowed.has(hd.toLowerCase()))
    throw new GoogleRefusal("domain", "that Google account is not on a domain allowed to use printmax");
  return { sub, email: email.toLowerCase(), name: typeof name === "string" && name.trim() ? name.trim() : email };
}

/** Finds the account for a Google identity, linking one by email or registering a new user. */
export function googleUser(db: Db, identity: GoogleIdentity): UserRow {
  const linked = db.prepare("SELECT id FROM users WHERE google_sub = ?").get(identity.sub) as { id: number } | undefined;
  if (linked)
    return getUser(db, linked.id)!;
  const existing = findUserByEmail(db, identity.email);
  if (existing) {
    if (existing.google_sub)
      throw new GoogleRefusal("conflict", "that email is already linked to a different Google account");
    db.prepare("UPDATE users SET google_sub = ? WHERE id = ?").run(identity.sub, existing.id);
    return getUser(db, existing.id)!;
  }
  const result = db.prepare("INSERT INTO users (email, name, password_hash, role, created_at, google_sub) VALUES (?, ?, '', 'user', ?, ?)")
    .run(identity.email, identity.name, now(), identity.sub);
  return getUser(db, Number(result.lastInsertRowid))!;
}
