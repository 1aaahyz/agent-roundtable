/**
 * 界面可视检查：桌面 1440 / 1280 与移动 768 三档截图，并收集运行时错误。
 * 用法：node scripts/visual-check.mjs [baseUrl]
 */
import { chromium } from "playwright";
import fs from "node:fs/promises";

const BASE = process.argv[2] ?? "http://127.0.0.1:3000";
const OUT = "screenshots";
await fs.mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ channel: "msedge" });
const errors = [];
const pages = [
  ["overview", "/workspaces/ws_demo", "工作区总览"],
  ["tasks", "/workspaces/ws_demo/tasks", "任务列表"],
  ["task-room", "/workspaces/ws_demo/tasks/task_launch", "任务协作室"],
  ["agents", "/workspaces/ws_demo/agents", "Agent 列表"],
  ["artifact", "/workspaces/ws_demo/artifacts/art_api", "产物详情"],
  ["approvals", "/workspaces/ws_demo/approvals", "审批中心"],
  ["runs", "/workspaces/ws_demo/runs", "执行记录"],
  ["settings", "/workspaces/ws_demo/settings", "设置"],
];

async function shoot(page, name, path, width, height) {
  await page.setViewportSize({ width, height });
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/${name}-${width}.png`, fullPage: false });
  const title = await page.locator("h1").first().textContent().catch(() => "(no h1)");
  console.log(`  ${name} @${width}: ${title?.trim()}`);
}

const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await context.newPage();
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

console.log("截图检查 1440px:");
for (const [name, path] of pages) await shoot(page, name, path, 1440, 900);
console.log("截图检查 1280px:");
await shoot(page, "overview", "/workspaces/ws_demo", 1280, 800);
await shoot(page, "task-room", "/workspaces/ws_demo/tasks/task_launch", 1280, 800);
console.log("截图检查 768px:");
await shoot(page, "overview", "/workspaces/ws_demo", 768, 900);
await shoot(page, "task-room", "/workspaces/ws_demo/tasks/task_launch", 768, 900);
await shoot(page, "approvals", "/workspaces/ws_demo/approvals", 768, 900);

// command palette smoke
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(`${BASE}/workspaces/ws_demo`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(700);
await page.keyboard.press("Control+k");
await page.waitForTimeout(800);
const paletteVisible = await page.getByRole("dialog", { name: "命令面板" }).isVisible().catch(() => false);
console.log(`  Command Palette: ${paletteVisible ? "可见" : "未打开"}`);
await page.screenshot({ path: `${OUT}/command-palette-1440.png` });

// 回归检查：接入向导第 1 步必须有「下一步」，否则用户会卡死在选方式页面
await page.goto(`${BASE}/workspaces/ws_demo/agents/new`, { waitUntil: "domcontentloaded" });
await page.getByRole("button", { name: /Demo Agent/ }).click();
const nextButton = page.getByRole("button", { name: /下一步/ });
const nextVisible = await nextButton.isVisible().catch(() => false);
console.log(`  接入向导「下一步」: ${nextVisible ? "可见" : "缺失"}`);
if (nextVisible) {
  await nextButton.click();
  const saveVisible = await page.getByRole("button", { name: /保存并测试/ }).isVisible().catch(() => false);
  console.log(`  接入向导「保存并测试」: ${saveVisible ? "可见" : "缺失"}`);
  if (!saveVisible) errors.push("wizard: save button missing");
} else {
  errors.push("wizard: next button missing");
}

// 模型 API 接入：无密钥自测选项与模型 ID 默认值
await page.goto(`${BASE}/workspaces/ws_demo/agents/new`, { waitUntil: "domcontentloaded" });
await page.getByRole("button", { name: /模型 API/ }).click();
await page.getByRole("button", { name: /下一步/ }).click();
const modelIdValue = await page.locator("input[placeholder*=\"doubao-seed\"]").inputValue().catch(() => "");
const mockChecked = await page.locator("input[type=checkbox]").first().isChecked().catch(() => false);
console.log(`  模型 API 自测: 模型 ID=${modelIdValue || "缺失"} 本地模拟=${mockChecked ? "默认勾选" : "未勾选"}`);
if (modelIdValue !== "doubao-seed-1-6-251015" || !mockChecked) errors.push("wizard: model_api self-test defaults invalid");

await browser.close();
console.log(`\n运行时错误：${errors.length}`);
errors.slice(0, 20).forEach((e) => console.log(`  - ${e.slice(0, 220)}`));
process.exit(errors.length === 0 && paletteVisible ? 0 : 1);
