import { ImportError } from './summary';

// Just enough of Java's object serialization (the format of ObjectOutputStream) to read
// another app's saved objects: objects, strings, enums, references and custom-written data.

export type JavaValue = number | bigint | boolean | string | null | JavaObject | JavaEnum;
export type JavaObject = { className: string; fields: Map<string, JavaValue> };
export type JavaEnum = { className: string; constant: string };

type ClassDesc = {
  name: string;
  flags: number;
  fields: { type: string; name: string }[];
  parent: ClassDesc | null;
};

const MAGIC = 0xaced;
const BASE_HANDLE = 0x7e0000;
const SC_WRITE_METHOD = 0x01;
const TC = {
  NULL: 0x70,
  REFERENCE: 0x71,
  CLASSDESC: 0x72,
  OBJECT: 0x73,
  STRING: 0x74,
  BLOCKDATA: 0x77,
  ENDBLOCKDATA: 0x78,
  ENUM: 0x7e,
};

/**
 * Java writes strings as "modified UTF-8": UTF-16 code units in one to three bytes each, so
 * characters outside the BMP arrive as two surrogates and NUL as two bytes.
 */
function modifiedUtf8(bytes: Uint8Array): string {
  const units: number[] = [];
  for (let i = 0; i < bytes.length;) {
    const a = bytes[i++] ?? 0;
    if (a < 0x80) units.push(a);
    else if ((a & 0xe0) === 0xc0) units.push(((a & 0x1f) << 6) | ((bytes[i++] ?? 0) & 0x3f));
    else {
      const b = bytes[i++] ?? 0;
      const c = bytes[i++] ?? 0;
      units.push(((a & 0x0f) << 12) | ((b & 0x3f) << 6) | (c & 0x3f));
    }
  }
  return String.fromCharCode(...units);
}

class Reader {
  private at = 0;
  private readonly view: DataView;
  private readonly handles: unknown[] = [];

  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  private need(n: number): number {
    if (this.at + n > this.bytes.length) throw new ImportError('The file ends too early.');
    const at = this.at;
    this.at += n;
    return at;
  }

  private u1(): number {
    return this.view.getUint8(this.need(1));
  }

  private u2(): number {
    return this.view.getUint16(this.need(2));
  }

  private utf(): string {
    const length = this.u2();
    const at = this.need(length);
    return modifiedUtf8(this.bytes.subarray(at, at + length));
  }

  private handle<T>(): T {
    const index = this.view.getInt32(this.need(4)) - BASE_HANDLE;
    if (index < 0 || index >= this.handles.length) throw new ImportError('A broken reference.');
    return this.handles[index] as T;
  }

  stream(): JavaValue {
    if (this.u2() !== MAGIC || this.u2() !== 5) throw new ImportError('Not a Java object file.');
    return this.content();
  }

  private classDesc(): ClassDesc | null {
    const tc = this.u1();
    if (tc === TC.NULL) return null;
    if (tc === TC.REFERENCE) return this.handle<ClassDesc>();
    if (tc !== TC.CLASSDESC) throw new ImportError('Unsupported Java class description.');
    const name = this.utf();
    this.need(8); // serialVersionUID
    const desc: ClassDesc = { name, flags: 0, fields: [], parent: null };
    this.handles.push(desc);
    desc.flags = this.u1();
    const count = this.u2();
    for (let i = 0; i < count; i++) {
      const type = String.fromCharCode(this.u1());
      const fieldName = this.utf();
      if (type === 'L' || type === '[') this.content(); // the field's class name
      desc.fields.push({ type, name: fieldName });
    }
    if (this.u1() !== TC.ENDBLOCKDATA) throw new ImportError('Unsupported class annotation.');
    desc.parent = this.classDesc();
    return desc;
  }

  private field(type: string): JavaValue {
    switch (type) {
      case 'B':
        return this.view.getInt8(this.need(1));
      case 'C':
        return this.view.getUint16(this.need(2));
      case 'S':
        return this.view.getInt16(this.need(2));
      case 'I':
        return this.view.getInt32(this.need(4));
      case 'J':
        return this.view.getBigInt64(this.need(8));
      case 'F':
        return this.view.getFloat32(this.need(4));
      case 'D':
        return this.view.getFloat64(this.need(8));
      case 'Z':
        return this.u1() !== 0;
      default:
        return this.content();
    }
  }

  private content(): JavaValue {
    const tc = this.u1();
    switch (tc) {
      case TC.NULL:
        return null;
      case TC.REFERENCE:
        return this.handle<JavaValue>();
      case TC.STRING: {
        const text = this.utf();
        this.handles.push(text);
        return text;
      }
      case TC.ENUM: {
        const desc = this.classDesc();
        const index = this.handles.push(null) - 1;
        const constant = this.content();
        const value: JavaEnum = { className: desc?.name ?? '', constant: String(constant) };
        this.handles[index] = value;
        return value;
      }
      case TC.OBJECT: {
        const desc = this.classDesc();
        const object: JavaObject = { className: desc?.name ?? '', fields: new Map() };
        this.handles.push(object);
        const chain: ClassDesc[] = [];
        for (let d = desc; d; d = d.parent) chain.unshift(d);
        for (const d of chain) {
          for (const f of d.fields) object.fields.set(f.name, this.field(f.type));
          if (d.flags & SC_WRITE_METHOD) this.skipCustomData();
        }
        return object;
      }
      default:
        throw new ImportError(`Unsupported Java object (0x${tc.toString(16)}).`);
    }
  }

  /** Data a class wrote itself (java.util.Date writes its time this way); not needed here. */
  private skipCustomData(): void {
    for (;;) {
      const tc = this.u1();
      if (tc === TC.ENDBLOCKDATA) return;
      if (tc === TC.BLOCKDATA) this.need(this.u1());
      else {
        this.at--;
        this.content();
      }
    }
  }
}

/** The first object in a Java serialization stream. */
export function readJavaObject(bytes: Uint8Array): JavaObject {
  const value = new Reader(bytes).stream();
  if (value === null || typeof value !== 'object' || !('fields' in value)) {
    throw new ImportError('The file holds no Java object.');
  }
  return value;
}
