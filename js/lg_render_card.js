/* ============================================================
 * lg_render_card.js — AnyFile Liquid Glass
 * 液态玻璃三维卡片渲染器
 *
 *   .liquid-glass 本体：backdrop-filter + mask-image 内描边 + 多重阴影
 *   图片卡：图片作背景层 + 高强度毛玻璃
 *   文本卡：等宽字体排版前 10 行 + 语言签名色
 *   高光跟随：纯 JS mousemove → CSS 变量 --mx/--my → radial-gradient
 *   三维倾斜：perspective + rotateX/rotateY（rAF 节流）
 *
 * 暴露：window.LiquidGlassRenderer
 * ============================================================ */
(function (global) {
  'use strict';

  var TILT_DEG = 8;       // 最大倾斜角
  var GLARE_OPACITY = 1;  // 悬停高光不透明度

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function hexToRgba(hex, alpha) {
    var m = String(hex || '').replace('#', '');
    if (m.length === 3) m = m[0] + m[0] + m[1] + m[1] + m[2] + m[2];
    var n = parseInt(m, 16);
    if (isNaN(n)) return 'rgba(124,196,255,' + alpha + ')';
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  /* 亮度判定，决定徽章文字用深色还是浅色 */
  function isLightColor(hex) {
    var m = String(hex || '#ffffff').replace('#', '');
    if (m.length === 3) m = m[0] + m[0] + m[1] + m[1] + m[2] + m[2];
    var n = parseInt(m, 16);
    if (isNaN(n)) return true;
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return (0.299 * r + 0.587 * g + 0.114 * b) > 150;
  }

  function LiquidGlassRenderer() {}

  LiquidGlassRenderer.prototype = {
    constructor: LiquidGlassRenderer,

    /**
     * 渲染一张卡片并挂到瀑布流容器
     * @param {HTMLElement} gallery 瀑布流容器
     * @param {Object} profile FileOracle.sniff 产出的 profile
     * @param {Number} index 序号（用于弹跳动画错峰）
     * @returns {HTMLElement} 卡片根节点
     */
    render: function (gallery, profile, index) {
      var card = this.createCard(profile, index);
      gallery.appendChild(card);
      return card;
    },

    createCard: function (profile, index) {
      var frame = el('article', 'lg-card');
      frame.style.animationDelay = (index || 0) * 70 + 'ms';
      frame.setAttribute('draggable', 'false');

      var tilt = el('div', 'lg-tilt');
      var glass = el('div', 'liquid-glass');
      glass.style.setProperty('--accent', profile.accent || '#7dd3fc');
      glass.style.setProperty('--accent-glow', profile.glow || 'rgba(124,196,255,.3)');

      /* —— 玻璃图层 z 序：bg(0) → edge(2) → sheen(3) → spec(4) → content(5) —— */
      if (profile.category === 'image' && profile.thumb) {
        var bgwrap = el('div', 'lg-bgwrap');
        var bgimg = el('img', 'lg-bgimg');
        bgimg.src = profile.thumb;
        bgimg.alt = '';
        bgwrap.appendChild(bgimg);
        bgwrap.appendChild(el('div', 'lg-frost'));
        glass.appendChild(bgwrap);
      }

      glass.appendChild(el('div', 'lg-edge'));   // mask-image 1px 发光内描边
      glass.appendChild(el('div', 'lg-sheen'));  // 鼠标跟随径向高光
      var spec = el('div', 'lg-spec');           // 球形高光反射点

      glass.appendChild(spec);
      glass.appendChild(this._buildContent(profile));

      tilt.appendChild(glass);
      frame.appendChild(tilt);

      this._bindPointer(frame, glass, tilt, spec);
      return frame;
    },

    /* ---------------- 内容构建 ---------------- */
    _buildContent: function (profile) {
      var content = el('div', 'lg-content');

      /* 头部：扩展名徽章 + 文件名 + 元信息 */
      var head = el('div', 'lg-head');
      var badge = el('div', 'lg-badge', profile.category === 'binary' ? 'BIN' : (profile.ext || 'FILE').slice(0, 4));
      if (!isLightColor(profile.accent)) badge.style.color = '#fff';
      head.appendChild(badge);

      var meta = el('div', 'lg-meta');
      meta.appendChild(el('div', 'lg-name', profile.name));
      var sub = (profile.lang || '') + ' · ' + profile.prettySize;
      if (profile.category === 'image' && profile.width) {
        sub = profile.lang + ' · ' + profile.width + '×' + profile.height + ' · ' + profile.prettySize;
      }
      meta.appendChild(el('div', 'lg-sub', sub));
      head.appendChild(meta);
      content.appendChild(head);

      /* 主体 */
      if (profile.category === 'image') {
        if (profile.thumb) {
          var figure = el('div', 'lg-image');
          var img = el('img');
          img.src = profile.thumb; img.alt = profile.name;
          figure.appendChild(img);
          content.appendChild(figure);
        }
        var foot = el('div', 'lg-foot');
        foot.appendChild(el('span', 'lg-foot-label', '主色调'));
        (profile.colors || []).forEach(function (c) {
          var s = el('span', 'lg-swatch');
          s.style.setProperty('--c', c.hex);
          s.appendChild(el('i'));
          s.appendChild(el('span', null, c.hex + ' · ' + c.weight + '%'));
          foot.appendChild(s);
        });
        content.appendChild(foot);
      } else if (profile.category === 'text' || profile.category === 'code') {
        var ol = el('ol', 'lg-lines');
        (profile.lines || []).forEach(function (line) {
          var li = el('li');
          li.appendChild(el('span', 'ln', line === '' ? ' ' : line));
          ol.appendChild(li);
        });
        content.appendChild(ol);

        var foot2 = el('div', 'lg-foot');
        foot2.appendChild(el('span', 'lg-foot-label', '前 ' + (profile.lines || []).length + ' 行'));
        foot2.appendChild(el('span', 'lg-chip', profile.totalLines + ' 行'));
        if (profile.autoDetected) foot2.appendChild(el('span', 'lg-chip', '自动识别为文本'));
        content.appendChild(foot2);
      } else {
        var note = el('div', 'lg-binary-note');
        note.appendChild(el('span', null, '这是二进制文件，无法解析为文本。玻璃卡片只保留 '));
        note.appendChild(el('b', null, profile.magic || '未知格式'));
        note.appendChild(el('br'));
        note.appendChild(el('span', null, 'Magic bytes（前 16 字节）：'));
        note.appendChild(el('br'));
        var hex = el('div', 'lg-hex');
        (profile.hex || []).forEach(function (h) { hex.appendChild(el('span', null, h)); });
        note.appendChild(hex);
        content.appendChild(note);
      }

      return content;
    },

    /* ---------------- 高光跟随 + 三维倾斜 ---------------- */
    _bindPointer: function (frame, glass, tilt, spec) {
      var raf = null;
      var mx = 0.5, my = 0.5;

      function applyVars() {
        raf = null;
        glass.style.setProperty('--mx', (mx * 100).toFixed(2) + '%');
        glass.style.setProperty('--my', (my * 100).toFixed(2) + '%');
        var rx = (0.5 - my) * TILT_DEG * 2;
        var ry = (mx - 0.5) * TILT_DEG * 2;
        tilt.style.transform =
          'perspective(900px) rotateX(' + rx.toFixed(2) + 'deg) rotateY(' + ry.toFixed(2) + 'deg)';
      }

      function schedule() {
        if (raf === null) raf = global.requestAnimationFrame(applyVars);
      }

      frame.addEventListener('mousemove', function (e) {
        var r = frame.getBoundingClientRect();
        mx = (e.clientX - r.left) / r.width;
        my = (e.clientY - r.top) / r.height;
        schedule();
      });

      frame.addEventListener('mouseenter', function () {
        spec.style.opacity = '.9';
        glass.style.setProperty('--sheen', GLARE_OPACITY);
      });

      frame.addEventListener('mouseleave', function () {
        mx = 0.5; my = 0.5;
        spec.style.opacity = '0';
        glass.style.setProperty('--sheen', '.55');
        schedule(); // 平滑回正
      });

      /* 触屏支持：touchmove 同步驱动 */
      frame.addEventListener('touchmove', function (e) {
        var t = e.touches[0]; if (!t) return;
        var r = frame.getBoundingClientRect();
        mx = (t.clientX - r.left) / r.width;
        my = (t.clientY - r.top) / r.height;
        schedule();
      }, { passive: true });
    }
  };

  LiquidGlassRenderer.hexToRgba = hexToRgba;
  global.LiquidGlassRenderer = LiquidGlassRenderer;
})(window);
