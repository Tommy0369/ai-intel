import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { networkInterfaces } from "node:os";
import type { AppConfig } from "./types.js";
import { runDashboard } from "./dashboard.js";
import { resolveBridgeRoot } from "./ship.js";

const PORT = 8787;

function lanAddresses(): string[] {
  const nets = networkInterfaces();
  const out: string[] = [];
  for (const list of Object.values(nets)) {
    if (!list) continue;
    for (const n of list) {
      if (n.family === "IPv4" && !n.internal) out.push(n.address);
    }
  }
  return out;
}

function contentType(file: string): string {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".md")) return "text/markdown; charset=utf-8";
  if (file.endsWith(".json")) return "application/json; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  return "text/plain; charset=utf-8";
}

/**
 * ダッシュボードを iCloud に同期し、同じWi-Fiのスマホ向けに配信する。
 */
export async function runPhone(
  config: AppConfig,
  opts?: { serve?: boolean },
): Promise<{ mobilePath: string; urls: string[] }> {
  const dash = await runDashboard(config);
  const mobilePath = dash.mobilePath;
  const urls = lanAddresses().map((ip) => `http://${ip}:${PORT}/`);

  const guide = [
    `# スマホで情報収集班を見る`,
    "",
    `更新: ${new Date().toISOString()}`,
    "",
    "## 方法A（おすすめ・いつでも）: iCloud",
    "",
    "iPhone の **ファイル**アプリ →",
    "`iCloud Drive / 99_システム / AI共有OS / AI活動OS / intel-bridge / mobile / DASHBOARD.html`",
    "",
    "## 方法B（同じWi-Fi・いまこのMacが配信中）",
    "",
    ...urls.map((u) => `- ${u}`),
    "",
    urls.length
      ? "Safariで上のURLを開く。ホーム画面に追加もできる。"
      : "（LAN IPが見つからない。Wi-Fi接続を確認）",
    "",
    `配信フォルダ: \`${mobilePath}\``,
    "",
  ].join("\n");

  const { writeFile } = await import("node:fs/promises");
  await writeFile(path.join(mobilePath, "PHONE.txt"), guide, "utf8");
  await writeFile(
    path.join(config.dataRoot, "ready", "PHONE.txt"),
    guide,
    "utf8",
  );

  if (opts?.serve === false) {
    return { mobilePath, urls };
  }

  const root = mobilePath;
  const server = http.createServer(async (req, res) => {
    try {
      let rel = decodeURIComponent((req.url || "/").split("?")[0] || "/");
      if (rel === "/") rel = "/index.html";
      const file = path.normalize(path.join(root, rel));
      if (!file.startsWith(root)) {
        res.writeHead(403);
        res.end("forbidden");
        return;
      }
      const st = await stat(file);
      if (!st.isFile()) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      const body = await readFile(file);
      res.writeHead(200, {
        "Content-Type": contentType(file),
        "Cache-Control": "no-store",
      });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(PORT, "0.0.0.0", () => resolve());
  });

  console.log("\n📱 スマホ用サーバー起動中（Ctrl+C で停止）");
  console.log(`  フォルダ: ${mobilePath}`);
  console.log("  iCloud: intel-bridge/mobile/DASHBOARD.html");
  for (const u of urls) console.log(`  LAN: ${u}`);
  if (!urls.length) {
    console.log(`  LAN: http://127.0.0.1:${PORT}/ （このMacのみ）`);
  }
  console.log(`  ホスト: ${os.hostname()}`);

  // プロセスを生かし続ける
  await new Promise(() => {});
  return { mobilePath, urls };
}

export function mobileIcloudHint(config: AppConfig): string {
  return path.join(resolveBridgeRoot(config), "mobile", "DASHBOARD.html");
}
