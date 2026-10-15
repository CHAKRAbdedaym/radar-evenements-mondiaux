// Dependency-free screenshot tool (fallback when the Playwright image cannot be pulled).
// Drives a local headless Chrome through the DevTools Protocol with real device emulation.
// Usage: node --experimental-websocket qa/cdp_screenshot.mjs <baseUrl> <outDir> <width> <height> <name=path>...
import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [base, outDir, width, height, ...pages] = process.argv.slice(2);
const W = Number(width), H = Number(height), mobile = W < 768;
const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn("google-chrome", [
  "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
  `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "cdp-"))}`, "about:blank",
], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function target() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = list.find((t) => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(200);
  }
  throw new Error("chrome did not start");
}

const ws = new WebSocket(await target());
await new Promise((r) => (ws.onopen = r));
let seq = 0;
const pending = new Map();
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
};
const send = (method, params = {}) => new Promise((r) => {
  const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params }));
});

await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile });
if (mobile) await send("Emulation.setTouchEmulationEnabled", { enabled: true });
for (const spec of pages) {
  const [name, path] = spec.split("=");
  await send("Page.navigate", { url: base + path });
  await sleep(6000); // let data polling + animations settle
  const { result } = await send("Runtime.evaluate", {
    expression: "JSON.stringify({w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight})",
    returnByValue: true,
  });
  const dims = JSON.parse(result.result.value);
  const shot = await send("Page.captureScreenshot", {
    format: "png", captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: W, height: Math.min(dims.h, 4000), scale: 1 },
  });
  const file = join(outDir, `${name}.png`);
  writeFileSync(file, Buffer.from(shot.result.data, "base64"));
  console.log(`${file} scrollWidth=${dims.w} (viewport ${W})${dims.w > W ? "  <-- HORIZONTAL OVERFLOW" : ""}`);
}
ws.close();
chrome.kill();
