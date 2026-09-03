/**
 * IPP/2.0 wire encoding and decoding per RFC 8010.
 *
 * Attribute values are kept close to the wire representation so that
 * a Get-Printer-Attributes response can be stored verbatim as JSON and
 * re-encoded for job submission without a lossy intermediate schema.
 */
import { Buffer } from "node:buffer";

export const GroupTag = {
  operation: 0x01,
  job: 0x02,
  end: 0x03,
  printer: 0x04,
  unsupported: 0x05,
  subscription: 0x06,
  eventNotification: 0x07,
  resource: 0x08,
  document: 0x09,
  system: 0x0A,
} as const;

const VALUE_TAGS = {
  integer: 0x21,
  boolean: 0x22,
  enum: 0x23,
  octetString: 0x30,
  dateTime: 0x31,
  resolution: 0x32,
  rangeOfInteger: 0x33,
  collection: 0x34,
  textWithLanguage: 0x35,
  nameWithLanguage: 0x36,
  textWithoutLanguage: 0x41,
  nameWithoutLanguage: 0x42,
  keyword: 0x44,
  uri: 0x45,
  uriScheme: 0x46,
  charset: 0x47,
  naturalLanguage: 0x48,
  mimeMediaType: 0x49,
} as const;

const OUT_OF_BAND_TAGS = {
  "unsupported": 0x10,
  "default": 0x11,
  "unknown": 0x12,
  "no-value": 0x13,
  "not-settable": 0x15,
  "delete-attribute": 0x16,
  "admin-define": 0x17,
} as const;

const END_COLLECTION = 0x37;
const MEMBER_ATTR_NAME = 0x4A;

export type IppValueType = keyof typeof VALUE_TAGS | keyof typeof OUT_OF_BAND_TAGS;

export interface IppResolution { x: number; y: number; units: number }
export interface IppRange { min: number; max: number }
export interface IppLangString { language: string; text: string }
export type IppCollection = Record<string, IppAttribute>;
export type IppValue = number | boolean | string | IppResolution | IppRange | IppLangString | IppCollection | null;

export interface IppAttribute {
  type: IppValueType;
  values: IppValue[];
}

export type IppAttributes = Record<string, IppAttribute>;

export interface IppGroup {
  tag: number;
  attributes: IppAttributes;
}

export interface IppMessage {
  version: [number, number];
  /** operation-id on requests, status-code on responses */
  code: number;
  requestId: number;
  groups: IppGroup[];
  data?: Buffer;
}

const TAG_TO_TYPE = new Map<number, IppValueType>();
for (const [type, tag] of Object.entries(VALUE_TAGS)) TAG_TO_TYPE.set(tag, type as IppValueType);
for (const [type, tag] of Object.entries(OUT_OF_BAND_TAGS)) TAG_TO_TYPE.set(tag, type as IppValueType);

export function isOutOfBand(type: IppValueType): boolean {
  return type in OUT_OF_BAND_TAGS;
}

class Writer {
  private chunks: Buffer[] = [];

  u8(n: number): void {
    this.chunks.push(Buffer.from([n & 0xFF]));
  }

  u16(n: number): void {
    const b = Buffer.alloc(2);
    b.writeUInt16BE(n);
    this.chunks.push(b);
  }

  i32(n: number): void {
    const b = Buffer.alloc(4);
    b.writeInt32BE(n);
    this.chunks.push(b);
  }

  raw(b: Buffer): void {
    this.chunks.push(b);
  }

  /** length-prefixed UTF-8 string */
  str(s: string): void {
    const b = Buffer.from(s, "utf8");
    if (b.length > 0xFFFF)
      throw new RangeError(`IPP string too long (${b.length} bytes)`);
    this.u16(b.length);
    this.raw(b);
  }

  toBuffer(): Buffer {
    return Buffer.concat(this.chunks);
  }
}

class Reader {
  private offset = 0;
  constructor(private readonly buf: Buffer) {}

  eof(): boolean {
    return this.offset >= this.buf.length;
  }

  private need(n: number): void {
    if (this.offset + n > this.buf.length)
      throw new RangeError(`truncated IPP message at offset ${this.offset}`);
  }

  u8(): number {
    this.need(1);
    return this.buf[this.offset++]!;
  }

  u16(): number {
    this.need(2);
    const v = this.buf.readUInt16BE(this.offset);
    this.offset += 2;
    return v;
  }

  u32(): number {
    this.need(4);
    const v = this.buf.readUInt32BE(this.offset);
    this.offset += 4;
    return v;
  }

  bytes(n: number): Buffer {
    this.need(n);
    const v = this.buf.subarray(this.offset, this.offset + n);
    this.offset += n;
    return v;
  }

  skip(n: number): void {
    this.need(n);
    this.offset += n;
  }

  str(): string {
    return this.bytes(this.u16()).toString("utf8");
  }

  rest(): Buffer {
    return this.buf.subarray(this.offset);
  }
}

export function encode(msg: IppMessage): Buffer {
  const w = new Writer();
  w.u8(msg.version[0]);
  w.u8(msg.version[1]);
  w.u16(msg.code);
  const id = Buffer.alloc(4);
  id.writeUInt32BE(msg.requestId >>> 0);
  w.raw(id);
  for (const group of msg.groups) {
    w.u8(group.tag);
    for (const [name, attr] of Object.entries(group.attributes))
      writeAttribute(w, name, attr);
  }
  w.u8(GroupTag.end);
  if (msg.data)
    w.raw(msg.data);
  return w.toBuffer();
}

function writeAttribute(w: Writer, name: string, attr: IppAttribute): void {
  if (isOutOfBand(attr.type)) {
    w.u8(OUT_OF_BAND_TAGS[attr.type as keyof typeof OUT_OF_BAND_TAGS]);
    w.str(name);
    w.u16(0);
    return;
  }
  if (attr.values.length === 0)
    throw new TypeError(`attribute "${name}" has no values`);
  attr.values.forEach((value, i) => writeValue(w, i === 0 ? name : "", attr.type, value, name));
}

function writeValue(w: Writer, name: string, type: IppValueType, value: IppValue, attrName: string): void {
  if (type === "collection") {
    w.u8(VALUE_TAGS.collection);
    w.str(name);
    w.u16(0);
    writeCollection(w, value as IppCollection, attrName);
    return;
  }
  const tag = VALUE_TAGS[type as keyof typeof VALUE_TAGS];
  if (tag === undefined)
    throw new TypeError(`cannot encode value of type "${type}" for "${attrName}"`);
  w.u8(tag);
  w.str(name);
  const bytes = valueBytes(type, value, attrName);
  if (bytes.length > 0xFFFF)
    throw new RangeError(`value of "${attrName}" too long`);
  w.u16(bytes.length);
  w.raw(bytes);
}

function writeCollection(w: Writer, members: IppCollection, attrName: string): void {
  if (typeof members !== "object" || members === null)
    throw new TypeError(`collection value of "${attrName}" must be an object`);
  for (const [memberName, memberAttr] of Object.entries(members)) {
    w.u8(MEMBER_ATTR_NAME);
    w.str("");
    w.str(memberName);
    for (const v of memberAttr.values)
      writeValue(w, "", memberAttr.type, v, `${attrName}/${memberName}`);
  }
  w.u8(END_COLLECTION);
  w.str("");
  w.u16(0);
}

function int32(n: unknown, attrName: string): Buffer {
  if (typeof n !== "number" || !Number.isInteger(n))
    throw new TypeError(`"${attrName}" expects an integer, got ${JSON.stringify(n)}`);
  const b = Buffer.alloc(4);
  b.writeInt32BE(n);
  return b;
}

function valueBytes(type: IppValueType, value: IppValue, attrName: string): Buffer {
  switch (type) {
    case "integer":
    case "enum":
      return int32(value, attrName);
    case "boolean":
      if (typeof value !== "boolean")
        throw new TypeError(`"${attrName}" expects a boolean`);
      return Buffer.from([value ? 1 : 0]);
    case "rangeOfInteger": {
      const r = value as IppRange;
      if (typeof r !== "object" || r === null)
        throw new TypeError(`"${attrName}" expects {min,max}`);
      return Buffer.concat([int32(r.min, attrName), int32(r.max, attrName)]);
    }
    case "resolution": {
      const r = value as IppResolution;
      if (typeof r !== "object" || r === null)
        throw new TypeError(`"${attrName}" expects {x,y,units}`);
      return Buffer.concat([int32(r.x, attrName), int32(r.y, attrName), Buffer.from([r.units & 0xFF])]);
    }
    case "dateTime":
      return encodeDateTime(value, attrName);
    case "textWithLanguage":
    case "nameWithLanguage": {
      const s = value as IppLangString;
      if (typeof s !== "object" || s === null)
        throw new TypeError(`"${attrName}" expects {language,text}`);
      const lang = Buffer.from(s.language, "utf8");
      const text = Buffer.from(s.text, "utf8");
      const b = Buffer.alloc(4 + lang.length + text.length);
      b.writeUInt16BE(lang.length, 0);
      lang.copy(b, 2);
      b.writeUInt16BE(text.length, 2 + lang.length);
      text.copy(b, 4 + lang.length);
      return b;
    }
    default:
      if (typeof value !== "string")
        throw new TypeError(`"${attrName}" expects a string, got ${JSON.stringify(value)}`);
      return Buffer.from(value, "utf8");
  }
}

function encodeDateTime(value: IppValue, attrName: string): Buffer {
  const d = new Date(value as string);
  if (Number.isNaN(d.getTime()))
    throw new TypeError(`"${attrName}" expects an ISO date string`);
  const b = Buffer.alloc(11);
  b.writeUInt16BE(d.getUTCFullYear(), 0);
  b[2] = d.getUTCMonth() + 1;
  b[3] = d.getUTCDate();
  b[4] = d.getUTCHours();
  b[5] = d.getUTCMinutes();
  b[6] = d.getUTCSeconds();
  b[7] = Math.floor(d.getUTCMilliseconds() / 100);
  b[8] = 0x2B; // '+'
  b[9] = 0;
  b[10] = 0;
  return b;
}

export function decode(buf: Buffer): IppMessage {
  const r = new Reader(buf);
  const version: [number, number] = [r.u8(), r.u8()];
  const code = r.u16();
  const requestId = r.u32();
  const groups: IppGroup[] = [];
  let current: IppGroup | undefined;
  let last: IppAttribute | undefined;

  while (!r.eof()) {
    const tag = r.u8();
    if (tag === GroupTag.end)
      break;
    if (tag < 0x10) {
      current = { tag, attributes: {} };
      groups.push(current);
      last = undefined;
      continue;
    }
    if (!current)
      throw new Error("IPP attribute appears before any attribute group");
    const name = r.str();
    const len = r.u16();
    const { type, value } = readValue(r, tag, len);
    if (name === "") {
      if (!last)
        throw new Error("IPP additional value without a preceding attribute");
      last.values.push(value);
    }
    else {
      last = { type, values: [value] };
      current.attributes[name] = last;
    }
  }
  const data = r.rest();
  const msg: IppMessage = { version, code, requestId, groups };
  if (data.length > 0)
    msg.data = Buffer.from(data);
  return msg;
}

function readValue(r: Reader, tag: number, len: number): { type: IppValueType; value: IppValue } {
  if (tag === VALUE_TAGS.collection) {
    r.skip(len);
    return { type: "collection", value: readCollection(r) };
  }
  const known = TAG_TO_TYPE.get(tag);
  if (known && isOutOfBand(known)) {
    r.skip(len);
    return { type: known, value: null };
  }
  const bytes = r.bytes(len);
  const type = known ?? fallbackType(tag, len);
  return { type, value: parseValue(type, bytes) };
}

function readCollection(r: Reader): IppCollection {
  const members: IppCollection = {};
  let current: IppAttribute | undefined;
  while (true) {
    const tag = r.u8();
    r.str();
    const len = r.u16();
    if (tag === END_COLLECTION) {
      r.skip(len);
      return members;
    }
    if (tag === MEMBER_ATTR_NAME) {
      const memberName = r.bytes(len).toString("utf8");
      current = { type: "unknown", values: [] };
      members[memberName] = current;
      continue;
    }
    if (!current)
      throw new Error("IPP collection value without a member name");
    const { type, value } = readValue(r, tag, len);
    if (current.values.length === 0)
      current.type = type;
    current.values.push(value);
  }
}

function fallbackType(tag: number, len: number): IppValueType {
  if (tag >= 0x40 && tag <= 0x5F)
    return "keyword";
  if (tag >= 0x20 && tag <= 0x2F && len === 4)
    return "integer";
  return "octetString";
}

function parseValue(type: IppValueType, b: Buffer): IppValue {
  switch (type) {
    case "integer":
    case "enum":
      return b.length === 4 ? b.readInt32BE(0) : Number.parseInt(b.toString("hex") || "0", 16);
    case "boolean":
      return b[0] !== 0;
    case "rangeOfInteger":
      return { min: b.readInt32BE(0), max: b.readInt32BE(4) };
    case "resolution":
      return { x: b.readInt32BE(0), y: b.readInt32BE(4), units: b[8] ?? 3 };
    case "dateTime":
      return parseDateTime(b);
    case "textWithLanguage":
    case "nameWithLanguage": {
      const langLen = b.readUInt16BE(0);
      const language = b.subarray(2, 2 + langLen).toString("utf8");
      const textLen = b.readUInt16BE(2 + langLen);
      const text = b.subarray(4 + langLen, 4 + langLen + textLen).toString("utf8");
      return { language, text };
    }
    default:
      return b.toString("utf8");
  }
}

function parseDateTime(b: Buffer): string {
  if (b.length < 11)
    return b.toString("hex");
  const sign = b[8] === 0x2D ? -1 : 1;
  const offsetMinutes = sign * ((b[9] ?? 0) * 60 + (b[10] ?? 0));
  const utc = Date.UTC(b.readUInt16BE(0), (b[2] ?? 1) - 1, b[3] ?? 1, b[4] ?? 0, b[5] ?? 0, b[6] ?? 0, (b[7] ?? 0) * 100);
  return new Date(utc - offsetMinutes * 60_000).toISOString();
}

export function firstGroup(msg: IppMessage, tag: number): IppAttributes | undefined {
  return msg.groups.find(g => g.tag === tag)?.attributes;
}

export function groupsOf(msg: IppMessage, tag: number): IppAttributes[] {
  return msg.groups.filter(g => g.tag === tag).map(g => g.attributes);
}

export function attrValues<T extends IppValue = IppValue>(attrs: IppAttributes | undefined, name: string): T[] {
  const attr = attrs?.[name];
  if (!attr || isOutOfBand(attr.type))
    return [];
  return attr.values as T[];
}

export function attrValue<T extends IppValue = IppValue>(attrs: IppAttributes | undefined, name: string): T | undefined {
  return attrValues<T>(attrs, name)[0];
}
