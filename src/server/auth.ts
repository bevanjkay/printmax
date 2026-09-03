import type { FastifyReply, FastifyRequest } from "fastify";
import type { UserDto } from "../shared/types.js";
import type { Db } from "./db.js";
import { Buffer } from "node:buffer";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { now } from "./db.js";
import { HttpError, notFound } from "./errors.js";

export interface UserRow {
  id: number;
  email: string;
  name: string;
  password_hash: string;
  role: "admin" | "user";
  created_at: string;
}

export const SESSION_COOKIE = "printmax_session";
const SESSION_DAYS = 30;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, n, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !n || !salt || !hash)
    return false;
  const expected = Buffer.from(hash, "base64");
  const actual = scryptSync(password, Buffer.from(salt, "base64"), expected.length, { N: Number(n), r: SCRYPT.r, p: SCRYPT.p });
  return timingSafeEqual(actual, expected);
}

function validatePassword(password: unknown): asserts password is string {
  if (typeof password !== "string" || password.length < 8)
    throw new HttpError(400, "password must be at least 8 characters");
}

function validateEmail(email: unknown): asserts email is string {
  if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+$/.test(email))
    throw new HttpError(400, "a valid email is required");
}

export function countUsers(db: Db): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
}

export function listUsers(db: Db): UserRow[] {
  return db.prepare("SELECT * FROM users ORDER BY name").all() as unknown as UserRow[];
}

export function getUser(db: Db, id: number): UserRow | undefined {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as unknown as UserRow | undefined;
}

export function findUserByEmail(db: Db, email: string): UserRow | undefined {
  return db.prepare("SELECT * FROM users WHERE lower(email) = lower(?)").get(email) as unknown as UserRow | undefined;
}

export interface CreateUserInput { email: unknown; name: unknown; password: unknown; role: unknown }

export function createUser(db: Db, input: CreateUserInput): UserRow {
  validateEmail(input.email);
  validatePassword(input.password);
  if (typeof input.name !== "string" || input.name.trim() === "")
    throw new HttpError(400, "name is required");
  const role = input.role === "admin" ? "admin" : "user";
  if (findUserByEmail(db, input.email))
    throw new HttpError(409, "a user with that email already exists");
  const result = db.prepare("INSERT INTO users (email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(input.email.trim().toLowerCase(), input.name.trim(), hashPassword(input.password), role, now());
  return getUser(db, Number(result.lastInsertRowid))!;
}

export function setPassword(db: Db, userId: number, password: unknown): void {
  validatePassword(password);
  if (!getUser(db, userId))
    throw notFound("user");
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(password), userId);
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

export function deleteUser(db: Db, id: number): void {
  if (!getUser(db, id))
    throw notFound("user");
  db.prepare("DELETE FROM users WHERE id = ?").run(id);
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createSession(db: Db, userId: number): { token: string; expiresAt: string } {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString();
  db.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)").run(tokenHash(token), userId, now(), expiresAt);
  return { token, expiresAt };
}

export function sessionUser(db: Db, token: string | undefined): UserRow | undefined {
  if (!token)
    return undefined;
  const row = db.prepare(`
    SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `).get(tokenHash(token), now()) as unknown as UserRow | undefined;
  return row;
}

export function deleteSession(db: Db, token: string | undefined): void {
  if (token)
    db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash(token));
}

export function purgeExpiredSessions(db: Db): void {
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now());
}

export function login(db: Db, email: unknown, password: unknown): UserRow {
  if (typeof email !== "string" || typeof password !== "string")
    throw new HttpError(400, "email and password are required");
  const user = findUserByEmail(db, email);
  // Always run the hash so a missing user takes as long as a wrong password.
  const ok = user ? verifyPassword(password, user.password_hash) : (hashPassword(password), false);
  if (!user || !ok)
    throw new HttpError(401, "incorrect email or password");
  return user;
}

export function toUserDto(user: UserRow): UserDto {
  return { id: user.id, email: user.email, name: user.name, role: user.role, createdAt: user.created_at };
}

declare module "fastify" {
  interface FastifyRequest {
    user?: UserRow;
  }
}

export async function requireUser(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  if (!req.user)
    throw new HttpError(401, "sign in required");
}

export async function requireAdmin(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  if (!req.user)
    throw new HttpError(401, "sign in required");
  if (req.user.role !== "admin")
    throw new HttpError(403, "admin access required");
}
