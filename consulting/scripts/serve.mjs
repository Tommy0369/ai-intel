// dist/index.html をローカル配信する。同じWi-Fiのスマホからは表示される LAN の URL で開く。
//   node consulting/scripts/serve.mjs [--port=8787] [--host=0.0.0.0]
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || "").split("=")[1] || d;
const port = Number(arg("port", process.env.PORT || 8787));
const host = arg("host", "0.0.0.0");
const file = path.join(root, "dist/index.html");

if (!existsSync(file)) {
  console.error("dist/index.html がありません。先に npm run consult:build を実行してください。");
  process.exit(1);
}

createServer((req, res) => {
  if (req.url === "/" || req.url.startsWith("/?") || req.url.startsWith("/#") || req.url === "/index.html") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(readFileSync(file));
    return;
  }
  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("not found");
}).listen(port, host, () => {
  console.log(`RE:MAKE コンサル道場: http://localhost:${port}/`);
  for (const list of Object.values(networkInterfaces())) {
    for (const n of list || []) if (n.family === "IPv4" && !n.internal) console.log(`同じWi-Fiのスマホから: http://${n.address}:${port}/`);
  }
  console.log("停止は Ctrl+C。データは各ブラウザの localStorage に保存され、このサーバーには送られません。");
});
