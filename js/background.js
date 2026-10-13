/* =========================================================
 * background.js —— 治愈星际：柔光渐变 + 马卡龙岩云 +
 *                   闪烁星点 + 上浮光尘 + 柔和流星
 * ========================================================= */
window.G = window.G || {};

G.background = (function () {
  let stars = [];          // 三层星星
  let motes = [];          // 上浮光尘（治愈感）
  let nebulaCanvas = null; // 预渲染星云
  let meteors = [];        // 流星
  let meteorTimer = 0;
  let planets = [];        // 远景星球（缓慢下移的视差层）

  const STAR_TINTS = ['#ffffff', '#d8f6ff', '#e8ddff', '#fff4e0'];
  const MOTE_COLORS = ['rgba(127,232,192,', 'rgba(168,242,245,', 'rgba(199,155,255,', 'rgba(255,201,168,'];

  function init () {
    stars = [];
    // L1 远星 50 颗（慢、暗）；L2 中星 40 颗；L3 近星 20 颗
    for (let i = 0; i < 50; i++) stars.push({ layer: 1, x: G.utils.rand(0, G.W), y: G.utils.rand(0, G.H), r: G.utils.rand(0.5, 1.2), sp: 22, tint: G.utils.pick(STAR_TINTS), tw: G.utils.rand(0, 6.28) });
    for (let i = 0; i < 40; i++) stars.push({ layer: 2, x: G.utils.rand(0, G.W), y: G.utils.rand(0, G.H), r: G.utils.rand(1, 2), sp: 55, tint: G.utils.pick(STAR_TINTS), tw: G.utils.rand(0, 6.28) });
    for (let i = 0; i < 20; i++) stars.push({ layer: 3, x: G.utils.rand(0, G.W), y: G.utils.rand(0, G.H), r: G.utils.rand(2, 3), sp: 120, tint: G.utils.pick(STAR_TINTS), tw: G.utils.rand(0, 6.28) });

    // 治愈光尘：缓缓上浮、左右轻摆
    motes = [];
    for (let i = 0; i < 26; i++) {
      motes.push({
        x: G.utils.rand(0, G.W), y: G.utils.rand(0, G.H),
        r: G.utils.rand(1.5, 4),
        vy: G.utils.rand(-14, -6),
        sway: G.utils.rand(0.6, 1.6),
        phase: G.utils.rand(0, 6.28),
        c: G.utils.pick(MOTE_COLORS),
        a: G.utils.rand(0.15, 0.4)
      });
    }
    buildNebula();
    initPlanets();
    meteors = [];
    meteorTimer = G.utils.rand(3, 7);
  }

  /** 远景星球：两三颗柔和巨行星，极慢下移制造星际巡航感 */
  function initPlanets () {
    planets = [
      { x: G.W * 0.80, y: G.H * 0.16, r: 88,  sp: 5.0, c1: '#9cc8ff', c2: '#2a4a8a', a: 0.50, ring: false },
      { x: G.W * 0.16, y: G.H * 0.66, r: 132, sp: 3.4, c1: '#cbb0ff', c2: '#3a2a6e', a: 0.42, ring: true },
      { x: G.W * 0.62, y: G.H * 1.18, r: 56,  sp: 8.0, c1: '#ffd9a8', c2: '#6e4a2e', a: 0.55, ring: false }
    ];
  }

  /** 预渲染马卡龙岩云斑块（离屏画布，运行时只 drawImage） */
  function buildNebula () {
    nebulaCanvas = document.createElement('canvas');
    nebulaCanvas.width = G.W; nebulaCanvas.height = G.H;
    const c = nebulaCanvas.getContext('2d');
    // 柔蓝 / 薰衣草紫 / 柔粉紫 / 薄荷青，低饱和大光晕
    const blobs = [
      { x: G.W * 0.22, y: G.H * 0.18, r: 200, c: 'rgba(90,130,210,0.30)' },
      { x: G.W * 0.78, y: G.H * 0.45, r: 230, c: 'rgba(150,110,210,0.26)' },
      { x: G.W * 0.45, y: G.H * 0.72, r: 200, c: 'rgba(190,120,170,0.18)' },
      { x: G.W * 0.62, y: G.H * 0.92, r: 170, c: 'rgba(95,227,232,0.14)' }
    ];
    blobs.forEach(b => {
      const g = c.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
      g.addColorStop(0, b.c);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g; c.fillRect(0, 0, G.W, G.H);
    });
  }

  function update (dt) {
    // 星星：向下滚动，越层越快
    for (const s of stars) {
      s.y += s.sp * dt;
      s.tw += dt * 2;
      if (s.y > G.H + 5) { s.y = -5; s.x = G.utils.rand(0, G.W); }
    }
    // 光尘：上浮 + 正弦摆动
    for (const m of motes) {
      m.phase += dt;
      m.y += m.vy * dt;
      m.x += Math.sin(m.phase * m.sway) * 12 * dt;
      if (m.y < -10) { m.y = G.H + 10; m.x = G.utils.rand(0, G.W); }
      if (m.x < -10) m.x = G.W + 10; else if (m.x > G.W + 10) m.x = -10;
    }
    // 流星（柔和浅色）
    meteorTimer -= dt;
    if (meteorTimer <= 0) {
      meteorTimer = G.utils.rand(7, 14);
      meteors.push({ x: G.utils.rand(0, G.W), y: -30, vx: G.utils.rand(-120, 120), vy: 340, life: 1 });
    }
    for (let i = meteors.length - 1; i >= 0; i--) {
      const m = meteors[i];
      m.x += m.vx * dt; m.y += m.vy * dt; m.life -= dt * 2.2;
      if (m.life <= 0 || m.y > G.H + 50) meteors.splice(i, 1);
    }
    // 星球：极慢下移，飞出屏幕后从顶部循环
    for (const p of planets) {
      p.y += p.sp * dt;
      if (p.y - p.r * 1.6 > G.H + 30) {
        p.y = -p.r * 1.6 - 30;
        p.x = G.utils.rand(G.W * 0.1, G.W * 0.9);
      }
    }
  }

  function draw (ctx) {
    // 静谧深蓝紫竖向渐变底
    const g = ctx.createLinearGradient(0, 0, 0, G.H);
    g.addColorStop(0, G.COLORS.bg2);
    g.addColorStop(0.55, G.COLORS.bg);
    g.addColorStop(1, '#080C26');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, G.W, G.H);

    // 星球（渐变底层之后、星云之前，营造纵深）
    for (const p of planets) drawPlanet(ctx, p);

    // 星云（L1）缓慢下移
    const off = (performance.now() * 0.015) % G.H;
    ctx.globalAlpha = 0.95;
    ctx.drawImage(nebulaCanvas, 0, off - G.H);
    ctx.drawImage(nebulaCanvas, 0, off);

    // 星星（轻柔呼吸闪烁）
    for (const s of stars) {
      const tw = 0.55 + 0.45 * Math.sin(s.tw + s.x);
      ctx.globalAlpha = s.layer === 3 ? 0.95 * tw : (s.layer === 2 ? 0.7 * tw : 0.45 * tw);
      if (s.layer === 3) {
        // 近星带淡色拖尾
        ctx.strokeStyle = 'rgba(168,242,245,0.30)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y - s.r * 4);
        ctx.lineTo(s.x, s.y);
        ctx.stroke();
      }
      G.drawGlow(ctx, s.x, s.y, s.tint, s.r + (s.layer === 3 ? 1 : 0), 0.8);
    }
    ctx.globalAlpha = 1;

    // 治愈光尘（柔光圆点）
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const m of motes) {
      const a = m.a * (0.7 + 0.3 * Math.sin(m.phase * 1.5));
      const grd = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.r * 3);
      grd.addColorStop(0, m.c + a + ')');
      grd.addColorStop(1, m.c + '0)');
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.arc(m.x, m.y, m.r * 3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();

    // 流星
    for (const m of meteors) {
      ctx.strokeStyle = 'rgba(200,235,255,' + (m.life * 0.7) + ')';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(m.x - m.vx * 0.08, m.y - m.vy * 0.08);
      ctx.lineTo(m.x, m.y);
      ctx.stroke();
    }
  }

  /** 单颗星球：受光球体 + 大气缘光 + （可选）行星环 */
  function drawPlanet (ctx, p) {
    ctx.save();
    ctx.globalAlpha = p.a;
    // 大气外发光
    const glow = ctx.createRadialGradient(p.x, p.y, p.r * 0.85, p.x, p.y, p.r * 1.55);
    glow.addColorStop(0, 'rgba(150,195,255,0.12)');
    glow.addColorStop(1, 'rgba(150,195,255,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 1.55, 0, Math.PI * 2); ctx.fill();
    // 球体（左上方受光）
    const g = ctx.createRadialGradient(p.x - p.r * 0.38, p.y - p.r * 0.38, p.r * 0.08, p.x, p.y, p.r);
    g.addColorStop(0, p.c1);
    g.addColorStop(0.5, p.c2);
    g.addColorStop(1, '#0a0e24');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    // 行星环
    if (p.ring) {
      ctx.strokeStyle = 'rgba(205,225,255,0.26)';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(p.x, p.y, p.r * 1.62, p.r * 0.40, -0.32, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = 'rgba(205,225,255,0.12)';
      ctx.lineWidth = 8;
      ctx.beginPath(); ctx.ellipse(p.x, p.y, p.r * 1.92, p.r * 0.50, -0.32, 0, Math.PI * 2); ctx.stroke();
    }
    // 晨昏线（右下暗面）
    const shade = ctx.createRadialGradient(p.x + p.r * 0.5, p.y + p.r * 0.55, p.r * 0.2, p.x + p.r * 0.3, p.y + p.r * 0.3, p.r * 1.1);
    shade.addColorStop(0, 'rgba(4,6,20,0.42)');
    shade.addColorStop(1, 'rgba(4,6,20,0)');
    ctx.fillStyle = shade;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  return { init, update, draw };
})();
