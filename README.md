# Todo清单 增强套件 · todo-list-hack

> **有问题 / 想反馈 / 想要定制？加我微信：`PageClear`**（备注：Todo清单）

给 **[Todo清单](https://todo.evestudio.cn/)**（EveStudio / 杭州乾夕科技）做的两个**互相独立**的东西：

| 部件 | 干什么 | 动不动 App 的文件 | 入口 |
|---|---|---|---|
| **① 皮肤补丁** `todo-glass-off/` | 关掉主窗口原生毛玻璃，套一套 macOS 26/27（Tahoe）风格皮肤 | **改**（解包 `app.asar` → 改一行窗口参数 + 追一段 CSS → 重打包、ad-hoc 重签） | [`todo-glass-off/README.md`](todo-glass-off/README.md) |
| **② 命令行 `todoctl`** `cli/` | 查、增、改、完成、删除、子任务、标签、清单、统计、番茄；也能给 AI 助手直接调用 | **不改**（查询读本地文件，写入走 Electron 主进程 `--inspect` 本地接口） | [`cli/README.md`](cli/README.md) |

用哪个都行、也可以都用：**② 不需要改 App，所以和 ① 打完补丁的 App 完全兼容**，App 升级后 ② 也照常能用。

- 官网：<https://todo.evestudio.cn/>（文档里提到"官网"都指这里）
- 适配版本：**Todo清单 4.0.x macOS 桌面版**（Electron 打包，默认安装在 `/Applications/Todo清单.app`；`todoctl` 目前只在 macOS 上实测）
- 不改业务逻辑、不联网、不上传任何数据；与官方无关，属第三方个人修改

---

## 📮 联系方式

| 渠道 | 信息 |
|---|---|
| **微信（最快）** | **`PageClear`** ← 复制搜索，加好友时请备注「Todo清单」 |
| 仓库 | <https://github.com/ivaneye/todo-list-hack> |

---

# 第一部分：皮肤补丁

## 一、为什么需要它

macOS 版客户端基于 Electron，界面在系统层面用了三样东西，在真实使用中会带来三个问题：

| # | 官方实现 | 实际问题 |
|---|---|---|
| 1 | 主窗口开了原生毛玻璃 `vibrancy: "titlebar"` + 透明背景 | 窗口背后只要是深色内容（深色壁纸、其他深色窗口），**整块界面就发灰发脏**，白卡片看起来像蒙了层灰 |
| 2 | 界面沿用旧版设计语言（方角卡片、1px 分割线、灰色外壳） | 与 macOS 26/27 的"大圆角卡片 + 细投影 + 中性灰外壳"不一致，**看起来不像这个系统上的原生应用** |
| 3 | 侧边栏、日期条、日历事件块都是直角/硬边框 | 长时间盯着用眼累，日历区域密密麻麻 |

本工具只解决这三件事，其余一律不动：**不新增功能、不改数据、不改快捷键、不动同步。**

## 二、前后对比

四张图都是同一份界面（**日程概览**，2026 年 11 月），左边官方原版，右边打完补丁。

**亮色主题**

| 官方原版 | 打补丁后 |
|---|---|
| ![亮色·官方原版：方角事件块、硬网格线、灰底平板卡片](docs/images/light-before.png) | ![亮色·打补丁后：14px 圆角卡片、圆角事件块、中性灰外壳](docs/images/light-after.png) |

**暗色主题**

| 官方原版 | 打补丁后 |
|---|---|
| ![暗色·官方原版：近纯黑底、方角事件块、硬网格线](docs/images/dark-before.png) | ![暗色·打补丁后：整体抬亮一级、卡片分层、圆角事件块](docs/images/dark-after.png) |

不用放大也能看出来的差别：

| # | 位置 | 官方原版 | 打补丁后 |
|---|---|---|---|
| 1 | 窗口底色 | 近纯黑（暗）/ 偏灰（亮），且受背后窗口影响发脏 | 实心中性色：亮 `#f4f4f4`、暗 `#2e2e2e`，背后是什么都不影响 |
| 2 | 内容区 | 与外壳同色，一整片平铺 | 独立**白卡片，14px 圆角 + 极淡投影**，与外壳分层（暗色 `#3a3a3a`） |
| 3 | 日历事件块 | 2px 直角块 | **6px 圆角**，同一列不再“糊成一条” |
| 4 | 日历网格线 | 明显的 1px 分隔线，画面碎 | 降到 6%，只留阅读锚点 |
| 5 | 顶部输入框 / 搜索框 | 方角、与背景同色 | 12px 圆角，边界靠底色区分 |
| 6 | 侧边栏选中项 | 通栏直角色块 | 8px 圆角药丸，缩进对齐图标 |
| 7 | 待办列表行 | 每行 1px 分割线 | 去掉分割线，悬停变 10px 圆角药丸（**行高不变**，虚拟滚动不受影响） |
| 8 | 暗色整体 | `#1c1c1c` 近纯黑，对比过强 | 外壳/卡片/输入框/编辑面板统一到同一层，久看不刺眼 |

其余细节：滚动条改细胶囊，按钮 8px 圆角，字体统一 `-apple-system` / SF Pro，明暗两套主题都覆盖。
配色、圆角想自己调？只改 `todo-glass-off/skin.css` 再跑一次脚本即可。

## 三、快速开始

```bash
git clone https://github.com/ivaneye/todo-list-hack.git
cd todo-list-hack/todo-glass-off

./patch.sh          # 打补丁 + 装皮肤（结束自动体检）
```

就这一条命令。它自己会：

1. 找 Node.js；**没有就自动下载安装**（见下节，无需 sudo、不动系统环境）
2. 退出 Todo清单 → 首次运行备份原始 `app.asar` 到 `backup/`
3. 解包 → 关毛玻璃 + 写入皮肤 → 重新打包 → ad-hoc 重签名
4. 断言落盘结果 + 清渲染缓存 + 用调试端口跑一次真实体检（滚轮、圆角、玻璃）
5. 重启应用

其他入口：

```bash
./patch.sh --diag      # 只看当前状态（版本/是否已关玻璃/是否已装皮肤/指纹/备份）
./patch.sh --no-verify # 只打补丁，不跑体检
./verify.sh            # 单独体检
./revert.sh            # 还原官方原版（毛玻璃回来、皮肤去掉）
```

App 不在默认路径：`TODO_APP="/Users/xxx/Applications/Todo清单.app" ./patch.sh`

### 关于 Node.js（按需自动安装）

脚本需要 **Node.js 22+** 来解包 / 重新打包 `app.asar` 和做体检（体检用了全局 `fetch` / `WebSocket`）。
**你不需要提前装**：

- 先找系统里已有的（`PATH`、Homebrew、nvm、`~/.volta` 都会认），**版本够用就直接用，不下载任何东西**；
- 都没有才自动下载官方 Node.js 最新 LTS，**只解压到本目录 `.tools/node`**，并做 sha256 校验；不写系统目录、不需要 sudo、不碰你已有的 node；
- 下载源官方 `nodejs.org` 优先，失败自动切 `npmmirror`；也可手动指定：
  ```bash
  TODO_NODE_MIRROR=https://cdn.npmmirror.com/binaries/node ./patch.sh
  ```
- 不想让它联网安装：`TODO_NO_INSTALL_NODE=1 ./patch.sh`（缺 node 会直接报错并给出手动安装方式）
- `.tools/` 已在 `.gitignore` 里，不会进 git

## 四、目录结构

```
todo-list-hack/
├── README.md                  # 本文件（总览：皮肤 + CLI）
├── docs/images/               # 前后对比截图（亮色/暗色 × 修改前/后）
│
├── todo-glass-off/            # ① 皮肤补丁本体（会改 App 的 app.asar）
│   ├── README.md              #    补丁细节
│   ├── patch.sh               # 主入口：打补丁 + 装皮肤 + 自检
│   ├── revert.sh              # 还原官方原版
│   ├── verify.sh              # 体检（拉起调试端口 → 检查 → 重启）
│   ├── skin.css               # ← 皮肤源码，只改这一个文件
│   ├── lib/
│   │   ├── env.sh             # 公共环境：找 Node.js / 缺了自动装 / App 定位 / 空闲端口
│   │   ├── asar-tool.js       # 无依赖 asar 解包 / 打包 / 差异校验
│   │   ├── bake.js            # 注入窗口参数与皮肤（带皮肤安全检查）
│   │   └── verify.js          # 体检实现（CDP，真实滚轮事件）
│   ├── dev/                   # 调试辅助（CDP 客户端、截图、预览），日常用不到
│   ├── backup/                # 运行时生成：原始 app.asar / 版本 / 皮肤指纹（不进 git）
│   └── .tools/                # 运行时生成：自动安装的 Node.js（不进 git）
│
└── cli/                       # ② 命令行 todoctl（不改 App 任何文件）
    ├── README.md              #    完整命令手册
    ├── todoctl                #    唯一入口（可执行，无第三方依赖）
    ├── BRIDGE-EVALUATION.md   #    设计决策留痕：为什么删掉"桥接/CDP 改包"方案
    ├── skill/SKILL.md         #    给 AI 助手用的 Skill 指令（可直接装进 agent）
    └── lib/
        ├── commands.js        # 所有子命令实现
        ├── filedb.js          # N1 驱动：只读解析 todos.db / 状态备份
        ├── inspect.js         # N2 驱动：CDP 连 Electron 主进程，调 Vuex action
        ├── persist.js         # 可选：登录即带本地接口（写用户自己的启动项）
        ├── platform.js        # App 定位 / 数据目录 / 平台差异
        ├── prelude.js         # 注入到主进程里跑的脚本
        └── sqlite-dump.js     # 无依赖读取 SQLite 文件
```

## 五、它到底改了什么

| 位置 | 改动 | 量级 |
|---|---|---|
| `app.asar → background.js` | macOS 分支窗口选项 `{backgroundColor:"#00000000", vibrancy:"titlebar", visualEffectState:"followWindow"}` → `{backgroundColor: 亮色/暗色实色}` | **一行** |
| `app.asar → css/index.*.css` | 末尾追加 `skin.css`，用 `/* @macos-skin start */ … end` 包裹 | 一段 CSS |

一次完整流程的安全性设计：

- **失败即中止**：解包/检查/打包任何一步失败都在**替换前**退出，不会留下半个包
- **皮肤安全检查**：`bake.js` 会拦下两类已知会把 App 改坏写法的 CSS
  （给滚动容器加 `overflow:hidden` → 滚轮失效；改待办行竖向 margin/height → 虚拟滚动错位）
- **安装后断言**：确认落盘 asar 里「没有 vibrancy、有皮肤标记、体积正常」，不满足直接报错
- **原版备份**：首次运行把官方 `app.asar` 复制到 `backup/`（含版本号），`revert.sh` 靠它还原本机
- **清渲染缓存**：CSS 文件名不变，不清 Chromium 磁盘缓存可能看不到新样式

## 六、风险与免责（请先看）

1. **改了官方 App 包**：会 ad-hoc 重新签名，因此
   - 应用内**自动更新可能失败或被覆盖** → 升级后重跑 `./patch.sh` 即可；
   - 首次启动可能要重新允许**通知 / 日历**等系统权限；
   - 若被 Gatekeeper 拦：系统设置 → 隐私与安全性 → 「仍要打开」。
2. **官方升级后**：重跑 `./patch.sh`；版本结构变大了（找不到目标代码）脚本会**明确提示并中止**，不会打包出坏应用。
3. **皮肤依赖类名**：`.todo-page-surface`、`.todo-list-item` 等是这版前端的语义类。官方改名则对应规则**静默失效退回原样**（不会白屏），`./patch.sh --diag` 能看出来。
4. **合规**：本仓库**不含**官方任何二进制（`backup/` 里的 `app.asar` 是从你自己机器上备份的，已排除在 git 之外）。请自行评估使用风险；如果你是该应用作者且不希望此类修改存在，联系我即删。
5. **恢复官方**：`./revert.sh`，或删掉 App 从[官网](https://todo.evestudio.cn/)重新下载安装。

## 七、常见问题（皮肤）

| 现象 | 原因 / 处理 |
|---|---|
| 打完还是原本的样子 | `./patch.sh --diag` 看「含皮肤标记」：否 = 没打进去（多半跑的是另一份脚本副本）；是但仍没变化 = 缓存，`./verify.sh` 再重启一次 |
| 圆角有但滚轮失灵 | 皮肤给滚动容器加了 `overflow:hidden`，`bake.js` 已内置拦截；改完 `skin.css` 重跑 |
| 列表滚错位 | 给 `.todo-list-item` 改了竖向 margin/padding（虚拟列表按行高算），已内置拦截 |
| 体检连不上调试端口 | 已改为**自动挑空闲端口**；若 App 启动时本身带了调试参数，脚本会读 `DevToolsActivePort` 校正 |
| 想换配色 | 只改 `skin.css` 顶部两处 `background`，再 `./patch.sh`（按文件指纹判断要不要重烘） |
| App 升级后没皮肤了 | 正常，重跑 `./patch.sh`（会自动重新备份新版本原始包） |

---

# 第二部分：命令行 / 对话式管理待办（todoctl）

`cli/todoctl` 用一条命令管理 Todo清单 里的待办：查、增、改、完成、删除、恢复、子任务、标签、
清单、统计、番茄。输出默认是 **JSON**，因此也适合直接交给脚本或 AI 助手执行。

```
你说人话                    todoctl 选驱动                       落点
「今天还剩什么」 ──► N1 文件只读 ─────────────────► todos.db + critical-state-backup.json（App 不用开）
「完成复盘」     ──► N2 主进程接口 ────────────────► store.dispatch('todo/updateTodo')
                      (必要时自动带 --inspect 启动)     ↓
                                              App 自己写本地库 + 云同步 + 刷新界面
```

**它不改 App 的任何文件**：不解包 asar、不重签名，所以

- 和第一部分的皮肤补丁**互不影响**，App 升级后 CLI 也不会失效；
- `todoctl app quit` 后就是"什么都没有"的干净状态，不会留常开端口。

## 八、为什么不直接改数据库

`todoctl` 调的是 **App 自己的 Vuex action/mutation**，和你用鼠标点按钮走同一条代码路径。
taskId 生成、`task_sort` 排序、软删除（进回收站）、`status/version`、子任务格式、云同步队列
全交给 App 处理，所以不会和 App 的内存状态、云同步打架。

> 设计上也评估过"往 asar 里注入 HTTP 服务 / 走 Chrome 调试端口"的方案，最终都删掉了——
> 需要改包 + 重签、App 升级即失效、还等于给本机任意进程开了调试口。留痕见
> [`cli/BRIDGE-EVALUATION.md`](cli/BRIDGE-EVALUATION.md)。

## 九、安装：不需要

```bash
cd todo-list-hack/cli

./todoctl app status    # 平台 / App 路径 / 数据目录 / 是否运行 / 接口端口 / 文件时间
./todoctl list          # 今天未完成
```

- **查询开箱即用**：直接读 App 自己的两个文件，App 不用运行、不需要端口。
- **写入自动处理**：需要时由 `todoctl` 带 `--inspect` 启动 App（已在运行则优雅重启一次，约 3 秒），
  调完就结束。App 文件一个字节都不改。
- 唯一前置：**Node.js ≥ 22.12**（用了内置 `node:sqlite`、全局 `fetch` / `WebSocket`），**没有 npm 依赖**。
  没装的话先跑一次第一部分的 `todo-glass-off/patch.sh`，它会自动装到 `.tools/node`，再加进 `PATH` 即可。

```bash
./todoctl app start     # 带本地接口启动（已在运行则不动）
./todoctl app restart   # 主动重启并开接口
./todoctl app quit      # 退出，恢复"没有接口"的干净状态
```

> 接口只绑 `127.0.0.1:9331`（`--port` / `TODO_INSPECT_PORT` 可改）。本机任意进程本来就能读
> 你的数据目录（含云同步 token），所以这是"同等级信任"；不想开就用 `app quit`，
> 或对写命令加 `--no-restart` 直接拒绝。

**可选：登录即带接口**（消掉首次写入前的那一次重启，2~3 秒）：`./todoctl app persist on|off|status`
——只写**你自己的**启动项（macOS LaunchAgent / Windows Run 键 / Linux autostart），不动 App。
App 设置里的「开机自启」需先关掉，否则两个启动源会抢（`persist status` 会报 `appAutostart`）。

## 十、常用命令

> **归属规则（写待办必读）**：`分组(folder) → 清单(cat) → 待办`。所有待办都挂在**清单**上，
> 因此 `add` / `edit` 的 `--cat` 必须是清单名：
> · 写分组名 → 直接报错并列出该分组下的清单；· 名称匹配多个 → 报错列候选；
> · 不写 `--cat` → 落到「未分类」（返回 `hint` 提醒）。
> 只读筛选例外：`list --cat <分组名>` 会展开为该分组下所有清单。

```bash
# 查询
./todoctl list                       # 今天未完成
./todoctl list --all                 # 全部未完成
./todoctl list --date tomorrow|2026-11-15|none|all
./todoctl list --done                # 今天已完成
./todoctl list --cat 研发管理 --tag 二宝 --search 复盘 --limit 20
./todoctl show 复盘                  # 单条详情（含原始 standby* 字段）
./todoctl overdue                    # 逾期未完成
./todoctl trash                      # 回收站
./todoctl search 关键词               # 全局搜索（含已完成）

# 新增 / 修改
./todoctl add "写周报" --cat 汇报与述职 --date tomorrow
./todoctl add "站会" --repeat week --count 12 --remind 09:30   # 周期任务：展开成多条
./todoctl add "重构支付" --desc "先梳理依赖" --sub "画流程图;改代码" --difficulty 中等
./todoctl remind 复盘 09:30          # 设置提醒；--off 取消
./todoctl repeats                    # 重复组列表；repeat rm <目标> --yes 删整组
./todoctl edit 写周报 --content "写周报（周更）" --date 2026-11-15 --cat 研发管理
./todoctl edit 写周报 --sub "a;x:b"   # x: 前缀表示该子任务已完成

# 状态
./todoctl done 复盘 / ./todoctl undone 复盘
./todoctl rm 复盘                    # → 回收站（软删除，会同步）
./todoctl restore 复盘               # 从回收站恢复
./todoctl rm 复盘 --purge            # 彻底删除（不可撤销）
./todoctl top 复盘 / ./todoctl bottom 复盘

# 子任务 / 清单 / 标签
./todoctl subs 本体可视化             # 列出子任务与进度
./todoctl sub 本体可视化 okf-instance # 勾选（--undone 取消）
./todoctl folders                    # 分组树（分组 → 清单 → 未完成数）
./todoctl cat add 新清单 --color "#4f9cf9" --folder 工作
./todoctl cat move 清单名 --to 分组名|none
./todoctl tags                       # 标签统计（标签=内容里的 #@名字）
./todoctl tag 复盘 --add 工作 --del 旧标签

# 统计 / 番茄 / 设置 / 底层
./todoctl stats / ./todoctl tomato / ./todoctl settings
./todoctl raw 'window.vuexStore.state.todo.todoList.length'
./todoctl app status|start|restart|quit
```

目标（`<待办>`）支持 **taskId 前缀** 或 **内容关键词**，匹配多条会列出候选让你选；
`--table` 输出表格，`--all` 对 `done/undone/rm/remind/edit/restore` 批量执行。
**完整命令手册见 [`cli/README.md`](cli/README.md)**（含能力覆盖表、数据模型、限制说明）。

## 十一、给 AI 助手用

`cli/skill/SKILL.md` 是这个 CLI 的 Skill 说明（人设 + 处置契约 + 命令白名单），可以直接装进
支持 skill 的 agent：

```bash
cp -r todo-list-hack/cli/skill ~/.pi/agent/skills/todo-list    # 目录名随意，能被 agent 扫到即可
# 然后把 SKILL.md 里的 TDL 改成本仓库 cli/ 的实际路径，或 export TODOLIST_CLI_DIR=/path/to/cli
```

装好之后说「今天还剩什么」「把复盘标完成」「加个明天上午的体检，放到身体这个清单」就行。
关键约定（也是给 AI 的硬规则）：**写入必须走 `todoctl`，任何情况下都不要直接写 `todos.db`**；
新建待办先确认「分组 → 清单」归属；用户说"别动我的 App"就加 `--no-restart`，不要自己绕过。

## 十二、CLI 注意

- **查询不依赖 App**（直接读文件）；**写入会自动启动 App**（带 `--inspect`，已在运行则优雅重启一次）。
- 重新跑皮肤脚本（`todo-glass-off/patch.sh` / `revert.sh`）与本 CLI 无关，不影响接口。
- 云同步由 App 自己完成；命令默认会等一次同步（最长 4 秒，失败不影响本地结果）。
- `rm --purge`、`trash --clear --yes` 不可撤销。
- 大输出已做分片读取（Electron 单条消息有 64KB 左右限制），`list --all` 5000+ 条也能完整返回。

---

# 附：维护者备忘（踩过的坑）

| 坑 | 现象 | 正确做法 |
|---|---|---|
| 给 `.todo-page-surface` 加 `overflow:hidden` | 待办列表滚轮完全失灵 | 用 `clip-path: inset(0 round 14px)` |
| 给 `.todo-list-item` 加竖向 margin/padding | 虚拟列表高度算错、滚动错位 | 只允许水平 `margin: 0 6px` |
| 原地改 CSS 但文件名不变 | 命中 Chromium 磁盘缓存，样式不生效 | 装完清 `Cache` / `Code Cache`（已内置） |
| macOS 自带 bash 是 3.2 | `$VAR` 紧跟全角括号（如 `$X）`）→ `unbound variable` 中途退出，出现"半套补丁" | 一律写 `${VAR}` |
| macOS 12+ 不带 `python3` | 老版本注入脚本在干净机器上直接失败 | 现在只用 Node（`lib/asar-tool.js`），字节级原样往返 |
| 体检硬编码 9222 | 端口被 VS Code 等占用就连不上 | 自动挑空闲端口 + 读 `DevToolsActivePort` 校正 |
| 用两份脚本副本 | 一份装了一套，另一份又覆盖 | 只在同一目录维护，装完看「安装后断言」 |
| CLI 直接写 `todos.db` | App 内存状态 / 云同步冲突，出现"幽灵待办"或改完又变回来 | 只读可以读文件；写一律走 App 的 Vuex action |

---

**联系我**：微信 `PageClear`（备注「Todo清单」）。

**License**：脚本、皮肤与 CLI（本仓库代码）MIT。修改的是你本机安装的 App，官方应用版权归 EveStudio 所有。
