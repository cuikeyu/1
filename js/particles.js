/* =========================================================
 * particles.js —— 粒子 / 冲击波环 / 数值飘字（对象池思想 + 标记回收）
 * ========================================================= */
window.G = window.G || {};

G.particles = [];      // { x,y,vx,vy,life,maxLife,size,color,drag }
G.shockwaves = [];     // { x,y,r,maxR,life,maxLife,color,lineWidth }
G.texts = [];          // { x,y,vy,life,maxLife,text,color,size }

/** 生成粒子（超限时丢最早的） */
G.spawnParticle = function (x, y, opts) {
  if (G.particles.length >= G.CONFIG.maxParticles) G.particles.shift();
  G.particles.push({
    x, y,
    vx: opts.vx !== undefined ? opts.vx : G.utils.rand(-80, 80),
    vy: opts.vy !== undefined ? opts.vy : G.utils.rand(-80, 80),
    life: opts.life || 0.6,
    maxLife: opts.life || 0.6,
    size: opts.size || 3,
    color: opts.color || '#00E5FF',
    drag: opts.drag !== undefined ? opts.drag : 0.97
  });
};

/** 爆炸粒子群 */
G.spawnExplosion = function (x, y, color, count) {
  for (let i = 0; i < (count || 14); i++) {
    const a = G.utils.rand(0, Math.PI * 2);
    const sp = G.utils.rand(40, 260);
    G.spawnParticle(x, y, {
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      color: Math.random() < 0.35 ? '#ffffff' : color,
      size: G.utils.rand(1.5, 4), life: G.utils.rand(0.3, 0.7)
    });
  }
  // 白色闪光圈
  G.spawnShockwave(x, y, '#ffffff', 60, 0.18);
  G.spawnShockwave(x, y, color, 100, 0.35);
};

/** 冲击波环 */
G.spawnShockwave = function (x, y, color, maxR, life) {
  G.shockwaves.push({ x, y, r: 4, maxR, life: life || 0.4, maxLife: life || 0.4, color, lineWidth: 3 });
};

/** 数值飘字 */
G.spawnText = function (x, y, text, color, size) {
  G.texts.push({ x, y, vy: -55, life: 0.9, maxLife: 0.9, text, color: color || '#ffffff', size: size || 14 });
};

function update (dt) {
  // 粒子
  for (let i = G.particles.length - 1; i >= 0; i--) {
    const p = G.particles[i];
    p.life -= dt;
    if (p.life <= 0) { G.particles.splice(i, 1); continue; }
    p.vx *= p.drag; p.vy *= p.drag;
    p.x += p.vx * dt; p.y += p.vy * dt;
  }
  // 冲击波
  for (let i = G.shockwaves.length - 1; i >= 0; i--) {
    const s = G.shockwaves[i];
    s.life -= dt;
    if (s.life <= 0) { G.shockwaves.splice(i, 1); continue; }
    s.r = G.utils.lerp(s.r, s.maxR, 0.12);
  }
  // 飘字
  for (let i = G.texts.length - 1; i >= 0; i--) {
    const t = G.texts[i];
    t.life -= dt; t.y += t.vy * dt;
    if (t.life <= 0) G.texts.splice(i, 1);
  }
}

function draw (ctx) {
  // 粒子（加法混合发光）
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const p of G.particles) {
    const a = p.life / p.maxLife;
    G.drawGlow(ctx, p.x, p.y, p.color, p.size, a);
  }
  // 冲击波
  for (const s of G.shockwaves) {
    const a = s.life / s.maxLife;
    ctx.globalAlpha = a;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.lineWidth;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();

  // 飘字
  ctx.textAlign = 'center';
  for (const t of G.texts) {
    const a = t.life / t.maxLife;
    ctx.globalAlpha = a;
    ctx.fillStyle = t.color;
    ctx.font = 'bold ' + t.size + 'px "Microsoft YaHei", sans-serif';
    ctx.fillText(t.text, t.x, t.y);
  }
  ctx.globalAlpha = 1;
}

G.updateParticles = update;
G.drawParticles = draw;