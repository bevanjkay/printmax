import type { IppMessage } from "../src/server/ipp/codec.js";
import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { attrValue, attrValues, decode, encode, firstGroup, GroupTag } from "../src/server/ipp/codec.js";

describe("codec", () => {
  it("round-trips every value type including nested collections and 1setOf values", () => {
    const msg: IppMessage = {
      version: [2, 0],
      code: 0x000B,
      requestId: 42,
      groups: [
        {
          tag: GroupTag.operation,
          attributes: {
            "attributes-charset": { type: "charset", values: ["utf-8"] },
            "attributes-natural-language": { type: "naturalLanguage", values: ["en"] },
            "printer-uri": { type: "uri", values: ["ipp://printer.local/ipp/print"] },
            "requested-attributes": { type: "keyword", values: ["all", "media-col-database"] },
          },
        },
        {
          tag: GroupTag.job,
          attributes: {
            "copies": { type: "integer", values: [3] },
            "sides": { type: "keyword", values: ["two-sided-long-edge"] },
            "finishings": { type: "enum", values: [4, 20] },
            "ipp-attribute-fidelity": { type: "boolean", values: [false] },
            "page-ranges": { type: "rangeOfInteger", values: [{ min: 1, max: 3 }, { min: 7, max: 9 }] },
            "printer-resolution": { type: "resolution", values: [{ x: 600, y: 1200, units: 3 }] },
            "job-name": { type: "nameWithoutLanguage", values: ["report.pdf"] },
            "job-message": { type: "textWithLanguage", values: [{ language: "en-AU", text: "hello there" }] },
            "date-time-at-creation": { type: "dateTime", values: ["2026-09-03T01:02:03.400Z"] },
            "job-password": { type: "octetString", values: ["1234"] },
            "media-col": {
              type: "collection",
              values: [{
                "media-size": {
                  type: "collection",
                  values: [{
                    "x-dimension": { type: "integer", values: [21000] },
                    "y-dimension": { type: "integer", values: [29700] },
                  }],
                },
                "media-source": { type: "keyword", values: ["main"] },
                "media-type": { type: "keyword", values: ["stationery", "stationery-letterhead"] },
              }, {
                "media-source": { type: "keyword", values: ["by-pass-tray"] },
              }],
            },
            "job-hold-until": { type: "no-value", values: [] },
          },
        },
      ],
      data: Buffer.from("%PDF-1.4\n"),
    };

    const bytes = encode(msg);
    expect(bytes.subarray(0, 8)).toEqual(Buffer.from([2, 0, 0x00, 0x0B, 0, 0, 0, 42]));

    const decoded = decode(bytes);
    expect(decoded.version).toEqual([2, 0]);
    expect(decoded.code).toBe(0x000B);
    expect(decoded.requestId).toBe(42);
    expect(decoded.groups).toEqual(msg.groups.map(g => ({
      tag: g.tag,
      attributes: Object.fromEntries(Object.entries(g.attributes).map(([k, a]) => [k, a.type === "no-value" ? { type: "no-value", values: [null] } : a])),
    })));
    expect(decoded.data?.toString()).toBe("%PDF-1.4\n");
  });

  it("decodes additional values whose name length is zero into the previous attribute", () => {
    const bytes = Buffer.concat([
      Buffer.from([1, 1, 0, 0, 0, 0, 0, 1]),
      Buffer.from([GroupTag.printer]),
      Buffer.from([0x44, 0, 5]),
      Buffer.from("sides"),
      Buffer.from([0, 9]),
      Buffer.from("one-sided"),
      Buffer.from([0x44, 0, 0, 0, 19]),
      Buffer.from("two-sided-long-edge"),
      Buffer.from([GroupTag.end]),
    ]);
    const msg = decode(bytes);
    expect(attrValues(firstGroup(msg, GroupTag.printer), "sides")).toEqual(["one-sided", "two-sided-long-edge"]);
    expect(attrValue(firstGroup(msg, GroupTag.printer), "missing")).toBeUndefined();
  });

  it("rejects truncated input", () => {
    expect(() => decode(Buffer.from([2, 0, 0, 0]))).toThrow(/truncated/);
  });

  it("refuses to encode a wrongly typed value with the attribute name in the message", () => {
    expect(() => encode({
      version: [2, 0],
      code: 2,
      requestId: 1,
      groups: [{ tag: GroupTag.job, attributes: { copies: { type: "integer", values: ["two"] } } }],
    })).toThrow(/"copies" expects an integer/);
  });
});
