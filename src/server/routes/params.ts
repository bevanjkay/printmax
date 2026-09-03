import { HttpError } from "../errors.js";

export function idParam(params: unknown, key = "id"): number {
  const id = Number((params as Record<string, string>)[key]);
  if (!Number.isInteger(id) || id <= 0)
    throw new HttpError(400, `invalid ${key}`);
  return id;
}
