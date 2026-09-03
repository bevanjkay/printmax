import type { FastifyInstance } from "fastify";
import type { Db } from "../db.js";
import { createUser, deleteUser, listUsers, setPassword, toUserDto } from "../auth.js";
import { HttpError } from "../errors.js";
import { idParam } from "./params.js";

export function userRoutes(app: FastifyInstance, db: Db): void {
  app.get("/api/users", async () => listUsers(db).map(toUserDto));

  app.post("/api/users", async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const user = createUser(db, { email: body.email, name: body.name, password: body.password, role: body.role });
    return reply.code(201).send(toUserDto(user));
  });

  app.post("/api/users/:id/password", async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    setPassword(db, idParam(req.params), body.password);
    return reply.code(204).send();
  });

  app.delete("/api/users/:id", async (req, reply) => {
    const id = idParam(req.params);
    if (id === req.user!.id)
      throw new HttpError(400, "you cannot delete your own account");
    deleteUser(db, id);
    return reply.code(204).send();
  });
}
