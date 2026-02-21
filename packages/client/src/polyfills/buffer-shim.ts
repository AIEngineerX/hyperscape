import * as bufferModule from "buffer/index.js";

type BufferModuleLike = {
  Buffer?: typeof globalThis.Buffer;
  SlowBuffer?: typeof globalThis.Buffer;
  INSPECT_MAX_BYTES?: number;
  kMaxLength?: number;
};

const resolved = (bufferModule as unknown as BufferModuleLike).Buffer
  ? (bufferModule as unknown as BufferModuleLike)
  : ((bufferModule as unknown as { default?: BufferModuleLike }).default ??
    (bufferModule as unknown as BufferModuleLike));

export const Buffer = resolved.Buffer ?? globalThis.Buffer;
export const SlowBuffer = resolved.SlowBuffer ?? Buffer;
export const INSPECT_MAX_BYTES = resolved.INSPECT_MAX_BYTES ?? 50;
export const kMaxLength = resolved.kMaxLength ?? Number.MAX_SAFE_INTEGER;

export default resolved;
