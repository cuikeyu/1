/* =========================================================
 * main.js —— 游戏循环 / 状态机 / 输入 / 碰撞 / 震屏 / 时间缩放
 * ========================================================= */
window.G = window.G || {};

(function () {
  const $ = (id) => document.getElementById(id);
  const canvas = $('game');
  const ctx = canvas.getContext('2d');

  // ---------- 运行期全局状态 ----------
  G.state = 'menu';
  G.ctx = ctx;
  G.canvas = canvas;
  G.score = 0;
  G.sessionCoins = 0;
  G.combo = 0;
  G.comboTimer = 0;
  G.kills = 0;
  G.grazeCount = 0;
  G.hitsTaken = 0;
  G.deaths = 0;
  G.flashTimer = 0;
  G.vignetteTimer = 0;
  G.shakeMag = 0;
  G.shakeTime = 0;
  G.timeScale = 1;
  G.timeScaleTimer = 0;
  G.slowTimer = 0;            // 时间减速道具剩余时间（只减速敌方）
  G.enemyTimeScale = 1;
  G.stageTime = 0;            // 本关已用时间（秒）
  G.level = 1;
  G.difficultyMode = 'normal';
  G.obstacleTimer = 0;
  G.bossWasActive = false;    // 本关 Boss 是否已登场（用于死亡演出后结算）
  G.stageCleared = false;
  G.stageWordLog = [];        // 每关词汇记录 [{level, name, words:[{en,cn,pos,hit}]}]，最终通关展示

  /* ---------- 输入 ---------- */
  G.input = { keys: new Set(), mouseDown: false, mouseX: 0, mouseY: 0, touchActive: false, touchX: 0, touchY: 0, touches: new Map() };

  const rect = () => canvas.getBoundingClientRect();
  function toLogical (clientX, clientY) {
    const r = rect();
    return { x: (clientX - r.left) / r.width * G.W, y: (clientY - r.top) / r.height * G.H };
  }

  function bindInput () {
    // 键盘
    window.addEventListener('keydown', (e) => {
      const k = e.key;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(k)) e.preventDefault();
      G.input.keys.add(k.length === 1 ? k.toLowerCase() : k);
      if (k === ' ' || k === 'j' || k === 'J') { if (G.state === 'playing') G.useBomb(); }
      if (k === 'p' || k === 'P' || k === 'Escape') { togglePause(); }
    });
    window.addEventListener('keyup', (e) => {
      G.input.keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key);
    });

    // 鼠标拖动 + 右键炸弹
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) { G.input.mouseDown = true; const p = toLogical(e.clientX, e.clientY); G.input.mouseX = p.x; G.input.mouseY = p.y; }
    });
    window.addEventListener('mousemove', (e) => {
      if (G.input.mouseDown) { const p = toLogical(e.clientX, e.clientY); G.input.mouseX = p.x; G.input.mouseY = p.y; }
    });
    window.addEventListener('mouseup', (e) => { if (e.button === 0) G.input.mouseDown = false; });
    canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); if (G.state === 'playing') G.useBomb(); });

    // 触屏
    canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      G.audio.init();
      for (const t of e.changedTouches) {
        if (G.input.touches.size > 0) { if (G.state === 'playing') G.useBomb(); }   // 双指炸弹
        G.input.touches.set(t.identifier, t);
      }
      const first = e.touches[0];
      if (first) { G.input.touchActive = true; const p = toLogical(first.clientX, first.clientY); G.input.touchX = p.x; G.input.touchY = p.y; }
    }, { passive: false });
    canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      const first = e.touches[0];
      if (first) { const p = toLogical(first.clientX, first.clientY); G.input.touchX = p.x; G.input.touchY = p.y; }
    }, { passive: false });
    const touchEnd = (e) => {
      for (const t of e.changedTouches) G.input.touches.delete(t.identifier);
      if (G.input.touches.size === 0) G.input.touchActive = false;
    };
    canvas.addEventListener('touchend', touchEnd);
    canvas.addEventListener('touchcancel', touchEnd);
  }

  function togglePause () {
    if (G.state === 'playing') { G.state = 'paused'; G.ui.showScreen('pause'); }
    else if (G.state === 'paused') { G.state = 'playing'; G.ui.showScreen('game'); }
  }

  /* ---------- 得分 / Combo ---------- */
  G.addScore = function (base) {
    const mul = Math.min(1 + G.combo * 0.05, G.CONFIG.comboMaxMul);
    G.score += Math.round(base * mul);
  };
  G.addCombo = function () {
    G.combo++; G.comboTimer = G.CONFIG.comboWindow;
    // Combo 里程碑奖励（每档只发一次）
    const p = G.player;
    if (!p) return;
    if (G.combo >= 50 && G.comboMilestone < 50) {
      G.comboMilestone = 50; G.sessionCoins += 60;
      G.spawnText(p.x, p.y - 50, 'COMBO x50! +60★', G.COLORS.gold, 16);
      G.spawnCoins(p.x, p.y - 20, 4); G.audio.buy();
    } else if (G.combo >= 30 && G.comboMilestone < 30) {
      G.comboMilestone = 30;
      if (p.bombs < G.bombMaxOf()) p.bombs++;
      G.spawnText(p.x, p.y - 50, 'COMBO x30! BOMB+1', G.COLORS.accent, 15);
      G.audio.powerup();
    } else if (G.combo >= 15 && G.comboMilestone < 15) {
      G.comboMilestone = 15; G.sessionCoins += 20;
      G.spawnText(p.x, p.y - 50, 'COMBO x15! +20★', G.COLORS.gold, 14);
      G.audio.buy();
    }
  };

  /** 波次结算奖励：无伤通关 / 快速清波 */
  G.onWaveCleared = function () {
    if (G.waveTotal <= 0) return;   // Boss 波不参与
    const msgs = [];
    if (!G.waveTookDamage) { G.sessionCoins += 30; msgs.push('PERFECT +30★'); }
    if (G.waveTimer <= 12) { G.sessionCoins += 20; msgs.push('FAST +20★'); }
    if (msgs.length && G.player && !G.player.dead) {
      G.spawnText(G.player.x, G.player.y - 70, msgs.join(' '), G.COLORS.gold, 15);
      G.audio.pickup();
    }
  };
  G.resetCombo = function () { G.combo = 0; G.comboTimer = 0; };

  /* ---------- 特效辅助 ---------- */
  G.shake = function (mag, time) {
    if (!G.save.get().settings.shake) return;
    G.shakeMag = Math.max(G.shakeMag, mag);
    G.shakeTime = Math.max(G.shakeTime, time);
  };
  G.slowMo = function (dur, scale) { G.timeScale = scale; G.timeScaleTimer = dur; };
  G.hitStop = function (dur) { G.timeScale = 0.2; G.timeScaleTimer = Math.max(G.timeScaleTimer, dur); };

  /* ---------- 会话控制 ---------- */
  function resetSession () {
    G.score = 0; G.sessionCoins = 0; G.combo = 0; G.comboTimer = 0;
    G.kills = 0; G.grazeCount = 0; G.hitsTaken = 0; G.deaths = 0;
    G.comboMilestone = 0; G.waveTookDamage = false;
    G.playerBullets = []; G.enemyBullets = []; G.enemies = []; G.powerups = [];
    G.letterDrops = [];
    G.particles = []; G.shockwaves = []; G.texts = []; G.wings = []; G.obstacles = [];
    G.boss = null; G.bossDying = 0; G.bombCharge = 0;
    G.stageWordLog = [];        // 新一局：词汇总表重新归档
    if (G.resetUsedWords) G.resetUsedWords();   // 新一局：跨关词汇去重池清空
    G.flashTimer = 0; G.vignetteTimer = 0; G.shakeMag = 0; G.shakeTime = 0;
    G.timeScale = 1; G.timeScaleTimer = 0;
    G.slowTimer = 0; G.enemyTimeScale = 1; G.stageTime = 0;
    G.obstacleTimer = G.CONFIG.obstacle.spawnFirst;
    G.bossWasActive = false; G.stageCleared = false;
    G.bossWarning = { active: false, t: 0, typeIndex: 0 };
  }

  /** 菜单出击：从当前难度的存档进度继续（各难度独立记录，未通关则从已到过的最高关开始） */
  G.startGame = function () {
    const save = G.save.get();
    const diff = save.settings.difficulty || 'normal';
    const lv = Math.max(1, Math.min(save.stageUnlock[diff] || 1, G.LEVELS.length));
    G.startAtStage(lv);
  };

  /** 从指定关卡开始新的一局（关卡选择入口：分数清零，难度取当前菜单选择） */
  G.startAtStage = function (lv) {
    G.audio.init();
    // 读取菜单选择的难度
    G.difficultyMode = G.save.get().settings.difficulty || 'normal';
    // 游戏内 BGM 随难度切换（简单可爱 / 普通治愈 / 困难暗雷），与菜单雷霆区分
    G.audio.setBgmTrack({ easy: 'cute', normal: 'heal', hard: 'storm' }[G.difficultyMode] || 'heal');
    G.audio.setBgmDuck(false);   // 可能从词库结算画面（压低态）进入，恢复常音量
    G.level = Math.max(1, Math.min(lv || 1, G.LEVELS.length));
    // 进度落档：本难度到达过本关即记录（中途退出/阵亡后再进也从本关继续）
    const s0 = G.save.get();
    if (typeof s0.stageUnlock[G.difficultyMode] !== 'number') s0.stageUnlock[G.difficultyMode] = 1;
    s0.stageUnlock[G.difficultyMode] = Math.max(s0.stageUnlock[G.difficultyMode], G.level);
    G.save.commit();
    resetSession();
    G.initStageWords();   // 本局词表：随机 20 词，本关内循环
    G.createPlayer();
    spawnEquippedDrone();
    G.startWave(1);
    G.state = 'playing';
    G.ui.showScreen('game');
    G.ui.updateHUD();
  };

  /** 进入指定关卡（下一关时保留分数与金币，恢复满状态） */
  G.startStage = function (lv) {
    G.audio.init();
    G.level = lv;
    G.stageTime = 0;
    G.initStageWords();   // 每关重新抽取 20 词
    G.obstacleTimer = G.CONFIG.obstacle.spawnFirst;
    G.bossWasActive = false; G.stageCleared = false;
    // 清空战场实体（分数/金币/连击保留）
    G.playerBullets = []; G.enemyBullets = []; G.enemies = []; G.powerups = [];
    G.letterDrops = [];
    G.particles = []; G.shockwaves = []; G.texts = []; G.wings = []; G.obstacles = [];
    G.boss = null; G.slowTimer = 0; G.enemyTimeScale = 1;
    G.bossWarning = { active: false, t: 0, typeIndex: 0 };
    G.createPlayer();
    spawnEquippedDrone();
    G.startWave(1);
    G.state = 'playing';
    G.ui.showScreen('game');
    G.ui.updateHUD();
  };

  /** 机库中装备的僚机出战机（需已金币购买） */
  function spawnEquippedDrone () {
    const save = G.save.get();
    if (save.currentDrone && save.unlockedDrones.includes(save.currentDrone)) {
      G.wings = [G.makeDrone(save.currentDrone, -1)];
    }
  }

  /** Boss 击杀演出结束后的关卡结算 */
  G.stageClear = function () {
    if (G.stageCleared) return;
    G.stageCleared = true;
    G.state = 'stageclear';
    const mode = G.DIFFICULTIES[G.difficultyMode] || G.DIFFICULTIES.normal;
    const bonus = Math.round(G.CONFIG.level.clearBonus * G.level * mode.coinMul);
    G.sessionCoins += bonus;
    // 结算即锁定收益：金币入档 + 最高分（避免通关后收益丢失）
    const save = G.save.get();
    save.coins += G.sessionCoins;
    if (G.score > save.highScore) save.highScore = G.score;
    save.stats.cleared = true;   // 通关记录（僚机已改为机库金币购买）
    // 解锁下一关（各难度独立记录，封顶 50）
    const diff = G.difficultyMode || 'normal';
    if (typeof save.stageUnlock[diff] !== 'number') save.stageUnlock[diff] = 1;
    save.stageUnlock[diff] = Math.max(save.stageUnlock[diff], Math.min(G.LEVELS.length, G.level + 1));
    G.save.commit();
    const earned = G.sessionCoins;
    G.sessionCoins = 0;
    const isFinal = G.level >= G.LEVELS.length;
    // 最终关词汇表画面：BGM 压低（返回菜单/开局时恢复）
    if (isFinal) G.audio.setBgmDuck(true);
    // 归档本关词汇表（已击打/未打消，最终通关结算时逐关展示）
    if (G.stageWordHits) {
      const def = G.LEVELS[(G.level - 1) % G.LEVELS.length] || {};
      G.stageWordLog.push({ level: G.level, name: def.name || '', words: Array.from(G.stageWordHits.values()) });
    }
    G.ui.showStageClear({ level: G.level, time: G.stageTime, kills: G.kills, bonus, earned, final: isFinal });
    G.ui.showScreen('stageclear');
  };

  G.nextLevel = function () {
    // 最终关通关：结算已入档，返回主菜单
    if (G.level >= G.LEVELS.length) { G.quitToMenu(); return; }
    G.startStage(G.level + 1);
  };

  G.pauseGame = function () { if (G.state === 'playing') { G.state = 'paused'; G.ui.showScreen('pause'); } };
  G.resumeGame = function () { if (G.state === 'paused') { G.state = 'playing'; G.ui.showScreen('game'); } };
  G.quitToMenu = function () { G.state = 'menu'; G.audio.setBgmDuck(false); G.audio.setBgmTrack('menu'); if (G.ui.refreshMenu) G.ui.refreshMenu(); G.ui.showScreen('menu'); };

  /* ---------- 受击 / 死亡 ---------- */
  G.hurtPlayer = function (dmg) {
    const p = G.player;
    if (!p || p.dead || G.state !== 'playing') return;
    if (p.invincible > 0) return;
    // 难度伤害系数
    const mode = G.DIFFICULTIES[G.difficultyMode] || G.DIFFICULTIES.normal;
    dmg = dmg * mode.dmgMul;
    if (p.shield > 0) {
      p.shield--; p.invincible = 1.5; G.hitsTaken++; G.waveTookDamage = true;
      G.audio.hit(); G.shake(5, 0.15);
      G.spawnShockwave(p.x, p.y, '#55bbff', 80, 0.3);
      return;
    }
    p.hp -= dmg; p.invincible = 1.5; G.hitsTaken++; G.waveTookDamage = true;
    G.resetCombo();
    G.audio.hit(); G.shake(7, 0.2); G.vignetteTimer = 0.4; G.hitStop(0.05);
    if (p.hp <= 0) G.playerDead();
  };

  G.playerDead = function () {
    // 一条命：死亡即结束，没有复活
    G.deaths++;
    const p = G.player;
    G.spawnExplosion(p.x, p.y, '#00E5FF', 30);
    G.audio.death(); G.shake(12, 0.5);
    p.dead = true;
    G.gameOver();
  };

  G.gameOver = function () {
    G.state = 'gameover';
    // 评级（一条命制：死亡必然受击 1 次，hitsTaken==1 即近乎全程无伤）
    const rating = (G.hitsTaken <= 1) ? 'S' : (G.hitsTaken <= 3 ? 'A' : 'B');
    const bonus = { S: 1.5, A: 1.2, B: 1.0 }[rating];
    const earned = Math.round(G.sessionCoins * bonus);
    const save = G.save.get();
    save.coins += earned;
    if (G.score > save.highScore) save.highScore = G.score;
    G.save.commit();
    G.ui.showGameOver({ rating, score: G.score, earned, kills: G.kills, graze: G.grazeCount, hits: G.hitsTaken, level: G.level, time: G.stageTime });
    G.ui.showScreen('gameover');
  };

  /* ---------- 碰撞 ---------- */
  G.updateCollisions = function () {
    const p = G.player;

    // 玩家弹 × 敌机
    for (let i = G.playerBullets.length - 1; i >= 0; i--) {
      const b = G.playerBullets[i];
      let removed = false;
      for (let j = G.enemies.length - 1; j >= 0; j--) {
        const e = G.enemies[j];
        if (e.dead) continue;
        if (G.utils.circleHit(b, e)) {
          damageEnemy(e, b.dmg);
          if (b.pierce > 0) { b.pierce--; }
          else { removed = true; }
          break;
        }
      }
      if (removed) G.playerBullets.splice(i, 1);
    }

    // 玩家弹 × 陨石（可击碎）
    for (let i = G.playerBullets.length - 1; i >= 0; i--) {
      const b = G.playerBullets[i];
      let hit = false;
      for (let k = G.obstacles.length - 1; k >= 0; k--) {
        const o = G.obstacles[k];
        if (o.dead) continue;
        if (G.utils.circleHit(b, o)) {
          G.damageObstacle(o, b.dmg);
          if (b.pierce > 0) { b.pierce--; } else { hit = true; }
          break;
        }
      }
      if (hit) G.playerBullets.splice(i, 1);
    }

    // 玩家弹 × Boss
    if (G.boss && !G.boss.dying && !G.boss.dead && G.boss.invuln <= 0) {
      for (let i = G.playerBullets.length - 1; i >= 0; i--) {
        const b = G.playerBullets[i];
        if (G.utils.circleHit(b, G.boss)) {
          G.damageBoss(b.dmg);
          if (b.pierce > 0) { b.pierce--; } else { G.playerBullets.splice(i, 1); }
        }
      }
    }

    // 敌弹 × 玩家
    if (p && !p.dead) {
      for (let i = G.enemyBullets.length - 1; i >= 0; i--) {
        const b = G.enemyBullets[i];
        // 陨石吸收敌弹（可当掩体）
        let absorbed = false;
        for (const o of G.obstacles) {
          if (o.dead) continue;
          if (G.utils.circleHit(b, o)) { absorbed = true; break; }
        }
        if (absorbed) { G.enemyBullets.splice(i, 1); continue; }
        if (G.utils.circleHit(b, p)) {
          G.enemyBullets.splice(i, 1);
          G.hurtPlayer(15);
          continue;
        }
        // 敌弹 × 僚机（小飞机独立血条，可被击落）
        for (let k = G.wings.length - 1; k >= 0; k--) {
          const w = G.wings[k];
          if (w.invuln > 0) continue;
          if (G.utils.circleHit(b, w)) {
            G.enemyBullets.splice(i, 1);
            G.hurtDrone(w, 15);
            break;
          }
        }
      }
      // 敌机 × 玩家（撞击）
      for (let j = G.enemies.length - 1; j >= 0; j--) {
        const e = G.enemies[j];
        if (e.dead) continue;
        if (G.utils.circleHit(e, p)) G.hurtPlayer(e.contactDmg);
      }
      // 敌机 × 僚机（撞击）
      for (let k = G.wings.length - 1; k >= 0; k--) {
        const w = G.wings[k];
        if (w.invuln > 0) continue;
        for (let j = G.enemies.length - 1; j >= 0; j--) {
          const e = G.enemies[j];
          if (e.dead) continue;
          if (G.utils.circleHit(e, w)) { G.hurtDrone(w, e.contactDmg); break; }
        }
      }
      // 玩家 × 陨石：实体阻挡，不可穿过（沿法线推出）+ 触碰伤害
      for (const o of G.obstacles) {
        if (o.dead) continue;
        const rr = o.r + p.hitR - 2;
        let dx = p.x - o.x, dy = p.y - o.y;
        let d = Math.hypot(dx, dy);
        // 完全同心（罕见）：按陨石下落方向把玩家向下推出
        if (d < 0.001) { dx = 0; dy = 1; d = 1; }
        if (d < rr) {
          const nx = dx / d, ny = dy / d;
          p.x = o.x + nx * rr;
          p.y = o.y + ny * rr;
          p.x = G.utils.clamp(p.x, p.hitR, G.W - p.hitR);
          p.y = G.utils.clamp(p.y, p.hitR, G.H - p.hitR);
          if (o.touchCd <= 0) {
            G.hurtPlayer(G.CONFIG.obstacle.contactDmg);
            o.touchCd = 0.9;
            G.spawnParticle(p.x, p.y, { vx: -nx * 80, vy: -ny * 80, color: G.COLORS.peach, size: 3, life: 0.35 });
          }
        }
      }
    }

    // 道具 × 玩家
    if (p && !p.dead) {
      for (let i = G.powerups.length - 1; i >= 0; i--) {
        const u = G.powerups[i];
        if (G.utils.circleHit(u, p)) {
          G.powerups.splice(i, 1);
          applyPowerup(u.type);
        }
      }
    }
  };

  function applyPowerup (type) {
    const p = G.player;
    switch (type) {
      case 'P': {
        // 火力上限随难度：简单 6 发，普通/困难 5 发
        const mp = (G.DIFFICULTIES[G.difficultyMode] || G.DIFFICULTIES.normal).maxPower || 5;
        if (p.power < mp) p.power++; else G.score += 500;
        G.audio.powerup(); break;
      }
      case 'S': if (p.shield < 2) p.shield++; G.audio.pickup(); break;
      case 'B': if (p.bombs < G.bombMaxOf()) p.bombs++; G.audio.pickup(); break;
      case 'C': {
        // 辅助道具·充能核：擦弹槽立即充满（大招 +1），可叠加充能上限内反复使用
        if (p.bombs < G.bombMaxOf()) {
          p.bombs++; G.bombCharge = 0;
          G.spawnText(p.x, p.y - 34, 'BOMB +1', G.COLORS.accent, 14);
        } else { G.bombCharge = 0; G.score += 300; }
        G.audio.powerup(); break;
      }
      case 'U': {
        // 辅助道具·超载核心（困难专属）：一次充 2 枚大招 + 冲击波清扫全屏敌弹
        const gained = Math.min(2, G.bombMaxOf() - p.bombs);
        p.bombs += gained;
        G.bombCharge = 0;
        for (const b of G.enemyBullets) b.dead = true;
        G.enemyBullets.length = 0;
        G.spawnText(p.x, p.y - 34, 'BOMB +' + gained + '!', G.COLORS.accent, 16);
        G.spawnShockwave(p.x, p.y, G.COLORS.accent, 260, 0.5);
        G.audio.bomb(); break;
      }
      case 'L': {
        // 散落字母（困难专属，外观伪装成普通字母）：填充左下角充能条，每 4 个获得一次大招
        if (p.bombs < G.bombMaxOf()) {
          G.bombCharge += G.letterCharge.gain;
          if (G.bombCharge >= 1) {
            G.bombCharge = 0; p.bombs++;
            G.spawnText(p.x, p.y - 34, 'BOMB +1', G.COLORS.accent, 14);
            G.audio.powerup();
          } else {
            G.audio.spell();
          }
        } else {
          // 大招已满：字母转化为少量分数，充能槽不溢出
          G.bombCharge = 0; G.score += 200;
          G.audio.spell();
        }
        break;
      }
      case 'H': p.hp = Math.min(p.hp + 30, p.maxHp); G.audio.pickup(); break;
      case 'M': G.addWing(); G.audio.powerup(); break;
      case 'T': {
        // 时间减速：仅敌方变慢，玩家照常行动
        const c = G.CONFIG.slowMoPowerup;
        G.slowTimer = c.duration; G.enemyTimeScale = c.enemyScale;
        G.spawnText(p.x, p.y - 50, 'TIME SLOW', '#B59CFF', 16);
        G.spawnShockwave(p.x, p.y, '#B59CFF', 180, 0.5);
        G.audio.powerup();
        break;
      }
      case 'coin': G.sessionCoins += Math.round(10 * (G.DIFFICULTIES[G.difficultyMode] || G.DIFFICULTIES.normal).coinMul); G.audio.pickup(); break;
    }
  }

  /* ---------- 特效 DOM ---------- */
  function updateFX () {
    const flash = $('flash'), vig = $('vignette');
    if (G.flashTimer > 0) { flash.classList.remove('hidden'); flash.style.opacity = Math.min(1, G.flashTimer / 0.25); }
    else flash.classList.add('hidden');
    if (G.vignetteTimer > 0) { vig.classList.remove('hidden'); vig.style.opacity = Math.min(0.8, G.vignetteTimer / 0.4); }
    else vig.classList.add('hidden');
  }

  /* ---------- 视角相机（设置内可切：标准 / 动态跟镜 / 广阔） ---------- */
  // dynamic：常规轻微跟镜，Boss 战推近并略上移（看得清 Boss 也留出下方机动空间）
  // wide：全局缩小，视野更大；standard：固定 1:1
  G.camera = { x: 0, y: 0, zoom: 1, tx: 0, ty: 0, tz: 1 };
  function updateCamera (dt) {
    const cam = G.camera;
    const mode = (G.save.get().settings.viewMode || 'standard');
    const p = G.player;
    if (mode === 'wide') {
      cam.tz = 0.88; cam.tx = 0; cam.ty = 0;
    } else if (mode === 'dynamic' && G.state === 'playing') {
      const bossFight = !!(G.boss || G.bossWarning.active);
      cam.tz = bossFight ? 1.12 : 1.03;
      cam.ty = bossFight ? -34 : -10;
      cam.tx = p ? (p.x - G.W / 2) * (bossFight ? 0.07 : 0.05) : 0;
    } else {
      cam.tz = 1; cam.tx = 0; cam.ty = 0;
    }
    const k = Math.min(1, 4 * dt);
    cam.x += (cam.tx - cam.x) * k;
    cam.y += (cam.ty - cam.y) * k;
    cam.zoom += (cam.tz - cam.zoom) * k;
  }

  /* ---------- 更新 ---------- */
  function update (dt) {
    updateCamera(dt);
    G.background.update(dt);
    G.updateParticles(dt);

    if (G.state === 'playing') {
      // 时间减速道具：仅作用于敌方单位（实时倒计时）
      if (G.slowTimer > 0) {
        G.slowTimer -= dt;
        if (G.slowTimer <= 0) G.enemyTimeScale = 1;
      }
      const edt = dt * G.enemyTimeScale;

      // 关卡计时（真实时间）
      G.stageTime += dt;

      // 陨石周期生成（Boss 战期间暂停生成，避免遮挡弹幕）
      if (!G.boss && !G.bossWarning.active) {
        G.obstacleTimer -= dt;
        if (G.obstacleTimer <= 0) {
          G.spawnObstacle();
          const cfg = G.CONFIG.obstacle;
          const base = Math.max(cfg.intervalMin, cfg.spawnInterval - (G.level - 1) * 0.6);
          G.obstacleTimer = G.utils.rand(base * 0.7, base * 1.3);
        }
      }

      G.updatePlayer(dt);
      G.updateWings(dt);
      G.updatePlayerBullets(dt);
      G.updateObstacles(edt);
      G.updateEnemies(edt);
      G.updateBoss(edt);
      G.updateEnemyBullets(edt);
      G.updatePowerups(dt);
      G.updateLetterDrops(dt);
      G.updateWave(edt);
      G.updateCollisions();
      if (G.combo > 0) { G.comboTimer -= dt; if (G.comboTimer <= 0) G.resetCombo(); }

      // —— 5 分钟关卡时长保障 ——
      const lv = G.CONFIG.level;
      if (G.boss) {
        G.bossWasActive = true;
        if (G.stageTime >= lv.timeLimit && !G.boss.rush) {
          G.boss.rush = true;   // 狂暴：受伤翻倍，快速终结战斗
          G.spawnText(G.W / 2, G.H * 0.35, 'RUSH MODE!', G.COLORS.danger, 22);
        }
      } else if (!G.bossWarning.active && G.wave <= lv.wavesPerLevel && G.stageTime >= lv.enrageAt) {
        // 4:30 仍在清波：清场并强制 Boss 登场
        for (const e of G.enemies) e.dead = true;
        G.pendingSpawns.length = 0;
        G.wave = lv.wavesPerLevel + 1;
        G.triggerBossWarning();
      }

      // Boss 死亡演出结束（boss 由实体变为 null）→ 关卡结算
      if (G.bossWasActive && !G.boss && !G.bossWarning.active) {
        G.stageClear();
      }

      G.ui.updateHUD();
    }

    // 计时器（按缩放后的 dt 递减亦可，视觉足够）
    if (G.flashTimer > 0) G.flashTimer -= dt;
    if (G.vignetteTimer > 0) G.vignetteTimer -= dt;
    if (G.shakeTime > 0) { G.shakeTime -= dt; if (G.shakeTime <= 0) G.shakeMag = 0; }
    updateFX();
  }

  /* ---------- 渲染 ---------- */
  function draw () {
    ctx.setTransform(devicePixelRatio || 1, 0, 0, devicePixelRatio || 1, 0, 0);
    ctx.clearRect(0, 0, G.W, G.H);
    ctx.save();
    if (G.shakeTime > 0) ctx.translate(G.utils.rand(-G.shakeMag, G.shakeMag), G.utils.rand(-G.shakeMag, G.shakeMag));

    // 背景：满幅绘制（不随相机变换，避免广阔视角露出画布外黑边）
    G.background.draw(ctx);

    // 相机变换（仅实体层：视角推拉/平移）
    const cam = G.camera;
    ctx.save();
    if (cam.zoom !== 1 || cam.x !== 0 || cam.y !== 0) {
      ctx.translate(G.W / 2 + cam.x, G.H / 2 + cam.y);
      ctx.scale(cam.zoom, cam.zoom);
      ctx.translate(-G.W / 2, -G.H / 2);
    }

    // 渲染顺序（敌弹永远最上层）
    if (G.state !== 'menu') {
      G.drawObstacles(ctx);
      G.drawPlayerBullets(ctx);
      G.drawEnemies(ctx);
      G.drawBoss(ctx);
      G.drawWings(ctx);
      G.drawPlayer(ctx);
      G.drawEnemyBullets(ctx);
      G.drawPowerups(ctx);
    }
    G.drawParticles(ctx);
    ctx.restore();
    ctx.restore();
  }

  /* ---------- 主循环（固定时间步长） ---------- */
  /* 屏幕适配：按视口高度铺满（手机竖屏无黑边），超宽时按宽度限位并居中；
     画布始终按 480×854 逻辑分辨率 + DPR 渲染，CSS 尺寸做拉伸，游戏内容不变形 */
  function resize () {
    const vw = window.innerWidth, vh = window.innerHeight;
    // 宽度不足时收窄逻辑宽度（保持 480:854 比例），保证横屏矮窗也能完整显示
    let lw = G.W, lh = G.H;
    const ratio = G.W / G.H;
    if (vw / vh < ratio) { lw = Math.max(360, Math.round(vh * ratio * 0.999)); lh = Math.round(lw / ratio); }
    // 等比缩放铺满视口短边；上限 1.8 倍避免大屏元素过大失真
    const scale = Math.min(vw / lw, vh / lh, 1.8);
    const cssW = Math.floor(lw * scale), cssH = Math.floor(lh * scale);
    const stage = $('stage');
    stage.style.width = cssW + 'px';
    stage.style.height = cssH + 'px';
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(G.W * dpr);
    canvas.height = Math.floor(G.H * dpr);
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  let last = performance.now(), acc = 0;
  const STEP = 1000 / 60;
  function frame (now) {
    acc += Math.min(now - last, 100);
    last = now;
    while (acc >= STEP) {
      const realDt = STEP / 1000;
      if (G.timeScaleTimer > 0) { G.timeScaleTimer -= realDt; if (G.timeScaleTimer <= 0) G.timeScale = 1; }
      update(realDt * G.timeScale);
      acc -= STEP;
    }
    draw();
    requestAnimationFrame(frame);
  }

  /* ---------- 启动 ---------- */
  function boot () {
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', () => setTimeout(resize, 120));   // 移动端转屏后重算
    resize();
    G.save.load();
    G.background.init();
    bindInput();
    G.ui.init();
    // 开机动画：待机悬停 → 首次点击点火，音画同零帧启动（音频须用户手势后才能播放）
    G.ui.showScreen('boot');
    let launched = false;
    let bootDone = false;
    const bootText = document.getElementById('bootText');
    const phases = ['LAUNCH SEQUENCE · 出击序列', 'ACCELERATING · 加速突破', 'DEEP SPACE · 深空巡航'];
    const hint = $('bootHint');
    const launch = () => {
      if (launched) return;
      launched = true;
      // 音画同步：音频上下文创建 + 引擎点火音效 + CSS 动画序列同帧启动
      G.audio.init();
      G.audio.bootSound();
      document.getElementById('screen-boot').classList.add('go');
      document.getElementById('screen-boot').classList.remove('idle');
      if (hint) hint.style.display = 'none';
      // HUD 数值动画：推力/速度/高度递增
      const bt = $('bootThrust'), bv = $('bootVel'), ba = $('bootAlt');
      let hudT = 0;
      const hudIv = setInterval(() => {
        if (bootDone) { clearInterval(hudIv); return; }
        hudT += 0.1;
        if (bt) bt.textContent = Math.min(100, Math.round(hudT * 26));
        if (bv) bv.textContent = Math.min(999, Math.round(hudT * 250));
        if (ba) ba.textContent = Math.min(9999, Math.round(hudT * 600));
      }, 100);
      // 阶段文字（与 CSS 动画 delay 对齐：0 / 1.3s / 2.6s）
      const phaseTimers = [0, 1300, 2600].map((t, i) => setTimeout(() => { if (!bootDone && bootText) bootText.textContent = phases[i]; }, t));
      const finishBoot = () => {
        if (bootDone) return;
        bootDone = true;
        clearInterval(hudIv);
        phaseTimers.forEach(clearTimeout);
        G.audio.setBgmDuck(false);   // 进入主菜单，BGM 恢复常音量
        G.ui.showScreen('menu');
        // 首次进入页面：询问是否保存进度（返回 false 表示已问过）
        G.ui.askStorageIfNeeded();
      };
      // 4.0s 战机动画 + 1.2s 叠化
      setTimeout(finishBoot, 5200);
      // 紧凑衔接：点火音尾音尚未落定即进入菜单 BGM 下拍（1.45s 卡点）；开机期间 BGM 压低
      setTimeout(() => { G.audio.startBgm(); G.audio.setBgmDuck(true); }, 1450);
    };
    // 任意首次输入（鼠标/触摸/指针/按键/点击）均可点火，保证音画同步启动
    for (const ev of ['pointerdown', 'mousedown', 'touchstart', 'keydown', 'click']) {
      window.addEventListener(ev, launch);
    }
    requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();