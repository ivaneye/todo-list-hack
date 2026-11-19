'use strict';
/**
 * 注入到 App 渲染进程里的辅助函数（字符串）。
 * 用 String.raw 保存正则里的反斜杠，注意：这里不要出现 ${ 插值。
 */
const PRELUDE = String.raw`
const __s = window.vuexStore;
const __H = {
  dayMs(v) { const d = new Date(v); d.setHours(0, 0, 0, 0); return +d; },
  parseDate(v) {
    if (v === undefined || v === null || v === '') return __H.dayMs(Date.now());
    if (v === 'none' || v === '0') return 0;
    if (v === 'today') return __H.dayMs(Date.now());
    if (v === 'tomorrow') return __H.dayMs(Date.now() + 86400000);
    if (v === 'yesterday') return __H.dayMs(Date.now() - 86400000);
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    if (m) return +new Date(+m[1], +m[2] - 1, +m[3]);
    const d = new Date(v);
    if (isNaN(+d)) throw new Error('看不懂的日期: ' + v);
    return __H.dayMs(+d);
  },
  fmtDate(ts) {
    if (!ts) return null;
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  },
  fmtTime(ts) {
    if (!ts) return null;
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return p(d.getHours()) + ':' + p(d.getMinutes());
  },
  cats() {
    return ((__s.state.category && __s.state.category.list) || []).map((c) => ({
      id: c.categoryId, name: c.categoryName, color: c.categoryColor,
      isFolder: !!c.folderIs, folderId: c.folderId || 0,
    }));
  },
  catsByFolder(folderId) {
    return __H.cats().filter((c) => !c.isFolder && (c.folderId || 0) === folderId);
  },
  // 把用户给的名称解析成「清单 / 分组 / 未分类 / 找不到」
  // 返回 { kind: 'cat'|'folder'|'none'|'missing', cat?, folder?, candidates: [] }
  resolveCatName(name) {
    const raw = String(name == null ? '' : name).trim();
    if (!raw || raw === 'none' || raw === '未分类' || raw === 'uncategorized') {
      return { kind: 'none', candidates: [] };
    }
    const list = __H.cats();
    const catsOnly = list.filter((c) => !c.isFolder);
    const foldersOnly = list.filter((c) => c.isFolder);
    const exactCat = catsOnly.filter((c) => c.name === raw)[0];
    if (exactCat) return { kind: 'cat', cat: exactCat, candidates: [exactCat] };
    const exactFolder = foldersOnly.filter((c) => c.name === raw)[0];
    if (exactFolder) {
      return { kind: 'folder', folder: exactFolder, candidates: __H.catsByFolder(exactFolder.id) };
    }
    const fuzzyCats = catsOnly.filter((c) => c.name.includes(raw));
    if (fuzzyCats.length === 1) return { kind: 'cat', cat: fuzzyCats[0], candidates: fuzzyCats };
    if (fuzzyCats.length > 1) return { kind: 'missing', candidates: fuzzyCats, ambiguous: true };
    const fuzzyFolders = foldersOnly.filter((c) => c.name.includes(raw));
    if (fuzzyFolders.length === 1) {
      return { kind: 'folder', folder: fuzzyFolders[0], candidates: __H.catsByFolder(fuzzyFolders[0].id) };
    }
    if (fuzzyFolders.length > 1) return { kind: 'missing', candidates: fuzzyFolders, ambiguous: true };
    return { kind: 'missing', candidates: [] };
  },
  // 写操作专用：待办必须落在清单上（清单再归属分组），不要落到分组或未分类上
  catIdForWrite(name) {
    const r = __H.resolveCatName(name);
    if (r.kind === 'none') return 0;
    if (r.kind === 'cat') return r.cat.id;
    const tier = (list) => (list.length ? list.map((c) => c.name + '(' + c.id + ')').join('、') : '（空）');
    if (r.kind === 'folder') {
      throw new Error('「' + r.folder.name + '」是分组，不是清单。该分组下的清单：' + tier(r.candidates) +
        '。请改用具体清单：--cat <清单名>；要新建清单：./todoctl cat add <清单名> --folder ' + r.folder.name);
    }
    if (r.ambiguous) {
      throw new Error('「' + name + '」匹配到多个候选：' + tier(r.candidates) + '。请写全名或用 id。');
    }
    throw new Error('没有找到清单「' + name + '」。现有清单用 ./todoctl cats 查看；新建清单：./todoctl cat add <清单名> --folder <分组>');
  },
  // 读操作专用：允许按分组名筛选（展开成该分组下所有清单）
  catIdsForFilter(name) {
    const r = __H.resolveCatName(name);
    if (r.kind === 'none') return [0];
    if (r.kind === 'cat') return [r.cat.id];
    if (r.kind === 'folder') return r.candidates.map((c) => c.id);
    if (r.ambiguous) throw new Error('「' + name + '」匹配到多个候选：' + r.candidates.map((c) => c.name).join('、'));
    throw new Error('没有找到清单或分组「' + name + '」（用 ./todoctl cats / folders 查看）');
  },
  catIdByName(name) {
    return __H.catIdForWrite(name);
  },
  folderOfCat(catId) {
    const c = __H.cats().filter((x) => x.id === catId)[0];
    if (!c || !c.folderId) return null;
    const f = __H.cats().filter((x) => x.id === c.folderId)[0];
    return f ? f.name : null;
  },
  catName(id) {
    if (!id) return '未分类';
    const hit = __H.cats().filter((c) => c.id === id)[0];
    return hit ? hit.name : String(id);
  },
  alive() { return (__s.state.todo.todoList || []).filter((t) => !t.delete); },
  inTrash() { return (__s.state.todo.todoList || []).filter((t) => t.delete); },
  parseSubs(str) {
    if (!str) return [];
    const out = [];
    const re = /- \[(.)]([\s\S]*?)(?:\[end]|$)/g;
    let m;
    while ((m = re.exec(str)) !== null) {
      const text = (m[2] || '').trim();
      if (text) out.push({ done: !!m[1].trim(), text: text });
    }
    return out;
  },
  buildSubs(items) {
    return items.map((x) => x.trim()).filter(Boolean)
      .map((x) => (/^x:/i.test(x) ? '- [x]' + x.slice(2) : '- [ ]' + x))
      .join('[end] -');
  },
  tagsOf(t) {
    const out = [];
    const re = /#@([^\s#@]+)/g;
    let m;
    while ((m = re.exec(t.taskContent || '')) !== null) out.push(m[1]);
    return out;
  },
  resolve(target, opts) {
    const scope = (opts && opts.scope) === 'trash' ? __H.inTrash() : __H.alive();
    const q = String(target || '');
    if (!q) throw new Error('请给出待办（taskId 前缀或内容关键词）');
    let hit = scope.filter((t) => t.taskId === q);
    if (!hit.length) hit = scope.filter((t) => String(t.taskId).startsWith(q));
    if (!hit.length) hit = scope.filter((t) => (t.taskContent || '').toLowerCase().includes(q.toLowerCase()));
    if (!hit.length) throw new Error('没找到待办: ' + q);
    if (hit.length > 1) {
      throw new Error('匹配到 ' + hit.length + ' 条，请更精确或用 taskId：\n' +
        hit.slice(0, 10).map((t) => '  ' + t.taskId + '  ' + t.taskContent).join('\n'));
    }
    return hit[0];
  },
  resolveAll(target, opts) {
    const scope = (opts && opts.scope) === 'trash' ? __H.inTrash() : __H.alive();
    const q = String(target || '');
    if (!q) throw new Error('请给出待办（taskId 前缀或内容关键词）');
    let hit = scope.filter((t) => t.taskId === q);
    if (!hit.length) hit = scope.filter((t) => String(t.taskId).startsWith(q));
    if (!hit.length) hit = scope.filter((t) => (t.taskContent || '').toLowerCase().includes(q.toLowerCase()));
    if (!hit.length) throw new Error('没找到待办: ' + q);
    return hit;
  },
  row(t) {
    const subs = __H.parseSubs(t.standbyStr2);
    return {
      id: t.taskId,
      content: t.taskContent,
      done: !!t.complete,
      date: __H.fmtDate(t.todoTime),
      cat: __H.catName(t.standbyInt1),
      catId: t.standbyInt1 || 0,
      folder: __H.folderOfCat(t.standbyInt1),
      tags: __H.tagsOf(t),
      desc: t.taskDescribe || null,
      subs: subs,
      subProgress: subs.length ? subs.filter((x) => x.done).length + '/' + subs.length : null,
      difficulty: t.snowAssess || null,
      reminder: t.reminderTime ? __H.fmtTime(t.reminderTime) : null,
      repeat: t.standbyStr1 && t.standbyStr1 !== 'null' ? t.standbyStr1 : null,
      created: t.createTime ? new Date(t.createTime).toISOString() : null,
      updated: t.updateTime ? new Date(t.updateTime).toISOString() : null,
      deleted: !!t.delete,
    };
  },
  async sync() {
    try {
      await Promise.race([__s.dispatch('todo/syncTodos'), new Promise((r) => setTimeout(r, 4000))]);
    } catch (e) {}
  },
};
`;

module.exports = { PRELUDE };
