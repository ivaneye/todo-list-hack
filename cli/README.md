# todoctl —— Todo清单 命令行 / 对话式操作

> 本目录是 [todo-list-hack](../README.md) 的 **②**：不改 App 任何文件的 CLI。
> 皮肤补丁是 **①** `../todo-glass-off/`，两者互不影响。

用一条命令管理 Todo清单 里的待办：查、增、改、完成、删除、恢复、子任务、标签、清单、
统计、番茄。也给 AI 助手用（JSON 输出），可以说人话让它执行。

```
你说人话                    todoctl 选驱动                       落点
「今天还剩什么」 ──► N1 文件只读 ─────────────────► todos.db + critical-state-backup.json（App 不用开）
「完成复盘」     ──► N2 主进程接口 ────────────────► store.dispatch('todo/updateTodo')
                      (必要时自动带 --inspect 启动)     ↓
                                              App 自己写本地库 + 云同步 + 刷新界面
```

**为什么不是直接改数据库**：`todoctl` 调的是 App 自己的 Vuex action/mutation，和你用鼠标点
按钮走同一条代码路径。taskId 生成、`task_sort` 排序、软删除（进回收站）、`status/version`、
子任务格式、云同步队列全交给 App 处理，所以不会和 App 的内存状态、云同步打架。

---

## 一、安装：不需要

前置只有一条：**Node.js ≥ 22.12**（用到内置 `node:sqlite` 与全局 `fetch` / `WebSocket`）。
检查：

```bash
node -v      # 需要 v22.12 以上
```

没有 node？先跑一次 `../todo-glass-off/patch.sh`（会自动装到 `.tools/node`），或自己装一个 LTS。
本 CLI **没有 npm 依赖**，不装包、不建 `node_modules`。

```bash
./todoctl app status    # 平台 / App 路径 / 数据目录 / 是否运行 / 接口端口 / 文件时间
```

**查询开箱即用**：直接读 App 自己的两个文件，App 不用运行、不需要端口、不改 App。
**写入自动处理**：需要时由 `todoctl` 带 `--inspect` 启动 App（已在运行则优雅重启一次，约 3 秒），
调完就结束。App 文件一个字节都不改，**App 升级不会失效**。

```bash
./todoctl app start     # 带本地接口启动（已在运行则不动）
./todoctl app restart   # 主动重启并开接口
./todoctl app quit      # 退出，恢复"没有接口"的干净状态
```

> 旧方案（改 asar 打开 Chrome 调试端口 + 重签名）**已删除**：能力被 N2 完全覆盖，还多了
> "改我 App / 升级失效 / 开着调试口" 三个问题。现在 CLI 里没有任何改 App 文件的代码。

> 接口只绑 `127.0.0.1:9331`（`--port` / `TODO_INSPECT_PORT` 可改）。本机任意进程本来就能读
> 你的数据目录（含云同步 token），所以这是"同等级信任"；不想开就用 `app quit`，
> 或对写命令加 `--no-restart` 直接拒绝。

### 可选：登录即带接口（`app persist`）

按需模式的唯一摩擦是：你自己启动 App 后的**第一次写**要重启一次（2~3 秒）。
想消掉它，就让 App 每次登录都带 `--inspect` 启动：

```bash
./todoctl app persist status   # 看状态（是否装了、是否 loaded、App 自己的开机自启是否冲突）
./todoctl app persist on       # 装启动项（不动 App，只写你自己的启动配置）
./todoctl app persist off      # 移除
```

| 系统 | 写在哪里 |
|---|---|
| macOS | `~/Library/LaunchAgents/cn.eve.todolist.agent.plist`（`launchctl bootstrap`） |
| Windows | 注册表 `HKCU\…\CurrentVersion\Run` 的值 `Todo清单Agent` |
| Linux | `~/.config/autostart/todo-agent.desktop` |

只写用户自己的启动项，**不改 App 任何文件**；`off` 就是删掉它。
注意：App 设置里的「开机自启」要先关掉，否则两个启动源会抢（`persist status` 会报 `appAutostart`）。

## 二、命令

> **归属规则（写待办必读）**：`分组(folder) → 清单(cat) → 待办`。所有待办都挂在**清单**上，
> 清单再归属分组，因此 `add` / `edit` 的 `--cat` 必须是清单名：
> · 写分组名 → 直接报错并列出该分组下的清单；· 名称匹配多个 → 报错列候选；
> · 不写 `--cat` → 落到「未分类」（返回 `hint` 提醒）。
> 只读筛选例外：`list --cat <分组名>` 会展开为该分组下所有清单。
> 接口输出里 `cat` = 清单名、`folder` = 所属分组。

```bash
# 查询
./todoctl list                       # 今天未完成
./todoctl list --all                 # 全部未完成
./todoctl list --date tomorrow|2026-11-15|none|all
./todoctl list --done                # 今天已完成
./todoctl list --with-done           # 含已完成
./todoctl list --cat 研发管理 --tag 二宝 --search 复盘 --limit 20   # --cat 也可写分组名，自动展开为该分组下所有清单
./todoctl show 复盘                  # 单条详情（含原始 standby* 字段）
./todoctl overdue                    # 逾期未完成
./todoctl trash                      # 回收站
./todoctl search 关键词               # 全局搜索（含已完成）

# 新增 / 修改
./todoctl add "写周报" --cat 汇报与述职 --date tomorrow   # --cat 必须写清单名（写分组名会报错）
./todoctl add "站会" --repeat week --count 12 --remind 09:30   # 周期任务：展开成多条
./todoctl add "吃药" --repeat day:1 --until 2026-12-31
./todoctl remind 复盘 09:30          # 设置提醒；--off 取消；--date 指定日期
./todoctl repeats                    # 重复组列表（条数 / 未完成 / 起止）
./todoctl repeat rm <目标> [--yes]    # 删除整个重复组（先预览，--yes 才执行）
./todoctl add "重构支付" --desc "先梳理依赖" --sub "画流程图;改代码" --difficulty 中等
./todoctl add "体检" --date 2026-12-01 --remind 09:30 --tag 健康
./todoctl edit 写周报 --content "写周报（周更）" --date 2026-11-15 --cat 研发管理 --difficulty 较高
./todoctl edit 写周报 --sub "a;x:b"          # x: 前缀表示该子任务已完成

# 状态
./todoctl done 复盘 / ./todoctl undone 复盘
./todoctl rm 复盘                    # → 回收站（软删除，会同步）
./todoctl restore 复盘               # 从回收站恢复
./todoctl rm 复盘 --purge            # 彻底删除（仅回收站内；不可撤销）
./todoctl trash --clear --yes        # 清空回收站
./todoctl top 复盘 / ./todoctl bottom 复盘

# 子任务
./todoctl subs 本体可视化             # 列出子任务与进度
./todoctl sub 本体可视化 okf-instance # 勾选（--undone 取消）

# 清单 / 标签
./todoctl folders                    # 分组树（分组 → 清单 → 未完成数）
./todoctl folder add 新分组 --color "#4f9cf9"
./todoctl folder rename 旧名 新名
./todoctl folder rm 分组名             # 分组内必须没有清单
./todoctl cat move 清单名 --to 分组名|none   # 清单移进/移出分组
./todoctl cats                       # 清单列表（含未完成数、所属分组）
./todoctl cat add 新清单 --color "#4f9cf9" --folder 工作
./todoctl cat rename 旧名 新名
./todoctl cat rm 清单名
./todoctl tags                       # 标签统计（标签=内容里的 #@名字）
./todoctl tag 复盘 --add 工作 --del 旧标签

# 统计 / 番茄 / 设置
./todoctl stats
./todoctl tomato
./todoctl settings [key]

# 底层
./todoctl raw 'window.vuexStore.state.todo.todoList.length'
./todoctl app status|start|restart|quit
```

所有命令默认输出 **JSON**（便于脚本/Agent），`--table` 输出表格。
目标（`<待办>`）支持 **taskId 前缀** 或 **内容关键词**；匹配多条会列出候选让你选。

## 三、功能覆盖情况

| App 功能 | CLI | 说明 |
|---|---|---|
| 待办增删改查 | ✅ | list / add / edit / show / search |
| 完成 / 取消完成 | ✅ | done / undone |
| 日期（含无日期、待办箱） | ✅ | `--date today|tomorrow|YYYY-MM-DD|none` |
| 清单分类（含分组） | ✅ | cats / cat add / rename / rm |
| 子任务 | ✅ | subs / sub / `--sub`（`x:` 表示已完成） |
| 标签 | ✅ | 标签是内容里的 `#@名字`；tags / tag --add --del |
| 描述 | ✅ | `--desc` |
| 难度（工作量） | ✅ | `--difficulty 一般|中等|较高`（2/5/9） |
| 提醒时间 | ✅ | add `--remind HH:mm`；已有待办用 `remind <目标> HH:mm`（`--off` 取消，`--all` 整组） |
| 置顶 / 置底 | ✅ | top / bottom |
| 回收站 | ✅ | trash / restore / `rm --purge` / `trash --clear` |
| 统计概览 | ✅ | `stats` 本地统计；`report yesterday｜week｜tomato` 调 App 云端报表 |
| 导出 | ✅ | `export --format csv｜json --out 文件`；`export --xlsx` 走 App 自带的 xlsx 导出（弹保存框） |
| 系统通知 | ✅ | `notify "标题" "正文"`（走 App 的通知通道） |
| 批量操作 | ✅ | `done/undone/rm/remind/edit/restore ... --all` |
| 昨日顺延 | ✅ | `carry`（把昨天未完成挪到今天，`--from/--date` 可改） |
| 番茄钟 | 只读 | `tomato`（状态、今日次数、最近记录）；启停依赖界面计时器，未接入 |
| 设置 | ✅ | `settings` / `settings set 键 值`（写 store + localStorage；主题会同步主进程） |
| 重复待办 | ✅ 展开式 | `add --repeat day|week|month|year[:间隔] --count/--until`。<br>App 本身也是把周期任务**展开成多条**（同 `standbyStr1` 分组），没有服务端规则；本 CLI 同机制，但**不做周末/节假日跳过**（App 界面里的"跳过周末/法定节假日"选项未接入）。`repeats` 看所有重复组，`repeat rm --yes` 删整组 |
| 附件 / 图片 | ❌ | 走文件上传（mpAPI + 七牛），未接入 |
| 日历视图 / 拖拽排序 | ❌ | 纯 UI 交互，无对应 store 接口 |
| 登录 / 多设备 | ❌ | 属于认证流程，不做 |

需要覆盖面之外的能力时用 `./todoctl raw '<js>'` 直接读 store（只读用）。

## 四、数据模型备忘（来自 App 自身实现）

| store 字段 | DB 列 | 说明 |
|---|---|---|
| `taskId` | `task_id` | `tid_<userId>xxxx_<ms>` |
| `taskContent` | `task_content` | 标签 `#@name` 就写在这里 |
| `todoTime` | `todo_time` | 当天 0 点时间戳；`0` = 无日期 |
| `taskSort` | `task_sort` | 排序值（越大越靠上） |
| `standbyStr2` | `standby_str2` | 子任务：`- [ ]a[end] - [x]b` |
| `standbyInt1` | `standby_int1` | 清单分类 id（0 = 未分类） |
| `snowAssess` | `snow_assess` | 难度：2 一般 / 5 中等 / 9 较高 |
| `complete` / `delete` | `complete` / `deleted` | 1 = 已完成 / 已进回收站 |
| `reminderTime` | `reminder_time` | 提醒时间戳 |

本地库：`~/Library/Application Support/todo-list/todos.db`（明文 SQLite，可直接只读查询；
**写请走 CLI**，否则会和 App 内存/云同步打架）。

## 五、注意

- **查询不依赖 App**（直接读文件）；**写入会自动启动 App**（带 `--inspect`，已在运行则优雅重启一次）。
- 重新跑皮肤脚本（`../todo-glass-off/patch.sh` / `revert.sh`）与本 CLI 无关，不影响接口。
- 云同步由 App 自己完成；命令默认会等一次同步（最长 4 秒，失败不影响本地结果）。
- `rm --purge`、`trash --clear --yes` 不可撤销。
- 大输出已做分片读取（Electron 单条消息有 64KB 左右限制），`list --all` 5000+ 条也能完整返回。
- 给 AI 用的 Skill 在仓库里：`cli/skill/SKILL.md`（装法见仓库根 `README.md`「给 AI 助手用」一节）。
