# CLAUDE.md

本仓库的部署与改造指南统一写在 **[AGENTS.md](./AGENTS.md)**，请先完整读取它再动手。

要点速览（详情以 AGENTS.md 为准）：

- 目标是让用户在**本机**跑起来，服务固定监听 `127.0.0.1:3000`，不得暴露到公网。
- 用户密钥必须经 `CREDENTIAL_SECRET` 加密落盘，禁止写入代码、日志、README 或提交到 git。
- `.data/` 与 `.env.local` 是用户数据与密钥，已被 gitignore 排除，**不要提交，也不要误删**。
- 修改代码后必须跑 `npm run typecheck`、`npm run build` 和 `node scripts/smoke.mjs`。
- 禁止绕过 SSRF 校验、会话鉴权、产物终态锁定这些安全约束。
