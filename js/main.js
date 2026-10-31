/* ============================================================
 * main.js — AnyFile Liquid Glass
 * 极简拖拽交互大厅：拖入 → 嗅探 → 液态玻璃卡片瀑布流
 * 支持：拖拽 / 点击选择 / 全窗口投放 / 示例 Demo / #demo 直开
 * ============================================================ */
(function (global) {
  'use strict';

  var gallery = document.getElementById('gallery');
  var dz = document.getElementById('dropzone');
  var fileInput = document.getElementById('fileInput');
  var pickBtn = document.getElementById('pickBtn');
  var demoBtn = document.getElementById('demoBtn');
  var clearBtn = document.getElementById('clearBtn');
  var statusEl = document.getElementById('status');

  var oracle = new FileOracle();
  var renderer = new LiquidGlassRenderer();
  var counter = 0;

  function setStatus(msg) { if (statusEl) statusEl.textContent = msg; }

  /* ---------- 核心：文件列表 → 嗅探 → 渲染 ---------- */
  function ingest(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;
    setStatus('正在嗅探 ' + files.length + ' 个文件 · 提取特征…');
    var ok = 0, fail = 0;
    var chain = Promise.resolve();
    files.forEach(function (file) {
      chain = chain.then(function () {
        return oracle.sniff(file).then(function (profile) {
          renderer.render(gallery, profile, counter++);
          ok++;
        }).catch(function (err) {
          console.error('[LiquidGlass] 嗅探失败:', file.name, err);
          fail++;
        });
      });
    });
    chain.then(function () {
      setStatus('已渲染 ' + ok + ' 张液态玻璃卡片' + (fail ? '，' + fail + ' 个文件失败' : ''));
    });
  }

  /* ---------- 拖拽大厅 ---------- */
  var dragDepth = 0;
  function onDragEnter(e) {
    e.preventDefault();
    dragDepth++;
    dz.classList.add('dropover');
  }
  function onDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
  function onDragLeave(e) {
    e.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dz.classList.remove('dropover');
  }
  function onDrop(e) {
    e.preventDefault();
    dragDepth = 0;
    dz.classList.remove('dropover');
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
      ingest(e.dataTransfer.files);
    }
  }

  dz.addEventListener('dragenter', onDragEnter);
  dz.addEventListener('dragover', onDragOver);
  dz.addEventListener('dragleave', onDragLeave);
  dz.addEventListener('drop', onDrop);

  /* 全窗口投放：拖到页面任意位置都生效 */
  global.addEventListener('dragover', function (e) { e.preventDefault(); });
  global.addEventListener('drop', onDrop);

  /* 点击选择 */
  pickBtn.addEventListener('click', function () { fileInput.click(); });
  fileInput.addEventListener('change', function () {
    if (fileInput.files && fileInput.files.length) ingest(fileInput.files);
    fileInput.value = '';
  });

  /* 清空画廊 */
  clearBtn.addEventListener('click', function () {
    gallery.innerHTML = '';
    counter = 0;
    setStatus('画廊已清空');
  });

  /* ---------- 示例 Demo：纯本地生成文件 ---------- */
  function canvasToFile(name, w, h, paint) {
    return new Promise(function (resolve) {
      var c = document.createElement('canvas');
      c.width = w; c.height = h;
      var ctx = c.getContext('2d');
      paint(ctx, w, h);
      c.toBlob(function (blob) {
        resolve(new File([blob], name, { type: 'image/png' }));
      }, 'image/png');
    });
  }

  function nebula(ctx, w, h) {
    var g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#0b1030'); g.addColorStop(1, '#1a0f2e');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    var blobs = [
      ['#5e5ce6', .18, .22, .55], ['#bf5af2', .38, .30, .5],
      ['#30d158', .62, .18, .42], ['#64d2ff', .55, .68, .55],
      ['#ff5a8a', .25, .72, .4]
    ];
    blobs.forEach(function (b) {
      var rg = ctx.createRadialGradient(w * b[1], h * b[2], 0, w * b[1], h * b[2], w * b[3]);
      rg.addColorStop(0, b[0]); rg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = rg; ctx.fillRect(0, 0, w, h);
    });
    // 星点
    ctx.fillStyle = 'rgba(255,255,255,.9)';
    for (var i = 0; i < 90; i++) {
      ctx.globalAlpha = .25 + Math.random() * .7;
      ctx.fillRect(Math.random() * w, Math.random() * h, 1.6, 1.6);
    }
    ctx.globalAlpha = 1;
  }

  function aurora(ctx, w, h) {
    var g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#04121c'); g.addColorStop(1, '#0b2e2a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    var bands = [['#64d2ff', .12], ['#30d158', .2], ['#bf5af2', .14]];
    bands.forEach(function (b, i) {
      var rg = ctx.createRadialGradient(w * (0.3 + i * 0.22), h * .55, 0, w * (0.3 + i * 0.22), h * .55, w * b[1]);
      rg.addColorStop(0, b[0]); rg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = rg; ctx.fillRect(0, 0, w, h);
    });
    // 光带
    for (var i = 0; i < 3; i++) {
      ctx.strokeStyle = 'rgba(255,255,255,' + (0.08 + i * 0.05) + ')';
      ctx.lineWidth = 60 - i * 18;
      ctx.beginPath();
      ctx.moveTo(0, h * (0.3 + i * 0.16));
      ctx.bezierCurveTo(w * .3, h * (0.1 + i * .2), w * .7, h * (0.5 - i * .12), w, h * (0.26 + i * .18));
      ctx.stroke();
    }
  }

  function loadDemo() {
    var code = [
      '/* AnyFile Liquid Glass — 液态玻璃引擎 */',
      'class LiquidGlass {',
      '  constructor(el) {',
      '    this.el = el; this.mx = 0.5; this.my = 0.5;',
      '  }',
      '  sheen(x, y) {                     // 高光跟随',
      '    this.mx = x; this.my = y;',
      '    this.el.style.setProperty(\'--mx\', (x*100)+\'%\');',
      '    this.el.style.setProperty(\'--my\', (y*100)+\'%\');',
      '  }',
      '}'
    ].join('\n');

    var md = [
      '# 液态玻璃宣言',
      '',
      '**AnyFile Liquid Glass** —— 用 CSS 给数字世界',
      '穿上玻璃外壳。',
      '',
      '- 拖入任意文件，自动提取特征',
      '- 图片 → Canvas 提取主色调',
      '- 代码 → 前 10 行 + 语言签名色',
      '- 二进制 → 魔数 + 元数据'
    ].join('\n');

    var txt = [
      '玻璃自白 / A Glass Confession',
      '',
      '我没有颜色，',
      '但我记得穿过我的一切光线。',
      '拖一张图进来，',
      '我便染上它的主色调。'
    ].join('\n');

    var files = [
      new File([code], 'liquid-glass.js', { type: 'text/javascript' }),
      new File([md], 'MANIFESTO.md', { type: 'text/markdown' }),
      new File([txt], 'haiku.txt', { type: 'text/plain' }),
      new File([new Uint8Array([0x4D, 0x5A, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00,
        0x04, 0x00, 0x00, 0x00, 0xFF, 0xFF, 0x00, 0x00])],
        'oracle.exe', { type: 'application/x-msdownload' })
    ];

    Promise.all([
      canvasToFile('nebula.png', 640, 400, nebula),
      canvasToFile('aurora.png', 640, 480, aurora)
    ]).then(function (imgs) {
      ingest(files.concat(imgs));
    });
  }

  demoBtn.addEventListener('click', loadDemo);

  /* #demo 直开示例，便于截图与首次体验 */
  if (global.location.hash.indexOf('demo') >= 0) loadDemo();
})(window);
