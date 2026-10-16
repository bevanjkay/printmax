import type { FastifyInstance } from "fastify";
import type { CreatedApiTokenDto } from "../../shared/types.js";
import type { Db } from "../db.js";
import { createApiToken, deleteApiToken, listApiTokens, toApiTokenDto } from "../auth.js";
import { idParam } from "./params.js";

export function tokenRoutes(app: FastifyInstance, db: Db): void {
  app.get("/api/tokens", async req => listApiTokens(db, req.user!.id).map(toApiTokenDto));

  app.post("/api/tokens", async (req, reply) => {
    const body = (req.body ?? {}) as { name?: unknown };
    const { row, secret } = createApiToken(db, req.user!.id, body.name);
    const created: CreatedApiTokenDto = { ...toApiTokenDto(row), secret };
    return reply.code(201).send(created);
  });

  app.delete("/api/tokens/:id", async (req, reply) => {
    deleteApiToken(db, req.user!.id, idParam(req.params));
    return reply.code(204).send();
  });
}
