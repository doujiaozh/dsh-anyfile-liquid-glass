'use strict';
/* assets/frames/f-XX.png → assets/demo.gif
 * 纯 Node 实现：PNG 解码（zlib）→ 裁剪 → 216 色量化 → GIF89a/LZW 编码
 * 零依赖，Win7 友好。
 */
var fs = require('fs');
var path = require('path');
var zlib = require('zlib');

var FRAMES_DIR = path.join(__dirname, 'frames');
var OUT = path.join(__dirname, 'demo.gif');
var CROP = { x: 958, y: 404, w: 288, h: 300 }; // aurora.png 卡片区域
var DELAY_CS = 12; // 每帧 120ms

/* ---------------- PNG 解码 ---------------- */
function decodePNG(buf) {
  if (buf.slice(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('not a PNG');
  var pos = 8, ihdr = null, idats = [];
  while (pos < buf.length) {
    var len = buf.readUInt32BE(pos);
    var type = buf.toString('ascii', pos + 4, pos + 8);
    var data = buf.slice(pos + 8, pos + 8 + len);
    if (type === 'IHDR') ihdr = data;
    else if (type === 'IDAT') idats.push(data);
    pos += 12 + len;
  }
  var w = ihdr.readUInt32BE(0), h = ihdr.readUInt32BE(4);
  var bitDepth = ihdr[8], colorType = ihdr[9], interlace = ihdr[12];
  if (bitDepth !== 8) throw new Error('unsupported bit depth ' + bitDepth);
  if (interlace !== 0) throw new Error('interlaced PNG not supported');
  var channels = colorType === 6 ? 4 : (colorType === 2 ? 3 : (colorType === 4 ? 2 : 1));
  var raw = zlib.inflateSync(Buffer.concat(idats));
  var stride = w * channels;
  var bpp = channels;
  var out = Buffer.alloc(w * h * channels);
  var prev = Buffer.alloc(stride);
  var off = 0;
  for (var y = 0; y < h; y++) {
    var ftype = raw[off++];
    var line = raw.slice(off, off + stride); off += stride;
    var cur = Buffer.alloc(stride);
    for (var x = 0; x < stride; x++) {
      var a = x >= bpp ? cur[x - bpp] : 0;     // 左
      var b = prev[x];                          // 上
      var c = x >= bpp ? prev[x - bpp] : 0;     // 左上
      var v = line[x];
      switch (ftype) {
        case 0: cur[x] = v; break;
        case 1: cur[x] = (v + a) & 0xff; break;
        case 2: cur[x] = (v + b) & 0xff; break;
        case 3: cur[x] = (v + ((a + b) >> 1)) & 0xff; break;
        case 4: {
          var p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          var pred = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
          cur[x] = (v + pred) & 0xff; break;
        }
        default: throw new Error('bad filter ' + ftype);
      }
    }
    cur.copy(out, y * stride);
    prev = cur;
  }
  return { w: w, h: h, channels: channels, data: out };
}

/* 裁剪并转为 RGB（忽略 alpha，合成到不透明背景） */
function cropRGB(img, x, y, w, h) {
  var buf = Buffer.alloc(w * h * 3);
  var bg = [5, 6, 12];
  for (var j = 0; j < h; j++) {
    for (var i = 0; i < w; i++) {
      var s = ((y + j) * img.w + (x + i)) * img.channels;
      var d = (j * w + i) * 3;
      var r = img.data[s], g = img.data[s + 1], b = img.data[s + 2];
      var a = img.channels === 4 ? img.data[s + 3] / 255 : 1;
      buf[d] = Math.round(r * a + bg[0] * (1 - a));
      buf[d + 1] = Math.round(g * a + bg[1] * (1 - a));
      buf[d + 2] = Math.round(b * a + bg[2] * (1 - a));
    }
  }
  return buf;
}

/* ---------------- 216 色（6×6×6 web cube）量化 ---------------- */
var CUBE = [0, 51, 102, 153, 204, 255];
var PALETTE = [];
var RGB2IDX = Object.create(null);
(function () {
  for (var r = 0; r < 6; r++) for (var g = 0; g < 6; g++) for (var b = 0; b < 6; b++) {
    var rr = CUBE[r], gg = CUBE[g], bb = CUBE[b];
    var idx = PALETTE.length / 3;
    PALETTE.push(rr, gg, bb);
    RGB2IDX[(rr << 16) | (gg << 8) | bb] = idx;
  }
  while (PALETTE.length < 256 * 3) PALETTE.push(0, 0, 0); // 补齐 256 项
})();

function quantize(rgb) {
  var r = rgb[0], g = rgb[1], b = rgb[2];
  var rr = CUBE[Math.min(5, Math.round(r / 51))];
  var gg = CUBE[Math.min(5, Math.round(g / 51))];
  var bb = CUBE[Math.min(5, Math.round(b / 51))];
  return RGB2IDX[(rr << 16) | (gg << 8) | bb];
}

/* ---------------- GIF LZW 编码 ---------------- */
function lzwEncode(indices) {
  var minCodeSize = 8;
  var clearCode = 1 << minCodeSize;
  var endCode = clearCode + 1;
  var dict = Object.create(null);
  var dictSize = endCode + 1;
  var codeSize = minCodeSize + 1;
  var out = [];
  var cur = -1;
  var chunkBits = 0, chunkCount = 0;

  function emit(code) {
    chunkBits |= code << chunkCount;
    chunkCount += codeSize;
    while (chunkCount >= 8) { out.push(chunkBits & 0xff); chunkBits >>= 8; chunkCount -= 8; }
  }

  function resetDict() {
    dict = Object.create(null);
    dictSize = endCode + 1;
    codeSize = minCodeSize + 1;
  }

  emit(clearCode);
  for (var i = 0; i < indices.length; i++) {
    var k = indices[i];
    var key = cur + ':' + k;
    if (cur === -1) { cur = k; }
    else if (dict[key] !== undefined) { cur = dict[key]; }
    else {
      emit(cur);
      if (dictSize < 4096) {
        // 码宽增长必须在「加条目之前」判定：解码端每读一个码才新增条目，
        // 比编码端滞后一个码；编码端提前一个码切换码宽会导致错位。
        if (dictSize === (1 << codeSize) && codeSize < 12) codeSize++;
        dict[key] = dictSize++;
      } else {
        emit(clearCode);
        resetDict();
      }
      cur = k;
    }
  }
  if (cur !== -1) emit(cur);
  emit(endCode);
  if (chunkCount > 0) out.push(chunkBits & 0xff);
  return { minCodeSize: minCodeSize, bytes: Buffer.from(out) };
}

/* ---------------- 组装 GIF ---------------- */
function u16(v) { return [v & 0xff, (v >> 8) & 0xff]; }

function buildGIF(frames, w, h) {
  var parts = [];
  parts.push(Buffer.from('GIF89a', 'ascii'));
  // Logical Screen Descriptor
  parts.push(Buffer.from(u16(w).concat(u16(h), [
    0xF7, // 256 色全局色表 (2^8)
    0x00, // 背景色索引
    0x00  // 像素纵横比
  ])));
  parts.push(Buffer.from(PALETTE));
  // Netscape 循环扩展
  parts.push(Buffer.concat([
    Buffer.from([0x21, 0xFF, 0x0B]),
    Buffer.from('NETSCAPE2.0', 'ascii'),
    Buffer.from([0x03, 0x01, 0x00, 0x00, 0x00])
  ]));

  frames.forEach(function (frame) {
    // Graphic Control Extension
    parts.push(Buffer.from([0x21, 0xF9, 0x04, 0x00].concat(u16(DELAY_CS), [0x00, 0x00])));
    // Image Descriptor
    parts.push(Buffer.from([0x2C].concat(u16(0), u16(0), u16(w), u16(h), [0x00])));
    // 图像数据
    var lzw = lzwEncode(frame);
    parts.push(Buffer.from([lzw.minCodeSize]));
    var bs = lzw.bytes, p = 0;
    while (p < bs.length) {
      var n = Math.min(255, bs.length - p);
      parts.push(Buffer.from([n]));
      parts.push(bs.slice(p, p + n));
      p += n;
    }
    parts.push(Buffer.from([0x00]));
  });

  parts.push(Buffer.from([0x3B])); // Trailer
  return Buffer.concat(parts);
}

/* ---------------- 主流程 ---------------- */
function main() {
  var files = fs.readdirSync(FRAMES_DIR)
    .filter(function (f) { return /^f-\d+\.png$/.test(f); })
    .sort()
    .map(function (f) { return path.join(FRAMES_DIR, f); });
  if (!files.length) throw new Error('no frames in ' + FRAMES_DIR);
  console.log('frames: ' + files.length);

  var frames = files.map(function (f) {
    var img = decodePNG(fs.readFileSync(f));
    var rgb = cropRGB(img, CROP.x, CROP.y, CROP.w, CROP.h);
    var idx = new Uint8Array(CROP.w * CROP.h);
    var rgbArr = new Uint8Array(rgb); // 取前 3 字节逐像素
    for (var p = 0; p < idx.length; p++) {
      idx[p] = quantize([rgbArr[p * 3], rgbArr[p * 3 + 1], rgbArr[p * 3 + 2]]);
    }
    return idx;
  });

  var gif = buildGIF(frames, CROP.w, CROP.h);
  fs.writeFileSync(OUT, gif);
  console.log('written ' + OUT + ' (' + (gif.length / 1024).toFixed(1) + ' KB)');
}

main();
