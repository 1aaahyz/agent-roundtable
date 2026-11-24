# AGENTS.md — 给 AI 编程助手的本地部署与补全指南

> 本文件是写给 **AI 编程助手**（Claude Code / Cursor / Copilot / Codex / Cline 等）执行的操作手册。
> 人类用户请读 [README.md](./README.md)。
> 你的任务：把本项目在**用户自己的电脑上**跑起来，让用户用自己的模型 API Key 工作，全程不把数据或密钥发到任何第三方服务器。

---

## 0. 完成定义（先看这段，避免做无用功）

只有以下 6 条**全部满足**，才算任务完成。每完成一条在回复里打勾并附证据（命令输出摘要）。

- [ ] `npm run typecheck` 通过，0 error
- [ ] `npm run build` 成功产出生产构建
- [ ] 服务运行在 `http://127.0.0.1:3000`，**监听地址必须是 127.0.0.1**（不能是 0.0.0.0）
- [ ] 用户能登录（`/login`），并能进入 `/workspaces/ws_demo`
- [ ] 初始内容确认只有演示数据（3 个演示 Agent、3 个示例任务、2 个示例产物），无任何他人真实数据
- [ ] 用户配置的模型 API Key **保存在本地且加密**，未出现在任何接口响应、日志或 git 变更中
- [ ] `node scripts/smoke.mjs` 全部通过（除用户主动跳过的外联用例）

**不要做**：不要为了"让测试通过"去放宽鉴权、关掉 SSRF 校验、把密钥写进代码或 `.env.example`、把服务暴露到公网。

---

## 1. 前置检查

```bash
node -v      # 需要 >= 18.18（推荐 20 LTS 或 22）
npm -v
```

若版本过低，先提示用户升级 Node，**不要**自行安装全局 Node 版本管理器去改用户环境。

平台说明：本项目在 Windows / macOS / Linux 均可运行。下面命令用 POSIX 写法；Windows PowerShell 的差异单独标注。

---

## 2. 安装依赖并生成加密密钥

```bash
npm install
```

生成一个 32 字节随机密钥（用于 AES-256-GCM 加密用户填入的 API Key）：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

把输出写入项目根目录的 `.env.local`：

```
CREDENTIAL_SECRET=<上一步的随机串>
AUTH_PASSWORD=<让用户自己定，至少 8 位>
```

- `.env.local` 已被 `.gitignore` 排除，**永远不要**把它提交或复制进 README / 示例文件。
- **必须让用户自己决定密码**，不要用 `demo-2026` 这种默认值直接上线使用。
- `CREDENTIAL_SECRET` 一旦更换，之前加密保存的 Key 无法解密，用户需要重新填写。改之前先告知用户。

---

## 3. 启动

开发模式（热更新，日常使用推荐）：

```bash
npm run dev
```

生产模式（更省资源，改代码后需重新 build）：

```bash
npm run build && npm run start
```

两者都固定绑定 `127.0.0.1:3000`。若用户明确要求局域网访问，才使用 `npm run start:lan`，并**先警告**：同网段任何人都能访问登录页。

**启动前必须检查数据目录**：如果项目里已经存在 `.data/`（常见于用户直接拷贝了别人的整个文件夹，或你自己的上一次测试），里面可能带着**别人的真实数据**。此时先把它移到别处或删除，再启动，确保用户得到的是一个干净实例。

---

## 4. 首次登录与验收

1. 打开 `http://127.0.0.1:3000/login`
2. 邮箱 `demo@agent.local`，密码 = 你写入 `AUTH_PASSWORD` 的值
3. 应跳转到 `/workspaces/ws_demo`，侧栏可见「总览 / 任务 / Agent / 产物 / 审批 / 运行 / 设置」
4. **确认初始内容只有演示数据**：Agent 应为 3 个（调研 Agent、写手 Agent、审校 Agent），任务 3 个（产品发布文章、竞品调研与产品定位、API 文档梳理），产物 2 个。若看到任何真实人名、公司名或业务内容，**立即停止并报告**——那说明数据目录被误拷贝，应先清空 `.data/` 再重新启动。
5. 建议让用户立即改密（`POST /api/v1/auth/password`，需要已登录会话；新密码 ≥ 8 位，改密会吊销其他会话）

**注意**：`AUTH_PASSWORD` 只在 `.data/db.json` 首次生成时写入。若该文件已存在，改环境变量无效——要么删掉数据文件重启（会丢数据），要么走改密接口。

---

## 5. 接入用户自己的模型（这是最关键的一步）

界面路径：`Agent` → `新建 Agent` → 选 **模型 API**。

| 字段 | 填什么 |
|---|---|
| Base URL | 到 `/v1` 或 `/api/v3` 为止，**不要**带 `/chat/completions` |
| 模型 ID | 厂商的模型名或接入点 ID（如 `ep-xxxx`） |
| API Key | 用户自己的密钥，保存后只存密文与指纹，接口不再返回 |

参考配置：

| 厂商 | Base URL | 模型 ID 示例 |
|---|---|---|
| 小米 MiMo | `https://api.xiaomimimo.com/v1` | `mimo-v2.6-flash` |
| 火山方舟（豆包） | `https://ark.cn-beijing.volces.com/api/v3` | `doubao-seed-1-6-251015` 或 `ep-xxx` |
| 任意 OpenAI 兼容服务 | `https://<host>/v1` | 按厂商文档 |

**无 Key 也能先体验**：选「模型 API」时勾选 **「使用本地模拟端点（无密钥自测）」**，走 `local://mock-openai`，回复会明确标注「本地模拟」，不会伪装成真实模型输出。这是演示模式，不产生任何外发请求。

---

## 6. 自检

```bash
npm run typecheck
```

服务运行中时，另开一个终端：

```bash
# POSIX
CREDENTIAL_SECRET=<同 .env.local> AUTH_PASSWORD=<同 .env.local> node scripts/smoke.mjs
```

```powershell
# PowerShell
$env:CREDENTIAL_SECRET="<同 .env.local>"; $env:AUTH_PASSWORD="<同 .env.local>"; node scripts/smoke.mjs
```

预期输出末行为 `结果：N 通过 / 0 失败`。若用户没有配置真实模型 Key，涉及外联的用例本身会跳过或按设计返回失败——这是预期行为，不要为了变绿去改断言。

可选界面检查（需要本机装有 Edge 或 Chromium）：

```bash
node scripts/visual-check.mjs
```

---

## 7. 故障排查

| 现象 | 原因 | 处置 |
|---|---|---|
| 保存 Key 报 503 `SECRET_NOT_CONFIGURED` | 未设 `CREDENTIAL_SECRET` | 按第 2 步写入 `.env.local` 后重启 |
| 调模型返回 **404** | Base URL 填成了批量推理端点（含 `/batch`），或模型 ID 不存在 | 改成官方实时端点；点 Agent 详情页的「测试」，它会先探测 `/models` 并校验模型 ID |
| 调模型返回 401/403 | Key 无效、过期或不属于该端点 | 让用户到厂商控制台重新签发 |
| 登录一直失败 | `AUTH_PASSWORD` 只对首次生成的数据生效 | 见第 4 步说明 |
| 页面 401 后自动跳回 `/login` | 会话过期（7 天）或 Cookie 被清 | 重新登录即可 |
| 端口 3000 被占用 | 上次进程未退出 | 结束旧进程，或改用别的端口（`next start -p 3001 -H 127.0.0.1`） |
| 发消息后 Agent 不回复 | 任务里没有加入 Agent，或没有可用（非 disabled/offline）的 Agent | 先加入 Agent 再加入会话；界面已内置提示 |
| 讨论停止响应 | 达到 `maxRounds`（默认值见任务设置，上限 20） | 由人类提升轮数或直接接管，这是有界讨论的设计 |

---

## 8. 硬性禁止（违反即视为任务失败）

1. **不要**把 `.data/`、`.env.local`、任何密钥、任何截图里的密钥提交到 git。
2. **不要**把服务绑定到 `0.0.0.0` 暴露给公网或公司内网，除非用户书面确认且你已提示风险。
3. **不要**关闭或绕过 `assertSafeEndpoint`（SSRF 防护）、会话校验、产物终态锁定这些约束。
4. **不要**把用户密钥写进代码、日志、README、测试断言或界面提示。
5. **不要**删除 `.data/db.json` 而不先备份（那是用户全部数据）。
6. **不要**引入新的外部 SaaS 依赖（含模型网关、数据库、统计），本项目设计为完全本地自持。

---

## 9. 改代码时的约定

若用户要求你**修改功能**（而不是仅部署），遵守以下约定：

- 改完必须跑 `npm run typecheck` + `npm run build`，并跑第 6 步冒烟。
- 状态机约束集中在 `src/lib/state-machines.ts` 与 `orchestrator.ts`：终态（`succeeded` / `failed` / `cancelled`）不可被改写；新增状态迁移前先确认不会让 Run 从终态复活。
- 所有 SSE 事件经 `src/lib/events.ts` 的 `publish` 发出；`message.created` / `message.delta` **必须携带 `runId`**，否则前端流式气泡无法正确清除（这是历史 bug，别改回去）。
- 前端所有接口调用要有错误提示（`toast`），危险操作要 `confirm`，提交按钮要有 busy 守卫。
- 用户输入进入 `settings` / `task` / `agent` 等对象时**必须走白名单字段赋值**，禁止 `Object.assign` 或直接展开 `req.body`（防原型污染）。
- 不要在前端用 `dangerouslySetInnerHTML` 渲染 Agent 输出；Markdown 走 `react-markdown` + `rehype-sanitize`。

---

## 10. 交付回复模板

完成任务后，用这个结构回复用户：

```
已完成本地部署
- Node / npm 版本：
- 服务地址：http://127.0.0.1:3000（监听 127.0.0.1）
- 登录账号：demo@agent.local（密码为你设定的值）
- typecheck：通过 / build：通过 / smoke：N 通过 0 失败
- 模型接入：<厂商 + 模型 ID>，Key 已加密存储（仅存密文与指纹）
- 未做/需你决定：<例如是否要改密、是否要接入第二个模型>
```
