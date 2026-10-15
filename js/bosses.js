/* =========================================================
 * bosses.js —— 9 个 Boss（难度分池）+ 阶段状态机 + 弹幕模式
 * 池分配（config.js BOSS_POOLS）：
 *   简单 [3,4,5] 萌系温和：花灯精灵 / 菌伞小屋 / 风车絮
 *   普通 [0,1,2] 经典三形态：陨星巢母 / 星云幻影 / 泰坦星核
 *   困难 [6,7,8] 暗黑恐怖：深渊之眼 / 腐化巢核 / 虚空鲸
 * 弹幕统一复用现有敌弹原语（spawnEnemyBullet/spawnEnemy），不新增弹型
 * ========================================================= */
window.G = window.G || {};

G.boss = null;          // 当前 Boss 实体
G.bossDying = 0;        // 击杀演出计时

/** Boss 死后弹出的温馨日常英文句子（过关结算随机展示） */
G.BOSS_SENTENCES = [
  'The stars sleep early tonight. So should you.',
  'Even a brave pilot deserves a warm cup of tea.',
  'You did great today. The galaxy is proud of you.',
  'Take a deep breath. The nebula smells like flowers.',
  'Home is just a small light waiting in the dark.',
  'Every ending is a quiet new beginning.',
  'Rest now, pilot. Tomorrow the sun rises again.',
  'The little repair bot says good job today.',
  'Somewhere far away, someone kept dinner warm for you.',
  'Kindness is the brightest weapon you carry.',
  'The quiet sky says thank you for coming home.',
  'Small steps still cross the whole universe.'
];
G.lastBossSentence = '';

/** 由波次层调用：生成指定类型 Boss（typeIndex: 0-8，按难度池分配） */
G.spawnBoss = function (typeIndex) {
  const def = G.BOSSES[typeIndex];
  // 血量 = 基础 × 轮次(每3关一轮) × 难度选项（困难更肉）
  const mode = (G.DIFFICULTIES[G.difficultyMode] || G.DIFFICULTIES.normal);
  const hpMul = (1 + 0.28 * Math.floor((G.level - 1) / 3)) * mode.hpMul;
  G.boss = {
    typeIndex, name: def.name,
    x: G.W / 2, y: -140,
    w: def.width,
    hp: def.hp * hpMul, maxHp: def.hp * hpMul,
    r: def.width / 2,
    rush: false,           // 超时狂暴：受伤翻倍
    phase: 0,
    phaseTimer: 0,        // 用于各阶段弹幕节拍
    invuln: 1.5,
    dead: false, dying: false, dieTimer: 0,
    flash: 0,
    t: 0,
    cloneA: null, cloneB: null   // Boss① P2 分身
  };
};

function damageBoss (dmg) {
  const b = G.boss;
  if (!b || b.dead || b.dying) return;
  if (b.invuln > 0) return;
  b.hp -= b.rush ? dmg * 2 : dmg;   // 超时狂暴期受伤翻倍
  b.flash = 0.05;
  if (b.hp <= 0) { killBoss(); return; }
  // 阶段判定
  const p = b.hp / b.maxHp;
  let tp = p <= 0.33 ? 2 : (p <= 0.66 ? 1 : 0);
  if (tp > b.phase) {
    b.phase = tp;
    phaseTransition(b);
  }
}
G.damageBoss = damageBoss;

function phaseTransition (b) {
  b.invuln = 1.0;
  b.phaseTimer = 0; b.subTimer = 0;   // 重置节拍，新阶段从头计时
  // 清除自身弹幕
  G.enemyBullets.length = 0;
  G.spawnShockwave(b.x, b.y, G.COLORS.accent, 300, 0.5);
  G.spawnPowerup('S', b.x, b.y + 20);
  G.audio.hit();
}

function killBoss () {
  const b = G.boss;
  b.dead = true; b.dying = true; b.dieTimer = 0;
  // 击杀后弹出温馨日常英文句子（过关结算展示）
  G.lastBossSentence = G.BOSS_SENTENCES[Math.floor(Math.random() * G.BOSS_SENTENCES.length)];
  G.addScore(G.ENEMY_SCORE.boss);
  G.kills++;
  G.save.get().stats.bossKills++;
  G.audio.bossExplode();
  G.shake(14, 0.8);
  G.slowMo(0.3, 0.25);
}

G.updateBoss = function (dt) {
  const b = G.boss;
  if (!b) return;
  b.t += dt;
  if (b.flash > 0) b.flash -= dt;
  if (b.invuln > 0) b.invuln -= dt;

  // 击杀演出
  if (b.dying) {
    b.dieTimer += dt;
    // 连环爆炸
    if (Math.floor(b.dieTimer * 10) % 2 === 0 && b.dieTimer < 1.2) {
      G.spawnExplosion(b.x + G.utils.rand(-60, 60), b.y + G.utils.rand(-40, 40), '#ffd24a', 10);
      G.audio.explode();
    }
    if (b.dieTimer >= 1.2) {
      // 掉落奖励
      G.spawnCoins(b.x, b.y, 6);
      G.spawnPowerup('P', b.x - 30, b.y);
      G.spawnPowerup('H', b.x + 30, b.y);
      G.spawnPowerup('C', b.x, b.y - 20);   // 充能核：保证大招可多次使用
      G.boss = null; G.bossDying = 0;
    }
    return;
  }

  // 入场动画（从顶部下降到战斗位置）
  const targetY = 150;
  if (b.y < targetY) b.y += 90 * dt;
  else {
    b.y = targetY + Math.sin(b.t * 1.2) * 12;   // 轻微上下浮动
    if (b.invuln <= 0) bossFire(b, dt);
  }
};

/** Boss 弹幕模式（按类型 + 阶段分发） */
function bossFire (b, dt) {
  b.phaseTimer += dt;
  b.subTimer = (b.subTimer || 0) + dt;   // 次级节拍（P2/P3 的副攻击）
  const sp = 168 * Math.sqrt(G.fireDifficulty());

  if (b.typeIndex === 0) {
    // 蜂巢母舰：P1 两翼扇形交替 / P2 环形+召唤 / P3 旋转螺旋
    if (b.phase === 0) {
      if (b.phaseTimer > 1.0) {
        b.phaseTimer = 0;
        const side = Math.floor(b.t * 2) % 2 === 0 ? -1 : 1;
        for (let a = -50; a <= 50; a += 25) {
          const r = G.utils.rad(90 + a);
          G.spawnEnemyBullet(b.x + side * b.w * 0.4, b.y + 20, Math.cos(r) * sp * 0.8, Math.sin(r) * sp * 0.8);
        }
      }
    } else if (b.phase === 1) {
      if (b.phaseTimer > 1.4) {
        b.phaseTimer = 0;
        for (let a = 0; a < 360; a += 24) {
          const r = G.utils.rad(a);
          G.spawnEnemyBullet(b.x, b.y, Math.cos(r) * sp, Math.sin(r) * sp);
        }
        if (Math.random() < 0.6) {
          G.spawnEnemy('kamikaze', b.x - 60, b.y + 30, 0);
          G.spawnEnemy('kamikaze', b.x + 60, b.y + 30, 0);
        }
      }
    } else {
      if (b.phaseTimer > 0.06) {
        b.phaseTimer = 0;
        const ang = b.t * 3;
        for (let k = 0; k < 2; k++) {
          const a = ang + k * Math.PI;
          G.spawnEnemyBullet(b.x, b.y, Math.cos(a) * sp * 1.3, Math.sin(a) * sp * 1.3);
        }
      }
    }
  } else if (b.typeIndex === 1) {
    // 幽灵巡洋：P1 瞄准激光 / P2 分身(三点闪烁) / P3 弹幕墙留缝
    if (b.phase === 0) {
      if (b.phaseTimer > 1.8) {
        b.phaseTimer = 0;
        let a = Math.PI / 2;
        if (G.player && !G.player.dead) a = Math.atan2(G.player.y - b.y, G.player.x - b.x);
        for (let k = -1; k <= 1; k++) {
          G.spawnEnemyBullet(b.x, b.y, Math.cos(a) * sp * 1.6, Math.sin(a) * sp * 1.6 + k * 40);
        }
      }
    } else if (b.phase === 1) {
      // 分身：机体在 x 上三点间闪烁移动
      const t = b.t * 4;
      const targetX = [G.W * 0.25, G.W * 0.5, G.W * 0.75][Math.floor(t) % 3];
      b.x += (targetX - b.x) * 6 * dt;
      if (b.phaseTimer > 0.7) {
        b.phaseTimer = 0;
        for (let a = -35; a <= 35; a += 17) {
          const r = G.utils.rad(90 + a);
          G.spawnEnemyBullet(b.x, b.y, Math.cos(r) * sp, Math.sin(r) * sp);
        }
      }
    } else {
      // 弹幕墙：留 2 个安全缝隙
      if (b.phaseTimer > 0.5) {
        b.phaseTimer = 0;
        const gap1 = G.utils.rand(40, 200);
        const gap2 = G.utils.rand(280, 440);
        for (let x = 10; x < G.W; x += 24) {
          if (Math.abs(x - gap1) < 40 || Math.abs(x - gap2) < 40) continue;
          G.spawnEnemyBullet(x, -10, 0, sp);
        }
      }
    }
  } else if (b.typeIndex === 2) {
    // 泰坦旗舰：P1 三向交叉+追踪 / P2 弹幕漩涡 / P3 全屏+编队+激光栅栏
    if (b.phase === 0) {
      if (b.phaseTimer > 0.9) {
        b.phaseTimer = 0;
        const dirs = [-30, 0, 30];
        for (const d of dirs) {
          const r = G.utils.rad(90 + d);
          G.spawnEnemyBullet(b.x, b.y + 30, Math.cos(r) * sp, Math.sin(r) * sp);
        }
        if (Math.random() < 0.8) {
          G.spawnEnemyBullet(b.x - 40, b.y + 20, 0, 120, true);
          G.spawnEnemyBullet(b.x + 40, b.y + 20, 0, 120, true);
        }
      }
    } else if (b.phase === 1) {
      if (b.phaseTimer > 0.04) {
        b.phaseTimer = 0;
        const dir = Math.floor(b.t / 4) % 2 === 0 ? 1 : -1;   // 顺时针/逆时针交替
        const ang = b.t * 4 * dir;
        G.spawnEnemyBullet(b.x, b.y, Math.cos(ang) * sp, Math.sin(ang) * sp);
        G.spawnEnemyBullet(b.x, b.y, Math.cos(ang + Math.PI) * sp, Math.sin(ang + Math.PI) * sp);
      }
    } else {
      if (b.phaseTimer > 0.35) {
        b.phaseTimer = 0;
        for (let a = 0; a < 360; a += 18) {
          const r = G.utils.rad(a + b.t * 40);
          G.spawnEnemyBullet(b.x, b.y, Math.cos(r) * sp * 0.9, Math.sin(r) * sp * 0.9);
        }
        if (Math.random() < 0.5) G.spawnEnemy('scout', G.utils.rand(40, G.W - 40), -20, 0);
      }
    }
  } else if (b.typeIndex === 3) {
    // 花灯精灵（萌系）：P1 软糯三连弹 / P2 糯米团子环+召唤 / P3 双螺旋慢洒
    if (b.phase === 0) {
      if (b.phaseTimer > 1.1) {
        b.phaseTimer = 0;
        for (let k = -1; k <= 1; k++) {
          const r = G.utils.rad(90 + k * 22);
          G.spawnEnemyBullet(b.x + k * 30, b.y + 26, Math.cos(r) * sp * 0.55, Math.sin(r) * sp * 0.55);
        }
      }
    } else if (b.phase === 1) {
      if (b.phaseTimer > 1.3) {
        b.phaseTimer = 0;
        for (let a = 0; a < 360; a += 45) {
          const r = G.utils.rad(a + b.t * 20);
          G.spawnEnemyBullet(b.x, b.y, Math.cos(r) * sp * 0.6, Math.sin(r) * sp * 0.6);
        }
        if (Math.random() < 0.5) G.spawnEnemy('kamikaze', G.utils.rand(60, G.W - 60), -20, 0);
      }
    } else {
      if (b.phaseTimer > 0.14) {
        b.phaseTimer = 0;
        const ang = b.t * 2.2;
        for (let k = 0; k < 2; k++) {
          const a = ang + k * Math.PI;
          G.spawnEnemyBullet(b.x, b.y, Math.cos(a) * sp * 0.7, Math.sin(a) * sp * 0.7);
        }
      }
    }
  } else if (b.typeIndex === 4) {
    // 菌伞小屋（萌系）：P1 星光点射 / P2 气泡墙 / P3 脉冲双环
    if (b.phase === 0) {
      if (b.phaseTimer > 1.3) {
        b.phaseTimer = 0;
        let a = Math.PI / 2;
        if (G.player && !G.player.dead) a = Math.atan2(G.player.y - b.y, G.player.x - b.x);
        for (let k = -1; k <= 1; k++) {
          G.spawnEnemyBullet(b.x, b.y + 12, Math.cos(a) * sp * 0.65, Math.sin(a) * sp * 0.65 + k * 36);
        }
      }
    } else if (b.phase === 1) {
      if (b.phaseTimer > 0.6) {
        b.phaseTimer = 0;
        const bx = G.utils.rand(30, G.W - 30);
        for (let k = 0; k < 3; k++) {
          G.spawnEnemyBullet(bx + k * 14, -10 - k * 26, 0, sp * 0.6);
        }
      }
    } else {
      if (b.phaseTimer > 1.4) {
        b.phaseTimer = 0;
        for (let ring = 0; ring < 2; ring++) {
          for (let a = 0; a < 360; a += 36) {
            const r = G.utils.rad(a + ring * 18);
            const v = sp * (0.5 + ring * 0.15);
            G.spawnEnemyBullet(b.x, b.y, Math.cos(r) * v, Math.sin(r) * v);
          }
        }
      }
    }
  } else if (b.typeIndex === 5) {
    // 风车絮（萌系）：P1 糖霜抛洒 / P2 扫射扇 / P3 斜跳双引流+团子环
    if (b.phase === 0) {
      if (b.phaseTimer > 0.8) {
        b.phaseTimer = 0;
        for (let k = 0; k < 4; k++) {
          G.spawnEnemyBullet(G.utils.rand(b.x - b.w * 0.4, b.x + b.w * 0.4), b.y + 22, G.utils.rand(-40, 40), sp * 0.55);
        }
      }
    } else if (b.phase === 1) {
      if (b.phaseTimer > 0.5) {
        b.phaseTimer = 0;
        const sweep = Math.sin(b.t * 1.8) * 40;
        for (let k = -2; k <= 2; k++) {
          const r = G.utils.rad(90 + sweep + k * 16);
          G.spawnEnemyBullet(b.x, b.y + 18, Math.cos(r) * sp * 0.7, Math.sin(r) * sp * 0.7);
        }
      }
    } else {
      if (b.phaseTimer > 1.2) {
        b.phaseTimer = 0;
        for (const dir of [-1, 1]) {
          for (let k = 0; k < 3; k++) {
            G.spawnEnemyBullet(b.x + dir * 40, b.y + 12, dir * sp * 0.5 * (1 + k * 0.2), sp * 0.35);
          }
        }
        if (Math.random() < 0.6) {
          for (let a = 0; a < 360; a += 60) {
            const r = G.utils.rad(a);
            G.spawnEnemyBullet(b.x, b.y, Math.cos(r) * sp * 0.5, Math.sin(r) * sp * 0.5);
          }
        }
      }
    }
  } else if (b.typeIndex === 6) {
    // 深渊之眼（恐怖）：P1 凝视锁定速射 / P2 旋转双缝眼睫毛环 / P3 三臂疾速螺旋+凝视
    if (b.phase === 0) {
      if (b.phaseTimer > 0.9) {
        b.phaseTimer = 0;
        let a = Math.PI / 2;
        if (G.player && !G.player.dead) a = Math.atan2(G.player.y - b.y, G.player.x - b.x);
        for (let k = -1; k <= 1; k++) {
          G.spawnEnemyBullet(b.x, b.y + 10, Math.cos(a) * sp * 1.5, Math.sin(a) * sp * 1.5 + k * 46);
        }
      }
    } else if (b.phase === 1) {
      if (b.phaseTimer > 0.5) {
        b.phaseTimer = 0;
        const n = 14, offset = Math.floor(b.t * 1.5) % n;
        for (let i = 0; i < n; i++) {
          const d = (i - offset + n) % n;
          if (d < 2 || d >= n - 2) continue;   // 两道对向旋转缝隙
          const a = i * (Math.PI * 2 / n);
          G.spawnEnemyBullet(b.x, b.y, Math.cos(a) * sp * 0.9, Math.sin(a) * sp * 0.9);
        }
      }
    } else {
      if (b.phaseTimer > 0.05) {
        b.phaseTimer = 0;
        const ang = b.t * 4.5;
        for (let k = 0; k < 3; k++) {
          const a = ang + k * (Math.PI * 2 / 3);
          G.spawnEnemyBullet(b.x, b.y, Math.cos(a) * sp * 1.25, Math.sin(a) * sp * 1.25);
        }
      }
      if (b.subTimer > 2.6 && G.player && !G.player.dead) {
        b.subTimer = 0;
        const a = Math.atan2(G.player.y - b.y, G.player.x - b.x);
        G.spawnEnemyBullet(b.x, b.y + 10, Math.cos(a) * sp * 1.5, Math.sin(a) * sp * 1.5);
        G.spawnEnemyBullet(b.x, b.y + 10, Math.cos(a + 0.12) * sp * 1.5, Math.sin(a + 0.12) * sp * 1.5);
      }
    }
  } else if (b.typeIndex === 7) {
    // 腐化巢核（恐怖）：P1 腐孢抛洒 / P2 腐化召唤+孢环 / P3 毒螺旋+留缝孢墙
    if (b.phase === 0) {
      if (b.phaseTimer > 0.7) {
        b.phaseTimer = 0;
        for (let k = 0; k < 4; k++) {
          const a = G.utils.rad(60 + G.utils.rand(0, 60));
          G.spawnEnemyBullet(b.x + G.utils.rand(-40, 40), b.y + G.utils.rand(-10, 30),
            Math.cos(a) * sp * 0.5 * G.utils.rand(0.8, 1.2), Math.sin(a) * sp * 0.55);
        }
      }
    } else if (b.phase === 1) {
      if (b.subTimer > 2.0) {
        b.subTimer = 0;
        G.spawnEnemy(G.utils.pick(['kamikaze', 'scout', 'poet']), G.utils.rand(60, G.W - 60), -20, 0);
        G.spawnEnemy(G.utils.pick(['kamikaze', 'scout', 'poet']), G.utils.rand(60, G.W - 60), -20, 0);
      }
      if (b.phaseTimer > 1.3) {
        b.phaseTimer = 0;
        for (let a = 0; a < 360; a += 45) {
          const r = G.utils.rad(a + b.t * 30);
          G.spawnEnemyBullet(b.x, b.y, Math.cos(r) * sp * 0.8, Math.sin(r) * sp * 0.8);
        }
      }
    } else {
      if (b.phaseTimer > 0.09) {
        b.phaseTimer = 0;
        const ang = b.t * 3.8;
        for (let k = 0; k < 2; k++) {
          const a = ang + k * Math.PI;
          G.spawnEnemyBullet(b.x, b.y, Math.cos(a) * sp * 1.15, Math.sin(a) * sp * 1.15);
        }
      }
      if (b.subTimer > 2.4) {
        b.subTimer = 0;
        const gap = G.utils.rand(40, 200);
        for (let x = 10; x < G.W; x += 24) {
          if (Math.abs(x - gap) < 44) continue;
          G.spawnEnemyBullet(x, -10, 0, sp * 0.9);
        }
      }
    }
  } else {
    // 虚空鲸（恐怖）：P1 鲸歌宽扇+侧鳍追踪 / P2 吞噬大张口+召重装 / P3 十字巨浪+旋转环
    if (b.phase === 0) {
      if (b.phaseTimer > 1.3) {
        b.phaseTimer = 0;
        for (let k = -3; k <= 3; k++) {
          const r = G.utils.rad(90 + k * 13);
          G.spawnEnemyBullet(b.x, b.y + 36, Math.cos(r) * sp * 0.85, Math.sin(r) * sp * 0.85);
        }
        for (const sx of [-1, 1]) {
          if (G.player && !G.player.dead) {
            const a = Math.atan2(G.player.y - b.y, G.player.x - (b.x + sx * 60));
            G.spawnEnemyBullet(b.x + sx * 60, b.y + 12, Math.cos(a) * sp, Math.sin(a) * sp, true);
          }
        }
      }
    } else if (b.phase === 1) {
      if (b.phaseTimer > 0.55) {
        b.phaseTimer = 0;
        if (G.player && !G.player.dead) {
          const a = Math.atan2(G.player.y - b.y, G.player.x - b.x);
          for (let k = -2; k <= 2; k++) {
            G.spawnEnemyBullet(b.x, b.y + 32, Math.cos(a) * sp * 1.2, Math.sin(a) * sp * 1.2 + k * 52);
          }
        }
      }
      if (b.subTimer > 2.6) {
        b.subTimer = 0;
        G.spawnEnemy('tank', G.utils.rand(80, G.W - 80), -60, 0);
      }
    } else {
      if (b.phaseTimer > 1.1) {
        b.phaseTimer = 0;
        for (let a = 45; a < 405; a += 90) {
          const r = G.utils.rad(a);
          G.spawnEnemyBullet(b.x, b.y, Math.cos(r) * sp * 0.9, Math.sin(r) * sp * 0.9);
        }
        for (let i = 0; i < 12; i++) {
          const r = G.utils.rad(i * 30 + b.t * 60);
          G.spawnEnemyBullet(b.x, b.y, Math.cos(r) * sp * 1.05, Math.sin(r) * sp * 1.05);
        }
      }
    }
  }
}

/* =========================================================
 * Boss 原创形象绘制（三款全新设计，造型/机制互不雷同）
 * 0 陨星巢母：六边形巢母机体 + 环绕巢穴舱 + 晶簇棘刺
 * 1 星云幻影：飘带纱幔 + 独眼凝视 + 光触手
 * 2 泰坦星核：陀螺双环 + 四炮臂 + 日冕星核
 * ========================================================= */

/** 正六边形路径 */
function hexPath (ctx, r, rot) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = rot + i * Math.PI / 3;
    const px = Math.cos(a) * r, py = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

G.drawBoss = function (ctx) {
  const b = G.boss;
  if (!b) return;
  const w = b.w, t = b.t;
  const flash = b.flash > 0;
  const glow = b.phase === 2 ? '#ff5a3a' : (b.phase === 1 ? '#c86bff' : '#5fe3e8');
  const dim  = b.phase === 2 ? '#2a1430' : (b.phase === 1 ? '#141a38' : '#0e1c33');
  const edge = b.invuln > 0 ? G.COLORS.accent : glow;

  ctx.save();
  ctx.translate(b.x, b.y);

  /* ---- 实体层（不透明机体） ---- */
  if (b.typeIndex === 0) drawHiveMother(ctx, b, w, t, dim, edge, glow, flash);
  else if (b.typeIndex === 1) drawNebulaWraith(ctx, b, w, t, dim, edge, glow, flash);
  else if (b.typeIndex === 2) drawNovaTitan(ctx, b, w, t, dim, edge, glow, flash);
  else if (b.typeIndex === 3) drawLanternSprite(ctx, b, w, t, dim, edge, glow, flash);
  else if (b.typeIndex === 4) drawMushroomHut(ctx, b, w, t, dim, edge, glow, flash);
  else if (b.typeIndex === 5) drawDandelionMill(ctx, b, w, t, dim, edge, glow, flash);
  else if (b.typeIndex === 6) drawAbyssEye(ctx, b, w, t, dim, edge, glow, flash);
  else if (b.typeIndex === 7) drawRottenCore(ctx, b, w, t, dim, edge, glow, flash);
  else drawVoidWhale(ctx, b, w, t, dim, edge, glow, flash);

  /* ---- 辉光层（叠加发光） ---- */
  ctx.globalCompositeOperation = 'lighter';
  if (b.typeIndex === 0) hiveMotherGlow(ctx, b, w, t, glow);
  else if (b.typeIndex === 1) wraithGlow(ctx, b, w, t, glow);
  else if (b.typeIndex === 2) titanGlow(ctx, b, w, t, glow);
  else if (b.typeIndex === 3) lanternGlow(ctx, b, w, t, glow);
  else if (b.typeIndex === 4) hutGlow(ctx, b, w, t, glow);
  else if (b.typeIndex === 5) millGlow(ctx, b, w, t, glow);
  else if (b.typeIndex === 6) eyeGlow(ctx, b, w, t, glow);
  else if (b.typeIndex === 7) coreGlow(ctx, b, w, t, glow);
  else whaleGlow(ctx, b, w, t, glow);

  // 阶段能量溢散（P2/P3）
  if (b.phase >= 1) {
    const n = b.phase === 2 ? 6 : 3;
    for (let i = 0; i < n; i++) {
      const a = t * 1.5 + i * (Math.PI * 2 / n);
      G.drawGlow(ctx, Math.cos(a) * w * 0.36, Math.sin(a) * w * 0.2 + 5, glow, 4, 0.7);
    }
  }
  ctx.restore();
};

/** 0 陨星巢母：六边形巢母 + 环绕巢穴舱 + 晶簇棘刺 */
function drawHiveMother (ctx, b, w, t, dim, edge, glow, flash) {
  const R = w * 0.30;
  const rot = Math.sin(t * 0.4) * 0.06;   // 机体缓慢摇摆
  // 三只环绕巢穴舱的公转坐标
  const pods = [];
  for (let i = 0; i < 3; i++) {
    const a = t * 0.9 + i * (Math.PI * 2 / 3);
    pods.push({ x: Math.cos(a) * w * 0.44, y: Math.sin(a) * w * 0.20, a });
  }
  // 巢穴舱与主体的能量索
  ctx.strokeStyle = 'rgba(95,227,232,0.35)';
  ctx.lineWidth = 1.5;
  for (const p of pods) {
    ctx.beginPath(); ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(p.x * 0.5, p.y * 0.5 - 14, p.x, p.y);
    ctx.stroke();
  }
  // 晶簇棘刺（六边形顶点向外生长）
  for (let i = 0; i < 6; i++) {
    const a = rot + i * Math.PI / 3;
    ctx.save();
    ctx.translate(Math.cos(a) * R, Math.sin(a) * R);
    ctx.rotate(a);
    ctx.fillStyle = flash ? '#ffffff' : '#2c4a6e';
    const len = 18 + (i % 2 === 0 ? 9 : 0) + Math.sin(t * 3 + i) * 2;
    ctx.beginPath();
    ctx.moveTo(-5, -4); ctx.lineTo(len, 0); ctx.lineTo(-5, 4);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  // 主机体（六边形双层甲）
  ctx.fillStyle = flash ? '#ffffff' : dim;
  ctx.strokeStyle = edge; ctx.lineWidth = 3;
  hexPath(ctx, R, rot); ctx.fill(); ctx.stroke();
  ctx.fillStyle = flash ? '#ffffff' : '#1c3355';
  hexPath(ctx, R * 0.62, -rot * 1.5); ctx.fill();
  // 巢穴窗格（两排圆窗）
  ctx.fillStyle = 'rgba(127,232,192,0.9)';
  for (let row = 0; row < 2; row++) for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.arc(i * R * 0.28, (row - 0.5) * R * 0.34, 2.6, 0, Math.PI * 2);
    ctx.fill();
  }
  // 巢穴舱（小六边形 + 金色复眼）
  for (const p of pods) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.a + t);
    ctx.fillStyle = flash ? '#ffffff' : '#24405f';
    ctx.strokeStyle = edge; ctx.lineWidth = 2;
    hexPath(ctx, 13, 0); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,217,138,0.95)';
    ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  // 底部三引擎焰
  for (const sx of [-w * 0.16, 0, w * 0.16]) {
    const fl = 22 + Math.sin(t * 12 + sx) * 6;
    ctx.fillStyle = 'rgba(95,227,232,0.8)';
    ctx.beginPath();
    ctx.moveTo(sx - 7, R * 0.72); ctx.lineTo(sx + 7, R * 0.72); ctx.lineTo(sx, R * 0.72 + fl);
    ctx.closePath(); ctx.fill();
  }
}

function hiveMotherGlow (ctx, b, w, t, glow) {
  const pulse = 0.8 + Math.sin(t * 4) * 0.2;
  G.drawGlow(ctx, 0, 0, glow, 15 * pulse, 0.9);
  G.drawGlow(ctx, 0, 0, '#ffffff', 6 * pulse, 0.85);
  for (let i = 0; i < 3; i++) {
    const a = t * 0.9 + i * (Math.PI * 2 / 3);
    G.drawGlow(ctx, Math.cos(a) * w * 0.44, Math.sin(a) * w * 0.20, '#ffd98a', 6, 0.7);
  }
}

/** 1 星云幻影：飘带纱幔 + 独眼凝视 + 光触手 */
function drawNebulaWraith (ctx, b, w, t, dim, edge, glow, flash) {
  // 三条波动飘带（半透明纱幔）
  for (let k = 0; k < 3; k++) {
    const ph = t * (1.2 + k * 0.4) + k * 2;
    const hw = w * (0.42 - k * 0.07);
    ctx.fillStyle = flash ? 'rgba(255,255,255,0.9)'
      : `rgba(${90 + k * 30},${60 + k * 30},${160 + k * 20},0.5)`;
    ctx.beginPath();
    for (let i = 0; i <= 20; i++) {
      const px = -hw + (i / 20) * hw * 2;
      const py = Math.sin(ph + i * 0.55) * 6 + (k - 1) * 26;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    for (let i = 20; i >= 0; i--) {
      const px = -hw * 0.7 + (i / 20) * hw * 1.4;
      const py = Math.sin(ph + i * 0.55) * 6 + (k - 1) * 26 + 34 + Math.cos(ph * 1.3 + i * 0.4) * 8;
      ctx.lineTo(px, py);
    }
    ctx.closePath(); ctx.fill();
  }
  // 独眼（杏仁形，瞳孔微微偏向玩家）
  const ex = 0, ey = -6;
  const look = (G.player && !G.player.dead)
    ? Math.max(-1, Math.min(1, (G.player.x - b.x) / 160)) : 0;
  ctx.fillStyle = flash ? '#ffffff' : '#0a0a20';
  ctx.beginPath();
  ctx.moveTo(ex - 34, ey);
  ctx.quadraticCurveTo(ex, ey - 30, ex + 34, ey);
  ctx.quadraticCurveTo(ex, ey + 22, ex - 34, ey);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = edge; ctx.lineWidth = 2; ctx.stroke();
  // 虹膜 + 竖瞳
  const irisR = 11 + Math.sin(t * 3) * 1.5;
  const ix = ex + look * 6;
  const ig = ctx.createRadialGradient(ix, ey, 1, ix, ey, irisR);
  ig.addColorStop(0, '#ffffff'); ig.addColorStop(0.35, glow); ig.addColorStop(1, 'rgba(80,30,140,0.9)');
  ctx.fillStyle = ig;
  ctx.beginPath(); ctx.arc(ix, ey, irisR, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#05010f';
  ctx.beginPath(); ctx.ellipse(ix, ey, 3.4, 8 + Math.sin(t * 2) * 1.2, 0, 0, Math.PI * 2); ctx.fill();
  // 光触手（下方五条波动触须）
  ctx.strokeStyle = 'rgba(199,155,255,0.75)';
  ctx.lineWidth = 3;
  for (let i = 0; i < 5; i++) {
    const bx = (i - 2) * w * 0.13;
    ctx.beginPath();
    ctx.moveTo(bx, 26);
    const sway = Math.sin(t * 2.2 + i * 1.3) * 12;
    ctx.bezierCurveTo(bx + sway, 48, bx - sway, 66, bx + sway * 0.5, 84 + (i % 2) * 14);
    ctx.stroke();
  }
}

function wraithGlow (ctx, b, w, t, glow) {
  G.drawGlow(ctx, 0, -6, glow, 16 + Math.sin(t * 3) * 3, 0.85);
  for (let i = 0; i < 6; i++) {
    const a = t * 0.7 + i * 1.05;
    const rr = w * 0.4 + Math.sin(t * 1.4 + i) * 12;
    G.drawGlow(ctx, Math.cos(a) * rr, Math.sin(a) * rr * 0.5 - 10, '#e8d8ff', 2.5, 0.8);
  }
}

/** 2 泰坦星核：陀螺双环 + 四炮臂 + 日冕星核 */
function drawNovaTitan (ctx, b, w, t, dim, edge, glow, flash) {
  const R = w * 0.16;
  // 陀螺双环（交叉椭圆环，反向旋转）
  for (let k = 0; k < 2; k++) {
    ctx.save();
    ctx.rotate(t * (k === 0 ? 0.9 : -0.7));
    ctx.strokeStyle = k === 0 ? 'rgba(255,217,138,0.85)' : 'rgba(255,158,100,0.7)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.ellipse(0, 0, w * 0.40, w * 0.13, k === 0 ? 0.5 : -0.35, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  // 四炮臂（斜向伸出，末端炮口）
  for (let i = 0; i < 4; i++) {
    ctx.save();
    ctx.rotate(Math.PI / 4 + i * Math.PI / 2 + Math.sin(t * 0.6) * 0.05);
    ctx.fillStyle = flash ? '#ffffff' : '#3a2a18';
    ctx.strokeStyle = edge; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.rect(R + 4, -7, w * 0.30, 14);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = flash ? '#ffffff' : '#ff9e64';
    ctx.beginPath();
    ctx.rect(R + 4 + w * 0.30, -10, 10, 20);
    ctx.fill();
    ctx.restore();
  }
  // 日冕盘（扁椭圆光晕）
  ctx.fillStyle = 'rgba(255,140,60,0.16)';
  ctx.beginPath(); ctx.ellipse(0, 4, w * 0.42, w * 0.16, 0, 0, Math.PI * 2); ctx.fill();
  // 星核（ radial 渐变球体 + 脉动）
  const pulse = 1 + Math.sin(t * 5) * 0.05;
  const cg = ctx.createRadialGradient(0, 0, 2, 0, 0, R * pulse);
  cg.addColorStop(0, '#ffffff');
  cg.addColorStop(0.3, '#ffd24a');
  cg.addColorStop(0.7, '#ff7a3a');
  cg.addColorStop(1, 'rgba(120,30,10,0.95)');
  ctx.fillStyle = cg;
  ctx.beginPath(); ctx.arc(0, 0, R * pulse, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = edge; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(0, 0, R * pulse, 0, Math.PI * 2); ctx.stroke();
  // 星核赤道纹
  ctx.strokeStyle = 'rgba(255,240,200,0.5)';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.ellipse(0, 0, R * 0.9, R * 0.32, Math.sin(t) * 0.4, 0, Math.PI * 2); ctx.stroke();
}

function titanGlow (ctx, b, w, t, glow) {
  const pulse = 0.8 + Math.sin(t * 5) * 0.2;
  G.drawGlow(ctx, 0, 0, '#ffb03a', w * 0.16 * pulse, 0.9);
  G.drawGlow(ctx, 0, 0, '#ffffff', w * 0.07 * pulse, 0.9);
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + i * Math.PI / 2 + Math.sin(t * 0.6) * 0.05;
    G.drawGlow(ctx, Math.cos(a) * (w * 0.40 + 8), Math.sin(a) * (w * 0.40 + 8), '#ff8f5a', 7, 0.8);
  }
}

/* =========================================================
 * 新增 6 形态原创绘制（简单池田园童趣 / 困难池暗黑恐怖）
 * 3 花灯精灵：圆润绢灯 + 木骨架 + 流苏 + 精灵薄翼 + 环绕小灯
 * 4 菌伞小屋：菌盖小屋（拱门 + 圆窗 + 烟囱炊烟）+ 奶白菌柄 + 飘散孢子
 * 5 风车絮：絮绒风车（旋转四叶 + 种子绒球 + 茎叶 + 飘散小伞）
 * 6 深渊之眼：锯齿暗渊 + 血红竖瞳 + 眼睫毛 + 血泪
 * 7 腐化巢核：不规则腐体 + 病绿核心 + 腐孢气泡 + 毒刺
 * 8 虚空鲸：俯冲巨鲸 + 荧光星座斑 + 巨口利齿
 * ========================================================= */

/** 四角星闪光（萌系装饰通用） */
function drawSparkle (ctx, x, y, r, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, -r); ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.quadraticCurveTo(0, 0, 0, r);
  ctx.quadraticCurveTo(0, 0, -r, 0);
  ctx.quadraticCurveTo(0, 0, 0, -r);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

/** 3 花灯精灵：圆润绢灯 + 木骨架 + 流苏 + 精灵薄翼 + 环绕小灯 */
function drawLanternSprite (ctx, b, w, t, dim, edge, glow, flash) {
  const R = w * 0.21;
  const sway = Math.sin(t * 1.6) * 0.06;         // 整灯轻摆
  const breath = 1 + Math.sin(t * 2.0) * 0.04;   // 灯火呼吸
  // 三只环绕小灯的公转坐标
  const pods = [];
  for (let i = 0; i < 3; i++) {
    const a = t * 0.7 + i * (Math.PI * 2 / 3);
    pods.push({ x: Math.cos(a) * w * 0.40, y: Math.sin(a) * w * 0.16 });
  }
  // 主机到小灯的提索
  ctx.strokeStyle = 'rgba(255,214,150,0.4)';
  ctx.lineWidth = 1.5;
  for (const p of pods) {
    ctx.beginPath(); ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(p.x * 0.5, p.y * 0.5 - 10, p.x, p.y);
    ctx.stroke();
  }
  // 精灵薄翼（半透明蝶翅，轻拍）
  ctx.save();
  ctx.translate(0, -R * 0.1);
  for (const sx of [-1, 1]) {
    ctx.save();
    ctx.scale(sx, 1);
    ctx.rotate(Math.sin(t * 6 + (sx > 0 ? 0.5 : 0)) * 0.22);
    const wg = ctx.createLinearGradient(0, 0, R * 1.3, -R * 0.5);
    wg.addColorStop(0, 'rgba(255,230,180,0.5)');
    wg.addColorStop(1, 'rgba(255,190,120,0.05)');
    ctx.fillStyle = wg;
    ctx.beginPath();
    ctx.moveTo(R * 0.3, 0);
    ctx.quadraticCurveTo(R * 1.4, -R * 0.7, R * 1.15, R * 0.35);
    ctx.quadraticCurveTo(R * 0.8, R * 0.2, R * 0.3, 0);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  ctx.restore();
  // 灯体
  ctx.save();
  ctx.rotate(sway);
  // 顶部木盖
  ctx.fillStyle = '#7a5236';
  ctx.strokeStyle = edge; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(0, -R * 1.04, R * 0.5, R * 0.16, 0, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();
  // 灯身（暖光绢面）
  const bg = ctx.createRadialGradient(-R * 0.2, -R * 0.25, R * 0.15, 0, 0, R * 1.05);
  bg.addColorStop(0, flash ? '#ffffff' : '#fff3d0');
  bg.addColorStop(0.55, flash ? '#ffffff' : '#ffd98a');
  bg.addColorStop(1, flash ? '#ffffff' : '#e8863c');
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.ellipse(0, 0, R * 0.92, R * breath, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = edge; ctx.lineWidth = 3;
  ctx.stroke();
  // 木骨架竖棱 + 腰箍
  ctx.strokeStyle = 'rgba(122,82,54,0.55)';
  ctx.lineWidth = 2;
  for (const kx of [-0.55, 0, 0.55]) {
    ctx.beginPath();
    ctx.ellipse(kx * R * 0.9, 0, R * 0.26, R * breath * 0.98, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.ellipse(0, 0, R * 0.92, R * breath * 0.34, 0, 0, Math.PI * 2);
  ctx.stroke();
  // 灯芯火焰（跳动）
  const fl = R * (0.34 + Math.sin(t * 9) * 0.05);
  const fg = ctx.createRadialGradient(0, 0, 1, 0, 0, fl);
  fg.addColorStop(0, '#fffbe8');
  fg.addColorStop(0.5, '#ffd75e');
  fg.addColorStop(1, 'rgba(255,150,60,0)');
  ctx.fillStyle = fg;
  ctx.beginPath(); ctx.ellipse(0, 0, fl * 0.62, fl, 0, 0, Math.PI * 2); ctx.fill();
  // 精灵小脸（点眼 + 浅笑）
  ctx.fillStyle = '#6a4a2a';
  for (const sx of [-1, 1]) {
    ctx.beginPath(); ctx.arc(sx * R * 0.26, -R * 0.05, R * 0.05, 0, Math.PI * 2); ctx.fill();
  }
  ctx.strokeStyle = '#6a4a2a'; ctx.lineWidth = 1.8;
  ctx.beginPath(); ctx.arc(0, R * 0.1, R * 0.16, 0.3, Math.PI - 0.3); ctx.stroke();
  // 底部木盖 + 流苏
  ctx.fillStyle = '#7a5236';
  ctx.strokeStyle = edge; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(0, R * 1.04, R * 0.5, R * 0.16, 0, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();
  const tsw = Math.sin(t * 2.4) * 4;
  ctx.strokeStyle = '#d8453c'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(0, R * 1.18);
  ctx.quadraticCurveTo(tsw * 0.5, R * 1.45, tsw, R * 1.72);
  ctx.stroke();
  ctx.fillStyle = '#d8453c';
  ctx.beginPath(); ctx.arc(tsw, R * 1.76, 4, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  // 环绕小灯
  for (const p of pods) {
    ctx.save();
    ctx.translate(p.x, p.y);
    const lg = ctx.createRadialGradient(0, 0, 1, 0, 0, R * 0.22);
    lg.addColorStop(0, flash ? '#ffffff' : '#fff3d0');
    lg.addColorStop(1, flash ? '#ffffff' : '#ffb35e');
    ctx.fillStyle = lg;
    ctx.strokeStyle = edge; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(0, 0, R * 0.2, R * 0.24, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#7a5236';
    ctx.fillRect(-R * 0.09, -R * 0.3, R * 0.18, R * 0.07);
    ctx.fillRect(-R * 0.09, R * 0.23, R * 0.18, R * 0.07);
    ctx.restore();
  }
}

function lanternGlow (ctx, b, w, t, glow) {
  const R = w * 0.21;
  const breath = 1 + Math.sin(t * 2.0) * 0.04;
  G.drawGlow(ctx, 0, 0, '#ffd98a', R * 1.0 * breath, 0.6);
  G.drawGlow(ctx, 0, 0, '#fff3d0', R * 0.45, 0.5);
  for (let i = 0; i < 3; i++) {
    const a = t * 0.7 + i * (Math.PI * 2 / 3);
    G.drawGlow(ctx, Math.cos(a) * w * 0.40, Math.sin(a) * w * 0.16, '#ffe8b0', R * 0.22, 0.7);
  }
  G.drawGlow(ctx, 0, -R * 1.04, '#ffca7a', 6, 0.5);
}

/** 4 菌伞小屋：菌盖小屋（拱门 + 圆窗 + 烟囱炊烟）+ 奶白菌柄 + 飘散孢子 */
function drawMushroomHut (ctx, b, w, t, dim, edge, glow, flash) {
  const R = w * 0.23;
  const bob = Math.sin(t * 1.5) * 4;             // 整栋轻微浮动
  // 飘散孢子（后方光点）
  for (let i = 0; i < 8; i++) {
    const a = t * 0.9 + i * 0.8;
    const rr = R * 1.6 + Math.sin(t * 1.6 + i) * 8;
    ctx.fillStyle = 'rgba(255,245,210,' + (0.35 + 0.3 * Math.sin(t * 2 + i)) + ')';
    ctx.beginPath(); ctx.arc(Math.cos(a) * rr, Math.sin(a) * rr * 0.55 + bob, 2.2, 0, Math.PI * 2); ctx.fill();
  }
  ctx.save();
  ctx.translate(0, bob);
  // 菌柄（奶白色柱体）
  const sg = ctx.createLinearGradient(-R * 0.4, 0, R * 0.4, 0);
  sg.addColorStop(0, flash ? '#ffffff' : '#e8dcc8');
  sg.addColorStop(0.5, flash ? '#ffffff' : '#f6ecd9');
  sg.addColorStop(1, flash ? '#ffffff' : '#d8c8b0');
  ctx.fillStyle = sg;
  ctx.strokeStyle = edge; ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(-R * 0.42, R * 0.2);
  ctx.quadraticCurveTo(-R * 0.5, R * 0.9, -R * 0.34, R * 1.15);
  ctx.lineTo(R * 0.34, R * 1.15);
  ctx.quadraticCurveTo(R * 0.5, R * 0.9, R * 0.42, R * 0.2);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  // 菌盖（圆顶 + 白斑）
  const cg = ctx.createRadialGradient(-R * 0.25, -R * 0.4, R * 0.1, 0, 0, R * 1.25);
  cg.addColorStop(0, flash ? '#ffffff' : '#ff9a7a');
  cg.addColorStop(0.6, flash ? '#ffffff' : '#e85a4a');
  cg.addColorStop(1, flash ? '#ffffff' : '#b03a30');
  ctx.fillStyle = cg;
  ctx.strokeStyle = edge; ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(0, R * 0.15, R * 1.15, R * 0.95, 0, Math.PI, Math.PI * 2);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  // 盖顶白斑点
  ctx.fillStyle = 'rgba(255,248,235,0.92)';
  const spots = [[-0.55, -0.35, 0.16], [0.1, -0.55, 0.2], [0.6, -0.2, 0.13], [-0.15, -0.12, 0.1], [0.35, 0.02, 0.09]];
  for (const s of spots) {
    ctx.beginPath();
    ctx.ellipse(s[0] * R, R * 0.15 + s[1] * R, s[2] * R, s[2] * R * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // 烟囱 + 炊烟
  ctx.fillStyle = '#a87a56';
  ctx.strokeStyle = edge; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.rect(R * 0.42, -R * 0.72, R * 0.18, R * 0.42); ctx.fill(); ctx.stroke();
  for (let i = 0; i < 3; i++) {
    const ph = (t * 0.5 + i / 3) % 1;
    ctx.fillStyle = 'rgba(240,240,235,' + (0.4 * (1 - ph)) + ')';
    ctx.beginPath(); ctx.arc(R * 0.51 + Math.sin(t * 2 + i) * 4, -R * 0.78 - ph * R * 0.9, 3 + ph * 5, 0, Math.PI * 2); ctx.fill();
  }
  // 圆窗（暖光闪烁 + 十字窗棂）
  for (const sx of [-0.26, 0.26]) {
    const flick = 0.75 + 0.25 * Math.sin(t * 3 + sx * 10);
    ctx.fillStyle = 'rgba(255,220,140,' + flick + ')';
    ctx.strokeStyle = edge; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(sx * R, R * 0.62, R * 0.1, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = 'rgba(122,82,54,0.7)'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(sx * R - R * 0.1, R * 0.62); ctx.lineTo(sx * R + R * 0.1, R * 0.62);
    ctx.moveTo(sx * R, R * 0.62 - R * 0.1); ctx.lineTo(sx * R, R * 0.62 + R * 0.1);
    ctx.stroke();
  }
  // 拱形小门 + 门把
  ctx.fillStyle = '#8a5a3a';
  ctx.strokeStyle = edge; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-R * 0.16, R * 1.12);
  ctx.lineTo(-R * 0.16, R * 0.72);
  ctx.quadraticCurveTo(0, R * 0.5, R * 0.16, R * 0.72);
  ctx.lineTo(R * 0.16, R * 1.12);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#ffd98a';
  ctx.beginPath(); ctx.arc(R * 0.08, R * 0.92, 2.4, 0, Math.PI * 2); ctx.fill();
  // 基座草丛
  ctx.strokeStyle = 'rgba(127,232,192,0.8)'; ctx.lineWidth = 2;
  for (const gx of [-R * 0.55, R * 0.55]) {
    ctx.beginPath();
    ctx.moveTo(gx, R * 1.15);
    ctx.quadraticCurveTo(gx + 4, R * 1.05, gx + 7, R * 0.98);
    ctx.moveTo(gx, R * 1.15);
    ctx.quadraticCurveTo(gx - 3, R * 1.02, gx - 8, R * 0.95);
    ctx.stroke();
  }
  ctx.restore();
}

function hutGlow (ctx, b, w, t, glow) {
  const R = w * 0.23;
  const bob = Math.sin(t * 1.5) * 4;
  G.drawGlow(ctx, 0, bob + R * 0.1, '#ff8a6a', R * 1.1, 0.5);
  for (const sx of [-0.26, 0.26]) G.drawGlow(ctx, sx * R, bob + R * 0.62, '#ffe8a8', R * 0.14, 0.8);
  G.drawGlow(ctx, 0, bob + R * 0.62, '#ffd98a', R * 0.3, 0.6);
  for (let i = 0; i < 8; i++) {
    const a = t * 0.9 + i * 0.8;
    const rr = R * 1.6 + Math.sin(t * 1.6 + i) * 8;
    G.drawGlow(ctx, Math.cos(a) * rr, Math.sin(a) * rr * 0.55 + bob, '#fff5d2', 2.5, 0.6);
  }
}

/** 5 风车絮：絮绒风车（旋转四叶 + 种子绒球 + 茎叶 + 飘散小伞） */
function drawDandelionMill (ctx, b, w, t, dim, edge, glow, flash) {
  const R = w * 0.19;
  const bob = Math.sin(t * 1.4) * 5;
  // 飘散小伞（后方）
  for (let i = 0; i < 6; i++) {
    const a = t * 0.6 + i * 1.05;
    const rr = R * 2.2 + Math.sin(t * 1.3 + i) * 10;
    const px = Math.cos(a) * rr;
    const py = Math.sin(a) * rr * 0.5 + bob;
    ctx.strokeStyle = 'rgba(220,230,220,0.35)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, py + 7); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,250,0.85)';
    ctx.beginPath(); ctx.arc(px, py, 3.2, 0, Math.PI * 2); ctx.fill();
  }
  ctx.save();
  ctx.translate(0, bob);
  // 中央种子绒球（絮点环）
  ctx.fillStyle = flash ? '#ffffff' : 'rgba(250,250,244,0.95)';
  for (let i = 0; i < 14; i++) {
    const a = i * (Math.PI * 2 / 14) + Math.sin(t + i) * 0.1;
    const rr = R * 0.55 + (i % 3) * 3;
    ctx.beginPath(); ctx.arc(Math.cos(a) * rr, Math.sin(a) * rr, 3.4, 0, Math.PI * 2); ctx.fill();
  }
  // 风车桨叶（四叶缓慢旋转）
  ctx.save();
  ctx.rotate(t * 1.1);
  for (let i = 0; i < 4; i++) {
    ctx.save();
    ctx.rotate(i * Math.PI / 2);
    const blade = ctx.createLinearGradient(0, 0, 0, -R * 1.25);
    blade.addColorStop(0, flash ? '#ffffff' : '#f2ecd8');
    blade.addColorStop(1, flash ? '#ffffff' : '#cfe8c0');
    ctx.fillStyle = blade;
    ctx.strokeStyle = edge; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(R * 0.42, -R * 0.55, R * 0.12, -R * 1.25);
    ctx.quadraticCurveTo(-R * 0.18, -R * 0.7, 0, 0);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  // 中心毂
  ctx.fillStyle = '#ffd98a';
  ctx.strokeStyle = edge; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(0, 0, R * 0.26, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#8a6a3a';
  ctx.beginPath(); ctx.arc(0, 0, R * 0.09, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  // 茎秆（浅绿渐隐）
  const stem = ctx.createLinearGradient(0, 0, 0, R * 1.4);
  stem.addColorStop(0, '#9adb9a');
  stem.addColorStop(1, 'rgba(127,232,192,0.15)');
  ctx.strokeStyle = stem; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(0, R * 0.2);
  ctx.quadraticCurveTo(Math.sin(t * 1.2) * 6, R * 0.8, Math.sin(t * 1.2) * 10, R * 1.35);
  ctx.stroke();
  // 两片小叶
  ctx.fillStyle = 'rgba(127,232,192,0.85)';
  for (const sx of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(sx * R * 0.32, R * 0.85, R * 0.2, R * 0.08, sx * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function millGlow (ctx, b, w, t, glow) {
  const R = w * 0.19;
  const bob = Math.sin(t * 1.4) * 5;
  G.drawGlow(ctx, 0, bob, '#fff8e0', R * 0.8, 0.55);
  G.drawGlow(ctx, 0, bob, '#ffd98a', R * 0.3, 0.6);
  for (let i = 0; i < 6; i++) {
    const a = t * 0.6 + i * 1.05;
    const rr = R * 2.2 + Math.sin(t * 1.3 + i) * 10;
    G.drawGlow(ctx, Math.cos(a) * rr, Math.sin(a) * rr * 0.5 + bob, '#ffffff', 3, 0.6);
  }
}

/** 6 深渊之眼：锯齿暗渊 + 血红竖瞳 + 眼睫毛 + 血泪 */
function drawAbyssEye (ctx, b, w, t, dim, edge, glow, flash) {
  const R = w * 0.30;
  const pulse = 1 + Math.sin(t * 2.2) * 0.03;
  ctx.save();
  ctx.rotate(Math.sin(t * 0.5) * 0.04);
  // 黑暗本体（锯齿深渊轮廓）
  ctx.fillStyle = flash ? '#ffffff' : '#160a26';
  ctx.strokeStyle = edge; ctx.lineWidth = 2.5;
  ctx.beginPath();
  const n = 16;
  for (let i = 0; i < n; i++) {
    const a = i * Math.PI * 2 / n;
    const rr = R * (i % 2 === 0 ? 1.0 : 0.82) * pulse;
    const px = Math.cos(a) * rr, py = Math.sin(a) * rr * 0.9;
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  }
  ctx.closePath(); ctx.fill(); ctx.stroke();
  // 内部暗红深渊渐变
  const ig = ctx.createRadialGradient(0, 0, R * 0.2, 0, 0, R);
  ig.addColorStop(0, 'rgba(120,20,50,0.55)');
  ig.addColorStop(1, 'rgba(20,5,30,0)');
  ctx.fillStyle = ig;
  ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill();
  // 怒张血管（向外脉动曲线）
  ctx.strokeStyle = 'rgba(180,40,80,0.5)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4 + Math.sin(t * 0.8 + i) * 0.06;
    const len = R * (0.95 + 0.12 * Math.sin(t * 3 + i * 1.3));
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * R * 0.3, Math.sin(a) * R * 0.27);
    ctx.quadraticCurveTo(Math.cos(a + 0.2) * len * 0.7, Math.sin(a + 0.2) * len * 0.63,
      Math.cos(a) * len, Math.sin(a) * len * 0.9);
    ctx.stroke();
  }
  // 巨眼（眨眼：偶尔快速合拢）
  const blink = (Math.sin(t * 0.9) > 0.93) ? 0.15 : 1;
  const er = R * 0.52;
  ctx.save();
  ctx.scale(1, blink);
  ctx.fillStyle = flash ? '#ffffff' : '#1c0a18';
  ctx.beginPath(); ctx.ellipse(0, 1, er * 1.25, er, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = edge; ctx.lineWidth = 2; ctx.stroke();
  // 虹膜（血红放射纹，瞳孔微微偏向玩家）
  const look = (G.player && !G.player.dead)
    ? Math.max(-1, Math.min(1, (G.player.x - b.x) / 170)) : 0;
  const ix = look * er * 0.3, iy = 1;
  const ir = er * 0.62;
  const iris = ctx.createRadialGradient(ix, iy, 1, ix, iy, ir);
  iris.addColorStop(0, '#ffb0a0'); iris.addColorStop(0.4, '#ff2a3a'); iris.addColorStop(1, '#7a0a1a');
  ctx.fillStyle = iris;
  ctx.beginPath(); ctx.arc(ix, iy, ir, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(120,0,20,0.8)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 10; i++) {
    const a = i * Math.PI / 5 + t * 0.2;
    ctx.beginPath();
    ctx.moveTo(ix + Math.cos(a) * ir * 0.3, iy + Math.sin(a) * ir * 0.3);
    ctx.lineTo(ix + Math.cos(a) * ir * 0.95, iy + Math.sin(a) * ir * 0.95);
    ctx.stroke();
  }
  // 竖瞳 + 高光
  ctx.fillStyle = '#0a0004';
  ctx.beginPath(); ctx.ellipse(ix, iy, ir * 0.16, ir * 0.62, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath(); ctx.arc(ix - ir * 0.3, iy - ir * 0.35, ir * 0.1, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  // 眼睫毛（外圈尖刺）
  ctx.fillStyle = flash ? '#ffffff' : '#2a0a3a';
  ctx.strokeStyle = edge; ctx.lineWidth = 1.5;
  for (let i = 0; i < 12; i++) {
    const a = i * Math.PI / 6 + t * 0.15;
    ctx.save();
    ctx.translate(Math.cos(a) * R * 0.92, Math.sin(a) * R * 0.84);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(-4, -5); ctx.lineTo(14 + (i % 3) * 4, 0); ctx.lineTo(-4, 5);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  // 血泪（眼下两滴，时续时断）
  for (const sx of [-1, 1]) {
    const drip = (Math.sin(t * 1.4 + sx) + 1) / 2;
    ctx.fillStyle = 'rgba(200,30,60,' + (0.35 + drip * 0.45) + ')';
    ctx.beginPath();
    ctx.ellipse(sx * R * 0.34, R * 0.55 + drip * R * 0.3, 3, 5 + drip * 4, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function eyeGlow (ctx, b, w, t, glow) {
  const R = w * 0.30;
  const er = R * 0.52, ir = er * 0.62;
  const pulse = 0.75 + Math.sin(t * 2.2) * 0.25;
  G.drawGlow(ctx, 0, 1, '#ff2a3a', er * 0.85 * pulse, 0.8);
  G.drawGlow(ctx, 0, 1, '#ff8a7a', ir * 0.55, 0.7);
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    G.drawGlow(ctx, Math.cos(a) * R * 0.95, Math.sin(a) * R * 0.86, '#c02050', 2.5, 0.5);
  }
  for (const sx of [-1, 1]) {
    G.drawGlow(ctx, sx * R * 0.34, R * 0.75, '#c02050', 3.5, 0.5);
  }
}

/** 7 腐化巢核：不规则腐体 + 病绿核心 + 腐孢气泡 + 毒刺 */
function drawRottenCore (ctx, b, w, t, dim, edge, glow, flash) {
  const R = w * 0.30;
  const pulse = 1 + Math.sin(t * 2.6) * 0.06;
  ctx.save();
  ctx.rotate(Math.sin(t * 0.6) * 0.05);
  // 腐化主体（不规则多边形，固定顶点扰动 + 呼吸）
  const n = 12;
  const jitter = [1, 0.86, 0.94, 0.8, 1.02, 0.88, 0.96, 0.82, 1.0, 0.9, 0.98, 0.84];
  ctx.fillStyle = flash ? '#ffffff' : '#241a33';
  ctx.strokeStyle = edge; ctx.lineWidth = 2.5;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = i * Math.PI * 2 / n;
    const rr = R * jitter[i] * pulse * (1 + Math.sin(t * 3 + i * 1.4) * 0.03);
    const px = Math.cos(a) * rr, py = Math.sin(a) * rr;
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  }
  ctx.closePath(); ctx.fill(); ctx.stroke();
  // 内部腐败渐变
  const ig = ctx.createRadialGradient(0, 0, R * 0.15, 0, 0, R);
  ig.addColorStop(0, 'rgba(90,160,60,0.4)');
  ig.addColorStop(0.6, 'rgba(50,80,50,0.18)');
  ig.addColorStop(1, 'rgba(20,30,20,0)');
  ctx.fillStyle = ig;
  ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill();
  // 内部腐管脉络
  ctx.strokeStyle = 'rgba(20,40,25,0.7)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3 + t * 0.25;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(Math.cos(a + 0.5) * R * 0.5, Math.sin(a + 0.5) * R * 0.5,
      Math.cos(a) * R * 0.85, Math.sin(a) * R * 0.85);
    ctx.stroke();
  }
  // 腐坏核心（病态绿光，不规则脉动）
  const cr = R * 0.34 * (1 + Math.sin(t * 5) * 0.08);
  const cg = ctx.createRadialGradient(0, 0, 1, 0, 0, cr);
  cg.addColorStop(0, '#e8ffb0');
  cg.addColorStop(0.35, '#8fe03a');
  cg.addColorStop(0.75, '#3a7a20');
  cg.addColorStop(1, 'rgba(20,50,10,0.9)');
  ctx.fillStyle = cg;
  ctx.beginPath(); ctx.arc(0, 0, cr, 0, Math.PI * 2); ctx.fill();
  // 核心裂痕
  ctx.strokeStyle = 'rgba(10,30,5,0.8)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 3; i++) {
    const a = i * 2.1 + t * 0.4;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * cr * 0.2, Math.sin(a) * cr * 0.2);
    ctx.lineTo(Math.cos(a + 0.4) * cr * 0.9, Math.sin(a + 0.4) * cr * 0.9);
    ctx.stroke();
  }
  // 周身腐孢气泡（循环上浮）
  for (let i = 0; i < 5; i++) {
    const ph = (t * 0.5 + i * 0.2) % 1;
    const bx = Math.sin(i * 2.4 + t) * R * 0.7;
    const by = R * 0.6 - ph * R * 1.5;
    const br = 3 + ph * 5;
    ctx.fillStyle = 'rgba(140,220,90,' + (0.5 * (1 - ph)) + ')';
    ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(200,255,160,' + (0.6 * (1 - ph)) + ')';
    ctx.lineWidth = 1; ctx.stroke();
  }
  // 周身毒刺
  ctx.fillStyle = flash ? '#ffffff' : '#1a2e18';
  ctx.strokeStyle = edge; ctx.lineWidth = 1.5;
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4 + 0.4;
    const rr = R * jitter[(i * 3) % n] * pulse;
    ctx.save();
    ctx.translate(Math.cos(a) * rr, Math.sin(a) * rr);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(-4, -4); ctx.lineTo(13 + (i % 2) * 5, 0); ctx.lineTo(-4, 4);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  // 底部黏滴
  for (let i = 0; i < 2; i++) {
    const ph = (t * 0.4 + i * 0.5) % 1;
    const dx = (i === 0 ? -1 : 1) * R * 0.3;
    const dy = R * 0.8 + ph * R * 0.5;
    ctx.fillStyle = 'rgba(120,180,70,' + (0.55 * (1 - ph)) + ')';
    ctx.beginPath(); ctx.ellipse(dx, dy, 3, 6 + ph * 5, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function coreGlow (ctx, b, w, t, glow) {
  const R = w * 0.30;
  const cr = R * 0.34;
  G.drawGlow(ctx, 0, 0, '#8fe03a', cr * (1.2 + Math.sin(t * 5) * 0.15), 0.85);
  G.drawGlow(ctx, 0, 0, '#e8ffb0', cr * 0.5, 0.8);
  for (let i = 0; i < 5; i++) {
    const ph = (t * 0.5 + i * 0.2) % 1;
    const bx = Math.sin(i * 2.4 + t) * R * 0.7;
    const by = R * 0.6 - ph * R * 1.5;
    G.drawGlow(ctx, bx, by, '#9ae05a', 3 + ph * 3, 0.4 * (1 - ph));
  }
}

/** 8 虚空鲸：俯冲巨兽（尾鳍在上、巨口在下、荧光星座斑） */
function drawVoidWhale (ctx, b, w, t, dim, edge, glow, flash) {
  const rx = w * 0.34, ry = w * 0.20;
  const bob = Math.sin(t * 1.1) * 0.05;
  // 尾鳍（上部大分叉）
  ctx.save();
  ctx.translate(0, -ry * 0.9);
  ctx.rotate(bob);
  ctx.fillStyle = flash ? '#ffffff' : '#0d1230';
  ctx.strokeStyle = edge; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 10);
  ctx.quadraticCurveTo(-rx * 0.7, -6, -rx * 0.85, -ry * 0.55);
  ctx.quadraticCurveTo(-rx * 0.3, -ry * 0.28, 0, -ry * 0.34);
  ctx.quadraticCurveTo(rx * 0.3, -ry * 0.28, rx * 0.85, -ry * 0.55);
  ctx.quadraticCurveTo(rx * 0.7, -6, 0, 10);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
  // 机身（暗蓝黑扁椭圆）
  ctx.save();
  ctx.rotate(bob);
  const bg = ctx.createLinearGradient(0, -ry, 0, ry);
  bg.addColorStop(0, '#141a3a');
  bg.addColorStop(0.6, '#0a0e26');
  bg.addColorStop(1, '#050818');
  ctx.fillStyle = flash ? '#ffffff' : bg;
  ctx.strokeStyle = edge; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  // 腹部受光面
  ctx.fillStyle = 'rgba(40,60,120,0.35)';
  ctx.beginPath(); ctx.ellipse(0, ry * 0.28, rx * 0.86, ry * 0.5, 0, 0, Math.PI); ctx.fill();
  // 生物荧光星点（背部星座图案，呼吸闪烁）
  const spots = [[-0.5, -0.3], [-0.2, -0.5], [0.15, -0.35], [0.45, -0.15], [-0.62, 0.1], [0.62, 0.15], [-0.3, 0.3], [0.3, 0.42], [0, -0.1]];
  ctx.fillStyle = 'rgba(95,227,232,0.9)';
  for (let i = 0; i < spots.length; i++) {
    ctx.globalAlpha = 0.55 + 0.45 * Math.sin(t * 2.4 + i * 1.7);
    ctx.beginPath(); ctx.arc(spots[i][0] * rx, spots[i][1] * ry, 2.2, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
  // 胸鳍（两侧摆动）
  for (const sx of [-1, 1]) {
    ctx.save();
    ctx.translate(sx * rx * 0.55, ry * 0.1);
    ctx.rotate(sx * (0.7 + Math.sin(t * 1.6) * 0.12));
    ctx.fillStyle = flash ? '#ffffff' : '#0d1230';
    ctx.strokeStyle = edge; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(sx * rx * 0.4, ry * 0.3, sx * rx * 0.15, ry * 0.75);
    ctx.quadraticCurveTo(0, ry * 0.4, -sx * 6, 4);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  // 巨口（下颌弧线 + 利齿）
  const my = ry * 0.82;
  ctx.strokeStyle = flash ? '#ffffff' : '#ff5a6a';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-rx * 0.42, my - 6);
  ctx.quadraticCurveTo(0, my + 16, rx * 0.42, my - 6);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,240,230,0.9)';
  for (let i = -3; i <= 3; i++) {
    const px = i * rx * 0.13;
    const py = my + 2 + Math.cos(i * 0.9) * 3;
    ctx.beginPath();
    ctx.moveTo(px - 4, py - 4); ctx.lineTo(px + 4, py - 4); ctx.lineTo(px, py + 5);
    ctx.closePath(); ctx.fill();
  }
  // 双眼（头部两侧荧光小眼）
  for (const sx of [-1, 1]) {
    ctx.fillStyle = flash ? '#ffffff' : '#5fe3e8';
    ctx.beginPath(); ctx.arc(sx * rx * 0.30, ry * 0.28, 3.4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(sx * rx * 0.30 - 1, ry * 0.28 - 1, 1.2, 0, Math.PI * 2); ctx.fill();
  }
}

function whaleGlow (ctx, b, w, t, glow) {
  const rx = w * 0.34, ry = w * 0.20;
  const spots = [[-0.5, -0.3], [-0.2, -0.5], [0.15, -0.35], [0.45, -0.15], [-0.62, 0.1], [0.62, 0.15], [-0.3, 0.3], [0.3, 0.42], [0, -0.1]];
  for (let i = 0; i < spots.length; i++) {
    const tw = 0.4 + 0.4 * Math.sin(t * 2.4 + i * 1.7);
    G.drawGlow(ctx, spots[i][0] * rx, spots[i][1] * ry, '#5fe3e8', 4 + tw * 2, 0.35 + tw * 0.3);
  }
  G.drawGlow(ctx, -rx * 0.30, ry * 0.28, '#5fe3e8', 6, 0.8);
  G.drawGlow(ctx, rx * 0.30, ry * 0.28, '#5fe3e8', 6, 0.8);
  G.drawGlow(ctx, 0, ry * 0.9, '#ff5a6a', 10 + Math.sin(t * 3) * 3, 0.6);
}