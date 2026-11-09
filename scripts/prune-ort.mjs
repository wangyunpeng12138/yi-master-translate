/**
 * 构建后清理：删掉 Vite 从 node_modules 里顺手打包进来的 ORT 变体
 *
 * transformers.js 内部会 `import('onnxruntime-web/.../ort-wasm-simd-threaded.asyncify.mjs')`，
 * Vite 会把它依赖的 25MB asyncify wasm 当静态资源产出。我们运行时已把 wasmPaths 钉到
 * public/ort/ort-wasm-simd-threaded.{mjs,wasm}，这份不会用到，删掉可省 ~25MB。
 */
import fs from 'node:fs';
import path from 'node:path';

const assets = path.resolve(import.meta.dirname, '..', '.output', 'chrome-mv3', 'assets');
if (!fs.existsSync(assets)) process.exit(0);

let removed = 0;
for (const name of fs.readdirSync(assets)) {
  if (!/^ort-wasm-.*\.wasm$/.test(name)) continue;
  // 只保留非 asyncify/jsep/jspi 的通用构建（也就是 public/ort 里那份的副本，若存在）
  if (/asyncify|jsep|jspi/.test(name)) {
    fs.rmSync(path.join(assets, name));
    removed += 1;
    console.log(`[prune-ort] removed assets/${name}`);
  }
}
console.log(`[prune-ort] done, removed ${removed}`);
