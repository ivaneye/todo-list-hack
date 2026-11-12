#!/usr/bin/env node
// 无依赖 asar 解包 / 打包 / 校验
// 用法：
//   node asar-tool.js extract <asar> <dir>
//   node asar-tool.js pack <dir> <out.asar> <原asar（用于取 unpacked 清单）>
//   node asar-tool.js verify <原asar> <新asar>
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function readHeader(asarPath) {
  const fd = fs.openSync(asarPath, 'r');
  const b = Buffer.alloc(16);
  fs.readSync(fd, b, 0, 16, 0);
  const headerLen = b.readUInt32LE(12);
  const hb = Buffer.alloc(headerLen);
  fs.readSync(fd, hb, 0, headerLen, 16);
  return { fd, header: JSON.parse(hb.toString('utf8')), base: 16 + headerLen };
}

function extract(asarPath, outDir) {
  const { fd, header, base } = readHeader(asarPath);
  fs.rmSync(outDir, { recursive: true, force: true });
  let count = 0;
  (function walk(node, dir) {
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, item] of Object.entries(node.files || {})) {
      const p = path.join(dir, name);
      if (item.files) { walk(item, p); continue; }
      if (item.link) { try { fs.symlinkSync(item.link, p); } catch (e) {} continue; }
      const size = item.size || 0;
      const off = Number(item.offset);
      const buf = Buffer.alloc(size);
      if (size && !isNaN(off)) fs.readSync(fd, buf, 0, size, base + off);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, buf);
      count++;
    }
  })(header, outDir);
  fs.closeSync(fd);
  return count;
}

function listUnpacked(asarPath) {
  const { header, fd } = readHeader(asarPath);
  fs.closeSync(fd);
  const set = new Set();
  (function walk(node, prefix) {
    for (const [name, item] of Object.entries(node.files || {})) {
      const rel = prefix ? prefix + '/' + name : name;
      if (item.files) walk(item, rel);
      else if (item.unpacked) set.add(rel);
    }
  })(header, '');
  return set;
}

function pack(srcDir, outFile, unpackedSet) {
  const root = { files: {} };
  let offset = 0;
  const chunks = [];
  (function walk(dirAbs, node) {
    const entries = fs.readdirSync(dirAbs, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const ent of entries) {
      const abs = path.join(dirAbs, ent.name);
      const rel = path.relative(srcDir, abs).split(path.sep).join('/');
      if (ent.isDirectory()) {
        const sub = { files: {} };
        walk(abs, sub);
        node.files[ent.name] = sub;
      } else if (ent.isSymbolicLink()) {
        node.files[ent.name] = { link: fs.readlinkSync(abs) };
      } else {
        const st = fs.statSync(abs);
        if (unpackedSet && unpackedSet.has(rel)) {
          node.files[ent.name] = { size: st.size, offset: '0', unpacked: true };
        } else {
          const buf = fs.readFileSync(abs);
          node.files[ent.name] = { size: buf.length, offset: String(offset) };
          chunks.push(buf);
          offset += buf.length;
        }
      }
    }
  })(srcDir, root);

  let json = JSON.stringify(root);
  while (json.length % 4 !== 0) json += ' ';
  const jsonBuf = Buffer.from(json, 'utf8');
  const headerPickle = Buffer.alloc(8 + jsonBuf.length);
  headerPickle.writeUInt32LE(4 + jsonBuf.length, 0); // pickle payload
  headerPickle.writeUInt32LE(jsonBuf.length, 4); // string length
  jsonBuf.copy(headerPickle, 8);
  const sizeBuf = Buffer.alloc(8);
  sizeBuf.writeUInt32LE(4, 0);
  sizeBuf.writeUInt32LE(headerPickle.length, 4);

  const fd = fs.openSync(outFile, 'w');
  let pos = 0;
  const write = (b) => { fs.writeSync(fd, b, 0, b.length, pos); pos += b.length; };
  write(sizeBuf);
  write(headerPickle);
  for (const c of chunks) write(c);
  fs.fsyncSync(fd);
  fs.closeSync(fd);
  return { size: pos };
}

function hashes(asarPath) {
  const { fd, header, base } = readHeader(asarPath);
  const out = new Map();
  (function walk(node, prefix) {
    for (const [name, item] of Object.entries(node.files || {})) {
      const rel = prefix ? prefix + '/' + name : name;
      if (item.files) { walk(item, rel); continue; }
      if (item.link || item.unpacked) continue;
      const buf = Buffer.alloc(item.size || 0);
      if (buf.length) fs.readSync(fd, buf, 0, buf.length, base + Number(item.offset));
      out.set(rel, crypto.createHash('sha256').update(buf).digest('hex'));
    }
  })(header, '');
  fs.closeSync(fd);
  return out;
}

function readFileFromAsar(asarPath, relPath) {
  const { fd, header, base } = readHeader(asarPath);
  const parts = relPath.split('/');
  let node = header;
  for (const part of parts) {
    node = node.files && node.files[part];
    if (!node) { fs.closeSync(fd); throw new Error('asar 内没有 ' + relPath); }
  }
  const buf = Buffer.alloc(node.size || 0);
  if (buf.length) fs.readSync(fd, buf, 0, buf.length, base + Number(node.offset));
  fs.closeSync(fd);
  return buf.toString('utf8');
}

const [cmd, a, b, c] = process.argv.slice(2);
if (cmd === 'extract') {
  console.log('extracted', extract(a, b), 'files');
} else if (cmd === 'pack') {
  console.log('packed', pack(a, b, listUnpacked(c)));
} else if (cmd === 'verify') {
  const oldH = hashes(a);
  const newH = hashes(b);
  const changed = [];
  for (const [k, v] of oldH) if (newH.get(k) !== v) changed.push(k);
  for (const k of newH.keys()) if (!oldH.has(k)) changed.push(k + ' (new)');
  console.log('文件数', oldH.size, '/', newH.size, '变更:', changed.length ? changed.join(', ') : '无');
} else if (cmd === 'getfile') {
  process.stdout.write(readFileFromAsar(a, b));
} else {
  console.error('usage: extract <asar> <dir> | pack <dir> <out> <origAsar> | verify <orig> <new>');
  process.exit(1);
}
