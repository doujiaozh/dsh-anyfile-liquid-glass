#!/usr/bin/env node
/* ============================================================
 * cli/oracle.js — AnyFile Liquid Glass
 * Node 命令行版文件特征嗅探（零依赖，CommonJS，Win7 友好）
 *
 * 用法 / Usage:
 *   node cli/oracle.js <文件路径> [文件路径...]
 *
 * 输出每个文件的 JSON 特征画像：
 *   图片   → 名称/大小/魔数（Node 侧无 Canvas，主色调请在浏览器版提取）
 *   文本   → 前 10 行核心字符 + 语言签名色
 *   其他   → 名称/大小/魔数
 * ============================================================ */
'use strict';

var fs = require('fs');
var path = require('path');

var MAX_LINES = 10;
var MAX_LINE_LEN = 100;

var SIGNATURES = [
  ['png jpg jpeg gif webp bmp ico avif svg', 'image', '#38bdf8', 'Image'],
  ['js mjs cjs', 'code', '#f7df1e', 'JavaScript'],
  ['ts', 'code', '#3178c6', 'TypeScript'],
  ['py pyw', 'code', '#3776ab', 'Python'],
  ['java', 'code', '#f89820', 'Java'],
  ['go', 'code', '#00add8', 'Go'],
  ['rs', 'code', '#dea584', 'Rust'],
  ['c h', 'code', '#8a94a6', 'C'],
  ['cpp cc hpp', 'code', '#00599c', 'C++'],
  ['html htm', 'code', '#e34c26', 'HTML'],
  ['css scss', 'code', '#1572b6', 'CSS'],
  ['json', 'code', '#a3a327', 'JSON'],
  ['md markdown', 'text', '#42a5f5', 'Markdown'],
  ['txt text log ini conf', 'text', '#9aa4b2', 'Text']
];

var MAGICS = [
  [[0x89, 0x50, 0x4E, 0x47], 'PNG image'],
  [[0xFF, 0xD8, 0xFF], 'JPEG image'],
  [[0x47, 0x49, 0x46, 0x38], 'GIF image'],
  [[0x52, 0x49, 0x46, 0x46], 'RIFF / WebP'],
  [[0x25, 0x50, 0x44, 0x46], 'PDF document'],
  [[0x50, 0x4B, 0x03, 0x04], 'ZIP / Office archive'],
  [[0x1F, 0x8B], 'GZIP stream'],
  [[0x4D, 0x5A], 'Windows PE executable'],
  [[0x7F, 0x45, 0x4C, 0x46], 'ELF executable'],
  [[0x4F, 0x67, 0x67, 0x53], 'Ogg media']
];

function humanSize(bytes) {
  if (!bytes) return '0 B';
  var units = ['B', 'KB', 'MB', 'GB', 'TB'];
  var i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  var v = bytes / Math.pow(1024, i);
  return (v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)) + ' ' + units[i];
}

function lookup(ext) {
  for (var i = 0; i < SIGNATURES.length; i++) {
    if (SIGNATURES[i][0].split(' ').indexOf(ext) >= 0) return SIGNATURES[i];
  }
  return null;
}

function detectMagic(head) {
  for (var i = 0; i < MAGICS.length; i++) {
    var m = MAGICS[i][0], hit = true;
    for (var j = 0; j < m.length; j++) { if (head[j] !== m[j]) { hit = false; break; } }
    if (hit) return MAGICS[i][1];
  }
  return '未知 / unknown';
  }

function looksLikeText(buf) {
  if (!buf.length) return true;
  var printable = 0;
  for (var i = 0; i < buf.length; i++) {
    var c = buf[i];
    if (c === 0) return false;
    if (c === 0x09 || c === 0x0A || c === 0x0D || (c >= 0x20 && c <= 0x7E) || c >= 0x80) printable++;
  }
  return printable / buf.length >= 0.9;
}

function sniff(filePath) {
  var name = path.basename(filePath);
  var ext = (path.extname(name).slice(1) || '').toLowerCase();
  var stat = fs.statSync(filePath);
  var fd = fs.openSync(filePath, 'r');
  var head = Buffer.alloc(512);
  var n = fs.readSync(fd, head, 0, 512, 0);
  fs.closeSync(fd);
  head = head.slice(0, n);

  var base = {
    name: name,
    path: path.resolve(filePath),
    ext: ext,
    size: stat.size,
    prettySize: humanSize(stat.size),
    isDirectory: stat.isDirectory()
  };
  if (base.isDirectory) return Object.assign(base, { category: 'directory' });

  var sig = lookup(ext);
  var magic = detectMagic(head.slice(0, 16));
  var hex = [];
  for (var i = 0; i < head.length && i < 16; i++) {
    hex.push(head[i].toString(16).toUpperCase().padStart(2, '0'));
  }

  if (sig && (sig[1] === 'code' || sig[1] === 'text')) {
    var raw = head.slice(0, 4096).toString('utf8');
    var lines = raw.split(/\r\n|\r|\n/).slice(0, MAX_LINES)
      .map(function (l) { return l.length > MAX_LINE_LEN ? l.slice(0, MAX_LINE_LEN) : l; });
    return Object.assign(base, {
      category: sig[1],
      lang: sig[3],
      accent: sig[2],
      magic: magic,
      hex: hex,
      lines: lines,
      totalLines: raw.split(/\r\n|\r|\n/).length
    });
  }
  if (looksLikeText(head)) {
    var raw2 = head.slice(0, 4096).toString('utf8');
    return Object.assign(base, {
      category: 'text',
      lang: 'Text',
      accent: '#9aa4b2',
      magic: magic,
      hex: hex,
      lines: raw2.split(/\r\n|\r|\n/).slice(0, MAX_LINES)
        .map(function (l) { return l.length > MAX_LINE_LEN ? l.slice(0, MAX_LINE_LEN) : l; }),
      autoDetected: true
    });
  }
  return Object.assign(base, {
    category: 'binary',
    lang: ext ? ext.toUpperCase() : 'Binary',
    accent: '#8b7cf6',
    magic: magic,
    hex: hex
  });
}

function main() {
  var args = process.argv.slice(2);
  if (!args.length) {
    console.error('用法: node cli/oracle.js <文件路径> [文件路径...]');
    process.exit(1);
  }
  var out = [];
  args.forEach(function (p) {
    if (!fs.existsSync(p)) {
      console.error('[skip] 文件不存在: ' + p);
      return;
    }
    try { out.push(sniff(p)); }
    catch (e) { console.error('[error] ' + p + ': ' + e.message); }
  });
  console.log(JSON.stringify(out.length === 1 ? out[0] : out, null, 2));
}

if (require.main === module) main();
module.exports = { sniff: sniff, humanSize: humanSize };
