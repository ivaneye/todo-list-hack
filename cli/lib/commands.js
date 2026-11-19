'use strict';
const { PRELUDE } = require('./prelude');

/** 把一段"渲染进程里执行的代码"包起来 */
const wrap = (body) =>
  `(async () => {${PRELUDE}\n` +
  'const __r = await (async () => {' + body + '})(); ' +
  'window.__todoctl_out = JSON.stringify(__r); return window.__todoctl_out.length; })()';

const DIFF = { '一般': 2, '中等': 5, '中等难度': 5, '较高': 9, '较高难度': 9 };
const diffValue = (v) => {
  if (v === undefined || v === null || v === '' || v === true) return null;
  if (DIFF[v] !== undefined) return DIFF[v];
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error('难度只能是 一般/中等/较高 或 2/5/9');
  return n;
};

/* ---------------- 查询 ---------------- */

async function list(s, flags) {
  const opts = {
    date: flags.all ? 'all' : flags.date || (flags.overdue ? 'all' : 'today'),
    overdue: flags.overdue === true,
    doneOnly: flags.done === true,
    includeDone: flags['with-done'] === true || flags.all === true,
    trash: flags.trash === true,
    cat: flags.cat || '',
    tag: flags.tag || '',
    search: flags.search || '',
    limit: flags.limit ? Number(flags.limit) : 0,
    from: flags.from && flags.from !== true ? String(flags.from) : null,
    to: flags.to && flags.to !== true ? String(flags.to) : null,
    month: flags.month && flags.month !== true ? String(flags.month) : null,
  };
  return s.run(
    wrap(`
    const f = ${JSON.stringify(opts)};
    let rows = f.trash ? __H.inTrash() : __H.alive();
    if (f.month) {
      const m = /^(\\d{4})-(\\d{2})$/.exec(f.month);
      if (!m) throw new Error('--month 格式应为 YYYY-MM');
      const start = +new Date(+m[1], +m[2] - 1, 1);
      const end = +new Date(+m[1], +m[2], 1);
      rows = rows.filter((t) => t.todoTime >= start && t.todoTime < end);
    } else if (f.from || f.to) {
      const from = f.from ? __H.parseDate(f.from) : 0;
      const to = f.to ? __H.parseDate(f.to) + 86400000 : Number.MAX_SAFE_INTEGER;
      rows = rows.filter((t) => t.todoTime >= from && t.todoTime < to);
    } else if (f.overdue) {
      const today = __H.dayMs(Date.now());
      rows = rows.filter((t) => !t.complete && t.todoTime > 0 && t.todoTime < today);
    } else if (f.date !== 'all') {
      const want = f.date === 'none' ? 0 : __H.parseDate(f.date);
      rows = rows.filter((t) => t.todoTime === want);
    }
    if (f.doneOnly) rows = rows.filter((t) => t.complete);
    else if (!f.includeDone) rows = rows.filter((t) => !t.complete);
    if (f.cat) {
      const ids = __H.catIdsForFilter(f.cat);
      rows = rows.filter((t) => ids.indexOf(t.standbyInt1) >= 0);
    }
    if (f.tag) { const tag = String(f.tag).replace(/^#@?/, ''); rows = rows.filter((t) => __H.tagsOf(t).indexOf(tag) >= 0); }
    if (f.search) {
      const q = String(f.search).toLowerCase();
      rows = rows.filter((t) => (t.taskContent || '').toLowerCase().includes(q) || (t.taskDescribe || '').toLowerCase().includes(q));
    }
    rows.sort((a, b) => (b.taskSort || 0) - (a.taskSort || 0));
    const total = rows.length;
    if (f.limit) rows = rows.slice(0, f.limit);
    return { ok: true, count: total, items: rows.map(__H.row) };
  `)
  );
}

async function show(s, target) {
  return s.run(
    wrap(`
    const t = __H.resolve(${JSON.stringify(target)}, { scope: 'alive' });
    return { ok: true, item: __H.row(t), raw: { standbyStr1: t.standbyStr1, standbyStr2: t.standbyStr2, standbyInt1: t.standbyInt1, taskSort: t.taskSort } };
  `)
  );
}

/* ---------------- 增删改 ---------------- */

async function add(s, content, flags) {
  if (!content) throw new Error('用法: ./todoctl add "内容" [--date today] [--cat 工作] [--tag 标签] [--desc ...] [--sub a;b] [--difficulty 中等] [--remind 09:30]');
  const opts = {
    content,
    cat: flags.cat || '',
    desc: flags.desc && flags.desc !== true ? String(flags.desc) : null,
    date: flags.date || 'today',
    subs: flags.sub && flags.sub !== true ? String(flags.sub) : null,
    difficulty: diffValue(flags.difficulty),
    tags: flags.tag ? String(flags.tag).split(',').map((x) => x.trim()).filter(Boolean) : [],
    remind: flags.remind && flags.remind !== true ? String(flags.remind) : null,
    repeat: flags.repeat && flags.repeat !== true ? String(flags.repeat) : null,
    count: flags.count ? Number(flags.count) : 30,
    until: flags.until && flags.until !== true ? String(flags.until) : null,
  };
  return s.run(
    wrap(`
    const o = ${JSON.stringify(opts)};
    const user = __s.state.auth.user;
    let content = o.content;
    if (o.tags.length) content = content + ' ' + o.tags.map((x) => '#@' + String(x).replace(/^#@?/, '')).join(' ') + ' ';
    let remind = 0;
    if (o.remind) {
      const m = /^(\\d{1,2}):(\\d{2})$/.exec(o.remind);
      if (!m) throw new Error('提醒时间格式应为 HH:mm');
      const d = new Date(__H.parseDate(o.date === 'none' ? 'today' : o.date));
      d.setHours(+m[1], +m[2], 0, 0);
      remind = +d;
    }
    const catId = __H.catIdByName(o.cat);
    const hint = catId ? null : '这条待办没有归属清单，会落在「未分类」（不在任何分组下）。建议用 --cat <清单名> 指定归属，一条待办必须属于某个分组的某个清单。';
    const base = {
      categoryId: catId,
      todoContent: content,
      todoDescription: o.desc,
      todoReminderTime: remind,
      todoDifficultyLevel: o.difficulty,
      todoSublist: o.subs ? __H.buildSubs(o.subs.split(';')) : null,
      userId: user && user.userId,
    };

    if (!o.repeat) {
      await __s.dispatch('todo/addTodo', Object.assign({}, base, { todoDate: __H.parseDate(o.date) }));
      await __H.sync();
      const created = __H.alive().filter((t) => t.taskContent === content)
        .sort((a, b) => (b.createTime || 0) - (a.createTime || 0))[0];
      return { ok: true, item: created ? __H.row(created) : null, hint: hint };
    }

    // ---- 重复：按 spec 生成多份（App 本身也是"展开成多条"，没有服务端规则） ----
    const spec = String(o.repeat).toLowerCase();
    const m = /^(day|week|month|year|天|周|月|年)(?:[:x*]?(\\d+))?$/.exec(spec);
    if (!m) throw new Error('重复规则支持: day|week|month|year[:间隔]，例如 week / day:2 / month');
    const unit = ({'天':'day','周':'week','月':'month','年':'year'})[m[1]] || m[1];
    const every = m[2] ? Math.max(1, parseInt(m[2], 10)) : 1;
    const startMs = __H.parseDate(o.date);
    if (!startMs) throw new Error('重复待办必须有起始日期（不能用 --date none）');
    const untilMs = o.until ? __H.parseDate(o.until) : 0;
    const limit = Math.min(Math.max(1, o.count || 30), 365);
    const start = new Date(startMs);
    const dates = [];
    for (let i = 0; i < limit; i++) {
      let d;
      if (unit === 'day') d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i * every);
      else if (unit === 'week') d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i * 7 * every);
      else if (unit === 'month') d = new Date(start.getFullYear(), start.getMonth() + i * every, start.getDate());
      else d = new Date(start.getFullYear() + i * every, start.getMonth(), start.getDate());
      const ms = __H.dayMs(d);
      if (untilMs && ms > untilMs) break;
      dates.push(ms);
    }
    if (!dates.length) throw new Error('重复区间为空，检查 --until / --date');
    const repeatId = 'repeat_' + (user && user.userId) + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    for (const ms of dates) {
      const remindAt = (() => {
        if (!o.remind) return 0;
        const hhmm = /^(\\d{1,2}):(\\d{2})$/.exec(o.remind);
        const dd = new Date(ms);
        dd.setHours(+hhmm[1], +hhmm[2], 0, 0);
        return +dd;
      })();
      await __s.dispatch('todo/addTodo', Object.assign({}, base, {
        todoDate: ms, todoReminderTime: remindAt, repeatId: repeatId,
      }));
    }
    await __H.sync();
    const createdRows = __H.alive().filter((t) => t.standbyStr1 === repeatId)
      .sort((a, b) => a.todoTime - b.todoTime).map(__H.row);
    return { ok: true, repeatId: repeatId, count: createdRows.length, items: createdRows, hint: hint };
  `)
  );
}

async function edit(s, target, flags) {
  const opts = {
    content: flags.content && flags.content !== true ? String(flags.content) : null,
    desc: flags.desc === true ? '' : flags.desc === undefined ? undefined : String(flags.desc),
    cat: flags.cat ? String(flags.cat) : null,
    date: flags.date ? String(flags.date) : null,
    subs: flags.sub === true ? '' : flags.sub === undefined ? undefined : String(flags.sub),
    difficulty: flags.difficulty ? diffValue(flags.difficulty) : undefined,
    tagAdd: flags['+tag'] ? String(flags['+tag']).split(',').map((x) => x.trim()).filter(Boolean) : [],
    tagDel: flags['-tag'] ? String(flags['-tag']).split(',').map((x) => x.trim()).filter(Boolean) : [],
  };
  return s.run(
    wrap(`
    const o = ${JSON.stringify(opts)};
    const rows = ${flags.all === true ? 'true' : 'false'}
      ? __H.resolveAll(${JSON.stringify(target)}, { scope: 'alive' })
      : [__H.resolve(${JSON.stringify(target)}, { scope: 'alive' })];
    const t = rows[0];
    const patch = { taskId: t.taskId };
    if (o.content) patch.taskContent = o.content;
    if (o.desc !== undefined) patch.taskDescribe = o.desc === '' ? null : o.desc;
    if (o.cat) patch.standbyInt1 = __H.catIdByName(o.cat);
    if (o.date) patch.todoTime = __H.parseDate(o.date);
    if (o.subs !== undefined) patch.standbyStr2 = o.subs === '' ? null : __H.buildSubs(o.subs.split(';'));
    if (o.difficulty !== undefined) patch.snowAssess = o.difficulty;
    if (o.tagAdd.length || o.tagDel.length) {
      let c = patch.taskContent !== undefined ? patch.taskContent : (t.taskContent || '');
      o.tagDel.forEach((tag) => { const re = new RegExp('\\\\s*#@' + tag.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&') + '(?=\\\\s|$)', 'g'); c = c.replace(re, ''); });
      o.tagAdd.forEach((tag) => { const name = String(tag).replace(/^#@?/, ''); if ((' ' + c + ' ').indexOf('#@' + name) < 0) c = c.replace(/\\s+$/, '') + ' #@' + name + ' '; });
      patch.taskContent = c;
    }
    const changed = [];
    for (const row of rows) {
      const p = Object.assign({}, patch, { taskId: row.taskId });
      if (patch.taskContent !== undefined && rows.length > 1) {
        // 批量改内容时，标签/子任务类改写只对单条生效，避免互相覆盖
        delete p.taskContent;
      }
      __s.commit('todo/updateTodo', p);
      changed.push(row.taskId);
    }
    await __H.sync();
    const after = __H.alive().filter((x) => x.taskId === t.taskId)[0];
    return { ok: true, count: changed.length, item: after ? __H.row(after) : null };
  `)
  );
}

async function toggle(s, targets, complete, all) {
  return s.run(
    wrap(`
    const targets = ${JSON.stringify(targets)};
    const useAll = ${all ? 'true' : 'false'};
    const done = ${complete ? 'true' : 'false'};
    const out = [];
    for (const q of targets) {
      const list = useAll ? __H.resolveAll(q, { scope: 'alive' }) : [__H.resolve(q, { scope: 'alive' })];
      for (const t of list) {
        __s.commit('todo/updateTodo', { taskId: t.taskId, complete: done ? 1 : 0 });
        out.push({ id: t.taskId, content: t.taskContent, date: __H.fmtDate(t.todoTime), done: done });
      }
    }
    await __H.sync();
    return { ok: true, changed: out };
  `)
  );
}

async function remove(s, targets, purge, all) {
  return s.run(
    wrap(`
    const targets = ${JSON.stringify(targets)};
    const useAll = ${all ? 'true' : 'false'};
    const purge = ${purge ? 'true' : 'false'};
    const scope = purge ? 'trash' : 'alive';
    const out = [];
    for (const q of targets) {
      const list = useAll ? __H.resolveAll(q, { scope: scope }) : [__H.resolve(q, { scope: scope })];
      for (const t of list) {
        if (purge) {
          const ipc = require('electron').ipcRenderer;
          await ipc.invoke('todo-db:call', { method: 'hardDelete', args: [t.taskId] });
          const idx = __s.state.todo.todoList.findIndex((x) => x.taskId === t.taskId);
          if (idx >= 0) __s.state.todo.todoList.splice(idx, 1);
        } else {
          __s.commit('todo/deleteTodo', { taskId: t.taskId, taskContent: t.taskContent });
        }
        out.push({ id: t.taskId, content: t.taskContent, purged: purge });
      }
    }
    if (!purge) await __H.sync();
    return { ok: true, removed: out };
  `)
  );
}

async function restore(s, targets, all) {
  return s.run(
    wrap(`
    const targets = ${JSON.stringify(targets)};
    const useAll = ${all ? 'true' : 'false'};
    const out = [];
    for (const q of targets) {
      const list = useAll ? __H.resolveAll(q, { scope: 'trash' }) : [__H.resolve(q, { scope: 'trash' })];
      for (const t of list) {
        __s.commit('todo/updateTodo', { taskId: t.taskId, delete: false, deleting: false, status: 'update' });
        out.push({ id: t.taskId, content: t.taskContent });
      }
    }
    await __H.sync();
    return { ok: true, restored: out };
  `)
  );
}

async function trashClear(s, flags) {
  if (!flags.yes) throw new Error('清空回收站不可撤销，请加 --yes 确认');
  return s.run(
    wrap(`
    const ipc = require('electron').ipcRenderer;
    const rows = __H.inTrash();
    for (const t of rows) {
      await ipc.invoke('todo-db:call', { method: 'hardDelete', args: [t.taskId] });
    }
    __s.state.todo.todoList = __s.state.todo.todoList.filter((x) => !x.delete);
    return { ok: true, cleared: rows.length };
  `)
  );
}

async function sortEdge(s, target, edge) {
  return s.run(
    wrap(`
    const t = __H.resolve(${JSON.stringify(target)}, { scope: 'alive' });
    await __s.dispatch('todo/${edge === 'top' ? 'moveToTop' : 'moveToBottom'}', t);
    await __H.sync();
    const after = __H.alive().filter((x) => x.taskId === t.taskId)[0];
    return { ok: true, item: after ? __H.row(after) : null, taskSort: after ? after.taskSort : null };
  `)
  );
}

/* ---------------- 子任务 ---------------- */

async function subsList(s, target) {
  return s.run(
    wrap(`
    const t = __H.resolve(${JSON.stringify(target)}, { scope: 'alive' });
    const subs = __H.parseSubs(t.standbyStr2);
    return { ok: true, content: t.taskContent, count: subs.length, subs: subs,
             progress: subs.filter((x) => x.done).length + '/' + subs.length };
  `)
  );
}

async function subToggle(s, target, keyword, undo) {
  return s.run(
    wrap(`
    const t = __H.resolve(${JSON.stringify(target)}, { scope: 'alive' });
    const subs = __H.parseSubs(t.standbyStr2);
    if (!subs.length) throw new Error('这条待办没有子任务');
    const kw = ${JSON.stringify(keyword || '')}.toLowerCase();
    const hits = subs.filter((x) => x.text.toLowerCase().includes(kw));
    if (!hits.length) throw new Error('没匹配到子任务：' + ${JSON.stringify(keyword || '')});
    if (hits.length > 1) throw new Error('匹配到多条子任务，请写更完整的文字：' + hits.map((x) => x.text).join(' / '));
    hits[0].done = ${undo ? 'false' : 'true'};
    const str = subs.map((x) => (x.done ? '- [x]' : '- [ ]') + x.text).join('[end] -');
    __s.commit('todo/updateTodo', { taskId: t.taskId, standbyStr2: str });
    await __H.sync();
    const after = __H.alive().filter((x) => x.taskId === t.taskId)[0];
    return { ok: true, subs: __H.parseSubs(after.standbyStr2) };
  `)
  );
}

/* ---------------- 组织：清单 / 标签 ---------------- */

async function remind(s, target, time, flags) {
  const opts = {
    time: time || null,
    off: flags.off === true,
    date: flags.date && flags.date !== true ? String(flags.date) : null,
    all: flags.all === true,
  };
  return s.run(
    wrap(`
    const o = ${JSON.stringify(opts)};
    const rows = o.all
      ? __H.resolveAll(${JSON.stringify(target)}, { scope: 'alive' })
      : [__H.resolve(${JSON.stringify(target)}, { scope: 'alive' })];
    if (!o.off && !o.time) throw new Error('用法: ./todoctl remind <待办> 09:30 | --off');
    let hhmm = null;
    if (o.time) {
      hhmm = /^(\\d{1,2}):(\\d{2})$/.exec(o.time);
      if (!hhmm) throw new Error('时间格式应为 HH:mm');
    }
    const out = [];
    for (const t of rows) {
      if (o.off) {
        __s.commit('todo/updateTodo', { taskId: t.taskId, reminderTime: 0 });
        out.push({ id: t.taskId, date: __H.fmtDate(t.todoTime), reminder: null });
        continue;
      }
      const dayMs = o.date ? __H.parseDate(o.date) : (t.todoTime || __H.parseDate('today'));
      if (!dayMs) throw new Error('这条待办没有日期，请用 --date 指定提醒日期');
      const d = new Date(dayMs);
      d.setHours(+hhmm[1], +hhmm[2], 0, 0);
      __s.commit('todo/updateTodo', { taskId: t.taskId, reminderTime: +d });
      out.push({ id: t.taskId, date: __H.fmtDate(t.todoTime), reminder: o.time });
    }
    await __H.sync();
    return { ok: true, count: out.length, changed: out };
  `)
  );
}

async function repeats(s, flags) {
  const limit = flags.limit ? Number(flags.limit) : 30;
  return s.run(
    wrap(`
    const map = {};
    __H.alive().forEach((t) => {
      const id = t.standbyStr1;
      if (!id || id === 'null') return;
      const g = map[id] || (map[id] = { repeatId: id, content: t.taskContent, total: 0, open: 0, first: null, last: null, sampleId: t.taskId });
      g.total += 1;
      if (!t.complete) g.open += 1;
      if (!g.first || t.todoTime < g.first) g.first = t.todoTime;
      if (!g.last || t.todoTime > g.last) g.last = t.todoTime;
    });
    const groups = Object.keys(map).map((k) => map[k])
      .map((g) => ({ repeatId: g.repeatId, content: g.content, total: g.total, open: g.open,
                     first: __H.fmtDate(g.first), last: __H.fmtDate(g.last), sampleId: g.sampleId }))
      .sort((a, b) => b.open - a.open);
    return { ok: true, count: groups.length, groups: groups.slice(0, ${limit}) };
  `)
  );
}

async function repeatRemove(s, target, flags) {
  return s.run(
    wrap(`
    const hits = __H.resolveAll(${JSON.stringify(target)}, { scope: 'alive' });
    const t = hits[0];
    const id = t.standbyStr1;
    if (!id || id === 'null') throw new Error('这条待办不属于重复组: ' + t.taskContent);
    const series = __H.alive().filter((x) => x.standbyStr1 === id);
    const dates = series.map((x) => x.todoTime).sort((a, b) => a - b);
    const preview = {
      repeatId: id, content: t.taskContent, count: series.length,
      first: __H.fmtDate(dates[0]), last: __H.fmtDate(dates[dates.length - 1]),
    };
    if (!${flags.yes === true ? 'true' : 'false'}) {
      return { ok: false, needConfirm: true, preview: preview,
               hint: '整组删除不可撤销（进回收站），确认请加 --yes' };
    }
    for (const x of series) __s.commit('todo/deleteTodo', { taskId: x.taskId, taskContent: x.taskContent });
    await __H.sync();
    return { ok: true, removed: preview };
  `)
  );
}


/** 把指定日期（默认昨天）未完成的待办挪到今天/指定日期 */
async function carry(s, flags) {
  const opts = {
    from: flags.from && flags.from !== true ? String(flags.from) : 'yesterday',
    to: flags.date && flags.date !== true ? String(flags.date) : 'today',
  };
  return s.run(
    wrap(`
    const o = ${JSON.stringify(opts)};
    const fromMs = __H.parseDate(o.from);
    const toMs = __H.parseDate(o.to);
    const taskIds = __H.alive()
      .filter((t) => !t.complete && t.todoTime === fromMs)
      .map((t) => t.taskId);
    if (!taskIds.length) return { ok: true, moved: 0, from: o.from, to: o.to };
    const n = await __s.dispatch('todo/moveUncompletedTodosToDate', { taskIds: taskIds, date: toMs });
    await __H.sync();
    return { ok: true, moved: taskIds.length, accepted: n, from: o.from, to: o.to };
  `)
  );
}

/** 写设置：改 store + 落 localStorage(settingsState)，主题相关同步给主进程 */
async function settingsWrite(s, key, value) {
  if (!key) throw new Error('用法: ./todoctl settings set <key> <value>');
  const opts = { key, value: value === undefined ? true : value };
  return s.run(
    wrap(`
    const o = ${JSON.stringify(opts)};
    const st = __s.state.settings;
    if (!(o.key in st)) throw new Error('没有这个设置项: ' + o.key + '（用 ./todoctl settings 看全部）');
    const before = st[o.key];
    let v = o.value;
    if (v === 'true') v = true; else if (v === 'false') v = false;
    else if (v !== '' && !isNaN(Number(v))) v = Number(v);
    st[o.key] = v;
    localStorage.setItem('settingsState', JSON.stringify(Object.assign({}, st)));
    try { require('electron').ipcRenderer.send('notify-settings-updated', Object.assign({}, st)); } catch (e) {}
    await __s.dispatch('nui/log', 'CLI 修改设置: ' + o.key + ' = ' + String(v), { root: true });
    return { ok: true, key: o.key, before: before, after: st[o.key] };
  `)
  );
}

/** 发一条系统通知（用于提醒/脚本回调） */
async function notify(s, title, body) {
  const opts = { title: title || 'Todo清单', body: body || '' };
  return s.run(
    wrap(`
    const o = ${JSON.stringify(opts)};
    require('electron').ipcRenderer.send('notification', {
      title: o.title, body: o.body, timeoutType: 'default',
    });
    return { ok: true, title: o.title, body: o.body };
  `)
  );
}

/** 用 App 自带能力导出 xlsx（会弹出保存对话框） */
async function exportXlsx(s, flags) {
  const opts = {
    date: flags.date && flags.date !== true ? String(flags.date) : 'all',
    fileName: flags.out && flags.out !== true ? String(flags.out) : 'Todo清单导出.xlsx',
  };
  return s.run(
    wrap(`
    const o = ${JSON.stringify(opts)};
    let rows = __H.alive();
    if (o.date !== 'all') {
      const want = __H.parseDate(o.date);
      rows = rows.filter((t) => t.todoTime === want);
    }
    rows.sort((a, b) => (a.todoTime || 0) - (b.todoTime || 0));
    const data = rows.map((t) => [
      t.taskId, __H.fmtDate(t.todoTime) || '', __H.catName(t.standbyInt1), t.taskContent || '',
      t.taskDescribe || '', t.standbyStr2 || '', t.complete ? '是' : '否',
      t.snowAssess || '', t.reminderTime ? __H.fmtDate(t.reminderTime) + ' ' + __H.fmtTime(t.reminderTime) : '',
    ]);
    const r = await require('electron').ipcRenderer.invoke('export-todos-to-xlsx', { fileName: o.fileName, rows: data });
    return { ok: !r || r.success !== false, result: r, count: data.length };
  `)
  );
}

/** App 的云端报表（昨日小结 / 周报 / 番茄统计） */
async function report(s, which) {
  const w = which || 'yesterday';
  return s.run(
    wrap(`
    const vm = document.querySelector('#app').__vue__;
    const api = vm.$api;
    const which = ${JSON.stringify(w)};
    const showTomato = __s.state.tomato.enableTomatoTimer ? 1 : 0;
    let data = null;
    if (which === 'yesterday') data = await api.getReportYesterdaySummary({ showTomato: showTomato });
    else if (which === 'week') data = await api.getReportWeek({ showTomato: showTomato });
    else if (which === 'tomato') {
      const DAY = 86400000;
      const span = Number(${JSON.stringify(String(0))}) || 7;
      data = await api.getReportTomato({ showTomato: showTomato, startTime: Date.now() - span * DAY, endTime: Date.now() });
    } else throw new Error('报表类型: yesterday | week | tomato');
    return { ok: true, type: which, count: Array.isArray(data) ? data.length : null, data: data };
  `)
  );
}

/** 子任务增删 */
async function subAdd(s, target, text) {
  return s.run(
    wrap(`
    const t = __H.resolve(${JSON.stringify(target)}, { scope: 'alive' });
    if (!${JSON.stringify(text || '')}) throw new Error('用法: ./todoctl sub add <待办> <子任务文字>');
    const subs = __H.parseSubs(t.standbyStr2);
    subs.push({ done: false, text: ${JSON.stringify(text || '')} });
    const str = subs.map((x) => (x.done ? '- [x]' : '- [ ]') + x.text).join('[end] -');
    __s.commit('todo/updateTodo', { taskId: t.taskId, standbyStr2: str });
    await __H.sync();
    const after = __H.alive().filter((x) => x.taskId === t.taskId)[0];
    return { ok: true, subs: __H.parseSubs(after.standbyStr2) };
  `)
  );
}

async function subRm(s, target, text) {
  return s.run(
    wrap(`
    const t = __H.resolve(${JSON.stringify(target)}, { scope: 'alive' });
    const kw = ${JSON.stringify(text || '')}.toLowerCase();
    if (!kw) throw new Error('用法: ./todoctl sub rm <待办> <子任务关键词>');
    const subs = __H.parseSubs(t.standbyStr2);
    const hit = subs.filter((x) => x.text.toLowerCase().includes(kw));
    if (!hit.length) throw new Error('没匹配到子任务: ' + ${JSON.stringify(text || '')});
    if (hit.length > 1) throw new Error('匹配到多条子任务，请写更完整的文字');
    const rest = subs.filter((x) => x !== hit[0]);
    const str = rest.length ? rest.map((x) => (x.done ? '- [x]' : '- [ ]') + x.text).join('[end] -') : null;
    __s.commit('todo/updateTodo', { taskId: t.taskId, standbyStr2: str });
    await __H.sync();
    const after = __H.alive().filter((x) => x.taskId === t.taskId)[0];
    return { ok: true, removed: hit[0].text, subs: __H.parseSubs(after.standbyStr2) };
  `)
  );
}

async function cats(s) {
  return s.run(
    wrap(`
    const list = __H.cats();
    const counts = {};
    __H.alive().forEach((t) => {
      if (!t.complete) counts[t.standbyInt1 || 0] = (counts[t.standbyInt1 || 0] || 0) + 1;
    });
    return { ok: true, categories: list.map((c) => ({ ...c, open: counts[c.id] || 0 })) };
  `)
  );
}

async function folders(s, flags) {
  const opts = { all: flags.all === true };
  return s.run(
    wrap(`
    const o = ${JSON.stringify(opts)};
    const all = __H.cats();
    const counts = {};
    __H.alive().forEach((t) => {
      if (!t.complete) counts[t.standbyInt1 || 0] = (counts[t.standbyInt1 || 0] || 0) + 1;
    });
    const folders = all.filter((c) => c.isFolder);
    const lists = all.filter((c) => !c.isFolder);
    const tree = folders.map((f) => {
      const kids = lists.filter((c) => c.folderId === f.id)
        .map((c) => ({ id: c.id, name: c.name, open: counts[c.id] || 0 }))
        .sort((a, b) => b.open - a.open);
      return {
        id: f.id, name: f.name, color: f.color, isFolder: true,
        open: kids.reduce((n, k) => n + k.open, 0),
        listCount: kids.length,
        lists: kids,
      };
    });
    const loose = lists.filter((c) => !c.folderId || c.folderId === 0)
      .map((c) => ({ id: c.id, name: c.name, open: counts[c.id] || 0 }))
      .sort((a, b) => b.open - a.open);
    const out = o.all ? tree : tree.filter((f) => f.listCount > 0 || f.open > 0);
    return {
      ok: true,
      folderCount: folders.length,
      listCount: lists.length,
      folders: out,
      looseLists: loose,
      emptyFolders: tree.filter((f) => f.listCount === 0).map((f) => f.name),
    };
  `)
  );
}

async function folderWrite(s, action, args, flags) {
  const opts = { action, args, color: flags.color || '#11abac', force: flags.force === true };
  return s.run(
    wrap(`
    const o = ${JSON.stringify(opts)};
    const api = document.querySelector('#app').__vue__.$api;
    const all = __H.cats();
    const find = (n) => {
      const hit = all.filter((c) => c.isFolder && c.name === n)[0]
        || all.filter((c) => c.isFolder && c.name.includes(n))[0];
      if (!hit) throw new Error('没有找到分组: ' + n);
      return hit;
    };
    let result = null;
    if (o.action === 'add') {
      if (!o.args[0]) throw new Error('用法: ./todoctl folder add 名称 [--color #rrggbb]');
      result = await api.addCategoryList({ categoryName: o.args[0], categoryColor: o.color, isFolder: true, folderId: 0 });
    } else if (o.action === 'rename') {
      const f = find(o.args[0]);
      if (!o.args[1]) throw new Error('用法: ./todoctl folder rename 旧名 新名');
      result = await api.updateCategoryList({ categoryId: f.id, categoryName: o.args[1], categoryColor: f.color || o.color, folderId: 0 });
    } else if (o.action === 'rm') {
      const f = find(o.args[0]);
      const kids = all.filter((c) => !c.isFolder && c.folderId === f.id);
      if (kids.length) {
        throw new Error('分组「' + f.name + '」下还有 ' + kids.length + ' 个清单：' + kids.map((k) => k.name).join('、') +
          '\\n先把它们移出去再删分组：./todoctl cat move <清单> --to <其他分组|none>');
      }
      result = await api.deleteCategoryList({ categoryId: f.id });
    }
    await __s.dispatch('category/fetch');
    return { ok: !result || result.ret !== false, api: result, folders: __H.cats().filter((c) => c.isFolder) };
  `)
  );
}

async function catWrite(s, action, args, flags) {
  const opts = { action, args, flags };
  return s.run(
    wrap(`
    const o = ${JSON.stringify(opts)};
    const vm = document.querySelector('#app').__vue__;
    const api = vm.$api;
    const list = __H.cats();
    const byName = (n) => {
      const hit = list.filter((c) => c.name === n)[0] || list.filter((c) => c.name.includes(n))[0];
      if (!hit) throw new Error('没有找到清单: ' + n);
      return hit;
    };
    let result = null;
    if (o.action === 'add') {
      const color = o.flags.color || '#11abac';
      const folderId = o.flags.folder ? byName(o.flags.folder).id : 0;
      result = await api.addCategoryList({ categoryName: o.args[0], categoryColor: color, isFolder: false, folderId: folderId });
    } else if (o.action === 'rename') {
      const c = byName(o.args[0]);
      result = await api.updateCategoryList({ categoryId: c.id, categoryName: o.args[1], categoryColor: c.color || '#11abac', folderId: c.folderId || 0 });
    } else if (o.action === 'move') {
      const c = byName(o.args[0]);
      const to = o.flags.to;
      if (!to) throw new Error('用法: ./todoctl cat move <清单> --to <分组|none>');
      const folderId = (to === 'none' || to === '0') ? 0 : byName(to).id;
      result = await api.updateCategoryList({ categoryId: c.id, categoryName: c.name, categoryColor: c.color || '#11abac', folderId: folderId });
    } else if (o.action === 'rm') {
      const c = byName(o.args[0]);
      result = await api.deleteCategoryList({ categoryId: c.id });
    }
    await __s.dispatch('category/fetch');
    return { ok: !result || result.ret !== false, api: result, categories: __H.cats() };
  `)
  );
}

async function tags(s) {
  return s.run(
    wrap(`
    const map = {};
    __H.alive().forEach((t) => {
      __H.tagsOf(t).forEach((tag) => {
        map[tag] = map[tag] || { tag: tag, open: 0, total: 0 };
        map[tag].total += 1;
        if (!t.complete) map[tag].open += 1;
      });
    });
    const tags = Object.keys(map).map((k) => map[k]).sort((a, b) => b.open - a.open);
    return { ok: true, count: tags.length, tags: tags };
  `)
  );
}

/* ---------------- 统计 ---------------- */

async function stats(s) {
  return s.run(
    wrap(`
    const today = __H.dayMs(Date.now());
    const tomorrow = today + 86400000;
    const alive = __H.alive();
    const count = (arr) => arr.length;
    const res = {
      today: {
        total: count(alive.filter((t) => t.todoTime === today)),
        open: count(alive.filter((t) => t.todoTime === today && !t.complete)),
        done: count(alive.filter((t) => t.todoTime === today && t.complete)),
      },
      overdue: count(alive.filter((t) => !t.complete && t.todoTime > 0 && t.todoTime < today)),
      noDate: count(alive.filter((t) => !t.complete && !t.todoTime)),
      upcoming: count(alive.filter((t) => !t.complete && t.todoTime >= tomorrow)),
      completedTotal: count(alive.filter((t) => t.complete)),
      trash: count(__H.inTrash()),
      tomato: {
        today: __s.state.tomato.todayTomatoCount || 0,
        records: (__s.state.tomato.tomatoRecordList || []).length,
        status: __s.state.tomato.status,
      },
      categories: __H.cats().length,
    };
    return { ok: true, stats: res };
  `)
  );
}

async function tomato(s) {
  return s.run(
    wrap(`
    const st = __s.state.tomato;
    return { ok: true, status: st.status, todayCount: st.todayTomatoCount,
             tomatoTime: st.tomatoTime, restTime: st.restTime,
             attachTodo: st.attachTodo ? st.attachTodo.taskContent : null,
             records: (st.tomatoRecordList || []).slice(0, 20) };
  `)
  );
}

async function settings(s, key) {
  return s.run(
    wrap(`
    const all = __s.state.settings;
    const key = ${JSON.stringify(key || '')};
    if (key) return { ok: true, key: key, value: all[key] };
    return { ok: true, settings: all };
  `)
  );
}

module.exports = {
  list, show, add, edit, toggle, remove, restore, trashClear, sortEdge,
  subsList, subToggle, cats, catWrite, folders, folderWrite, tags, stats, tomato, settings,
  remind, repeats, repeatRemove, carry, settingsWrite, notify, exportXlsx, report,
  subAdd, subRm, wrap,
};
