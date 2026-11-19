---
name: todo-list
description: 通过 todoctl 操作本机 Todo清单（macOS Electron 待办 App）——查询、新增、修改、完成、删除、恢复、子任务、标签、清单分类、统计、番茄与设置。Use when 用户说「今天还剩什么/加个待办/把 X 标完成/改到明天/删掉 X/我这周做了啥/某个清单里有什么」，或需要读写本机 Todo清单 数据时。新建待办会先确认归属的「分组 → 清单」并给出推荐（待办必须落在清单上）。命令入口 `cli/todoctl`（仓库内；用 `TODOLIST_CLI_DIR` 或改 SKILL.md 里的 `TDL` 指向实际路径）；查询直接读本地文件（App 不用开），写入会自动带参数启动/重启 App。
---

# Todo清单 操作 Skill

`todoctl` 有两个驱动，**自动选择，不需要你先判断 App 状态**：

| 要做的事 | 驱动 | App 必须在运行吗 |
|---|---|---|
| 查询：list / show / search / stats / cats / folders / tags / overdue / repeats / subs | N1 文件只读：`todos.db` + `critical-state-backup.json` | ❌ 不用，App 关着也能查 |
| 写入：add / edit / done / rm / restore / sub / remind / cat / folder / tag / `settings set` | N2 主进程接口：必要时自动 `--inspect` 启动或重启 App | 自动处理 |

写入必须走 App 自己的 Vuex action（ID/排序/软删除/子任务格式/云同步都由 App 处理）；
**任何情况下都不要直接写 `todos.db`**。

CLI 位置（把默认值改成你 clone 后 `cli/` 的实际路径，或 `export TODOLIST_CLI_DIR=...`）：

```bash
TDL="${TODOLIST_CLI_DIR:-$HOME/todo-list-hack/cli}"
"$TDL/todoctl" --help
```

## 一、App 状态判定（skill 的处置契约）

**直接执行命令就行，不要预先 `open -a "Todo清单"`，也不要让用户手动开接口。**
写命令遇到下面三种情况，todoctl 自己会处理：

| 情况 | 自动行为 |
|---|---|
| 本地接口已开（127.0.0.1:9331 有响应） | 直接连 |
| App 没运行 | 带 `--inspect` 启动，等主窗口 Vuex 就绪（约 2s） |
| App 在运行但没开接口 | **优雅退出**（先落盘 + 云同步）→ 带参启动（约 3s） |

注意：

- 重启是"一次性的、无感的"：退出走 App 自己的 `before-quit`，数据不丢；之后用户点 Dock 只是聚焦该实例。
- 用户明确说"别动我的 App / 别重启"→ 加 `--no-restart`，命令会失败并提示，不要自行绕过。
- 只读命令永远不会触发启动，不需要先自检。
- 需要看链路状态时用：

```bash
"$TDL/todoctl" app status     # 平台 / App 路径 / 数据目录 / 运行中 / 接口端口与状态 / 文件时间
"$TDL/todoctl" app restart    # 主动带接口重启
"$TDL/todoctl" app quit       # 退出，恢复"无接口"状态
```

排错顺序：`app status` →（文件读不了）`--live` 试连 App → `app restart`。

**不要擅自执行 `app persist on`**（登录即带接口，会让端口常开）——只在用户明确说
"不想每次重启"时提议，并说明代价：

```bash
"$TDL/todoctl" app persist on|off|status    # 可选；只写用户自己的启动项，不动 App
```

## 二、写待办必做：先定归属（分组 → 清单）

数据模型是 **分组（folder）→ 清单（cat）→ 待办**。用户的每条待办都必须落在某个清单上，
清单再归属一个分组；**不要落到「未分类」**。

1. **先看结构再写**：`"$TDL/todoctl" folders --table`（一次拿到 分组 → 清单 + 未完成数）。
2. **用户给的归属要落到「清单」**：
   - 给的是清单名 → 直接用；给的是分组名（如"工作""汇报"）→ 补全成该分组下的具体清单
     （"汇报" → 「汇报与述职」）。
   - 名称对不上（如"方案与计划" vs 实际「方案与设计」）→ **不要猜**，列候选让用户选。
3. **用户没指定归属时，必须问一次，并主动推荐**：
   - 给 **1 个主推荐 + 最多 2 个备选**，每个都附一句理由（语义贴合度 + 该清单现有未完成数/活跃度）。
   - 话术示例：`建议放「工作 / 汇报与述职」（同类"技术投稿""项目相关内容缺失"都在这个清单）；
     备选：「工作 / 研发管理」。也可以让我新建清单。`
   - 一次问清，别反复追问；用户回"随便/你定"→ 直接用主推荐并在回读时说明。
4. **确认后再写**，命令必须带 `--cat <清单名>`。
5. **分组合适但清单不合适**：先在该分组下建清单再建待办
   `"$TDL/todoctl" cat add "清单名" --folder 分组名`。
6. **回读并汇报三元组**：`分组 / 清单 / 日期`（`show`、`list --table`、`add` 返回的
   `folder` 与 `cat` 字段可直接引用）。

CLI 已内置硬约束（遇到报错照提示处理，**不要绕过、不要退回未分类**）：

- `--cat 工作`（分组名）→ 报错并列出该分组下的清单与 id。
- `--cat` 匹配到多个清单 → 报错列候选。
- 不带 `--cat` → 落到「未分类」，返回的 `hint` 字段会提醒；除非用户明确说"先不分类"，否则不要这样建。
- 只读筛选 `list --cat 工作` 会自动展开成该分组下所有清单（筛选不报错）。

## 三、命令速查

| 意图 | 命令 |
|---|---|
| 今天未完成 | `todoctl list` |
| 某天 / 明天 / 无日期 / 全部 | `todoctl list --date tomorrow｜2026-11-15｜none｜all` |
| 已完成 | `todoctl list --done`；含已完成 `--with-done` |
| 按清单 / 分组 / 标签 / 关键词 | `todoctl list --cat 研发管理 --tag 二宝 --search 复盘`（`--cat` 也可直接写分组名） |
| 逾期 | `todoctl overdue` |
| 单条详情 | `todoctl show <关键词或taskId>` |
| 新增 | `todoctl add "内容" --cat <清单名> --date tomorrow --desc "..." --sub "a;b" --difficulty 中等 --remind 09:30 --tag 标签`（`--cat` 是归属，见第二节） |
| 周期任务 | `todoctl add "站会" --repeat week --count 12 --remind 09:30`（也支持 `day/month/year[:间隔]`、`--until 日期`）；`todoctl repeats` 看已有重复组；`todoctl repeat rm <目标> --yes` 删整组 |
| 设/取消提醒 | `todoctl remind <目标> 09:30` / `remind <目标> --off`（重复组用 `--all`） |
| 修改 | `todoctl edit <目标> [--content|--date|--cat|--desc|--sub|--difficulty]` |
| 完成 / 取消 | `todoctl done <目标>` / `todoctl undone <目标>` |
| 删除（进回收站） | `todoctl rm <目标>` |
| 回收站 / 恢复 / 彻底删 | `todoctl trash` / `todoctl restore <目标>` / `todoctl rm <目标> --purge` |
| 置顶 / 置底 | `todoctl top <目标>` / `todoctl bottom <目标>` |
| 子任务 | `todoctl subs <目标>` / `todoctl sub <目标> <子任务关键词> [--undone]` |
| 分组 | `todoctl folders` / `folder add <名> [--color]` / `folder rename 旧 新` / `folder rm 名` |
| 清单 | `todoctl cats` / `cat add <名> [--color] [--folder 分组]` / `cat rename 旧 新` / `cat rm 名` / `cat move 名 --to 分组｜none` |
| 标签 | `todoctl tags` / `todoctl tag <目标> --add 标签 --del 旧标签` |
| 概览 | `todoctl stats`；`todoctl report yesterday｜week｜tomato`（云端报表） |
| 导出 | `todoctl export --format csv｜json --out 文件`（`--xlsx` 弹 App 的保存框） |
| 批量 | `done/undone/rm/remind/edit/restore ... --all` |
| 顺延 | `todoctl carry`（昨天未完成 → 今天） |
| 设置 | `todoctl settings [key]` / `settings set <key> <value>` |
| 通知 | `todoctl notify "标题" "正文"` |
| 时间区间 | `list --from/--to 日期`、`list --month 2026-11` |
| 番茄 | `todoctl tomato` |
| 设置（只读） | `todoctl settings [key]` |
| 逃生舱 | `todoctl raw '<js 表达式>'`（只读 debug 用） |

输出默认 JSON；加 `--table` 给人看。

## 四、执行纪律（重要）

1. **先查后改**：用户说"把复盘标完成"时，先 `todoctl list | grep 复盘` 或直接 `done 复盘`；
   若报"匹配到 N 条"，把候选列给用户选，**不要猜**。
2. **新建待办必须先定归属**（第二节）：未指定清单时先推荐 + 确认，禁止默默建到「未分类」。
2. **破坏性操作先确认**：`rm --purge`、`trash --clear --yes`、批量删除 —— 先复述将要删的内容，
   得到明确同意再执行。
3. **批量前先预览**：用 `list --table` 展示命中集合，再逐个执行或让用户确认范围。
4. **改完回读一次**（`show`/`list`）再把结果告诉用户，尤其是日期、清单、子任务。
5. **不要修改 App 数据之外的东西**（配置文件、数据库直写）；需要 App 未暴露的能力时，
   先说明限制，再给替代方案。

## 五、语义要点

- **分组与清单**：分组（folder）只是容器，**待办挂在清单（cat）上**；接口输出里
  `cat` 是清单名、`folder` 是它所属分组、`catId` 是清单 id（0 = 未分类）。
- **日期**：内部是当天 0 点时间戳；`--date none` = 无日期（待办箱）。"明天""下周一"要换算成
  `YYYY-MM-DD` 再传。
- **标签**：就是内容里的 `#@名字`（例：`写周报 #@工作 `）。`tag --add/--del` 会改内容串。
- **子任务**：存在 `standbyStr2`，格式 `- [ ]a[end] - [x]b`；CLI 的 `--sub "a;x:b"` 中
  `x:` 前缀表示已完成。
- **难度**：`一般`=2 / `中等`=5 / `较高`=9。
- **目标匹配**：taskId 前缀 或 内容子串，大小写不敏感；只匹配「未删除」的待办，
  `restore`/`purge` 才在回收站里查。
- **回收站**：`rm` 是软删除（会同步到其他设备）；`--purge` 才是物理删除（不可恢复）。
- **重复待办**：App 里没有"服务端规则"，周期任务就是提前展开成多条（用 `standbyStr1` 分组）。
  所以 `add --repeat` 会真的创建 N 条；改其中一条不影响其它条。整组删除用 `repeat rm --yes`
  （先不带 `--yes` 拿到条数与起止日期，向用户确认后再删）。
- **批量**：`done/undone/rm/remind` 加 `--all` 才会作用于所有匹配项；否则匹配多条会报歧义。

## 六、常见对话 → 动作

| 用户说 | 你做 |
|---|---|
| "今天还剩什么没做完" | `todoctl list --table`，按清单归类汇报，附子任务进度 |
| "帮我加个待办：周五前交设计稿，工作清单" | "工作"是分组 → 先 `folders --table` 定到具体清单（推荐 + 确认）→ `add "周五前交设计稿" --cat <清单> --date 2026-11-xx` |
| "加个待办：写周报"（没说归属） | `folders --table` → 推荐「工作 / 汇报与述职」等 1 主 2 备 + 理由 → 确认后 `add "写周报" --cat 汇报与述职` |
| "把复盘标完成" | `done 复盘`（多条匹配就先问） |
| "这个任务明天再做" | `edit <目标> --date tomorrow` |
| "把它拆成 3 步" | `edit <目标> --sub "步骤1;步骤2;步骤3"` |
| "这周做了什么" | `list --done --date <周一>` + `list --done --date <今天>`，或 `stats` |
| "清理一下过期的" | 先 `overdue --table` 给用户看，确认后再批量 `rm` |

## 七、不支持的（说明清楚，别硬做）

- 重复待办、附件/图片、日历拖拽、登录与多设备、**设置写入**（只读）
- 番茄钟只能读状态与记录，不能启停；附件/图片上传、登录与多设备、日历拖拽未接入
- 需要这些能力时：让用户在 App 界面操作，或明确说明限制
