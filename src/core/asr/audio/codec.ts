/**
 * 跨上下文传输的二进制编解码
 * 背景：Chrome 的 runtime 消息是 JSON 序列化的，ArrayBuffer 会被丢成 {}，
 * 所以音频走 base64 字符串传递（30s 16k/16bit ≈ 960KB → base64 ≈ 1.3MB，可接受）。
 */

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const CHUNK = 0x8000; // 逐块 fromCharCode，避免 apply 参数过多爆栈
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
