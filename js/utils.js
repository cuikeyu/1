/* =========================================================
 * utils.js —— 数学工具 / 随机 / 碰撞 / 对象池 / 发光贴图缓存
 * ========================================================= */
window.G = window.G || {};

G.utils = (function () {
  /** 闭区间随机浮点 */
  function rand (a, b) { return a + Math.random() * (b - a); }
  /** 闭区间随机整数 */
  function randInt (a, b) { return Math.floor(a + Math.random() * (b - a + 1)); }
  /** 从数组随机取一元素 */
  function pick (arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  /** 限制值域 */
  function clamp (v, a, b) { return v < a ? a : (v > b ? b : v); }
  /** 线性插值 */
  function lerp (a, b, t) { return a + (b - a) * t; }
  /** 两点距离平方（避免开方） */
  function dist2 (x1, y1, x2, y2) { const dx = x1 - x2, dy = y1 - y2; return dx * dx + dy * dy; }
  /** 圆形碰撞判定 */
  function circleHit (a, b) { return dist2(a.x, a.y, b.x, b.y) < (a.r + b.r) * (a.r + b.r); }
  /** 角度转弧度 */
  function rad (deg) { return deg * Math.PI / 180; }

  /** 简易对象池（用于子弹/粒子 -> 但本项目用"标记回收 + 过滤"即可，此池备用） */
  function Pool (factory, cap) {
    this.factory = factory; this.cap = cap;
    this.free = []; this.active = [];
  }
  Pool.prototype.obtain = function () {
    const o = this.free.pop() || this.factory();
    this.active.push(o); return o;
  };
  Pool.prototype.release = function (o) { this.free.push(o); };

  return { rand, randInt, pick, clamp, lerp, dist2, circleHit, rad, Pool };
})();

/* ---------- 发光贴图缓存（性能关键：禁止运行时 shadowBlur） ---------- */
G.glowCache = {};
/**
 * 生成一枚径向渐变的发光圆点贴图，返回离屏 canvas。同一颜色+尺寸只生成一次。
 */
G.glow = function (color, r) {
  const key = color + '_' + r;
  if (G.glowCache[key]) return G.glowCache[key];
  const c = document.createElement('canvas');
  const d = r * 2;
  c.width = c.height = d;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.25, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, d, d);
  G.glowCache[key] = c;
  return c;
};

/** 绘制发光圆点（封装 drawImage，供子弹/粒子复用） */
G.drawGlow = function (ctx, x, y, color, r, alpha) {
  const img = G.glow(color, Math.ceil(r));
  const s = r * 2;
  const a = ctx.globalAlpha;
  ctx.globalAlpha = (alpha === undefined ? 1 : alpha);
  ctx.drawImage(img, x - r, y - r, s, s);
  ctx.globalAlpha = a;
};