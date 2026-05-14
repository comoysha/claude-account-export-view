# claude-account-export-view

本地三栏 Web 浏览器，用来翻看 **Claude Code 桌面端**（Mac/Windows desktop app）导出的历史会话 Markdown 文件。

> ⚠️ **仅适用于 Claude Code 桌面端导出的会话**
>
> 本工具只识别 Claude Code **桌面端**（即 claude.ai 网页/桌面应用的 Cowork、Code 两类会话）通过类似 `claude-old-cli` 等导出工具落地为 Markdown 后的目录结构。
>
> **不适用于** 以下场景：
> - Claude Code CLI（`~/.claude/projects/...` 下的 `.jsonl` 原始会话日志）
> - Anthropic API、Claude.ai 网页版直接复制粘贴的对话
> - 任何不符合下方"目录约定"的 Markdown 集合

---

## 它解决什么问题

切换 Anthropic 账号后，桌面端老账号的 Cowork / Code 会话从 UI 里消失了。如果你已经用导出工具把这些 session 落地成本地 Markdown 文件，本工具给你一个干净的本地 Web 界面来翻、读、全文搜索。

## 目录约定

工具期望的导出目录长这样（每个 source 是一个根目录，下面一层是 project，再下一层是 session 文件）：

```
<source-root>/
  └── <project-name>/
        ├── PROJECT.md                              # 可选，会被跳过
        ├── 2025-04-12 7dd56d2e Some session title.md
        ├── 2025-04-15 a1b2c3d4 Another session.md
        └── ...
```

Session 文件名格式：`YYYY-MM-DD <8位短ID> <标题>.md`。文件内容应为：
- 顶部 `# 标题` + `- **Key**: value` 元数据块，再以 `---` 分隔
- 正文用 `### 👤 用户` / `### 🤖 Claude` 作为发言分段标题
- 工具调用 / 结果可包在 `<details>` 中（会被自动折叠成可展开条带）

## 功能

- 三栏布局：**项目列表** / **会话列表** / **会话详情**
- 多 source 并列（如 `cowork` 和 `code` 两类）
- 全文搜索（命中行内高亮 + 自动滚动到首个命中）
- 工具调用自动折叠为可展开条带，标记调用次数与工具名
- 代码块语法高亮（highlight.js）+ Markdown 渲染（marked）
- 内存缓存扫描结果，点右上 `⟳` 重新扫描

## 安装与运行

依赖：Node.js 18+，仅需一个 npm 包（`express`）。

### 方式 A：一次性使用（前台运行）

```bash
npm install
cp config.example.json config.json
# 编辑 config.json，把 sources 改成你本地导出目录的绝对路径
npm start
```

默认监听 `http://localhost:5273`。如果端口被占，会自动 +1 直到找到空端口（启动日志里有实际 URL）。

### 方式 B：常驻后台（macOS LaunchAgent，开机/登录自启）

仓库自带 `init.sh` 一键安装：

```bash
./init.sh              # 装 + 起（首次会自动生成 config.json 并提示你编辑）
./init.sh status       # 查看当前进程 / 端口 / 最新日志
./init.sh uninstall    # 停服 + 删 plist
```

脚本会：
1. `npm install`
2. 没有 `config.json` 就从 `config.example.json` 复制一份并提示编辑（确认 `sources` 不再是占位路径才会继续）
3. 自动探测 `node` 路径（兼容 Intel `/usr/local/bin/node` 和 Apple Silicon `/opt/homebrew/bin/node`）
4. 生成 `~/Library/LaunchAgents/local.claude-account-export-view.plist`
5. `launchctl bootstrap` 加载，`RunAtLoad=true` + `KeepAlive=true`，崩了自动拉起
6. 日志输出到 `~/Library/Logs/claude-account-export-view/{out,err}.log`

> ⚠️ **仅 macOS**。Linux 用户请改用 systemd user unit；Windows 用户请用 Task Scheduler 或 NSSM。脚本会自动拒绝在非 macOS 上运行。

### 配置

`config.json`（**不要提交到仓库**，已在 `.gitignore` 中）：

```json
{
  "port": 5273,
  "sources": [
    { "name": "cowork", "dir": "/absolute/path/to/export/cowork" },
    { "name": "code",   "dir": "/absolute/path/to/export/code" }
  ]
}
```

也支持命令行覆盖：

```bash
node server.js --port 6000 --dir /path/to/single/source
COWORK_DIR=/path/to/source node server.js
```

## API（仅本地使用）

| Method | Path | 用途 |
|---|---|---|
| GET | `/api/sources` | 列出已配置的 source |
| GET | `/api/projects` | 列出所有项目（`?refresh=1` 强制重扫） |
| GET | `/api/projects/:projectId/sessions` | 列出某项目下所有 session |
| GET | `/api/sessions/:projectId/:sessionId` | 拿到解析后的 session 内容 |
| GET | `/api/search?q=<词>` | 跨所有 source 全文搜索 |

服务**只绑定本地、无鉴权**，请勿暴露到公网。

## 隐私提示

- 你的导出 Markdown 里可能包含敏感对话内容。请勿把数据目录（`config.json` 里的 `sources`）放到公开仓库中。
- 本仓库默认 `.gitignore` 已忽略 `config.json` 与常见 IDE/系统目录。

## License

MIT
