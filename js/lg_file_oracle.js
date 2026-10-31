/* ============================================================
 * lg_file_oracle.js — AnyFile Liquid Glass
 * 任意文件特征嗅探与提取（纯前端，零依赖）
 *
 *   图片   → Canvas getImageData 提取主色调
 *   文本   → 前 10 行核心字符 + 语言签名色
 *   二进制 → 文件名 / 大小 / 魔数
 *
 * 暴露：window.FileOracle
 * ============================================================ */
(function (global) {
  'use strict';

  var MAX_LINES = 10;      // 提取前 10 行
  var MAX_LINE_LEN = 100;  // 每行截断长度
  var PEEK_BYTES = 8192;   // 文本嗅探窗口

  /* 扩展名签名表：标志性颜色 + 语言 */
  var SIGNATURES = [
    { ext: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif', 'svg'], kind: 'image', color: '#38bdf8', lang: 'Image' },
    { ext: ['js', 'mjs', 'cjs'], kind: 'code', color: '#f7df1e', lang: 'JavaScript' },
    { ext: ['ts'],               kind: 'code', color: '#3178c6', lang: 'TypeScript' },
    { ext: ['py', 'pyw'],        kind: 'code', color: '#3776ab', lang: 'Python' },
    { ext: ['java'],             kind: 'code', color: '#f89820', lang: 'Java' },
    { ext: ['go'],               kind: 'code', color: '#00add8', lang: 'Go' },
    { ext: ['rs'],               kind: 'code', color: '#dea584', lang: 'Rust' },
    { ext: ['c', 'h'],           kind: 'code', color: '#8a94a6', lang: 'C' },
    { ext: ['cpp', 'cc', 'hpp'], kind: 'code', color: '#00599c', lang: 'C++' },
    { ext: ['cs'],               kind: 'code', color: '#9b4f96', lang: 'C#' },
    { ext: ['html', 'htm'],      kind: 'code', color: '#e34c26', lang: 'HTML' },
    { ext: ['css', 'scss'],      kind: 'code', color: '#1572b6', lang: 'CSS' },
    { ext: ['json'],             kind: 'code', color: '#a3a327', lang: 'JSON' },
    { ext: ['xml'],              kind: 'code', color: '#e37933', lang: 'XML' },
    { ext: ['yml', 'yaml'],      kind: 'code', color: '#cb171e', lang: 'YAML' },
    { ext: ['sql'],              kind: 'code', color: '#e38c2a', lang: 'SQL' },
    { ext: ['sh', 'bash'],       kind: 'code', color: '#89e051', lang: 'Shell' },
    { ext: ['md', 'markdown'],   kind: 'text', color: '#42a5f5', lang: 'Markdown' },
    { ext: ['txt', 'text', 'log', 'ini', 'conf'], kind: 'text', color: '#9aa4b2', lang: 'Text' }
  ];

  /* 常见魔数（前 2~8 字节） */
  var MAGICS = [
    [[0x89, 0x50, 0x4E, 0x47], 'PNG image'],
    [[0xFF, 0xD8, 0xFF], 'JPEG image'],
    [[0x47, 0x49, 0x46, 0x38], 'GIF image'],
    [[0x52, 0x49, 0x46, 0x46], 'RIFF / WebP'],
    [[0x25, 0x50, 0x44, 0x46], 'PDF document'],
    [[0x50, 0x4B, 0x03, 0x04], 'ZIP / Office archive'],
    [[0x1F, 0x8B], 'GZIP stream'],
    [[0x37, 0x7A, 0xBC, 0xAF], '7-Zip archive'],
    [[0x52, 0x61, 0x72, 0x21], 'RAR archive'],
    [[0x4D, 0x5A], 'Windows PE executable'],
    [[0x7F, 0x45, 0x4C, 0x46], 'ELF executable'],
    [[0xD0, 0xCF, 0x11, 0xE0], 'Legacy Office document'],
    [[0x00, 0x00, 0x01, 0x00], 'ICO / CUR icon'],
    [[0x4F, 0x67, 0x67, 0x53], 'Ogg media'],
    [[0x1A, 0x45, 0xDF, 0xA3], 'Matroska / WebM'],
    [[0x66, 0x4C, 0x61, 0x43], 'FLAC audio'],
    [[0x49, 0x44, 0x33], 'MP3 audio (ID3)']
  ];

  function extOf(name) {
    var i = String(name || '').lastIndexOf('.');
    return i > 0 ? name.slice(i + 1).toLowerCase() : '';
  }

  function humanSize(bytes) {
    if (bytes === 0) return '0 B';
    var units = ['B', 'KB', 'MB', 'GB', 'TB'];
    var i = Math.floor(Math.log(bytes) / Math.log(1024));
    if (i >= units.length) i = units.length - 1;
    var v = bytes / Math.pow(1024, i);
    return (v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)) + ' ' + units[i];
  }

  function hexOf(h) {
    var s = h.toString(16).toUpperCase();
    return s.length < 2 ? '0' + s : s;
  }

  function hexToRgba(hex, alpha) {
    var m = String(hex).replace('#', '');
    if (m.length === 3) m = m[0] + m[0] + m[1] + m[1] + m[2] + m[2];
    var n = parseInt(m, 16);
    if (isNaN(n)) return 'rgba(124,196,255,' + alpha + ')';
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  function FileOracle() {}

  FileOracle.prototype = {
    constructor: FileOracle,

    /**
     * 嗅探单个文件，产出渲染所需的 profile
     * @param {File|Blob} file 浏览器 File 对象
     * @returns {Promise<Object>} profile
     */
    sniff: function (file) {
      var self = this;
      var name = file.name || 'unknown';
      var ext = extOf(name);
      var mime = file.type || '';
      var sig = null;
      for (var i = 0; i < SIGNATURES.length; i++) {
        if (SIGNATURES[i].ext.indexOf(ext) >= 0) { sig = SIGNATURES[i]; break; }
      }

      var base = {
        name: name,
        ext: ext,
        size: file.size || 0,
        prettySize: humanSize(file.size || 0),
        mime: mime || 'application/octet-stream',
        lang: sig ? sig.lang : (ext ? ext.toUpperCase() : 'Unknown'),
        lastModified: file.lastModified || Date.now()
      };

      if (mime.indexOf('image/') === 0 || (sig && sig.kind === 'image')) {
        return this._sniffImage(file, base, sig);
      }
      return this._sniffTextOrBinary(file, base, sig);
    },

    /* ---------- 图片：Canvas 2D 提取主色调 ---------- */
    _sniffImage: function (file, base, sig) {
      var self = this;
      return new Promise(function (resolve) {
        var url = global.URL.createObjectURL(file);
        var img = new Image();
        img.onload = function () {
          global.URL.revokeObjectURL(url);
          resolve(self._finishImage(file, base, sig, img));
        };
        img.onerror = function () {
          global.URL.revokeObjectURL(url);
          resolve(self._finishImage(file, base, sig, null));
        };
        img.src = url;
      });
    },

    _finishImage: function (file, base, sig, img) {
      var colors = img ? this.extractDominantColor(img) : [];
      var accent = colors.length ? colors[0].hex : (sig ? sig.color : '#38bdf8');
      return Object.assign({}, base, {
        category: 'image',
        accent: accent,
        glow: hexToRgba(accent, .35),
        colors: colors,
        thumb: img ? global.URL.createObjectURL(file) : null,
        width: img ? img.naturalWidth : 0,
        height: img ? img.naturalHeight : 0
      });
    },

    /**
     * 提取主色调：缩放到 36x36，getImageData 后按 4-bit/通道分桶计数，
     * 以饱和度加权，返回最多 3 个主色。
     * @param {HTMLImageElement} img
     * @returns {Array<{hex, r, g, b, weight}>}
     */
    extractDominantColor: function (img) {
      var S = 36;
      var canvas = document.createElement('canvas');
      canvas.width = S; canvas.height = S;
      var ctx = canvas.getContext('2d');
      try {
        ctx.drawImage(img, 0, 0, S, S);
      } catch (e) {
        return [];
      }
      var data;
      try {
        data = ctx.getImageData(0, 0, S, S).data;
      } catch (e) { // 跨域污染等
        return [];
      }

      var buckets = new Map();
      for (var i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 128) continue; // 跳过透明像素
        var r = data[i], g = data[i + 1], b = data[i + 2];
        var key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
        var cur = buckets.get(key);
        if (cur) { cur.r += r; cur.g += g; cur.b += b; cur.n++; }
        else buckets.set(key, { r: r, g: g, b: b, n: 1 });
      }

      var total = Math.max(1, data.length / 4);
      var arr = [];
      buckets.forEach(function (c) {
        var r = c.r / c.n, g = c.g / c.n, b = c.b / c.n;
        var max = Math.max(r, g, b), min = Math.min(r, g, b);
        var sat = max === 0 ? 0 : (max - min) / max;       // 饱和度
        var lum = 0.299 * r + 0.587 * g + 0.114 * b;        // 亮度
        var weight = c.n * (sat + .12) * (lum > 245 ? .35 : 1); // 抑制纯白
        arr.push({ r: r, g: g, b: b, n: c.n, weight: weight });
      });
      arr.sort(function (a, b) { return b.weight - a.weight; });

      var out = [];
      for (var j = 0; j < arr.length && out.length < 3; j++) {
        var c2 = arr[j];
        var rr = Math.round(c2.r), gg = Math.round(c2.g), bb = Math.round(c2.b);
        out.push({
          hex: '#' + hexOf(rr) + hexOf(gg) + hexOf(bb),
          r: rr, g: gg, b: bb,
          weight: Math.round(c2.n / total * 100)
        });
      }
      return out;
    },

    /* ---------- 文本 / 二进制 ---------- */
    _sniffTextOrBinary: function (file, base, sig) {
      var self = this;
      var headPromise = file.slice(0, 512).arrayBuffer();
      return headPromise.then(function (headBuf) {
        var head = new Uint8Array(headBuf);
        if (sig && (sig.kind === 'code' || sig.kind === 'text')) {
          return self._readText(file, base, sig);
        }
        if (self._looksLikeText(head)) { // 无扩展名等：按字节嗅探
          return self._readText(file, base, sig, true);
        }
        return self._sniffBinary(file, base, head);
      }).catch(function () {
        return self._sniffBinary(file, base, null);
      });
    },

    /* 经验法则：无 NUL 字节且大部分为可打印 ASCII/UTF-8 → 视作文本 */
    _looksLikeText: function (bytes) {
      if (!bytes || bytes.length === 0) return true;
      var printable = 0;
      for (var i = 0; i < bytes.length; i++) {
        var c = bytes[i];
        if (c === 0) return false;
        if (c === 0x09 || c === 0x0A || c === 0x0D || (c >= 0x20 && c <= 0x7E) || c >= 0x80) printable++;
      }
      return printable / bytes.length >= 0.9;
    },

    _readText: function (file, base, sig, isAuto) {
      return file.slice(0, PEEK_BYTES).text().then(function (raw) {
        var lines = raw.split(/\r\n|\r|\n/).slice(0, MAX_LINES)
          .map(function (l) { return l.length > MAX_LINE_LEN ? l.slice(0, MAX_LINE_LEN) : l; });
        var totalLines = raw.split(/\r\n|\r|\n/).length;
        var accent = sig ? sig.color : '#9aa4b2';
        return Object.assign({}, base, {
          category: (sig && sig.kind === 'code') ? 'code' : 'text',
          accent: accent,
          glow: hexToRgba(accent, .32),
          lines: lines,
          totalLines: totalLines,
          autoDetected: !!isAuto
        });
      });
    },

    _sniffBinary: function (file, base, head) {
      var magic = '未知 / unknown';
      if (head) {
        for (var i = 0; i < MAGICS.length; i++) {
          var m = MAGICS[i][0], hit = true;
          for (var j = 0; j < m.length; j++) {
            if (head[j] !== m[j]) { hit = false; break; }
          }
          if (hit) { magic = MAGICS[i][1]; break; }
        }
      }
      var hex = [];
      if (head) {
        for (var k = 0; k < head.length && k < 16; k++) hex.push(hexOf(head[k]));
      }
      var accent = '#8b7cf6';
      return Object.assign({}, base, {
        category: 'binary',
        accent: accent,
        glow: hexToRgba(accent, .3),
        magic: magic,
        hex: hex
      });
    }
  };

  /* 工具方法一并通过原型导出 */
  FileOracle.humanSize = humanSize;
  FileOracle.hexToRgba = hexToRgba;
  FileOracle.SIGNATURES = SIGNATURES;

  global.FileOracle = FileOracle;
})(window);
