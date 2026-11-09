/**
 * 把 ONNX Runtime Web 的 wasm 与加载器拷进 public/ort/（构建前自动执行）
 *
 * 为什么需要：transformers.js 默认从 jsDelivr CDN 动态 import ORT 的 `.mjs` 加载器，
 * 而扩展里既不该依赖 CDN（离线/墙），也会因版本是 dev 构建而在 CDN 上 404。
 * 改为随扩展打包，`asr.local` 初始化时把 wasmPaths 指到 chrome-extension://.../ort/。
 *
 * 只拷 `ort-wasm-simd-threaded`（13.6MB）：异步/WebGPU(jsep)/JSPI 三个变体用不到。
 * `public/ort/` 已在 .gitignore 中（二进制不入库，构建时生成）。
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'public', 'ort');
const FILES = ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm'];

function findOrtDist() {
  const candidates = [
    path.join(ROOT, 'node_modules', 'onnxruntime-web', 'dist'),
    path.join(ROOT, 'node_modules', '@huggingface', 'transformers', 'node_modules', 'onnxruntime-web', 'dist'),
  ];
  // pnpm 布局：node_modules/.pnpm/onnxruntime-web@<ver>/node_modules/onnxruntime-web/dist
  const pnpmDir = path.join(ROOT, 'node_modules', '.pnpm');
  if (fs.existsSync(pnpmDir)) {
    for (const entry of fs.readdirSync(pnpmDir)) {
      if (!entry.startsWith('onnxruntime-web@')) continue;
      candidates.push(path.join(pnpmDir, entry, 'node_modules', 'onnxruntime-web', 'dist'));
    }
  }
  return candidates.find((p) => FILES.every((f) => fs.existsSync(path.join(p, f)))) ?? null;
}

const dist = findOrtDist();
if (!dist) {
  console.warn('[copy-ort] 未找到 onnxruntime-web/dist，跳过（本地 Whisper 将退回 CDN 加载）');
  process.exit(0);
}

fs.mkdirSync(OUT, { recursive: true });
for (const f of FILES) {
  const src = path.join(dist, f);
  const dst = path.join(OUT, f);
  const srcSize = fs.statSync(src).size;
  if (fs.existsSync(dst) && fs.statSync(dst).size === srcSize) continue; // 已是最新
  fs.copyFileSync(src, dst);
  console.log(`[copy-ort] ${f} → public/ort/ (${(srcSize / 1024 / 1024).toFixed(1)}MB)`);
}
console.log('[copy-ort] done');
