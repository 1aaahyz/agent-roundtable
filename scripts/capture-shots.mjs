/**
 * 重新截取全部界面截图。
 * 用法：node scripts/capture-shots.mjs   （需服务运行在 127.0.0.1:3000，且数据为演示种子态）
 * 截图只包含页面内容，不包含浏览器地址栏，因此不会出现本地端口。
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const EMAIL = process.env.AUTH_EMAIL ?? "demo@agent.local";
const PASSWORD = process.env.AUTH_PASSWORD ?? "demo-2026";
const OUT = "screenshots";

const SHOTS = [
  { name: "overview", path: "/workspaces/ws_demo", label: "总览" },
  { name: "tasks", path: "/workspaces/ws_demo/tasks", label: "任务列表" },
  { name: "task-room", path: "/workspaces/ws_demo/tasks/task_launch", label: "协作室" },
  { name: "agents", path: "/workspaces/ws_demo/agents", label: "Agent 列表" },
  { name: "artifact", path: "/workspaces/ws_demo/artifacts/art_api", label: "产物版本" },
  { name: "approvals", path: "/workspaces/ws_demo/approvals", label: "审批中心" },
  { name: "runs", path: "/workspaces/ws_demo/runs", label: "运行记录" },
  { name: "settings", path: "/workspaces/ws_demo/settings", label: "设置" },
];

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: "msedge" });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await context.newPage();

await page.goto(`${BASE}/login`, { waitUntil: "load" });
await page.locator("input[type=password]").fill(PASSWORD);
await page.getByRole("button", { name: "登录" }).click();
await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20000 });
console.log("已登录");

for (const shot of SHOTS) {
  await page.goto(`${BASE}${shot.path}`, { waitUntil: "load" });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/${shot.name}.png` });
  console.log(`  截取 ${shot.label} -> ${OUT}/${shot.name}.png`);
}

// 命令面板（需要真实键盘触发，不能用 URL 直达）
await page.goto(`${BASE}/workspaces/ws_demo`, { waitUntil: "load" });
await page.waitForTimeout(500);
await page.keyboard.press("Control+k");
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/command-palette.png` });
console.log("  截取 命令面板 -> screenshots/command-palette.png");

// 窄屏响应式：协作室
await page.setViewportSize({ width: 768, height: 1024 });
await page.goto(`${BASE}/workspaces/ws_demo/tasks/task_launch`, { waitUntil: "load" });
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/task-room-narrow.png` });
console.log("  截取 窄屏协作室 -> screenshots/task-room-narrow.png");

await browser.close();
console.log("\n全部截图完成");
