/**
 * Binary reader utility for parsing game files
 * Mirrors the functionality needed from the C++ codebase
 */
export class BinaryReader {
  private buffer: ArrayBuffer;
  private view: DataView;
  private offset: number = 0;
  private littleEndian: boolean = true;

  constructor(buffer: ArrayBuffer | Uint8Array) {
    if (buffer instanceof Uint8Array) {
      this.buffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    } else {
      this.buffer = buffer;
    }
    this.view = new DataView(this.buffer);
  }

  get position(): number {
    return this.offset;
  }

  get length(): number {
    return this.buffer.byteLength;
  }

  get remaining(): number {
    return this.length - this.offset;
  }

  seek(offset: number): void {
    if (offset < 0 || offset > this.length) {
      throw new Error(`Seek position ${offset} out of bounds (0-${this.length})`);
    }
    this.offset = offset;
  }

  skip(bytes: number): void {
    this.seek(this.offset + bytes);
  }

  align(alignment: number): void {
    const remainder = this.offset % alignment;
    if (remainder !== 0) {
      this.skip(alignment - remainder);
    }
  }

  // Read bytes as Uint8Array
  readBytes(length: number): Uint8Array {
    const bytes = new Uint8Array(this.buffer, this.offset, length);
    this.offset += length;
    return bytes.slice(); // Return a copy
  }

  // Unsigned integers (lowercase aliases for compatibility)
  readUint8(): number {
    const value = this.view.getUint8(this.offset);
    this.offset += 1;
    return value;
  }

  readUint16(): number {
    const value = this.view.getUint16(this.offset, this.littleEndian);
    this.offset += 2;
    return value;
  }

  readUint32(): number {
    const value = this.view.getUint32(this.offset, this.littleEndian);
    this.offset += 4;
    return value;
  }

  readUint64(): bigint {
    const value = this.view.getBigUint64(this.offset, this.littleEndian);
    this.offset += 8;
    return value;
  }

  // PascalCase aliases
  readUInt8(): number { return this.readUint8(); }
  readUInt16(): number { return this.readUint16(); }
  readUInt32(): number { return this.readUint32(); }
  readUInt64(): bigint { return this.readUint64(); }

  // Signed integers
  readInt8(): number {
    const value = this.view.getInt8(this.offset);
    this.offset += 1;
    return value;
  }

  readInt16(): number {
    const value = this.view.getInt16(this.offset, this.littleEndian);
    this.offset += 2;
    return value;
  }

  readInt32(): number {
    const value = this.view.getInt32(this.offset, this.littleEndian);
    this.offset += 4;
    return value;
  }

  readInt64(): bigint {
    const value = this.view.getBigInt64(this.offset, this.littleEndian);
    this.offset += 8;
    return value;
  }

  // Floating point
  readFloat32(): number {
    const value = this.view.getFloat32(this.offset, this.littleEndian);
    this.offset += 4;
    return value;
  }

  readFloat64(): number {
    const value = this.view.getFloat64(this.offset, this.littleEndian);
    this.offset += 8;
    return value;
  }

  // Half-precision float (16-bit)
  readFloat16(): number {
    const half = this.readUInt16();
    return this.halfToFloat(half);
  }

  private halfToFloat(half: number): number {
    const sign = (half >> 15) & 0x1;
    const exponent = (half >> 10) & 0x1f;
    const mantissa = half & 0x3ff;

    if (exponent === 0) {
      if (mantissa === 0) {
        return sign ? -0 : 0;
      }
      // Denormalized number
      return (sign ? -1 : 1) * Math.pow(2, -14) * (mantissa / 1024);
    } else if (exponent === 31) {
      return mantissa ? NaN : (sign ? -Infinity : Infinity);
    }

    return (sign ? -1 : 1) * Math.pow(2, exponent - 15) * (1 + mantissa / 1024);
  }

  // Strings
  readString(length: number): string {
    const bytes = new Uint8Array(this.buffer, this.offset, length);
    this.offset += length;
    return new TextDecoder('utf-8').decode(bytes);
  }

  readNullTerminatedString(maxLength: number = 256): string {
    const start = this.offset;
    let end = start;
    const bytes = new Uint8Array(this.buffer);
    
    while (end < this.length && end - start < maxLength && bytes[end] !== 0) {
      end++;
    }
    
    const str = new TextDecoder('utf-8').decode(bytes.slice(start, end));
    this.offset = end + 1; // Skip the null terminator
    return str;
  }

  // Read string at specific offset without moving position
  readStringAt(offset: number, maxLength: number = 256): string {
    const savedOffset = this.offset;
    this.seek(offset);
    const str = this.readNullTerminatedString(maxLength);
    this.offset = savedOffset;
    return str;
  }

  readUInt16Array(count: number): Uint16Array {
    const arr = new Uint16Array(count);
    for (let i = 0; i < count; i++) {
      arr[i] = this.readUInt16();
    }
    return arr;
  }

  readUInt32Array(count: number): Uint32Array {
    const arr = new Uint32Array(count);
    for (let i = 0; i < count; i++) {
      arr[i] = this.readUInt32();
    }
    return arr;
  }

  readFloat32Array(count: number): Float32Array {
    const arr = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      arr[i] = this.readFloat32();
    }
    return arr;
  }

  // FourCC
  readFourCC(): number {
    return this.readUInt32();
  }

  readFourCCString(): string {
    const fourcc = this.readFourCC();
    return String.fromCharCode(
      fourcc & 0xff,
      (fourcc >> 8) & 0xff,
      (fourcc >> 16) & 0xff,
      (fourcc >> 24) & 0xff
    ).replace(/\0/g, '');
  }

  // GUID (64-bit)
  readGUID(): string {
    const value = this.readUInt64();
    return value.toString(16).padStart(16, '0');
  }

  // Vector types
  readVector2(): { x: number; y: number } {
    return {
      x: this.readFloat32(),
      y: this.readFloat32(),
    };
  }

  readVector3(): { x: number; y: number; z: number } {
    return {
      x: this.readFloat32(),
      y: this.readFloat32(),
      z: this.readFloat32(),
    };
  }

  readVector4(): { x: number; y: number; z: number; w: number } {
    return {
      x: this.readFloat32(),
      y: this.readFloat32(),
      z: this.readFloat32(),
      w: this.readFloat32(),
    };
  }

  // Create a sub-reader for a portion of the buffer
  slice(offset: number, length: number): BinaryReader {
    return new BinaryReader(this.buffer.slice(offset, offset + length));
  }
}

/**
 * Binary writer utility for creating files
 */
export class BinaryWriter {
  private buffer: ArrayBuffer;
  private view: DataView;
  private offset: number = 0;
  private littleEndian: boolean = true;

  constructor(initialSize: number = 1024) {
    this.buffer = new ArrayBuffer(initialSize);
    this.view = new DataView(this.buffer);
  }

  get position(): number {
    return this.offset;
  }

  get length(): number {
    return this.offset;
  }

  private ensureCapacity(additionalBytes: number): void {
    const required = this.offset + additionalBytes;
    if (required > this.buffer.byteLength) {
      const newSize = Math.max(required, this.buffer.byteLength * 2);
      const newBuffer = new ArrayBuffer(newSize);
      new Uint8Array(newBuffer).set(new Uint8Array(this.buffer));
      this.buffer = newBuffer;
      this.view = new DataView(this.buffer);
    }
  }

  seek(offset: number): void {
    this.offset = offset;
  }

  getBuffer(): ArrayBuffer {
    return this.buffer.slice(0, this.offset);
  }

  // Unsigned integers
  writeUInt8(value: number): void {
    this.ensureCapacity(1);
    this.view.setUint8(this.offset, value);
    this.offset += 1;
  }

  writeUInt16(value: number): void {
    this.ensureCapacity(2);
    this.view.setUint16(this.offset, value, this.littleEndian);
    this.offset += 2;
  }

  writeUInt32(value: number): void {
    this.ensureCapacity(4);
    this.view.setUint32(this.offset, value, this.littleEndian);
    this.offset += 4;
  }

  writeUInt64(value: bigint): void {
    this.ensureCapacity(8);
    this.view.setBigUint64(this.offset, value, this.littleEndian);
    this.offset += 8;
  }

  // Signed integers
  writeInt8(value: number): void {
    this.ensureCapacity(1);
    this.view.setInt8(this.offset, value);
    this.offset += 1;
  }

  writeInt16(value: number): void {
    this.ensureCapacity(2);
    this.view.setInt16(this.offset, value, this.littleEndian);
    this.offset += 2;
  }

  writeInt32(value: number): void {
    this.ensureCapacity(4);
    this.view.setInt32(this.offset, value, this.littleEndian);
    this.offset += 4;
  }

  // Floating point
  writeFloat32(value: number): void {
    this.ensureCapacity(4);
    this.view.setFloat32(this.offset, value, this.littleEndian);
    this.offset += 4;
  }

  writeFloat64(value: number): void {
    this.ensureCapacity(8);
    this.view.setFloat64(this.offset, value, this.littleEndian);
    this.offset += 8;
  }

  // Strings
  writeString(str: string): void {
    const bytes = new TextEncoder().encode(str);
    this.writeBytes(bytes);
  }

  writeNullTerminatedString(str: string): void {
    this.writeString(str);
    this.writeUInt8(0);
  }

  // Arrays
  writeBytes(bytes: Uint8Array): void {
    this.ensureCapacity(bytes.length);
    new Uint8Array(this.buffer, this.offset, bytes.length).set(bytes);
    this.offset += bytes.length;
  }

  // Padding
  writePadding(count: number, value: number = 0): void {
    this.ensureCapacity(count);
    for (let i = 0; i < count; i++) {
      this.writeUInt8(value);
    }
  }

  align(alignment: number): void {
    const remainder = this.offset % alignment;
    if (remainder !== 0) {
      this.writePadding(alignment - remainder);
    }
  }
}
