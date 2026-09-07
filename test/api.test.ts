import type { FastifyInstance, InjectOptions } from "fastify";
import type { IppAttributes } from "../src/server/ipp/codec.js";
import type { CapsChangeDto, FormField, PresetDto, PresetExport, PresetImportResult, UserDto } from "../src/shared/types.js";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/server/app.js";
import { diffCaps, listCapsChanges, recordCapsChange } from "../src/server/capsdiff.js";
import { openDb } from "../src/server/db.js";

const fixture = readFileSync(new URL("../fixtures/ippeveprinter.json", import.meta.url), "utf8");

describe("aPI", () => {
  let app: FastifyInstance;
  let db: ReturnType<typeof openDb>;
  let workDir: string;
  let adminCookie: string;
  let userCookie: string;
  let printerId: number;

  const as = (cookie: string, opts: InjectOptions): InjectOptions => ({ ...opts, headers: { ...(opts.headers ?? {}), cookie } });

  beforeAll(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), "printmax-api-"));
    db = openDb(":memory:");
    app = await buildApp({ db, uploadDir: workDir });
    db.prepare("INSERT INTO printers (name, uri, caps_discovered, caps_fetched_at, created_at) VALUES (?, ?, ?, ?, ?)")
      .run("Fixture", "ipp://127.0.0.1:1/ipp/print", fixture, new Date().toISOString(), new Date().toISOString());
    printerId = Number((db.prepare("SELECT id FROM printers").get() as { id: number }).id);
  });

  afterAll(async () => {
    await app.close();
    db.close();
    await rm(workDir, { recursive: true, force: true });
  });

  describe("setup and sessions", () => {
    it("reports that setup is needed and refuses protected routes", async () => {
      expect((await app.inject({ method: "GET", url: "/api/auth/me" })).json()).toEqual({ user: null, needsSetup: true });
      expect((await app.inject({ method: "GET", url: "/api/printers" })).statusCode).toBe(401);
    });

    it("creates the first admin, signs them in, and closes setup", async () => {
      const res = await app.inject({ method: "POST", url: "/api/auth/setup", payload: { name: "Bevan", email: "Admin@Example.org", password: "correct horse" } });
      expect(res.statusCode, res.body).toBe(201);
      expect(res.json<UserDto>()).toMatchObject({ name: "Bevan", email: "admin@example.org", role: "admin" });
      const cookie = res.cookies.find(c => c.name === "printmax_session");
      expect(cookie?.httpOnly).toBe(true);
      adminCookie = `printmax_session=${cookie!.value}`;

      expect((await app.inject(as(adminCookie, { method: "GET", url: "/api/auth/me" }))).json().user.role).toBe("admin");
      expect((await app.inject({ method: "POST", url: "/api/auth/setup", payload: { name: "x", email: "x@y", password: "12345678" } })).statusCode).toBe(403);
    });

    it("rejects bad logins with the same message for unknown users and wrong passwords", async () => {
      const wrong = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin@example.org", password: "nope" } });
      const missing = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "ghost@example.org", password: "nope" } });
      expect(wrong.statusCode).toBe(401);
      expect(missing.json().error).toBe(wrong.json().error);
    });

    it("lets an admin create a user who can then sign in but not administer", async () => {
      const created = await app.inject(as(adminCookie, { method: "POST", url: "/api/users", payload: { name: "Pat", email: "pat@example.org", password: "patpatpat", role: "user" } }));
      expect(created.statusCode, created.body).toBe(201);
      const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "pat@example.org", password: "patpatpat" } });
      expect(login.statusCode).toBe(200);
      userCookie = `printmax_session=${login.cookies.find(c => c.name === "printmax_session")!.value}`;
      expect((await app.inject(as(userCookie, { method: "GET", url: "/api/printers" }))).statusCode).toBe(200);
      expect((await app.inject(as(userCookie, { method: "GET", url: "/api/users" }))).statusCode).toBe(403);
      expect((await app.inject(as(userCookie, { method: "POST", url: "/api/printers", payload: { uri: "ipp://x/ipp/print" } }))).statusCode).toBe(403);
    });

    it("refuses to let an admin delete themselves", async () => {
      const me = (await app.inject(as(adminCookie, { method: "GET", url: "/api/auth/me" }))).json().user as UserDto;
      expect((await app.inject(as(adminCookie, { method: "DELETE", url: `/api/users/${me.id}` }))).statusCode).toBe(400);
    });

    it("changes a password, invalidating other sessions", async () => {
      const second = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "pat@example.org", password: "patpatpat" } });
      const secondCookie = `printmax_session=${second.cookies.find(c => c.name === "printmax_session")!.value}`;
      const bad = await app.inject(as(userCookie, { method: "POST", url: "/api/auth/password", payload: { currentPassword: "wrong", newPassword: "newnewnew1" } }));
      expect(bad.statusCode).toBe(400);
      const ok = await app.inject(as(userCookie, { method: "POST", url: "/api/auth/password", payload: { currentPassword: "patpatpat", newPassword: "newnewnew1" } }));
      expect(ok.statusCode).toBe(204);
      userCookie = `printmax_session=${ok.cookies.find(c => c.name === "printmax_session")!.value}`;
      expect((await app.inject(as(secondCookie, { method: "GET", url: "/api/auth/me" }))).json().user).toBeNull();
      expect((await app.inject(as(userCookie, { method: "GET", url: "/api/auth/me" }))).json().user.email).toBe("pat@example.org");
    });

    it("signs out", async () => {
      const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "pat@example.org", password: "newnewnew1" } });
      const cookie = `printmax_session=${login.cookies.find(c => c.name === "printmax_session")!.value}`;
      expect((await app.inject(as(cookie, { method: "POST", url: "/api/auth/logout" }))).statusCode).toBe(204);
      expect((await app.inject(as(cookie, { method: "GET", url: "/api/auth/me" }))).json().user).toBeNull();
    });

    it("accepts body-less POSTs that still declare a JSON content type, as browsers send them", async () => {
      const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "pat@example.org", password: "newnewnew1" } });
      const cookie = `printmax_session=${login.cookies.find(c => c.name === "printmax_session")!.value}`;
      const res = await app.inject(as(cookie, { method: "POST", url: "/api/auth/logout", headers: { "content-type": "application/json" } }));
      expect(res.statusCode, res.body).toBe(204);
    });
  });

  describe("generated form and validation", () => {
    it("serves the editor definition generated from the printer's attributes", async () => {
      const res = await app.inject(as(userCookie, { method: "GET", url: `/api/printers/${printerId}/form` }));
      expect(res.statusCode).toBe(200);
      const fields = res.json<FormField[]>();
      expect(fields.find(f => f.name === "sides")?.choices?.map(c => c.value)).toEqual(["one-sided", "two-sided-long-edge", "two-sided-short-edge"]);
    });

    it("validates option maps and echoes them back when nothing needs resolving", async () => {
      const ok = await app.inject(as(userCookie, { method: "POST", url: `/api/printers/${printerId}/validate`, payload: { options: { sides: "two-sided-long-edge", copies: 2 } } }));
      expect(ok.json()).toEqual({ errors: [], resolved: { sides: "two-sided-long-edge", copies: 2 } });
      const bad = await app.inject(as(userCookie, { method: "POST", url: `/api/printers/${printerId}/validate`, payload: { options: { copies: 5000 } } }));
      expect(bad.json().errors).toEqual(["\"copies\" must be between 1 and 999"]);
    });
  });

  describe("presets", () => {
    let globalId: number;
    let personalId: number;

    it("lets admins create shared presets and validates the options on save", async () => {
      const bad = await app.inject(as(adminCookie, { method: "POST", url: "/api/presets", payload: { printerId, name: "Broken", scope: "global", options: { sides: "upside-down" } } }));
      expect(bad.statusCode).toBe(422);
      const res = await app.inject(as(adminCookie, { method: "POST", url: "/api/presets", payload: { printerId, name: "Duplex draft", scope: "global", options: { "sides": "two-sided-long-edge", "print-quality": "draft" } } }));
      expect(res.statusCode, res.body).toBe(201);
      const preset = res.json<PresetDto>();
      expect(preset).toMatchObject({ scope: "global", ownerId: null, problems: [], editable: true });
      globalId = preset.id;
    });

    it("stops users creating shared presets but allows personal ones", async () => {
      const forbidden = await app.inject(as(userCookie, { method: "POST", url: "/api/presets", payload: { printerId, name: "Sneaky", scope: "global", options: {} } }));
      expect(forbidden.statusCode).toBe(403);
      const res = await app.inject(as(userCookie, { method: "POST", url: "/api/presets", payload: { printerId, name: "My A4", scope: "user", options: { media: "iso_a4_210x297mm" } } }));
      expect(res.statusCode, res.body).toBe(201);
      personalId = res.json<PresetDto>().id;
    });

    it("shows each user the shared presets plus their own", async () => {
      const mine = (await app.inject(as(userCookie, { method: "GET", url: `/api/presets?printerId=${printerId}` }))).json<PresetDto[]>();
      expect(mine.map(p => p.name)).toEqual(["Duplex draft", "My A4"]);
      const admins = (await app.inject(as(adminCookie, { method: "GET", url: "/api/presets" }))).json<PresetDto[]>();
      expect(admins.map(p => p.name)).toEqual(["Duplex draft"]);
      expect((await app.inject(as(adminCookie, { method: "GET", url: `/api/presets/${personalId}` }))).statusCode).toBe(404);
    });

    it("lets users edit only their own presets", async () => {
      const denied = await app.inject(as(userCookie, { method: "PUT", url: `/api/presets/${globalId}`, payload: { printerId, name: "Hijacked", options: {} } }));
      expect(denied.statusCode).toBe(403);
      const ok = await app.inject(as(userCookie, { method: "PUT", url: `/api/presets/${personalId}`, payload: { printerId, name: "My A4 duplex", options: { media: "iso_a4_210x297mm", sides: "two-sided-long-edge" } } }));
      expect(ok.statusCode, ok.body).toBe(200);
      expect(ok.json<PresetDto>().options).toEqual({ media: "iso_a4_210x297mm", sides: "two-sided-long-edge" });
    });

    it("exports a printer's presets as a file and imports one, reporting what it skipped", async () => {
      const file = (await app.inject(as(adminCookie, { method: "GET", url: `/api/presets/export?printerId=${printerId}` }))).json<PresetExport>();
      expect(file.format).toBe("printmax-presets/1");
      expect(file.printer.name).toBe("Fixture");
      expect(file.presets).toEqual([{ name: "Duplex draft", description: null, scope: "global", options: { "sides": "two-sided-long-edge", "print-quality": "draft" } }]);

      const res = await app.inject(as(adminCookie, { method: "POST", url: "/api/presets/import", payload: { printerId, presets: [
        ...file.presets,
        { name: "Thick card", scope: "global", options: { media: "iso_a4_210x297mm", sides: "one-sided" } },
        { name: "Impossible", scope: "global", options: { sides: "upside-down" } },
        { scope: "global", options: {} },
      ] } }));
      expect(res.statusCode, res.body).toBe(200);
      const result = res.json<PresetImportResult>();
      expect(result.imported.map(p => p.name)).toEqual(["Thick card"]);
      expect(result.skipped).toEqual([
        { name: "Duplex draft", reason: "already exists" },
        { name: "Impossible", reason: expect.stringMatching(/"sides" = upside-down is not supported/) },
        { name: "preset 4", reason: "name is required" },
      ]);

      const mine = (await app.inject(as(userCookie, { method: "POST", url: "/api/presets/import", payload: { printerId, presets: [{ name: "Thick card", scope: "global", options: {} }] } }))).json<PresetImportResult>();
      expect(mine.imported[0]).toMatchObject({ name: "Thick card", scope: "user", editable: true });
      expect((await app.inject(as(userCookie, { method: "POST", url: "/api/presets/import", payload: { printerId, presets: "nope" } }))).statusCode).toBe(400);
    });

    it("flags presets whose options the printer no longer supports", async () => {
      const caps = JSON.parse(fixture) as Record<string, { type: string; values: unknown[] }>;
      caps["sides-supported"] = { type: "keyword", values: ["one-sided"] };
      db.prepare("UPDATE printers SET caps_discovered = ? WHERE id = ?").run(JSON.stringify(caps), printerId);
      const presets = (await app.inject(as(adminCookie, { method: "GET", url: "/api/presets" }))).json<PresetDto[]>();
      expect(presets[0]?.problems[0]).toMatch(/"sides" = two-sided-long-edge is not supported/);
      db.prepare("UPDATE printers SET caps_discovered = ? WHERE id = ?").run(fixture, printerId);
    });
  });

  describe("postScript mode", () => {
    const ppdText = readFileSync(new URL("../fixtures/toshiba-e-studio-excerpt.ppd", import.meta.url), "utf8");

    it("takes a PPD, switches the form to its options, and validates presets against it", async () => {
      expect((await app.inject(as(userCookie, { method: "PUT", url: `/api/printers/${printerId}/ppd`, payload: { ppd: ppdText } }))).statusCode).toBe(403);
      expect((await app.inject(as(adminCookie, { method: "PUT", url: `/api/printers/${printerId}/mode`, payload: { mode: "postscript" } }))).statusCode).toBe(400);
      expect((await app.inject(as(adminCookie, { method: "PUT", url: `/api/printers/${printerId}/ppd`, payload: { ppd: "not a ppd" } }))).statusCode).toBe(400);

      try {
        await postScriptRoundTrip();
      }
      finally {
        await app.inject(as(adminCookie, { method: "DELETE", url: `/api/printers/${printerId}/ppd` }));
      }
    });

    async function postScriptRoundTrip(): Promise<void> {
      const withPpd = await app.inject(as(adminCookie, { method: "PUT", url: `/api/printers/${printerId}/ppd`, payload: { ppd: ppdText } }));
      expect(withPpd.statusCode, withPpd.body).toBe(200);
      expect(withPpd.json()).toMatchObject({ printMode: "ipp", ppd: { nickName: "TOSHIBA ColorMFP", hasJcl: true } });
      expect((await app.inject(as(userCookie, { method: "GET", url: `/api/printers/${printerId}/form` }))).json<FormField[]>().map(f => f.name)).toContain("sides");

      const on = await app.inject(as(adminCookie, { method: "PUT", url: `/api/printers/${printerId}/mode`, payload: { mode: "postscript" } }));
      expect(on.json().printMode).toBe("postscript");
      const fields = (await app.inject(as(userCookie, { method: "GET", url: `/api/printers/${printerId}/form` }))).json<FormField[]>();
      expect(fields[0]?.name).toBe("copies");
      expect(fields.map(f => f.name)).toContain("ppd:Stapling");
      expect(fields.map(f => f.name)).not.toContain("sides");

      const booklet = await app.inject(as(adminCookie, { method: "POST", url: "/api/presets", payload: { printerId, name: "Booklet", scope: "global", options: { "ppd:Stapling": "SS", "ppd:Folding": "True", "ppd:BookletPaperSize": "A4", "copies": 1 } } }));
      expect(booklet.statusCode, booklet.body).toBe(201);
      const bad = await app.inject(as(adminCookie, { method: "POST", url: "/api/presets", payload: { printerId, name: "Old style", scope: "global", options: { sides: "one-sided" } } }));
      expect(bad.statusCode).toBe(422);
      expect(bad.json().error).toMatch(/not used in PostScript mode/);
      const listed = (await app.inject(as(adminCookie, { method: "GET", url: `/api/presets?printerId=${printerId}` }))).json<PresetDto[]>();
      expect(listed.find(p => p.name === "Duplex draft")?.problems[0]).toMatch(/not used in PostScript mode/);
      expect(listed.find(p => p.name === "Booklet")?.problems).toEqual([]);

      expect((await app.inject(as(adminCookie, { method: "DELETE", url: `/api/presets/${booklet.json<PresetDto>().id}` }))).statusCode).toBe(204);
      const off = await app.inject(as(adminCookie, { method: "DELETE", url: `/api/printers/${printerId}/ppd` }));
      expect(off.json()).toMatchObject({ printMode: "ipp", ppd: null });
    }
  });

  describe("printer probe", () => {
    it("reports an unreachable printer rather than guessing", async () => {
      const res = await app.inject(as(userCookie, { method: "POST", url: `/api/printers/${printerId}/probe`, payload: { options: { sides: "one-sided" } } }));
      expect(res.statusCode).toBe(502);
      expect(res.json().error).toMatch(/printer not reachable/);
      expect((await app.inject(as(userCookie, { method: "POST", url: `/api/printers/${printerId}/probe`, payload: { options: [] } }))).statusCode).toBe(400);
    });
  });

  describe("capability overrides and change tracking", () => {
    it("merges admin overrides into the effective capabilities and the generated form", async () => {
      const put = await app.inject(as(adminCookie, { method: "PUT", url: `/api/printers/${printerId}/overrides`, payload: { "finishings-supported": { type: "enum", values: [3, 4, 20] } } }));
      expect(put.statusCode, put.body).toBe(200);
      expect(put.json().overrideCount).toBe(1);
      expect(put.json().summary.finishings).toEqual(["none", "staple", "staple-top-left"]);
      const fields = (await app.inject(as(userCookie, { method: "GET", url: `/api/printers/${printerId}/form` }))).json<FormField[]>();
      expect(fields.find(f => f.name === "finishings")?.choices?.map(c => c.value)).toEqual(["none", "staple", "staple-top-left"]);
      const ok = await app.inject(as(userCookie, { method: "POST", url: `/api/printers/${printerId}/validate`, payload: { options: { finishings: ["staple-top-left"] } } }));
      expect(ok.json().errors).toEqual([]);
    });

    it("lets admins set per-printer form defaults within what the printer supports", async () => {
      const set = await app.inject(as(adminCookie, { method: "PUT", url: `/api/printers/${printerId}/defaults`, payload: { media: "iso_a4_210x297mm", sides: "two-sided-long-edge" } }));
      expect(set.statusCode, set.body).toBe(200);
      expect(set.json().summary.defaults.media).toBe("iso_a4_210x297mm");
      const fields = (await app.inject(as(userCookie, { method: "GET", url: `/api/printers/${printerId}/form` }))).json<FormField[]>();
      expect(fields.find(f => f.name === "media")?.default).toBe("iso_a4_210x297mm");
      expect(fields.find(f => f.name === "sides")?.default).toBe("two-sided-long-edge");

      const bad = await app.inject(as(adminCookie, { method: "PUT", url: `/api/printers/${printerId}/defaults`, payload: { media: "iso_a3_297x420mm" } }));
      expect(bad.statusCode).toBe(422);
      expect(bad.json().error).toMatch(/"media" = iso_a3_297x420mm is not supported/);

      const cleared = await app.inject(as(adminCookie, { method: "PUT", url: `/api/printers/${printerId}/defaults`, payload: { media: "", sides: null } }));
      expect(cleared.statusCode).toBe(200);
      const after = (await app.inject(as(userCookie, { method: "GET", url: `/api/printers/${printerId}/form` }))).json<FormField[]>();
      expect(after.find(f => f.name === "media")?.default).toBe("na_letter_8.5x11in");
      expect((await app.inject(as(userCookie, { method: "PUT", url: `/api/printers/${printerId}/defaults`, payload: {} }))).statusCode).toBe(403);
    });

    it("rejects malformed overrides and keeps users out", async () => {
      expect((await app.inject(as(adminCookie, { method: "PUT", url: `/api/printers/${printerId}/overrides`, payload: { "sides-supported": ["one-sided"] } }))).statusCode).toBe(400);
      expect((await app.inject(as(userCookie, { method: "PUT", url: `/api/printers/${printerId}/overrides`, payload: {} }))).statusCode).toBe(403);
    });

    it("diffs capability fetches, ignoring volatile attributes, and lets admins acknowledge changes", async () => {
      const before = JSON.parse(fixture) as IppAttributes;
      const after = JSON.parse(fixture) as IppAttributes;
      after["printer-state"] = { type: "enum", values: [5] };
      after["printer-up-time"] = { type: "integer", values: [1] };
      after["sides-supported"] = { type: "keyword", values: ["one-sided"] };
      delete after["output-bin-supported"];
      after["job-account-id-supported"] = { type: "boolean", values: [true] };
      const diff = diffCaps(before, after);
      expect(diff).toEqual({ added: ["job-account-id-supported"], removed: ["output-bin-supported"], changed: ["sides-supported"] });

      recordCapsChange(db, printerId, diff);
      expect(listCapsChanges(db, printerId)).toHaveLength(1);
      const listed = (await app.inject(as(adminCookie, { method: "GET", url: `/api/printers/${printerId}/changes` }))).json<CapsChangeDto[]>();
      expect(listed[0]).toMatchObject({ added: ["job-account-id-supported"], acknowledgedAt: null });
      expect((await app.inject(as(adminCookie, { method: "GET", url: `/api/printers/${printerId}` }))).json().pendingChanges).toBe(1);

      expect((await app.inject(as(adminCookie, { method: "POST", url: `/api/printers/${printerId}/changes/${listed[0]!.id}/ack` }))).statusCode).toBe(204);
      expect((await app.inject(as(adminCookie, { method: "GET", url: `/api/printers/${printerId}/changes` }))).json()).toEqual([]);
      expect((await app.inject(as(adminCookie, { method: "GET", url: `/api/printers/${printerId}/changes?all=true` }))).json()).toHaveLength(1);
    });
  });

  describe("job history", () => {
    it("scopes job listings to the signed-in user unless an admin asks for everyone", async () => {
      const admin = (await app.inject(as(adminCookie, { method: "GET", url: "/api/auth/me" }))).json().user as UserDto;
      const user = (await app.inject(as(userCookie, { method: "GET", url: "/api/auth/me" }))).json().user as UserDto;
      const stamp = new Date().toISOString();
      const insert = db.prepare("INSERT INTO jobs (user_id, printer_id, filename, byte_size, document_format, state, created_at) VALUES (?, ?, ?, 1, 'application/pdf', 'completed', ?)");
      insert.run(admin.id, printerId, "admin.pdf", stamp);
      insert.run(user.id, printerId, "user.pdf", stamp);

      const mine = (await app.inject(as(userCookie, { method: "GET", url: "/api/jobs" }))).json<Array<{ filename: string }>>();
      expect(mine.map(j => j.filename)).toEqual(["user.pdf"]);
      const everyone = (await app.inject(as(userCookie, { method: "GET", url: "/api/jobs?all=true" }))).json<Array<{ filename: string }>>();
      expect(everyone.map(j => j.filename)).toEqual(["user.pdf"]);
      const adminAll = (await app.inject(as(adminCookie, { method: "GET", url: "/api/jobs?all=true" }))).json<Array<{ filename: string; userName: string }>>();
      expect(adminAll.map(j => `${j.filename}:${j.userName}`)).toEqual(["user.pdf:Pat", "admin.pdf:Bevan"]);

      const theirs = adminAll.find(j => j.filename === "admin.pdf") as unknown as { id: number };
      expect((await app.inject(as(userCookie, { method: "GET", url: `/api/jobs/${theirs.id}` }))).statusCode).toBe(404);
    });
  });
});
