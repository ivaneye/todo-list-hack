# 发布评估：CLI 需要「桥接」吗？还有别的模式吗？

> **最终结论（已实施）**：只保留 **N1 文件只读 + N2 主进程 inspect** 两个驱动。
> 本文里的「模式 A（CDP）」「模式 B（asar 注入 HTTP）」**已从 CLI 中删除**，
> 文件仅作决策留痕；`bridge.sh` 与 `lib/cdp.js` 均已移除。

> 结论先说：**能让用户零安装也能用的只有"只读模式"；要写数据，跨进程总要有一条通道。**
> 现有 CDP 桥接在功能上够用，但对「发布给别人用」不够友好，建议改成**注入式本地 HTTP 服务**，
> 并按「只读（零改动）→ 完整（一键安装）」分层发布。

---

## v2（实测后修订，2026-11）：最终落地为「N1 文件只读 + N2 主进程 inspect」

对 App 4.0.3（Electron 43.4.0 / Node 24.18.1）实测后，下面几条结论需要更新：

| 原判断 | 实测结果 |
|---|---|
| 只读层"分类只能显示 id" | ❌ 已过时。`critical-state-backup.json` 是 **明文 Vuex 镜像**（electron-store，状态变更 500ms 落盘），含 `categoryState`（**含分组**）、`settingsState`、`tomatoState`、`sidebarState`。**全部查询命令都能覆盖** |
| 要让 App 执行写操作，必须改 asar（模式 A/B） | ❌ 已过时。**主进程 `--inspect` 可用**：`open -a Todo清单 --args --inspect=127.0.0.1:9331` → 主进程 `Runtime.evaluate` → `require('electron')` → 主窗口 `webContents.executeJavaScript` → `window.vuexStore`。**不改任何文件、不重签、App 升级不失效** |
| — | `NODE_OPTIONS=--require` 注入被 Electron 封（`Most NODE_OPTIONs are not supported in packaged apps`），所以"零改动注入"只有 inspect 一条 |
| — | App 是 **ad-hoc 签名**，asar 完整性校验未生效（补丁态可正常运行）；`app-update.yml` 指向 `updatetodo.evestudio.cn`，升级会覆盖 asar 补丁 |

最终形态：

```
查询 ──► N1 文件只读      todos.db（明文 SQLite）+ critical-state-backup.json
                          App 不用开 · 无端口 · 无安装 · 三平台通用
写入 ──► N2 主进程 inspect  端口没开就自动 --inspect 启动；App 在跑但没开则优雅重启一次

（模式 A / B 已删除：CDP 补丁与 asar 注入都不再需要）
```

### 跨平台（N1/N2 都是三平台通用）

App 是同一个 Electron 应用，**两个数据文件在三平台结构完全一致**，只是基目录不同：

| | userData | 启动方式 |
|---|---|---|
| macOS | `~/Library/Application Support/todo-list` | `open -a Todo清单.app --args --inspect=...` |
| Windows | `%APPDATA%\todo-list` | `Todo清单.exe --inspect=127.0.0.1:9300` |
| Linux | `~/.config/todo-list` | 可执行文件 + 同上参数 |

已知差异：

- `todos.db` 三平台都是**明文** SQLite（主进程 `better-sqlite3-multiple-ciphers` 打开但不设 key），`task.db` 加密但内容已在 JSON 镜像里，无需解密。
- Windows 不自带 `sqlite3` 命令 → 统一用 `node:sqlite`（要求 Node ≥ 22.12，App 自身 engines 也是这个版本）。
- Windows / Linux 的 `--inspect` 取决于官方构建是否关闭该 fuse；macOS 版本已实测可用，其他平台首次运行需验证（失败时自动降级为"只读可用、写命令报错提示"）。
- App 安装位置在 Windows 需要探测（`%LOCALAPPDATA%\Programs`、`%ProgramFiles%`、`PATH`），可用 `TODO_APP=` 指定；数据目录可用 `TODO_USERDATA=` 指定。

---

## 一、为什么必须有"通道"

Todo清单 的数据在两个地方：

| 位置 | 内容 | 可得性 |
|---|---|---|
| `~/Library/Application Support/todo-list/todos.db` | 全部待办（明文 SQLite） | 直接可读 |
| 同上 `task.db` | 分类/设置/标签关系等 | **加密（SQLCipher）**，只能通过 App 自身读 |
| 云端 | 账号、同步、报表 | 私有 HTTP API（带用户 token） |

而"写"这件事更麻烦：App 在内存里维护一整份 store，写库后还要排队云同步、更新界面。
直接改 SQLite 会造成内存/云同步/界面三边不一致（这正是本 CLI 一开始就不写库的原因）。

所以"写"只有三条路：**让 App 自己执行**（通道注入）、**模拟界面操作**、**逆向官方 API**。

---

## 二、四种模式对比

### 模式 A：CDP 桥接（当前实现）

在 `background.js` 里塞一行 `app.commandLine.appendSwitch('remote-debugging-port','0')`，
CLI 通过 WebSocket 连到主窗口，在渲染进程里执行 JS，调 App 自己的 Vuex action。

| 优点 | 缺点 |
|---|---|
| 零业务代码，直接复用 App 全部内部能力 | 打开的是 **Chrome 调试端口**，本机任意进程都能连（等于任意进程可读写你的待办） |
| 实现最简单 | 用户心理上"开了调试端口"= 不安全，发布时很难解释 |
| 调试方便（可看 DOM/store） | 单条消息 ~64KB 限制（已分片解决） |
| | Electron 大版本变化可能影响 CDP 行为 |
| | 每次 App 升级/重打包 asar 都要重装 |

**评价**：适合"开发者自用/排障兜底"，不适合作为发布默认形态。

### 模式 B：注入式本地 HTTP 服务（推荐）

同样是改 `app.asar`，但注入的是自己写的一小段主进程模块：

```
background.js  →  require('./bridge/server.js')   // ~200 行
server.js      →  http.listen(127.0.0.1, 随机端口)
                    收到请求 → 主窗口 webContents.executeJavaScript('...放到渲染进程跑...')
                    端口 + 随机 token 写进 ~/Library/Application Support/todo-list/cli-bridge.json
```

关键点：**App 自己就是这么干的**（`get-settings`、`get-category-list` 都是主进程向渲染进程
`executeJavaScript` 取值），我们只是复用这条既有通路。

| 优点 | 缺点 |
|---|---|
| 不暴露调试端口，只暴露一个我们自己定义的窄接口 | 仍然要改 asar + 重签名（和皮肤补丁同一套流程） |
| 协议稳定、可带 token 鉴权、可白名单命令 | 需要维护 ~200 行注入模块 |
| CLI 侧可退化成"curl 一句话"，任何语言都能接 | 注入失败要能优雅降级（回退到只读） |
| 对 App 版本变化更鲁棒（只依赖 `executeJavaScript`） | |

**评价**：最适合发布。用户只需要跑一次安装脚本（可以和皮肤补丁合并成"一键美化 + 开启 CLI"）。

### 模式 C：只读模式（零改动）

不改 App，直接读明文 `todos.db`（只读打开）。

| 覆盖 | 不覆盖 |
|---|---|
| `list / show / search / overdue / stats / tags / export`（今天做了什么、还剩什么、导出） | 一切写操作（新增/完成/删除/改期/子任务/分类/设置） |
| 不需要安装、不需要端口、App 都不用开 | 分类名/设置项在加密库，只能显示 id（可回退成"未分类"） |

**评价**：发布包的"开箱能力"。用户第一句话就能用（"今天还剩什么"），想要写再装桥接。

### 模式 D：不推荐

| 方案 | 问题 |
|---|---|
| 直接写 `todos.db` | 与 App 内存、云同步、UI 三边冲突；版本升级字段变化就坏 |
| AppleScript / 坐标点界面 | 窗口一变就崩；无法批量、拿不到 ID |
| 逆向官方 HTTP API + 用户 token | 私有接口、随时变、可能违反服务条款 |
| 让用户复制粘贴 JSON 再由 App 导入 | 体验差，App 也没有导入功能 |

---

## 三、推荐发布形态

```
            ┌──────────────────────────────┐
零安装  ──► │ L0 只读驱动（sqlite, ~150 行）│  list/show/search/stats/export
            └──────────────────────────────┘
一键安装 ──► ┌──────────────────────────────┐
（含皮肤）   │ L1 HTTP 桥接驱动（~260 行）   │  全部命令
            └──────────────────────────────┘
开发者   ──► ┌──────────────────────────────┐
            │ L2 CDP 驱动（已有）           │  排障 / 桥接不可用时兜底
            └──────────────────────────────┘
```

实现上把 CLI 的"执行层"抽成 driver：

```js
// lib/driver/{cdp,http,sqlite}.js
{ probe() → 是否可用, run(command) → JSON }
```

- `cdp.js`：现有实现，保留
- `http.js`：`fetch('http://127.0.0.1:PORT/rpc', {token, cmd})`，~60 行
- `sqlite.js`：`sqlite3 -readonly` 或 `node:sqlite`（Node 22 自带实验 API）读 `todos.db`，~150 行
- `todoctl` 启动时按 `CDP → HTTP → SQLite(只读)` 顺序探测，写命令在只读模式直接提示"需要安装桥接"

## 四、成本与风险

| 项 | 估算 |
|---|---|
| HTTP 桥接注入模块 + 主进程打包 | 0.5～1 天（含 token、白名单、错误码） |
| CLI driver 抽象 + sqlite 只读 | 0.5 天 |
| 安装脚本合并（皮肤 + 桥接一次签名） | 半天 |
| 风险 | 与现有皮肤补丁相同：改 asar + ad-hoc 重签名 → 应用内自动更新失效，升级后需重跑安装脚本 |
| 维护 | App 改字段/接口时只需改 driver 里的命令实现，注入层几乎不用动 |

## 五、给用户的话术（发布时）

- 「只读功能开箱即用，不改你的 App」
- 「想让我帮你**改**待办，需要运行一次安装脚本（会重新签名，升级 App 后要再跑一次）」
- 「安装后只监听 127.0.0.1，需要 token 文件，卸载用 `--uninstall`」
- 「随时 `revert` 回到官方原版」

---

## 附：当前已实现 vs 模式依赖

| CLI 命令 | 只读(SQLite) | HTTP 桥接 | CDP |
|---|---|---|---|
| list / show / search / overdue / stats / export | ✅ | ✅ | ✅ |
| tags / cats（分类名来自加密库） | ⚠️ 仅 id | ✅ | ✅ |
| add / edit / done / rm / restore / sub / tag | ❌ | ✅ | ✅ |
| cat / folder / settings / report / notify / repeat | ❌ | ✅ | ✅ |
