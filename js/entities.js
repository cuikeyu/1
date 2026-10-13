/* =========================================================
 * entities.js —— 玩家 / 子弹 / 敌机(6类) / 道具 / 僚机
 * ========================================================= */
window.G = window.G || {};

G.playerBullets = [];
G.enemyBullets = [];
G.enemies = [];
G.powerups = [];
G.wings = [];
G.obstacles = [];      // 陨石（不可穿过的实体障碍）
G.player = null;
G.bombCharge = 0;

/* ================= 玩家 ================= */
G.createPlayer = function () {
  const ship = G.SHIPS[G.save.get().currentShip];
  const u = G.save.get().upgrades;
  const maxHp = ship.hp + u.armor * 10;
  G.player = {
    x: G.W / 2, y: G.H - 140,
    dead: false,
    hp: maxHp, maxHp,
    speed: ship.speed * (1 + u.engine * 0.05),
    hitR: ship.hitR,
    r: ship.hitR,        // circleHit 统一用 r（与 hitR 同步）
    grazeR: G.CONFIG.grazeR + ship.grazeBonus,
    // 火力起步发数：简单 2 发（爽快流），普通/困难 1 发
    power: (G.DIFFICULTIES[G.difficultyMode] || G.DIFFICULTIES.normal).startPower || 1,
    bombs: G.CONFIG.bombStart + u.bomb,
    shield: ship.startShield,
    pierce: ship.pierce,
    dmgMul: ship.dmgMul * (1 + u.firepower * 0.05),
    rateMul: ship.rateMul * (1 + u.ammo * 0.04),
    bullSpeedMul: ship.bullSpeedMul,
    shape: ship.shape || 'arrow',
    color: ship.color || G.COLORS.primary,
    missileLv: u.missile || 0,    // 武器库：自导导弹等级
    missTimer: 1.0,
    invincible: 1.2,
    fireTimer: 0,
    engineAcc: 0
  };
  if (G.player.bombs > G.CONFIG.bombMax) G.player.bombs = G.CONFIG.bombMax;
  G.bombCharge = 0;
  G.wings = [];
};

G.updatePlayer = function (dt) {
  const p = G.player;
  if (!p || p.dead) return;
  const inp = G.input;

  // 键盘移动
  let dx = 0, dy = 0;
  if (inp.keys.has('ArrowLeft') || inp.keys.has('a')) dx -= 1;
  if (inp.keys.has('ArrowRight') || inp.keys.has('d')) dx += 1;
  if (inp.keys.has('ArrowUp') || inp.keys.has('w')) dy -= 1;
  if (inp.keys.has('ArrowDown') || inp.keys.has('s')) dy += 1;

  if (dx !== 0 || dy !== 0) {
    const len = Math.hypot(dx, dy);
    p.x += (dx / len) * p.speed * dt;
    p.y += (dy / len) * p.speed * dt;
  }
  // 鼠标拖动（高灵敏度跟手）
  if (inp.mouseDown) { moveToward(p, inp.mouseX, inp.mouseY, dt, G.CONFIG.mouseFollowMul); }
  // 触屏
  if (inp.touchActive) { moveToward(p, inp.touchX, inp.touchY - 60, dt, G.CONFIG.touchFollowMul); }

  // 边界钳制
  p.x = G.utils.clamp(p.x, p.hitR, G.W - p.hitR);
  p.y = G.utils.clamp(p.y, p.hitR, G.H - p.hitR);

  // 无敌计时
  if (p.invincible > 0) p.invincible -= dt;

  // 自动射击
  p.fireTimer -= dt;
  if (p.fireTimer <= 0) {
    p.fireTimer = 1 / (G.CONFIG.fireRate * p.rateMul);
    firePlayer();
  }

  // 自导导弹：由武器库等级驱动；P5 满级火力额外 +1 级齐射
  const mLevel = p.missileLv + (p.power >= 5 ? 1 : 0);
  if (mLevel > 0) {
    p.missTimer -= dt;
    if (p.missTimer <= 0) {
      const mc = G.CONFIG.missile;
      p.missTimer = Math.max(mc.minInterval, mc.baseInterval - (mLevel - 1) * mc.intervalStep);
      const volley = Math.min(mc.maxVolley, mLevel);
      for (let i = 0; i < volley; i++) {
        const off = (i - (volley - 1) / 2) * 16;
        fireMissile(off);
      }
    }
  }

  // 引擎尾焰粒子
  p.engineAcc += dt;
  if (p.engineAcc > 0.03) {
    p.engineAcc = 0;
    G.spawnParticle(p.x + G.utils.rand(-4, 4), p.y + 18, {
      vx: G.utils.rand(-15, 15), vy: G.utils.rand(60, 120),
      color: p.color, size: 2.5, life: 0.3
    });
  }
};

function moveToward (p, tx, ty, dt, speedMul) {
  const dx = tx - p.x, dy = ty - p.y;
  const d = Math.hypot(dx, dy);
  const step = p.speed * (speedMul || 1) * dt;
  if (d > 3) {
    if (d < step) { p.x = tx; p.y = ty; }
    else { p.x += dx / d * step; p.y += dy / d * step; }
  }
}

function firePlayer () {
  const p = G.player;
  const spd = G.CONFIG.bulletSpeed * p.bullSpeedMul;
  const dmg = G.CONFIG.damage * p.dmgMul;
  const y = p.y - 20;
  const straight = (x) => G.spawnPlayerBullet(x, y, 0, -spd, dmg, p.pierce);
  const diag = (x, ang) => {
    const a = G.utils.rad(ang);
    G.spawnPlayerBullet(x, y, Math.sin(a) * spd, -Math.cos(a) * spd, dmg, p.pierce);
  };
  switch (p.power) {
    case 1: straight(p.x); break;
    case 2: straight(p.x - 8); straight(p.x + 8); break;
    case 3:
      straight(p.x - 8); straight(p.x + 8);
      diag(p.x - 8, 15); diag(p.x + 8, -15); break;
    case 4:
      straight(p.x); straight(p.x - 8); straight(p.x + 8);
      diag(p.x - 8, 15); diag(p.x + 8, -15); break;
    case 5:
      straight(p.x); straight(p.x - 8); straight(p.x + 8);
      diag(p.x - 8, 15); diag(p.x + 8, -15); break;
    case 6:   // 简单版满级火力：6 发齐射
      straight(p.x - 8); straight(p.x + 8);
      diag(p.x - 8, 12); diag(p.x + 8, -12);
      diag(p.x - 8, 30); diag(p.x + 8, -30); break;
  }
  G.audio.shoot();
}

function fireMissile (offX) {
  const p = G.player;
  const dmg = G.CONFIG.missile.dmg * p.dmgMul;
  G.spawnPlayerBullet(p.x + offX, p.y - 24, G.utils.rand(-40, 40), -120, dmg, 0, true);
}

G.drawPlayer = function (ctx) {
  const p = G.player;
  if (!p || p.dead) return;
  // 无敌闪烁
  if (p.invincible > 0 && Math.floor(p.invincible * 12) % 2 === 0) return;

  ctx.save();
  ctx.translate(p.x, p.y);
  // 机体矢量造型（与机库预览同一套绘制）
  G.drawShipShape(ctx, p, performance.now() / 1000);
  // 护盾环
  if (p.shield > 0) {
    ctx.strokeStyle = 'rgba(80,180,255,0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, 26, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
};

/**
 * 机体矢量绘制（战斗 + 机库预览共用）
 * shape: arrow 箭头舰 / dart 飞镖舰 / wing 宽翼舰 / heavy 重装舰
 * t: 传入运行时间时绘制引擎尾焰动画（战斗用），省略则为静态（机库预览）
 */
G.drawShipShape = function (ctx, ship, t) {
  const c = ship.color || G.COLORS.primary;
  const hull = '#eafcff';
  const dark = 'rgba(20,38,72,0.55)';   // 内机体深色层：压低存在感，机身更亮
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  /** 引擎尾焰（仅战斗帧） */
  const flame = (x, y, len, w) => {
    if (t === undefined) return;
    const f = 0.7 + 0.3 * Math.sin(t * 34 + x * 3.1);
    const g = ctx.createLinearGradient(x, y, x, y + len * f);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.35, c);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x - w, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x, y + len * f);
    ctx.closePath();
    ctx.fill();
  };

  // ---- 各造型主体 ----
  ctx.fillStyle = hull;
  ctx.strokeStyle = c;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  switch (ship.shape) {
    case 'dart':   // 流线飞镖：细长尖锐，高速机动型
      ctx.moveTo(0, -30);
      ctx.lineTo(-5, -8); ctx.lineTo(-9, 2); ctx.lineTo(-13, 12);
      ctx.lineTo(-4, 8); ctx.lineTo(0, 12); ctx.lineTo(4, 8);
      ctx.lineTo(13, 12); ctx.lineTo(9, 2); ctx.lineTo(5, -8);
      break;
    case 'wing':   // 宽翼重机：大后掠翼 + 翼下荚舱
      ctx.moveTo(0, -24);
      ctx.lineTo(-8, -10); ctx.lineTo(-24, 6); ctx.lineTo(-26, 14);
      ctx.lineTo(-10, 10); ctx.lineTo(0, 15);
      ctx.lineTo(10, 10); ctx.lineTo(26, 14); ctx.lineTo(24, 6); ctx.lineTo(8, -10);
      break;
    case 'heavy':  // 装甲重型：宽体堡垒 + 肩炮
      ctx.moveTo(0, -21);
      ctx.lineTo(-13, -12); ctx.lineTo(-20, 4); ctx.lineTo(-13, 18);
      ctx.lineTo(-6, 13); ctx.lineTo(6, 13); ctx.lineTo(13, 18);
      ctx.lineTo(20, 4); ctx.lineTo(13, -12);
      break;
    default:       // arrow 标准箭头舰
      ctx.moveTo(0, -27);
      ctx.lineTo(-7, -10); ctx.lineTo(-17, 10); ctx.lineTo(-18, 17);
      ctx.lineTo(-6, 13); ctx.lineTo(0, 9); ctx.lineTo(6, 13);
      ctx.lineTo(18, 17); ctx.lineTo(17, 10); ctx.lineTo(7, -10);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // ---- 分层细节：深色内机体 + 特色部件 ----
  ctx.fillStyle = dark;
  ctx.strokeStyle = 'rgba(120,200,230,0.5)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  switch (ship.shape) {
    case 'dart':
      ctx.moveTo(0, -23); ctx.lineTo(-2.2, -6); ctx.lineTo(0, 1); ctx.lineTo(2.2, -6);
      break;
    case 'wing':
      ctx.moveTo(0, -17); ctx.lineTo(-3.2, -6); ctx.lineTo(0, 2); ctx.lineTo(3.2, -6);
      break;
    case 'heavy':
      ctx.moveTo(0, -15); ctx.lineTo(-5.5, -4); ctx.lineTo(-4.5, 11); ctx.lineTo(4.5, 11); ctx.lineTo(5.5, -4);
      break;
    default:
      ctx.moveTo(0, -20); ctx.lineTo(-3.2, -6); ctx.lineTo(0, 1); ctx.lineTo(3.2, -6);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // ---- 驾驶舱发光 ----
  G.drawGlow(ctx, 0, ship.shape === 'dart' ? -14 : -10, c, ship.shape === 'heavy' ? 7 : 5.5, 0.95);

  // ---- 特色部件 ----
  ctx.fillStyle = c;
  if (ship.shape === 'wing') {
    // 翼下荚舱
    ctx.beginPath(); ctx.ellipse(-17, 9, 3.4, 6, 0.25, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(17, 9, 3.4, 6, -0.25, 0, Math.PI * 2); ctx.fill();
  } else if (ship.shape === 'heavy') {
    // 肩炮
    ctx.save();
    ctx.translate(-16, -1); ctx.rotate(-0.12);
    ctx.fillRect(-2.5, -8, 5, 13);
    ctx.restore();
    ctx.save();
    ctx.translate(16, -1); ctx.rotate(0.12);
    ctx.fillRect(-2.5, -8, 5, 13);
    ctx.restore();
  } else if (ship.shape === 'dart') {
    // 翼尖刀片
    ctx.beginPath();
    ctx.moveTo(-13, 12); ctx.lineTo(-16, 17); ctx.lineTo(-9, 14);
    ctx.moveTo(13, 12); ctx.lineTo(16, 17); ctx.lineTo(9, 14);
    ctx.fill();
  } else {
    // arrow：翼尖着色 + 尾鳍
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.moveTo(-17, 10); ctx.lineTo(-18, 17); ctx.lineTo(-12, 14);
    ctx.moveTo(17, 10); ctx.lineTo(18, 17); ctx.lineTo(12, 14);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // ---- 引擎 ----
  if (ship.shape === 'wing' || ship.shape === 'heavy') {
    flame(-7, 15, 14, 3.2);
    flame(7, 15, 14, 3.2);
  } else if (ship.shape === 'dart') {
    flame(0, 12, 12, 2.4);
  } else {
    flame(-6, 14, 12, 2.6);
    flame(6, 14, 12, 2.6);
  }
};

/* ================= 玩家子弹 ================= */
G.spawnPlayerBullet = function (x, y, vx, vy, dmg, pierce, homing) {
  if (G.playerBullets.length >= G.CONFIG.maxPlayerBullets) G.playerBullets.shift();
  G.playerBullets.push({ x, y, vx, vy, r: 5, dmg: dmg || 10, pierce: pierce || 0, homing: !!homing, dead: false });
};

G.updatePlayerBullets = function (dt) {
  for (let i = G.playerBullets.length - 1; i >= 0; i--) {
    const b = G.playerBullets[i];
    if (b.homing) {
      // 优先级：敌机/Boss → 陨石
      let best = null, bd = Infinity;
      for (const e of G.enemies) { if (e.dead) continue; const d = G.utils.dist2(b.x, b.y, e.x, e.y); if (d < bd) { bd = d; best = e; } }
      if (G.boss && !G.boss.dead) { const d = G.utils.dist2(b.x, b.y, G.boss.x, G.boss.y); if (d < bd) { bd = d; best = G.boss; } }
      if (!best) {
        for (const o of G.obstacles) { if (o.dead) continue; const d = G.utils.dist2(b.x, b.y, o.x, o.y); if (d < bd) { bd = d; best = o; } }
      }
      if (best) {
        const ang = Math.atan2(best.y - b.y, best.x - b.x);
        const sp = Math.hypot(b.vx, b.vy);
        b.vx += Math.cos(ang) * 400 * dt;
        b.vy += Math.sin(ang) * 400 * dt;
        const nsp = Math.hypot(b.vx, b.vy);
        b.vx = b.vx / nsp * sp; b.vy = b.vy / nsp * sp;
      }
    }
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (b.y < -30 || b.y > G.H + 30 || b.x < -30 || b.x > G.W + 30) G.playerBullets.splice(i, 1);
  }
};

G.drawPlayerBullets = function (ctx) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const b of G.playerBullets) {
    if (b.homing) G.drawGlow(ctx, b.x, b.y, G.COLORS.gold, 7, 0.95);
    else G.drawGlow(ctx, b.x, b.y, G.COLORS.primary, 5, 0.95);
  }
  ctx.restore();
};

/* ================= 敌机 ================= */
// 跑得偏快的敌人：只携带短单词（≤5 字母），长单词由诗抄机独自携带
const FAST_ENEMY_TYPES = { scout: true, kamikaze: true, sniper: true, splitter: true };

G.spawnEnemy = function (type, x, y, vy) {
  const def = G.ENEMIES[type];
  const diff = G.difficulty();
  const sp = (G.DIFFICULTIES[G.difficultyMode] || G.DIFFICULTIES.normal).spdMul || 1;   // 难度速度倍率（普通 1.25 提速）
  const e = {
    type, x, y,
    vx: 0, vy: (vy || 0) * sp,
    hp: def.hp * diff, maxHp: def.hp * diff,
    r: def.r, score: def.score, coins: def.coins, contactDmg: def.contactDmg,
    dead: false, t: 0, fireCd: 0.6,
    baseX: x,         // 侦察机正弦基准
    state: 'enter',
    laserState: 'idle', laserT: 0,
    hoverY: 0,
    // 单词携带规则：快敌机只带短单词；诗抄机只带长单词；其余混编
    word: type === 'poet' ? G.nextLongWord()
        : FAST_ENEMY_TYPES[type] ? G.nextShortWord()
        : G.nextStageWord()
  };
  // 根据类型初始化速度与行为参数（整体节奏已放缓；速度 × 难度倍率 sp）
  switch (type) {
    case 'scout':
      e.vy = 108 * diff * sp; e.baseX = x; break;
    case 'kamikaze':
      e.vy = 75 * sp; break;
    case 'fighter':
      e.vx = (x < G.W / 2 ? 115 : -115) * sp; e.vy = 98 * sp; break;
    case 'tank':
      e.vy = 52 * sp; e.fireCd = 1.5; break;
    case 'turret':
      e.vy = 62 * sp; e.fireCd = 2; break;
    case 'elite':
      e.vy = 52 * sp; e.fireCd = 1.5; e.baseX = x; e.vx = 80 * sp; break;
    case 'splitter':
      e.vy = 85 * diff * sp; e.baseX = x; break;
    case 'sniper':
      e.vy = 74 * sp; e.fireCd = 1.6; break;
    case 'poet':
      // 诗抄机：不攻击形态缓降悬停；周期性展开为攻击形态逐字发射单词
      e.vy = 34 * sp; e.fireCd = 3.5; e.form = 'calm'; e.formScale = 1;
      e.attackCount = 0; e.letterQueue = []; e.letterTimer = 0;
      break;
    case 'transport':
      e.vx = (x < G.W / 2 ? 60 : -60) * sp; e.vy = 26 * sp; e.fireCd = 1; break;
  }
  G.enemies.push(e);
  return e;
};

G.updateEnemies = function (dt) {
  for (let i = G.enemies.length - 1; i >= 0; i--) {
    const e = G.enemies[i];
    e.t += dt;
    if (e.dead) { G.enemies.splice(i, 1); continue; }
    const diff = G.difficulty();
    const bulletSpeed = G.CONFIG.enemy.bulletSpeed * Math.sqrt(diff);
    const fireSlow = 1 / G.CONFIG.enemy.fireRateMul;   // 开火间隔倍率（节奏放缓）

    switch (e.type) {
      case 'scout': {
        e.x = e.baseX + Math.sin(e.t * 3) * 40;
        e.y += e.vy * dt;
        break;
      }
      case 'kamikaze': {
        if (e.state === 'enter') {
          if (G.player && !G.player.dead) {
            const a = Math.atan2(G.player.y - e.y, G.player.x - e.x);
            e.vx = Math.cos(a) * 132; e.vy = Math.sin(a) * 132; e.state = 'dive';
          }
        } else {
          e.x += e.vx * dt; e.y += e.vy * dt;
          e.vx *= 1.01; e.vy *= 1.01;
        }
        break;
      }
      case 'fighter': {
        if (e.state === 'enter') {
          e.x += e.vx * dt; e.y += e.vy * dt;
          if (e.y >= G.H * 0.3 && e.y <= G.H * 0.3 + 10) { e.state = 'hover'; e.hoverY = e.y; e.t = 0; }
        } else if (e.state === 'hover') {
          e.y = e.hoverY + Math.sin(e.t * 2) * 10;
          e.fireCd -= dt;
          // 3 连发瞄准弹
          if (e.fireCd <= 0) {
            if (!e.burst) e.burst = 0;
            if (e.burst < 3) { aimShoot(e, bulletSpeed); e.fireCd = 0.4 * fireSlow; e.burst++; }
            else { e.fireCd = 1.6 * fireSlow; e.burst = 0; }
          }
          if (e.t > 3) { e.state = 'leave'; }
        } else { e.x += e.vx * dt; e.y -= 130 * dt; }
        break;
      }
      case 'tank': {
        e.y += e.vy * dt;
        e.fireCd -= dt;
        if (e.fireCd <= 0) {
          e.fireCd = 2 / Math.sqrt(diff) * fireSlow;
          for (let a = -40; a <= 40; a += 20) {
            const r = G.utils.rad(a - 90);
            G.spawnEnemyBullet(e.x, e.y + 10, Math.cos(r) * bulletSpeed, Math.sin(r) * bulletSpeed);
          }
        }
        break;
      }
      case 'turret': {
        if (e.state === 'enter') {
          e.y += e.vy * dt;
          if (e.y >= G.H * 0.25) { e.state = 'hold'; e.t = 0; }
        } else {
          e.fireCd -= dt;
          if (e.fireCd <= 0) {
            e.fireCd = 3 / Math.sqrt(diff) * fireSlow;
            for (let a = 0; a < 360; a += 30) {
              const r = G.utils.rad(a);
              G.spawnEnemyBullet(e.x, e.y, Math.cos(r) * bulletSpeed, Math.sin(r) * bulletSpeed);
            }
          }
          if (e.t > 8) e.state = 'leave';
        }
        if (e.state === 'leave') e.y -= 82 * dt;
        break;
      }
      case 'elite': {
        if (e.state === 'enter') {
          e.y += e.vy * dt;
          if (e.y >= G.H * 0.2) { e.state = 'cruise'; e.hoverY = e.y; }
        } else {
          e.x += e.vx * dt;
          if (e.x > G.W - 40) e.vx = -90;
          if (e.x < 40) e.vx = 90;
          e.y = e.hoverY + Math.sin(e.t * 1.5) * 20;
          // 激光：预警 -> 发射
          e.laserT += dt;
          if (e.laserState === 'idle' && e.laserT > 2.0) { e.laserState = 'warn'; e.laserT = 0; }
          else if (e.laserState === 'warn' && e.laserT > 0.8) { e.laserState = 'fire'; e.laserT = 0; G.audio.hit(); }
          else if (e.laserState === 'fire' && e.laserT > 1.5) { e.laserState = 'idle'; e.laserT = 0; }
        }
        break;
      }
      case 'splitter': {
        // 缓慢直落 + 小幅摆动，死亡时分裂（见 killEnemy）
        e.x = e.baseX + Math.sin(e.t * 2) * 18;
        e.y += e.vy * dt;
        break;
      }
      case 'sniper': {
        // 降至上空悬停，充能后发射高速瞄准弹（充能期有红色瞄准线预警）
        if (e.state === 'enter') {
          e.y += e.vy * dt;
          if (e.y >= G.H * 0.22) { e.state = 'hold'; e.hoverY = e.y; e.t = 0; }
        } else if (e.state === 'hold') {
          e.y = e.hoverY + Math.sin(e.t * 2) * 8;
          e.fireCd -= dt;
          if (e.fireCd <= 0.5 && e.fireCd > 0 && !G.player.dead) {
            // 预警方向记录
            e.aimA = Math.atan2(G.player.y - e.y, G.player.x - e.x);
          }
          if (e.fireCd <= 0) {
            if (e.aimA !== undefined) {
              const sp2 = bulletSpeed * 1.8;
              G.spawnEnemyBullet(e.x, e.y, Math.cos(e.aimA) * sp2, Math.sin(e.aimA) * sp2);
              G.audio.shoot();
            }
            e.fireCd = 2.2 / Math.sqrt(diff) * fireSlow;
          }
          if (e.t > 10) e.state = 'leave';
        } else { e.y -= 120 * dt; }
        break;
      }
      case 'transport': {
        // 横向穿越战场，不攻击但丰厚掉落
        e.x += e.vx * dt;
        e.y += Math.sin(e.t * 1.2) * 22 * dt;
        break;
      }
      case 'poet': {
        // 诗抄机：不攻击形态缓降悬停（只飘不射）；周期性展开为攻击形态
        if (e.state === 'enter') {
          e.y += e.vy * dt;
          if (e.y >= G.H * 0.24) { e.state = 'hover'; e.hoverY = e.y; e.t = 0; }
        } else if (e.state === 'hover') {
          e.y = e.hoverY + Math.sin(e.t * 1.2) * 12;
          e.x = e.baseX + Math.sin(e.t * 0.7) * 26;
          if (e.form === 'calm') {
            e.fireCd -= dt;
            if (e.fireCd <= 0) startPoetAttack(e, bulletSpeed, fireSlow);
          }
          if (e.t > 16) e.state = 'leave';
        } else { e.y -= 70 * dt; }
        if (e.form === 'attack') updatePoetAttack(e, dt, bulletSpeed, fireSlow);
        break;
      }
    }
    // 出屏清理
    if (e.y > G.H + 60 || e.y < -80 || e.x < -80 || e.x > G.W + 80) e.dead = true;
  }
};

function aimShoot (e, speed) {
  if (!G.player || G.player.dead) return;
  const mode = G.DIFFICULTIES[G.difficultyMode] || G.DIFFICULTIES.normal;
  const trackMul = mode.trackMul || 1;
  // 困难模式：瞄准弹带轻微跟踪（飞行中每帧修正方向）
  const a = Math.atan2(G.player.y - e.y, G.player.x - e.x);
  G.spawnEnemyBullet(e.x, e.y + 6, Math.cos(a) * speed * 1.2, Math.sin(a) * speed * 1.2, trackMul > 1 ? 'homing' : null, trackMul);
}

/** 诗抄机展开攻击形态：每次比上一次更大；第 2 次起单词循环 2 次后逐字发射 */
function startPoetAttack (e, bulletSpeed, fireSlow) {
  e.form = 'attack';
  e.attackCount++;
  // 攻击形态逐轮放大（封顶 1.8 倍，保证版面可读）
  e.formScale = Math.min(1 + 0.22 * e.attackCount, 1.8);
  // 循环次数：第 1 次 1 遍，第 2 次起固定 2 遍（"循环 2 次即可"）
  const loops = e.attackCount >= 2 ? 2 : 1;
  const queue = [];
  for (let l = 0; l < loops; l++) {
    for (const ch of e.word.en) queue.push(ch);
  }
  e.letterQueue = queue;
  e.letterTimer = 0.25;
  G.audio.poetCast();
}

/** 攻击形态：逐字发射单词拼写（字母即子弹），发完收回不攻击形态 */
function updatePoetAttack (e, dt, bulletSpeed, fireSlow) {
  e.letterTimer -= dt;
  if (e.letterTimer <= 0 && e.letterQueue.length > 0) {
    const ch = e.letterQueue.shift();
    if (G.player && !G.player.dead) {
      const a = Math.atan2(G.player.y - e.y, G.player.x - e.x);
      const sp = bulletSpeed * 0.9;
      G.spawnEnemyBullet(e.x, e.y + 14 * (e.formScale || 1), Math.cos(a) * sp, Math.sin(a) * sp, null, 1, ch);
    }
    G.audio.spell();
    e.letterTimer = 0.22 * fireSlow;
  }
  if (e.letterQueue.length === 0) {
    e.form = 'calm';
    e.fireCd = 5.5;   // 收回魔法书，重新进入悠闲的不攻击形态
  }
}

G.drawEnemies = function (ctx) {
  for (const e of G.enemies) {
    if (e.dead) continue;
    ctx.save();
    ctx.translate(e.x, e.y);
    // BOSS 敌人受击闪白通过 hp<maxHp 时短暂实现（略）
    switch (e.type) {
      case 'scout':
        ctx.fillStyle = '#5ae0ff'; ctx.strokeStyle = '#00a0cc';
        ctx.beginPath(); ctx.moveTo(0, 16); ctx.lineTo(-12, -12); ctx.lineTo(12, -12); ctx.closePath();
        ctx.fill(); ctx.stroke(); break;
      case 'kamikaze':
        ctx.fillStyle = '#ff5a5a'; ctx.strokeStyle = '#ff2e2e';
        ctx.beginPath(); ctx.ellipse(0, 0, 8, 16, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        G.drawGlow(ctx, 0, 0, '#ff5a5a', 8, 0.8); break;
      case 'fighter':
        ctx.strokeStyle = '#ff8c00'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-14, -14); ctx.lineTo(14, 14); ctx.moveTo(14, -14); ctx.lineTo(-14, 14); ctx.stroke();
        ctx.fillStyle = '#ffb347'; ctx.fillRect(-4, -4, 8, 8); break;
      case 'tank':
        ctx.fillStyle = '#7a7f88'; ctx.strokeStyle = '#b0b5bf';
        hexPath(ctx, 24); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#5a5f68'; hexPath(ctx, 12); ctx.fill(); break;
      case 'turret':
        ctx.strokeStyle = '#ff7a5c'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, 22, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = '#3a2222'; ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI * 2); ctx.fill();
        G.drawGlow(ctx, 0, 0, '#ff5a3a', 6, 0.9); break;
      case 'elite':
        ctx.fillStyle = '#b44aff'; ctx.strokeStyle = '#e6a8ff';
        ctx.beginPath(); ctx.moveTo(0, -22); ctx.lineTo(-20, 10); ctx.lineTo(-10, 22); ctx.lineTo(10, 22); ctx.lineTo(20, 10); ctx.closePath();
        ctx.fill(); ctx.stroke();
        G.drawGlow(ctx, 0, 0, '#c86bff', 10, 0.9);
        // 激光
        if (e.laserState === 'warn') {
          ctx.strokeStyle = 'rgba(255,34,68,0.7)'; ctx.lineWidth = 2; ctx.setLineDash([6, 6]);
          ctx.beginPath(); ctx.moveTo(0, 24); ctx.lineTo(0, G.H); ctx.stroke(); ctx.setLineDash([]);
        } else if (e.laserState === 'fire') {
          ctx.strokeStyle = '#ff2244'; ctx.lineWidth = 10;
          ctx.beginPath(); ctx.moveTo(0, 24); ctx.lineTo(0, G.H); ctx.stroke();
        }
        break;
      case 'splitter':
        // 旋转菱形，内部两个待分裂小球
        ctx.rotate(e.t * 1.5);
        ctx.fillStyle = '#e05aff'; ctx.strokeStyle = '#f5b8ff';
        ctx.beginPath(); ctx.moveTo(0, -18); ctx.lineTo(18, 0); ctx.lineTo(0, 18); ctx.lineTo(-18, 0); ctx.closePath();
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#8a2ac8';
        ctx.beginPath(); ctx.arc(-6, 0, 4, 0, Math.PI * 2); ctx.arc(6, 0, 4, 0, Math.PI * 2); ctx.fill();
        break;
      case 'sniper':
        ctx.fillStyle = '#2a4a6a'; ctx.strokeStyle = '#5ac8ff';
        ctx.beginPath(); ctx.moveTo(0, -18); ctx.lineTo(-10, 10); ctx.lineTo(0, 20); ctx.lineTo(10, 10); ctx.closePath();
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#ff5a5a'; ctx.fillRect(-2, -20, 4, 10);   // 狙击枪管
        // 充能预警：红色瞄准虚线
        if (e.state === 'hold' && e.fireCd <= 0.5 && e.fireCd > 0 && e.aimA !== undefined) {
          ctx.strokeStyle = 'rgba(255,34,68,' + (0.5 + Math.sin(e.t * 20) * 0.3) + ')';
          ctx.lineWidth = 1.5; ctx.setLineDash([5, 5]);
          ctx.beginPath(); ctx.moveTo(0, 0);
          ctx.lineTo(Math.cos(e.aimA) * 500, Math.sin(e.aimA) * 500);
          ctx.stroke(); ctx.setLineDash([]);
        }
        break;
      case 'transport':
        // 宽体货舱，金光提示高价值
        ctx.fillStyle = '#6a5a2a'; ctx.strokeStyle = '#ffd24a';
        ctx.beginPath(); ctx.moveTo(-26, -10); ctx.lineTo(26, -10); ctx.lineTo(30, 8); ctx.lineTo(-30, 8); ctx.closePath();
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#3a3020'; ctx.fillRect(-16, -6, 32, 10);
        G.drawGlow(ctx, 0, 0, '#ffd24a', 8, 0.7 + Math.sin(e.t * 4) * 0.25);
        break;
      case 'poet': {
        // 诗抄机：不攻击形态=合上的魔法书+符文环；攻击形态=展开的双扇书页（逐轮放大）
        ctx.scale(e.formScale || 1, e.formScale || 1);
        if (e.form === 'attack') {
          // 展开的书页（两扇半圆页）
          ctx.fillStyle = 'rgba(255,240,200,0.95)';
          ctx.strokeStyle = '#ffb347'; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(0, -6); ctx.quadraticCurveTo(-26, -14, -30, 2); ctx.quadraticCurveTo(-18, 8, 0, 6); ctx.closePath(); ctx.fill(); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(0, -6); ctx.quadraticCurveTo(26, -14, 30, 2); ctx.quadraticCurveTo(18, 8, 0, 6); ctx.closePath(); ctx.fill(); ctx.stroke();
          // 书页上的文字行
          ctx.strokeStyle = 'rgba(120,80,40,0.5)'; ctx.lineWidth = 1;
          for (let i = 0; i < 3; i++) {
            ctx.beginPath(); ctx.moveTo(-24, -2 + i * 4); ctx.lineTo(-8, -2 + i * 4); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(8, -2 + i * 4); ctx.lineTo(24, -2 + i * 4); ctx.stroke();
          }
          // 书脊与封面
          ctx.fillStyle = '#4a2a8a'; ctx.strokeStyle = '#c86bff';
          ctx.beginPath(); ctx.moveTo(-4, -8); ctx.lineTo(4, -8); ctx.lineTo(4, 8); ctx.lineTo(-4, 8); ctx.closePath(); ctx.fill(); ctx.stroke();
          G.drawGlow(ctx, 0, -4, '#ffd24a', 14 + Math.sin(e.t * 8) * 3, 0.8);
        } else {
          // 合上的魔法书（圆角封面 + 书脊 + 金扣）
          ctx.fillStyle = '#3a2a6a'; ctx.strokeStyle = '#9a7aff'; ctx.lineWidth = 2;
          ctx.beginPath();
          if (ctx.roundRect) ctx.roundRect(-14, -18, 28, 36, 4); else ctx.rect(-14, -18, 28, 36);
          ctx.fill(); ctx.stroke();
          ctx.fillStyle = '#241a45'; ctx.fillRect(-3, -18, 6, 36);
          ctx.fillStyle = '#ffd24a';
          ctx.beginPath(); ctx.arc(0, 0, 3.5, 0, Math.PI * 2); ctx.fill();
          // 底部悠闲旋转的符文环
          ctx.strokeStyle = 'rgba(154,122,255,0.6)'; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.ellipse(0, 26, 16, 5, Math.sin(e.t * 2) * 0.2, 0, Math.PI * 2); ctx.stroke();
          G.drawGlow(ctx, 0, 0, '#9a7aff', 8, 0.5 + Math.sin(e.t * 3) * 0.2);
        }
        break;
      }
    }
    ctx.restore();
  }
  // 头顶单词标签：世界坐标统一绘制（避免机体旋转带动），加大更醒目
  for (const e of G.enemies) {
    if (e.dead) continue;
    G.drawWordTag(ctx, e.x, e.y - e.r - 34, e.word);
  }
};

function hexPath (ctx, r) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 3 * i + Math.PI / 6;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/* ================= 敌弹 ================= */
G.spawnEnemyBullet = function (x, y, vx, vy, homing, trackMul, ch) {
  if (G.enemyBullets.length >= G.CONFIG.maxEnemyBullets) G.enemyBullets.shift();
  G.enemyBullets.push({ x, y, vx, vy, r: 5, grazed: false, dead: false, homing: !!homing, trackMul: trackMul || 1, ch: ch || null });
};

G.updateEnemyBullets = function (dt) {
  const p = G.player;
  for (let i = G.enemyBullets.length - 1; i >= 0; i--) {
    const b = G.enemyBullets[i];
    if (b.homing && p && !p.dead) {
      const tm = b.trackMul || 1;
      const a = Math.atan2(p.y - b.y, p.x - b.x);
      const sp = Math.hypot(b.vx, b.vy) || 160;
      b.vx += Math.cos(a) * 200 * tm * dt;
      b.vy += Math.sin(a) * 200 * tm * dt;
      const ns = Math.hypot(b.vx, b.vy);
      b.vx = b.vx / ns * Math.min(sp + 40, 280);
      b.vy = b.vy / ns * Math.min(sp + 40, 280);
    }
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (b.x < -20 || b.x > G.W + 20 || b.y < -20 || b.y > G.H + 20) { G.enemyBullets.splice(i, 1); continue; }
    // 擦弹判定
    if (p && !p.dead && !b.grazed) {
      const d2 = G.utils.dist2(b.x, b.y, p.x, p.y);
      const graze = (p.grazeR + b.r) * (p.grazeR + b.r);
      const hit = (p.hitR + b.r) * (p.hitR + b.r);
      if (d2 <= graze && d2 > hit) {
        b.grazed = true;
        G.onGraze(b.x, b.y);
      }
    }
  }
};

/** 擦弹计分与充能 */
G.onGraze = function (x, y) {
  G.score += G.CONFIG.grazeScore;
  G.grazeCount++;
  G.save.get().stats.totalGraze++;
  const u = G.save.get().upgrades.graze;
  const gain = G.CONFIG.grazeCharge * (1 + u * 0.25);
  if (G.player.bombs < G.CONFIG.bombMax) {
    G.bombCharge += gain;
    if (G.bombCharge >= 1) {
      G.bombCharge = 0;
      G.player.bombs++;
      G.audio.powerup();
      G.spawnText(G.player.x, G.player.y - 30, 'BOMB +1', G.COLORS.accent, 13);
    }
  }
  G.audio.graze();
  G.spawnText(x, y - 10, 'GRAZE!', '#7fd8ff', 10);
};

G.drawEnemyBullets = function (ctx) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const b of G.enemyBullets) {
    if (b.ch) {
      // 诗抄机的字母弹：金色光球 + 中央字母
      G.drawGlow(ctx, b.x, b.y, '#ffd24a', 8, 0.95);
    } else {
      const c = (b.x + b.y) % 2 < 1 ? G.COLORS.enemyBullet1 : G.COLORS.enemyBullet2;
      G.drawGlow(ctx, b.x, b.y, c, 5, 0.95);
    }
  }
  // 字母在光球上层用普通混合绘制，保证清晰
  for (const b of G.enemyBullets) {
    if (!b.ch) continue;
    ctx.globalCompositeOperation = 'source-over';
    ctx.font = '700 11px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#5a3a00';
    ctx.fillText(b.ch.toUpperCase(), b.x, b.y + 0.5);
    ctx.globalCompositeOperation = 'lighter';
  }
  ctx.restore();
};

/* ================= 障碍物：陨石（不可穿过，可击碎） ================= */
G.spawnObstacle = function () {
  if (G.obstacles.length >= G.CONFIG.maxObstacles) return;
  const cfg = G.CONFIG.obstacle;
  const r = G.utils.rand(cfg.r[0], cfg.r[1]);
  // 关卡越后，陨石越硬、越快
  const lvlMul = 1 + (G.level - 1) * 0.22;
  // 难度模式：陨石实力（血量/速度）随模式提升
  const mode = G.DIFFICULTIES[G.difficultyMode] || G.DIFFICULTIES.normal;
  const diffHp = mode.hpMul || 1;
  const diffSp = mode.spdMul || 1;   // 难度速度倍率：简单 0.92× / 普通 1.25× / 困难 1.15×
  const hp = cfg.hp * (0.65 + r / cfg.r[1] * 0.7) * lvlMul * diffHp;
  const verts = [];
  const n = 9;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    verts.push({ a, rr: r * G.utils.rand(0.78, 1.12) });
  }
  G.obstacles.push({
    x: G.utils.rand(r + 24, G.W - r - 24), y: -r - 12,
    vx: G.utils.rand(-22, 22),
    vy: G.utils.rand(cfg.speed[0], cfg.speed[1]) * (1 + (G.level - 1) * 0.06) * diffSp,
    r, hp, maxHp: hp,
    rot: G.utils.rand(0, Math.PI * 2), vrot: G.utils.rand(-0.7, 0.7),
    verts, flash: 0, touchCd: 0, dead: false,
    word: G.nextStageWord()   // 出场携带本关词表单词（20 词循环）+ 中文注释
  });
};

/** 通用：在世界坐标 (x,y) 绘制 单词/中文注释 标签（大号 + 衬底，醒目易读） */
G.drawWordTag = function (ctx, x, y, word) {
  if (!word || !word.en) return;
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = '700 16px "Segoe UI", sans-serif';
  const enW = ctx.measureText(word.en).width;
  ctx.font = '600 12px "Microsoft YaHei", sans-serif';
  const cnW = ctx.measureText(word.cn).width;
  // 半透明深色圆角衬底，任何背景下都清晰
  const bw = Math.max(enW, cnW) + 18, bh = 34;
  ctx.fillStyle = 'rgba(5,10,28,0.62)';
  ctx.strokeStyle = 'rgba(95,227,232,0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x - bw / 2, y - 16, bw, bh, 8);
  else ctx.rect(x - bw / 2, y - 16, bw, bh);
  ctx.fill(); ctx.stroke();
  // 英文大字（霓虹青发光）
  ctx.fillStyle = '#c8fbff';
  ctx.shadowColor = 'rgba(95,227,232,1)'; ctx.shadowBlur = 10;
  ctx.font = '700 16px "Segoe UI", sans-serif';
  ctx.fillText(word.en, x, y);
  // 中文注释（白色）
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = '600 12px "Microsoft YaHei", sans-serif';
  ctx.fillText(word.cn, x, y + 14);
  ctx.restore();
};

G.updateObstacles = function (dt) {
  for (let i = G.obstacles.length - 1; i >= 0; i--) {
    const o = G.obstacles[i];
    if (o.dead || !o.verts) { G.obstacles.splice(i, 1); continue; }
    o.rot += o.vrot * dt;
    o.x += o.vx * dt;
    o.y += o.vy * dt;
    if (o.flash > 0) o.flash -= dt;
    if (o.touchCd > 0) o.touchCd -= dt;
    // 轻微横向反弹，避免贴边
    if (o.x < o.r) { o.x = o.r; o.vx = Math.abs(o.vx); }
    if (o.x > G.W - o.r) { o.x = G.W - o.r; o.vx = -Math.abs(o.vx); }
    if (o.y > G.H + o.r + 20) G.obstacles.splice(i, 1);
  }
};

/** 玩家子弹/炸弹对陨石造成伤害 */
G.damageObstacle = function (o, dmg) {
  if (!o || o.dead) return;
  o.hp -= dmg;
  o.flash = 0.06;
  if (o.hp <= 0) {
    o.dead = true;
    if (o.word && o.word.en) G.markWordHit(o.word.en);   // 陨石击破同样记入已击打词汇
    G.spawnExplosion(o.x, o.y, G.COLORS.rock, 14);
    G.audio.explode();
    G.shake(4, 0.12);
    G.addScore(120);
    G.kills++;
    // 掉落
    const cfg = G.CONFIG.obstacle;
    if (Math.random() < cfg.coinChance) G.spawnCoins(o.x, o.y, 2);
    if (Math.random() < cfg.powerupChance) {
      G.spawnPowerup(G.utils.pick(['H', 'S', 'T']), o.x, o.y);
    }
  }
};

G.drawObstacles = function (ctx) {
  for (const o of G.obstacles) {
    if (!o.verts) continue;   // 防御残缺对象
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.rotate(o.rot);
    // 柔和外发光
    G.drawGlow(ctx, 0, 0, G.COLORS.accent, o.r * 1.15, 0.16);
    // 不规则岩体
    ctx.beginPath();
    for (let i = 0; i < o.verts.length; i++) {
      const v = o.verts[i];
      const px = Math.cos(v.a) * v.rr, py = Math.sin(v.a) * v.rr;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    const grd = ctx.createRadialGradient(-o.r * 0.3, -o.r * 0.3, o.r * 0.2, 0, 0, o.r * 1.2);
    grd.addColorStop(0, '#B7AEE0');
    grd.addColorStop(0.6, G.COLORS.rock);
    grd.addColorStop(1, '#5C5480');
    ctx.fillStyle = o.flash > 0 ? '#ffffff' : grd;
    ctx.fill();
    ctx.strokeStyle = 'rgba(199,155,255,0.55)';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    // 表面陨石坑
    ctx.fillStyle = 'rgba(60,52,92,0.5)';
    ctx.beginPath(); ctx.arc(o.r * 0.25, o.r * 0.1, o.r * 0.16, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(-o.r * 0.3, o.r * 0.28, o.r * 0.11, 0, Math.PI * 2); ctx.fill();
    // 受伤裂纹（HP 低时）
    if (o.hp / o.maxHp < 0.5) {
      ctx.strokeStyle = 'rgba(255,217,138,0.6)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-o.r * 0.5, -o.r * 0.2); ctx.lineTo(0, 0); ctx.lineTo(o.r * 0.4, o.r * 0.35);
      ctx.stroke();
    }
    ctx.restore();
    // 陨石上方：单词标签（世界坐标，大号醒目）
    G.drawWordTag(ctx, o.x, o.y - o.r - 34, o.word);
  }
};

/* ================= 道具 ================= */
G.spawnPowerup = function (type, x, y) {
  G.powerups.push({ type, x, y, vy: G.CONFIG.powerupFallSpeed, r: 12, dead: false });
};

G.spawnCoins = function (x, y, count) {
  for (let i = 0; i < count; i++) {
    G.powerups.push({
      type: 'coin', x: x + G.utils.rand(-20, 20), y: y + G.utils.rand(-10, 10),
      vx: G.utils.rand(-40, 40), vy: G.utils.rand(-30, -10),
      r: 9, dead: false, life: 0
    });
  }
};

G.updatePowerups = function (dt) {
  const p = G.player;
  const magnetR = G.CONFIG.magnetR + G.save.get().upgrades.magnet * 20;
  for (let i = G.powerups.length - 1; i >= 0; i--) {
    const u = G.powerups[i];
    if (u.type === 'coin') {
      // 金币：散开减速下落，磁铁吸引
      u.vx *= 0.9; u.vy = u.vy * 0.9 + 40 * dt;
      u.x += u.vx * dt; u.y += u.vy * dt;
      if (p && !p.dead) {
        const d = Math.hypot(p.x - u.x, p.y - u.y);
        if (d < magnetR) {
          u.x += (p.x - u.x) * 8 * dt;
          u.y += (p.y - u.y) * 8 * dt;
        }
      }
    } else {
      u.y += u.vy * dt;
    }
    if (u.y > G.H + 30) { G.powerups.splice(i, 1); }
  }
};

G.drawPowerups = function (ctx) {
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const u of G.powerups) {
    if (u.type === 'coin') {
      G.drawGlow(ctx, u.x, u.y, G.COLORS.gold, 6, 0.95);
      ctx.fillStyle = G.COLORS.gold;
      ctx.font = '12px sans-serif'; ctx.fillText('★', u.x, u.y);
    } else {
      const colors = { P: G.COLORS.primary, S: '#6FB7FF', B: G.COLORS.accent, H: G.COLORS.mint, M: G.COLORS.gold, T: '#B59CFF' };
      const labels = { P: 'P', S: 'S', B: 'B', H: 'H', M: 'M', T: 'T' };
      const c = colors[u.type] || '#fff';
      G.drawGlow(ctx, u.x, u.y, c, 8, 0.9);
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(u.x, u.y, 11, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = c;
      ctx.font = 'bold 13px "Segoe UI", sans-serif'; ctx.fillText(labels[u.type], u.x, u.y);
    }
  }
  ctx.textBaseline = 'alphabetic';
};

/* ================= 僚机（小型备用战机） ================= */
/** 生成一架僚机实例（机库购买并装备后参战） */
G.makeDrone = function (type, dir) {
  const d = G.DRONES[type] || G.DRONES.firefly;
  return {
    type, dir,
    x: G.player ? G.player.x + dir * 30 : G.W / 2,
    y: G.player ? G.player.y + 18 : G.H - 120,
    fireCd: 0.4,
    hp: d.hp, maxHp: d.hp, r: d.hitR,
    dmgMul: d.dmgMul, rate: d.rate,
    shape: d.shape, color: d.color,
    invuln: 0
  };
};

/** 道具掉落僚机（M 型）：装备中的僚机型号，未装备则默认萤火虫 */
G.addWing = function () {
  if (G.wings.length >= 2) return;
  const save = G.save.get();
  const type = (save.currentDrone && save.unlockedDrones.includes(save.currentDrone)) ? save.currentDrone : 'firefly';
  G.wings.push(G.makeDrone(type, G.wings.length === 0 ? -1 : 1));
  G.wings.sort((a, b) => a.dir - b.dir);
};

G.updateWings = function (dt) {
  const p = G.player;
  if (!p) return;
  for (const w of G.wings) {
    const off = w.dir * (26 + (G.wings.length > 1 ? 14 : 0));
    const tx = p.x + off, ty = p.y + 18;
    w.x += (tx - w.x) * 8 * dt; w.y += (ty - w.y) * 8 * dt;
    if (w.invuln > 0) w.invuln -= dt;
    w.fireCd -= dt;
    if (w.fireCd <= 0 && !p.dead) {
      w.fireCd = 1 / w.rate;   // 僚机射速（较旧版 0.5s 间隔略有提升）
      G.fireDrone(w);
    }
  }
};

/** 僚机开火：按型号决定弹幕 pattern（单发 / 双发 / 三发散射） */
G.fireDrone = function (w) {
  const p = G.player;
  const spd = G.CONFIG.bulletSpeed;
  const dmg = G.CONFIG.damage * w.dmgMul * p.dmgMul;
  const y = w.y - 10;
  const shot = (dx) => G.spawnPlayerBullet(w.x + dx, y, 0, -spd, dmg, 0);
  const diag = (dx, ang) => {
    const a = G.utils.rad(ang);
    G.spawnPlayerBullet(w.x + dx, y, Math.sin(a) * spd, -Math.cos(a) * spd, dmg, 0);
  };
  if (w.shape === 'wing') { shot(-4); shot(4); }
  else if (w.shape === 'heavy') { shot(0); diag(-4, 14); diag(4, -14); }
  else shot(0);
};

/** 僚机受击：独立血量，归零爆炸退场 */
G.hurtDrone = function (w, dmg) {
  if (w.invuln > 0) return;
  w.hp -= dmg;
  if (w.hp <= 0) {
    G.spawnExplosion(w.x, w.y, w.color, 14);
    G.audio.explode();
    const i = G.wings.indexOf(w);
    if (i >= 0) G.wings.splice(i, 1);
  } else {
    w.invuln = 0.9;   // 受击后保护时间加长（寿命提升）
    G.audio.hit();
    G.spawnShockwave(w.x, w.y, w.color, 36, 0.2);
  }
};

/** 僚机矢量绘制（战斗 + 机库预览共用，t 传运行时间时带尾焰） */
G.drawDroneShape = function (ctx, w, t) {
  const c = w.color || '#FFD98A';
  const hull = '#f4fbff';
  ctx.lineJoin = 'round';
  // 尾焰
  if (t !== undefined) {
    const f = 0.7 + 0.3 * Math.sin(t * 30 + w.x);
    const g = ctx.createLinearGradient(0, 8, 0, 8 + 10 * f);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.4, c);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-2.6, 8); ctx.lineTo(2.6, 8); ctx.lineTo(0, 8 + 10 * f);
    ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = hull;
  ctx.strokeStyle = c;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  switch (w.shape) {
    case 'wing':   // 雷蜂：双翼脉冲
      ctx.moveTo(0, -11);
      ctx.lineTo(-4, -4); ctx.lineTo(-11, 4); ctx.lineTo(-4, 6);
      ctx.lineTo(0, 4); ctx.lineTo(4, 6); ctx.lineTo(11, 4); ctx.lineTo(4, -4);
      break;
    case 'heavy':  // 星刃：重装宽体
      ctx.moveTo(0, -10);
      ctx.lineTo(-6, -4); ctx.lineTo(-8, 6); ctx.lineTo(0, 9); ctx.lineTo(8, 6); ctx.lineTo(6, -4);
      break;
    default:       // 萤火虫：轻巧飞镖
      ctx.moveTo(0, -12);
      ctx.lineTo(-4, -2); ctx.lineTo(-7, 7); ctx.lineTo(0, 4); ctx.lineTo(7, 7); ctx.lineTo(4, -2);
  }
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  G.drawGlow(ctx, 0, -4, c, 3, 0.8);
};

G.drawWings = function (ctx) {
  const t = performance.now() / 1000;
  for (const w of G.wings) {
    ctx.save();
    ctx.translate(w.x, w.y);
    // 受击后的无敌闪烁
    if (w.invuln > 0 && Math.floor(w.invuln * 14) % 2 === 0) ctx.globalAlpha = 0.45;
    G.drawDroneShape(ctx, w, t);
    ctx.restore();
  }
};

/* ================= 炸弹 ================= */
G.useBomb = function () {
  const p = G.player;
  if (!p || p.dead || p.bombs <= 0) return;
  p.bombs--;
  // 清屏敌弹
  for (const b of G.enemyBullets) b.dead = true;
  G.enemyBullets.length = 0;
  // 全屏伤害
  for (const e of G.enemies) { if (!e.dead) damageEnemy(e, G.CONFIG.bombDamage); }
  if (G.boss && !G.boss.dead) damageBoss(G.CONFIG.bombDamage);
  // 击碎陨石
  for (const o of G.obstacles) { if (!o.dead) G.damageObstacle(o, G.CONFIG.bombDamage); }
  // 无敌 + 特效
  p.invincible = Math.max(p.invincible, G.CONFIG.bombInvincible);
  G.spawnShockwave(p.x, p.y, '#ffffff', 500, 0.6);
  G.spawnShockwave(p.x, p.y, G.COLORS.primary, 700, 0.9);
  G.flashTimer = 0.25;
  G.audio.bomb();
  G.shake(8, 0.4);
};

/* ================= 共享伤害 ================= */
function damageEnemy (e, dmg) {
  e.hp -= dmg;
  e.flash = 0.06;
  if (e.hp <= 0) killEnemy(e);
}

function killEnemy (e) {
  if (e.dead) return;
  e.dead = true;
  if (e.word && e.word.en) G.markWordHit(e.word.en);   // 记录本关已击打词汇（结算词汇表用）
  G.addScore(e.score);
  G.kills++;
  G.save.get().stats.totalKills++;
  G.addCombo();
  // 大型敌机：更华丽爆炸 + 飘分反馈
  const big = (e.type === 'tank' || e.type === 'elite' || e.type === 'transport' || e.type === 'turret' || e.type === 'splitter' || e.type === 'sniper');
  G.spawnExplosion(e.x, e.y, '#00E5FF', big ? 24 : 12);
  if (big) G.spawnText(e.x, e.y - 12, '+' + e.score, G.COLORS.gold, 14);
  // 分裂机：死亡时分裂为 2 架半血侦察机
  if (e.type === 'splitter') {
    for (const off of [-16, 16]) {
      const s = G.spawnEnemy('scout', e.x + off, e.y, 150);
      s.hp = s.maxHp = s.maxHp * 0.5;
      s.baseX = s.x;
    }
    G.spawnText(e.x, e.y - 20, 'SPLIT!', '#e05aff', 12);
  }
  // 掉落
  dropLoot(e, e.type);
}

/** 掉落逻辑（按敌机类型） */
function dropLoot (e, type) {
  const roll = Math.random();
  if (type === 'elite') { if (roll < 0.7) G.spawnPowerup('P', e.x, e.y); if (roll < 0.3) G.spawnPowerup('M', e.x + 12, e.y); if (roll < 0.25) G.spawnPowerup('H', e.x - 12, e.y); if (roll < 0.08) G.spawnPowerup('T', e.x, e.y - 14); }
  else if (type === 'tank') { if (roll < 0.08) G.spawnPowerup('S', e.x, e.y); else if (roll < 0.18) G.spawnPowerup('H', e.x, e.y); }
  else if (type === 'turret') { if (roll < 0.06) G.spawnPowerup('B', e.x, e.y); }
  else if (type === 'kamikaze') { if (roll < 0.05) G.spawnPowerup('H', e.x, e.y); }
  else if (type === 'scout') { if (roll < 0.05) G.spawnPowerup('P', e.x, e.y); }
  else if (type === 'fighter') { if (roll < 0.05) G.spawnPowerup('P', e.x, e.y); }
  else if (type === 'splitter') { if (roll < 0.07) G.spawnPowerup('P', e.x, e.y); }
  else if (type === 'sniper') { if (roll < 0.10) G.spawnPowerup('H', e.x, e.y); else if (roll < 0.14) G.spawnPowerup('T', e.x, e.y); }
  else if (type === 'transport') {
    // 运输机：丰厚奖励掉落（随机道具 + 金币雨）
    const lucky = ['P', 'H', 'S', 'B'][Math.floor(Math.random() * 4)];
    G.spawnPowerup(lucky, e.x, e.y);
    G.spawnCoins(e.x, e.y, 6);
    G.spawnText(e.x, e.y - 24, 'CARGO!', G.COLORS.gold, 14);
  }
  // 金币
  const coinCount = { scout: 1, kamikaze: 0, fighter: 2, tank: 4, turret: 4, elite: 4, splitter: 2, sniper: 2, transport: 6 }[type] || 0;
  if (coinCount > 0) G.spawnCoins(e.x, e.y, coinCount);
}