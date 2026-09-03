import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AuthState } from "../../shared/types.js";
import type { Db } from "../db.js";
import { countUsers, createSession, createUser, deleteSession, login, SESSION_COOKIE, setPassword, toUserDto, verifyPassword } from "../auth.js";
import { HttpError } from "../errors.js";

function startSession(db: Db, req: FastifyRequest, reply: FastifyReply, userId: number): void {
  const { token, expiresAt } = createSession(db, userId);
  reply.setCookie(SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: req.protocol === "https",
    expires: new Date(expiresAt),
  });
}

export function authRoutes(app: FastifyInstance, db: Db): void {
  app.get("/api/auth/me", async (req): Promise<AuthState> => ({
    user: req.user ? toUserDto(req.user) : null,
    needsSetup: countUsers(db) === 0,
  }));

  /** Creates the first admin account. Only works while there are no users at all. */
  app.post("/api/auth/setup", async (req, reply) => {
    if (countUsers(db) > 0)
      throw new HttpError(403, "setup has already been completed");
    const body = (req.body ?? {}) as Record<string, unknown>;
    const user = createUser(db, { email: body.email, name: body.name, password: body.password, role: "admin" });
    startSession(db, req, reply, user.id);
    return reply.code(201).send(toUserDto(user));
  });

  app.post("/api/auth/login", async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const user = login(db, body.email, body.password);
    startSession(db, req, reply, user.id);
    return toUserDto(user);
  });

  app.post("/api/auth/logout", async (req, reply) => {
    deleteSession(db, req.cookies[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return reply.code(204).send();
  });

  app.post("/api/auth/password", async (req, reply) => {
    if (!req.user)
      throw new HttpError(401, "sign in required");
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (typeof body.currentPassword !== "string" || !verifyPassword(body.currentPassword, req.user.password_hash))
      throw new HttpError(400, "current password is incorrect");
    setPassword(db, req.user.id, body.newPassword);
    startSession(db, req, reply, req.user.id);
    return reply.code(204).send();
  });
}
