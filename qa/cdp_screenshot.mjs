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
const logs = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  // Collect page errors and console warnings/errors (printed per page).
  if (msg.method === "Runtime.exceptionThrown") {
    const d = msg.params.exceptionDetails;
    logs.push(`EXCEPTION: ${d.exception?.description || d.text}`.slice(0, 600));
  } else if (msg.method === "Runtime.consoleAPICalled" && ["error", "warning", "assert"].includes(msg.params.type)) {
    logs.push(`console.${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description ?? "").join(" ")}`.slice(0, 600));
  } else if (msg.method === "Log.entryAdded" && ["error", "warning"].includes(msg.params.entry.level)) {
    logs.push(`log.${msg.params.entry.level}: ${msg.params.entry.text} ${msg.params.entry.url || ""}`.slice(0, 600));
  }
};
const send = (method, params = {}) => new Promise((r) => {
  const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params }));
});

await send("Page.enable");
await send("Runtime.enable");
await send("Log.enable");
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile });
if (mobile) await send("Emulation.setTouchEmulationEnabled", { enabled: true });
for (const spec of pages) {
  const i = spec.indexOf("="); // split on the first "=" only (paths may contain ?q=...)
  const name = spec.slice(0, i), path = spec.slice(i + 1);
  await send("Page.navigate", { url: base + path });
  await sleep(6000); // let data polling + animations settle
  const { result } = await send("Runtime.evaluate", {
    expression: "JSON.stringify({w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight})",
    returnByValue: true,
  });
  const dims = JSON.parse(result.result.value);
  const fullH = Math.min(dims.h, Number(process.env.MAX_H || 9000));
  // Grow the viewport to the full page height so everything below the fold is painted.
  if (fullH > H) {
    await send("Emulation.setDeviceMetricsOverride", { width: W, height: fullH, deviceScaleFactor: 1, mobile });
    await sleep(800);
  }
  // Wait (max IMG_WAIT_MS, default 20 s) until every image has finished loading: Wikimedia thumbnails are slow here.
  const imgDeadline = Date.now() + Number(process.env.IMG_WAIT_MS || 20000);
  let pendingImgs = 0;
  while (Date.now() < imgDeadline) {
    const r = await send("Runtime.evaluate", {
      expression: "Array.from(document.images).filter((i) => !i.complete).length", returnByValue: true,
    });
    pendingImgs = r.result.result.value;
    if (!pendingImgs) break;
    await sleep(500);
  }
  if (pendingImgs) console.log(`   ${name}: ${pendingImgs} image(s) still loading after the wait`);
  await sleep(300);
  const shot = await send("Page.captureScreenshot", {
    format: "png", captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: W, height: fullH, scale: 1 },
  });
  if (fullH > H) await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile });
  if (!shot.result) { console.log(`${name}: capture failed ${JSON.stringify(shot.error)} dims=${JSON.stringify(dims)}`); continue; }
  const file = join(outDir, `${name}.png`);
  writeFileSync(file, Buffer.from(shot.result.data, "base64"));
  console.log(`${file} scrollWidth=${dims.w} (viewport ${W})${dims.w > W ? "  <-- HORIZONTAL OVERFLOW" : ""}`);
  for (const l of logs.splice(0)) console.log(`   ${l}`);
}
ws.close();
chrome.kill();
