/* =========================================================
 * waves.js —— 12 种编队模板 + 波次生成器 + 难度公式
 * ========================================================= */
window.G = window.G || {};

G.wave = 0;
G.level = 1;
G.difficultyMode = 'normal';
G.waveTimer = 0;
G.waveClearTimer = 0;
G.pendingSpawns = [];
G.waveTotal = 0;        // 当前波次敌机总数（进度条用）
G.bossWarning = { active: false, t: 0, typeIndex: 0 };
G.lastPicks = [];

/** 当前关卡配置（Boss 循环） */
G.levelDef = function () { return G.LEVELS[(G.level - 1) % G.LEVELS.length]; };

/** 综合难度系数（难度选项 × 关卡轮次 × 波次，逐级爬升；每 3 关一轮，设上限防爆） */
G.difficulty = function () {
  const mode = G.DIFFICULTIES[G.difficultyMode] || G.DIFFICULTIES.normal;
  const round = Math.floor((G.level - 1) / 3);
  return mode.hpMul * Math.min(1 + round * 0.30 + (G.wave - 1) * 0.05, 8);
};

/** 敌方弹幕速度/频率系数（同样按轮次爬升，封顶保证可躲避） */
G.fireDifficulty = function () {
  const mode = G.DIFFICULTIES[G.difficultyMode] || G.DIFFICULTIES.normal;
  const round = Math.floor((G.level - 1) / 3);
  return mode.fireMul * Math.min(1 + round * 0.10, 2.4);
};

/** 12 种编队模板（builder 返回 [{delay,type,x,y}]） */
G.FORMATIONS = [
  { name: '单列侦察', weight: 1.0, minWave: 1, build: () => {
    const a = []; for (let i = 0; i < 5; i++) a.push({ delay: i * 0.4, type: 'scout', x: G.W / 2, y: -40 - i * 60 });
    return a; } },
  { name: 'V字侦察', weight: 1.0, minWave: 1, build: () => {
    const a = []; for (let i = 0; i < 5; i++) { const off = Math.abs(i - 2); a.push({ delay: i * 0.35, type: 'scout', x: G.W / 2 + (i - 2) * 50, y: -40 - off * 60 }); }
    return a; } },
  { name: '双列侦察', weight: 0.9, minWave: 2, build: () => {
    const a = []; for (let c = 0; c < 2; c++) for (let i = 0; i < 4; i++) a.push({ delay: c * 0.5 + i * 0.4, type: 'scout', x: 90 + c * 300, y: -40 - i * 55 });
    return a; } },
  { name: '侧翼战斗机', weight: 1.0, minWave: 3, build: () => {
    return [ { delay: 0.2, type: 'fighter', x: -30, y: 80 }, { delay: 0.8, type: 'fighter', x: G.W + 30, y: 160 } ]; } },
  { name: 'V字战机编队', weight: 1.1, minWave: 4, build: () => {
    const a = []; for (let i = 0; i < 4; i++) a.push({ delay: i * 0.5, type: 'fighter', x: (i % 2 ? G.W + 30 : -30), y: 60 + i * 50 });
    return a; } },
  { name: '重装甲阵', weight: 0.9, minWave: 5, build: () => {
    const a = [{ delay: 0.2, type: 'tank', x: G.W * 0.35, y: -60 }, { delay: 1.0, type: 'tank', x: G.W * 0.65, y: -60 }];
    return a; } },
  { name: '浮游炮台', weight: 0.8, minWave: 6, build: () => {
    return [ { delay: 0.5, type: 'turret', x: G.W * 0.3, y: -40 }, { delay: 1.5, type: 'turret', x: G.W * 0.7, y: -40 } ]; } },
  { name: '自爆突袭', weight: 0.8, minWave: 4, build: () => {
    const a = []; for (let i = 0; i < 4; i++) a.push({ delay: i * 0.3, type: 'kamikaze', x: G.utils.rand(60, G.W - 60), y: -50 - i * 40 });
    return a; } },
  { name: '混编梯队', weight: 1.0, minWave: 5, build: () => {
    const a = [ { delay: 0.2, type: 'scout', x: G.W / 2 - 60, y: -40 }, { delay: 0.6, type: 'scout', x: G.W / 2 + 60, y: -40 }, { delay: 1.4, type: 'fighter', x: -30, y: 120 } ];
    return a; } },
  { name: '精英护卫', weight: 0.7, minWave: 7, build: () => {
    return [ { delay: 0.3, type: 'elite', x: G.W / 2, y: -60 }, { delay: 0.2, type: 'scout', x: G.W / 2 - 80, y: -30 }, { delay: 0.2, type: 'scout', x: G.W / 2 + 80, y: -30 } ]; } },
  { name: '三重装甲', weight: 0.8, minWave: 8, build: () => {
    const a = []; for (let i = 0; i < 3; i++) a.push({ delay: i * 0.6, type: 'tank', x: G.utils.rand(100, G.W - 100), y: -60 - i * 20 });
    return a; } },
  { name: '蜂群', weight: 0.9, minWave: 3, build: () => {
    const a = []; for (let i = 0; i < 8; i++) a.push({ delay: i * 0.25, type: 'scout', x: G.utils.rand(50, G.W - 50), y: -40 - i * 30 });
    return a; } },
  { name: '分裂矩阵', weight: 0.8, minWave: 6, build: () => {
    const a = []; for (let i = 0; i < 3; i++) a.push({ delay: i * 0.7, type: 'splitter', x: 120 + i * 120, y: -50 - i * 30 });
    return a; } },
  { name: '诗抄编队', weight: 0.7, minWave: 6, build: () => {
    // 长单词专递：诗抄机双形态（不攻击悬停 / 展开逐字发射单词拼写）
    return [ { delay: 0.4, type: 'poet', x: G.W * 0.3, y: -50 }, { delay: 1.8, type: 'poet', x: G.W * 0.7, y: -50 } ]; } },
  { name: '狙击阵地', weight: 0.8, minWave: 7, build: () => {
    return [ { delay: 0.3, type: 'sniper', x: G.W * 0.25, y: -40 }, { delay: 1.2, type: 'sniper', x: G.W * 0.75, y: -40 }, { delay: 0.8, type: 'scout', x: G.W * 0.5, y: -30 } ]; } },
  { name: '护航运输', weight: 0.7, minWave: 5, build: () => {
    return [ { delay: 0.4, type: 'transport', x: -40, y: 140 }, { delay: 0.2, type: 'fighter', x: -60, y: 80 }, { delay: 0.2, type: 'fighter', x: -60, y: 200 } ]; } }
];

function pickFormation () {
  const mode = G.DIFFICULTIES[G.difficultyMode] || G.DIFFICULTIES.normal;
  const shift = mode.typeShift || 0;   // 困难版：高级敌机编队提前登场（种类增加）
  const avail = G.FORMATIONS.filter(f => f.minWave <= G.wave + shift);
  // 加权随机
  let total = 0; for (const f of avail) total += f.weight;
  let r = Math.random() * total, chosen = avail[0];
  for (const f of avail) { r -= f.weight; if (r <= 0) { chosen = f; break; } }
  // 避免连续 3 波重复
  let guard = 0;
  while (G.lastPicks.slice(-3).includes(chosen) && guard < 5) {
    r = Math.random() * total;
    for (const f of avail) { r -= f.weight; if (r <= 0) { chosen = f; break; } }
    guard++;
  }
  G.lastPicks.push(chosen);
  if (G.lastPicks.length > 6) G.lastPicks.shift();
  return chosen;
}

/** 开始第 n 波（每关 wavesPerLevel 个普通波 + 1 个 Boss 波） */
G.startWave = function (n) {
  G.wave = n;
  G.waveTimer = 0;
  G.waveClearTimer = 0;
  G.waveTookDamage = false;   // 本波受击标记（无伤奖励用）
  G.pendingSpawns = [];
  const bossWave = n === G.CONFIG.level.wavesPerLevel + 1;
  if (bossWave) {
    G.triggerBossWarning();
  } else {
    const f = pickFormation();
    G.pendingSpawns = f.build();
    // 困难版：每波额外追加一个编队（敌人数量增加；子弹仍为普通单发，不改弹幕样式）
    const mode = G.DIFFICULTIES[G.difficultyMode] || G.DIFFICULTIES.normal;
    const extra = mode.extraFormations || 0;
    for (let k = 0; k < extra; k++) {
      const f2 = pickFormation();
      for (const s of f2.build()) {
        G.pendingSpawns.push({ type: s.type, x: s.x, y: s.y, delay: s.delay + 1.2 + k * 1.5 });
      }
    }
    G.waveTotal = G.pendingSpawns.length;   // 本波敌机总数（供进度条）
    // 第 7 波必投时间减速 T；第 4 波 50% 概率投放普通补给（控制道具总量）
    if (n === 7) {
      G.spawnPowerup('T', G.utils.rand(60, G.W - 60), -30);
    } else if (n === 4 && Math.random() < 0.5) {
      G.spawnPowerup(G.utils.pick(['B', 'H', 'S']), G.utils.rand(60, G.W - 60), -30);
    }
  }
};

/** 触发 Boss 来袭警告（正常波次结束或超时强杀都会调用） */
G.triggerBossWarning = function () {
  G.bossWarning = { active: true, t: 0, typeIndex: G.levelBossIndex() };
  G.waveTotal = 0;    // Boss 波由 Boss 血条表现，隐藏波次进度条
  G.audio.warn();
};

G.updateWave = function (dt) {
  // Boss 警告阶段
  if (G.bossWarning.active) {
    G.bossWarning.t += dt;
    G.ui.setWarning(true);
    if (G.bossWarning.t >= 2.0) {
      G.bossWarning.active = false;
      G.ui.setWarning(false);
      G.spawnBoss(G.bossWarning.typeIndex);
    }
    return;
  }
  // Boss 存活期间不推进普通波次
  if (G.boss) return;
  // Boss 波：关卡结算由主循环（Boss 死亡演出结束后）处理，这里不自动推进
  if (G.wave === G.CONFIG.level.wavesPerLevel + 1) return;

  G.waveTimer += dt;
  // 按延迟生成待刷新的敌机
  for (let i = G.pendingSpawns.length - 1; i >= 0; i--) {
    if (G.pendingSpawns[i].delay <= G.waveTimer) {
      const s = G.pendingSpawns[i];
      G.spawnEnemy(s.type, s.x, s.y);
      G.pendingSpawns.splice(i, 1);
    }
  }
  // 清场判定：敌机清空 或 超时放行
  if (G.pendingSpawns.length === 0) {
    const noEnemies = G.enemies.length === 0;
    const timeout = G.waveTimer > G.CONFIG.waveTimeout;
    if (noEnemies || timeout) {
      G.waveClearTimer += dt;
      if (G.waveClearTimer >= G.CONFIG.waveClearDelay) {
        if (timeout && !noEnemies) { for (const e of G.enemies) e.dead = true; }
        G.onWaveCleared();          // 波次结算奖励
        G.startWave(G.wave + 1);
      }
    } else {
      G.waveClearTimer = 0;
    }
  }
};