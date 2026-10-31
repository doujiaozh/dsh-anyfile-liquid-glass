'use strict';
/* verify-gif.js — 用独立 GIF LZW 解码器对 make-gif.js 的产物做往返自检
 * 解码 assets/demo.gif 全部帧 → 与原 PNG 裁剪+量化结果逐像素比对。
 */
var fs = require('fs');
var path = require('path');
var zlib = require('zlib');

var CROP = { x: 958, y: 404, w: 288, h: 300 };
var CUBE = [0, 51, 102, 153, 204, 255];
var RGB2IDX = Object.create(null);
var PALETTE = [];
(function () {
  for (var r = 0; r < 6; r++) for (var g = 0; g < 6; g++) for (var b = 0; b < 6; b++) {
    var key = (CUBE[r] << 16) | (CUBE[g] << 8) | CUBE[b];
    RGB2IDX[key] = PALETTE.length / 3;
    PALETTE.push(CUBE[r], CUBE[g], CUBE[b]);
  }
})();
function quantize(r, g, b) {
  return RGB2IDX[(CUBE[Math.min(5, Math.round(r / 51))] << 16) |
    (CUBE[Math.min(5, Math.round(g / 51))] << 8) | CUBE[Math.min(5, Math.round(b / 51))]];
}

/* ---- PNG 解码（与 make-gif.js 相同，独立复刻以交叉验证） ---- */
function decodePNG(buf) {
  var pos = 8, ihdr = null, idats = [];
  while (pos < buf.length) {
    var len = buf.readUInt32BE(pos);
    var type = buf.toString('ascii', pos + 4, pos + 8);
    if (type === 'IHDR') ihdr = buf.slice(pos + 8, pos + 8 + len);
    if (type === 'IDAT') idats.push(buf.slice(pos + 8, pos + 8 + len));
    pos += 12 + len;
  }
  var w = ihdr.readUInt32BE(0), h = ihdr.readUInt32BE(4);
  var ch = ihdr[9] === 6 ? 4 : 3;
  var raw = zlib.inflateSync(Buffer.concat(idats));
  var stride = w * ch, out = Buffer.alloc(stride * h), prev = Buffer.alloc(stride), off = 0;
  for (var y = 0; y < h; y++) {
    var ft = raw[off++];
    var line = raw.slice(off, off + stride); off += stride;
    var cur = Buffer.alloc(stride);
    for (var x = 0; x < stride; x++) {
      var a = x >= ch ? cur[x - ch] : 0, b = prev[x], c = x >= ch ? prev[x - ch] : 0;
      var v = line[x];
      cur[x] = ft === 0 ? v :
        ft === 1 ? (v + a) & 255 :
        ft === 2 ? (v + b) & 255 :
        ft === 3 ? (v + ((a + b) >> 1)) & 255 :
        (v + (((((a + b - c) - a) >= 0 ? (a + b - c - a) : -(a + b - c - a)) <= (((a + b - c) - b) >= 0 ? (a + b - c - b) : -(a + b - c - b)) &&
          (Math.abs(a + b - c - a) <= Math.abs(a + b - c - c)) ? a : (Math.abs(a + b - c - b) <= Math.abs(a + b - c - c) ? b : c)))) & 255;
    }
    cur.copy(out, y * stride); prev = cur;
  }
  return { w: w, h: h, ch: ch, data: out };
}

function expectedFromPNG(file) {
  var img = decodePNG(fs.readFileSync(file));
  var idx = new Uint8Array(CROP.w * CROP.h);
  for (var j = 0; j < CROP.h; j++) {
    for (var i = 0; i < CROP.w; i++) {
      var s = ((CROP.y + j) * img.w + (CROP.x + i)) * img.ch;
      idx[j * CROP.w + i] = quantize(img.data[s], img.data[s + 1], img.data[s + 2]);
    }
  }
  return idx;
}

/* ---- GIF 解码 ---- */
function decodeGIF(buf) {
  if (buf.slice(0, 6).toString('ascii') !== 'GIF89a' &&
      buf.slice(0, 6).toString('ascii') !== 'GIF87a') throw new Error('bad GIF header');
  var w = buf.readUInt16LE(6), h = buf.readUInt16LE(8);
  var gctFlag = buf[10] & 0x80, gctSize = 2 << (buf[10] & 7);
  var pos = 13;
  var pal = null;
  if (gctFlag) { pal = buf.slice(pos, pos + gctSize * 3); pos += gctSize * 3; }
  var frames = [];
  while (pos < buf.length) {
    var b = buf[pos];
    if (b === 0x3B) break;                       // trailer
    if (b === 0x21) {                            // extension
      var label = buf[pos + 1];
      pos += 2;
      if (label === 0xF9) { pos += 6; }          // GCE: size(1)+data(4)+term(1)
      else { while (buf[pos] !== 0) pos += buf[pos] + 1; pos++; } // 跳过子块
      continue;
    }
    if (b === 0x2C) {                            // image descriptor
      var left = buf.readUInt16LE(pos + 1), top = buf.readUInt16LE(pos + 3);
      var iw = buf.readUInt16LE(pos + 5), ih = buf.readUInt16LE(pos + 7);
      var lct = buf[pos + 9] & 0x80;
      pos += 10;
      if (lct) { var lp = buf.slice(pos, pos + (2 << (buf[pos - 1] & 7)) * 3); pos += lp.length; }
      var minCode = buf[pos++];
      // 汇总子块
      var data = [], n;
      while ((n = buf[pos++]) !== 0) { for (var k = 0; k < n; k++) data.push(buf[pos++]); }
      var pixels = lzwDecode(minCode, data);
      frames.push({ left: left, top: top, w: iw, h: ih, pixels: pixels });
      continue;
    }
    throw new Error('unexpected block 0x' + b.toString(16) + ' at ' + pos);
  }
  return { w: w, h: h, frames: frames };
}

function lzwDecode(minCodeSize, bytes) {
  var clearCode = 1 << minCodeSize, endCode = clearCode + 1;
  var codeSize, table, nextCode, prev;
  // 位读取器
  var bitPos = 0;
  function readCode(size) {
    var byteIdx = bitPos >> 3, bitOff = bitPos & 7;
    var v = 0, bits = 0;
    while (bits < size) {
      var chunk = bytes[byteIdx] >> bitOff;
      var take = Math.min(8 - bitOff, size - bits);
      v |= (chunk & ((1 << take) - 1)) << bits;
      bits += take; bitPos += take; bitOff = 0; byteIdx++;
    }
    return v;
  }
  function reset() {
    table = []; nextCode = endCode + 1; codeSize = minCodeSize + 1;
    for (var i = 0; i < clearCode; i++) table[i] = [i];
  }
  reset();
  var out = [];
  for (;;) {
    var code = readCode(codeSize);
    if (code === clearCode) { reset(); prev = null; continue; }
    if (code === endCode) break;
    var entry;
    if (code < nextCode) entry = table[code];
    else if (code === nextCode && prev !== null) entry = table[prev].concat(table[prev][0]);
    else throw new Error('LZW 无效码: ' + code + ' (nextCode=' + nextCode + ')');
    for (var i = 0; i < entry.length; i++) out.push(entry[i]);
    if (prev !== null && nextCode < 4096) {
      table[nextCode++] = table[prev].concat(entry[0]);
      if (nextCode === (1 << codeSize) && codeSize < 12) codeSize++;
    }
    prev = code;
  }
  return out;
}

/* ---- 主流程 ----
 * 无参数：demo.gif 往返自检
 * 参数1=外部 gif 路径：只解码，报告帧信息（用于校验解码器对真实 GIF 的兼容性）
 */
function main() {
  var target = process.argv[2]
    ? fs.readFileSync(process.argv[2])
    : fs.readFileSync(path.join(__dirname, 'demo.gif'));
  var gif = decodeGIF(target);
  console.log('GIF logical screen: ' + gif.w + 'x' + gif.h + ', frames: ' + gif.frames.length);

  if (process.argv[2]) {
    gif.frames.forEach(function (f, i) {
      console.log('  frame ' + i + ': ' + f.w + 'x' + f.h + ' @(' + f.left + ',' + f.top + ') pixels=' + f.pixels.length);
    });
    return;
  }

  var files = fs.readdirSync(path.join(__dirname, 'frames'))
    .filter(function (f) { return /^f-\d+\.png$/.test(f); }).sort();
  if (gif.frames.length !== files.length) throw new Error('帧数不匹配: ' + gif.frames.length + ' vs ' + files.length);

  var mismatch = 0, total = 0;
  for (var i = 0; i < files.length; i++) {
    var expected = expectedFromPNG(path.join(__dirname, 'frames', files[i]));
    var got = gif.frames[i].pixels;
    if (got.length !== expected.length) throw new Error('帧 ' + i + ' 像素数不符: ' + got.length + ' vs ' + expected.length);
    for (var p = 0; p < got.length; p++) { total++; if (got[p] !== expected[p]) mismatch++; }
  }
  var pct = (mismatch / total * 100).toFixed(3);
  console.log('比对像素 ' + total + '，不符 ' + mismatch + '（' + pct + '%）');
  if (mismatch === 0) { console.log('PASS: GIF 往返自检完全一致'); process.exit(0); }
  else { console.log('FAIL: GIF 内容与源帧不一致'); process.exit(1); }
}

main();
