/* =========================================================
 * ui.js —— DOM 界面 / 界面切换 / HUD 更新 / 结算 / 机库
 * ========================================================= */
window.G = window.G || {};

G.ui = (function () {
  const $ = (id) => document.getElementById(id);

  const screens = ['boot', 'menu', 'hangar', 'stages', 'settings', 'pause', 'stageclear', 'gameover', 'storage'];

  function showScreen (name) {
    for (const s of screens) {
      // 存档询问是浮层：保留主菜单垫底
      if (name === 'storage' && s === 'menu') continue;
      $('screen-' + s).classList.add('hidden');
    }
    if (name && name !== 'game') $('screen-' + name).classList.remove('hidden');
    const playing = (name === 'game');
    $('hud').classList.toggle('hidden', !playing);
    // 非战斗隐藏 HUD 相关战斗元素
    if (!playing) { $('bossbar').classList.add('hidden'); $('combo').classList.add('hidden'); $('slowicon').classList.add('hidden'); $('dronebar').classList.add('hidden'); }
  }

  function fmtTime (t) {
    const m = Math.floor(t / 60), s = Math.floor(t % 60);
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  function refreshMenu () {
    const save = G.save.get();
    $('menuHigh').textContent = save.highScore;
    $('menuCoins').textContent = save.coins;
    // 同步难度选择
    const diff = save.settings.difficulty || 'normal';
    document.querySelectorAll('.diff-btn').forEach(b => b.classList.toggle('selected', b.dataset.diff === diff));
    const descEl = $('diffDesc');
    if (descEl) descEl.textContent = G.DIFFICULTIES[diff].desc;
    // 出击按钮进度文案：本难度已解锁多高就从多高开始（第1关显示出击）
    const lv = Math.max(1, Math.min(save.stageUnlock[diff] || 1, G.LEVELS.length));
    const lt = $('launchText'), ls = $('launchSub');
    if (lt && ls) {
      if (lv > 1) { lt.textContent = '继续 · 第' + lv + '关'; ls.textContent = 'CONTINUE'; }
      else { lt.textContent = '出 击'; ls.textContent = 'LAUNCH'; }
    }
  }

  /* ---------- HUD ---------- */
  function updateHUD () {
    const p = G.player;
    if (!p) return;
    $('hpfill').style.width = Math.max(0, p.hp / p.maxHp * 100) + '%';
    $('shieldicon').classList.toggle('hidden', p.shield <= 0);
    $('shieldcount').textContent = p.shield;
    $('score').textContent = G.score;
    $('coinCount').textContent = G.sessionCoins;
    $('level').textContent = 'LV.' + G.level;
    if (G.boss || G.bossWarning.active) {
      $('wave').textContent = '◤ BOSS ◥';
    } else {
      $('wave').textContent = 'WAVE ' + String(Math.min(G.wave, G.CONFIG.level.wavesPerLevel)).padStart(2, '0');
    }
    $('stagetime').textContent = fmtTime(G.stageTime);
    // 临近 5 分钟时限变红提示
    $('stagetime').classList.toggle('danger', G.stageTime >= G.CONFIG.level.enrageAt);

    // 时间减速状态
    const si = $('slowicon');
    if (G.slowTimer > 0) {
      si.classList.remove('hidden');
      $('slowtime').textContent = G.slowTimer.toFixed(1);
    } else si.classList.add('hidden');

    // 僚机血条（宽度为主机血条一半，独立血量）
    const db = $('dronebar');
    const w0 = G.wings && G.wings[0];
    if (w0 && w0.maxHp) {
      db.classList.remove('hidden');
      $('dronefill').style.width = Math.max(0, w0.hp / w0.maxHp * 100) + '%';
    } else db.classList.add('hidden');

    // 波次歼敌进度条（Boss 波隐藏，改用 Boss 血条）
    const wp = $('waveprogress'), wf = $('wavefill');
    if (G.waveTotal > 0 && !G.boss && !G.bossWarning.active) {
      wp.classList.remove('hidden');
      const remaining = G.pendingSpawns.length + G.enemies.length;
      const ratio = G.utils.clamp((G.waveTotal - remaining) / G.waveTotal, 0, 1);
      wf.style.width = (ratio * 100) + '%';
    } else {
      wp.classList.add('hidden');
      wf.style.width = '0%';
    }
    $('bombnum').textContent = p.bombs;
    $('chargefill').style.width = Math.max(0, G.bombCharge * 100) + '%';

    // Combo
    const c = $('combo');
    if (G.combo >= 2) {
      c.classList.remove('hidden');
      c.textContent = 'x' + G.combo + ' COMBO';
      c.classList.toggle('hot', G.combo >= 10 && G.combo < 25);
      c.classList.toggle('onfire', G.combo >= 25);
    } else c.classList.add('hidden');

    // Boss 血条
    const bb = $('bossbar');
    if (G.boss && !G.boss.dying) {
      bb.classList.remove('hidden');
      $('bossfill').style.width = Math.max(0, G.boss.hp / G.boss.maxHp * 100) + '%';
      $('bossname').textContent = G.boss.name;
    } else bb.classList.add('hidden');
  }

  function setWarning (on) { $('warning').classList.toggle('hidden', !on); }

  /* ---------- 机库 ---------- */
  let shipIndex = 0;
  function shipIds () { return Object.keys(G.SHIPS).filter(id => !G.SHIPS[id].drone); }

  function buildHangar () {
    shipIndex = 0;
    droneIndex = 0;
    renderHangar();
    renderUpgrades();
    renderDrone();
  }

  function renderHangar () {
    const ids = shipIds();
    const id = ids[shipIndex];
    const ship = G.SHIPS[id];
    const save = G.save.get();
    const unlocked = save.unlockedShips.includes(id);
    const current = save.currentShip === id;
    $('shipName').textContent = ship.name;
    drawShipPreview(id);
    $('shipStats').innerHTML =
      (ship.trait ? '<span style="color:' + ship.color + '">' + ship.trait + '</span><br>' : '') +
      'HP: ' + ship.hp + '　速度: ' + ship.speed + '<br>' +
      '受击: ' + ship.hitR + '　伤害: ' + Math.round(ship.dmgMul * 100) + '%　射速: ' + Math.round(ship.rateMul * 100) + '%' +
      (ship.pierce ? '<br>特性: 子弹穿透 x' + (ship.pierce + 1) : '') +
      (ship.grazeBonus ? '<br>特性: 擦弹范围扩大' : '') +
      (ship.startShield ? '<br>特性: 自带护盾' : '');
    const btn = $('shipSelect');
    if (unlocked) {
      btn.textContent = current ? '当前出战' : '选用';
      btn.disabled = current;
    } else {
      btn.textContent = '解锁 (' + ship.cost + ' 金币)';
      btn.disabled = save.coins < ship.cost;
    }
    $('menuCoins').textContent = save.coins; // 同步显示金币
  }

  function drawShipPreview (id) {
    const c = $('shipPreview');
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    const ship = G.SHIPS[id];
    ctx.save();
    ctx.translate(80, 88);
    ctx.scale(2.4, 2.4);
    G.drawShipShape(ctx, ship);
    ctx.restore();
  }

  function upgradeRow (id) {
    const save = G.save.get();
    const u = G.UPGRADES[id];
    const lv = save.upgrades[id] || 0;
    const cost = G.upgradeCost(id);
    const maxed = lv >= u.max;
    const row = document.createElement('div');
    row.className = 'upgrade-row';
    const dots = '●'.repeat(lv) + '○'.repeat(u.max - lv);
    const can = !maxed && save.coins >= cost;
    row.innerHTML =
      '<div class="u-info"><div class="u-name">' + u.name + '</div>' +
      '<div class="u-desc">' + u.desc + '</div>' +
      '<div class="u-dots">' + dots + '</div></div>' +
      '<button class="u-buy" data-id="' + id + '" ' + (maxed ? 'disabled' : '') + '>' +
      (maxed ? 'MAX' : cost + ' ★') + '</button>';
    if (!maxed) row.querySelector('.u-buy').disabled = !can;
    return row;
  }

  function groupHeader (text, sub) {
    const h = document.createElement('div');
    h.className = 'upgrade-group';
    h.innerHTML = '<span>' + text + '</span><i>' + sub + '</i>';
    return h;
  }

  function renderUpgrades () {
    const list = $('upgradeList');
    list.innerHTML = '';
    const groups = [
      { key: 'weapon', title: '武器库', sub: 'ARSENAL' },
      { key: 'ship', title: '机体强化', sub: 'HANGAR' }
    ];
    for (const grp of groups) {
      list.appendChild(groupHeader(grp.title, grp.sub));
      for (const id in G.UPGRADES) {
        if ((G.UPGRADES[id].group || 'ship') === grp.key) list.appendChild(upgradeRow(id));
      }
    }
  }

  function buyUpgrade (id) {
    const save = G.save.get();
    const u = G.UPGRADES[id];
    const lv = save.upgrades[id];
    if (lv >= u.max) return;
    const cost = G.upgradeCost(id);
    if (save.coins < cost) return;
    save.coins -= cost;
    save.upgrades[id]++;
    G.save.commit();
    G.audio.buy();
    renderUpgrades();
    renderHangar();
  }

  function selectShip () {
    const save = G.save.get();
    const id = shipIds()[shipIndex];
    const ship = G.SHIPS[id];
    if (!save.unlockedShips.includes(id)) {
      if (save.coins >= ship.cost) { save.coins -= ship.cost; save.unlockedShips.push(id); save.currentShip = id; G.save.commit(); G.audio.buy(); }
      else return;
    } else {
      save.currentShip = id; G.save.commit();
    }
    renderHangar();
  }

  /* ---------- 僚机库（小型备用战机：金币购买，出战携带 1 架） ---------- */
  let droneIndex = 0;
  function droneIds () { return Object.keys(G.DRONES); }

  function renderDrone () {
    const ids = droneIds();
    const id = ids[droneIndex];
    const d = G.DRONES[id];
    const save = G.save.get();
    const unlocked = save.unlockedDrones.includes(id);
    const current = save.currentDrone === id;
    $('droneName').textContent = d.name;
    drawDronePreview(id);
    $('droneStats').innerHTML =
      '<span style="color:' + d.color + '">' + d.trait + '</span><br>' +
      'HP: ' + d.hp + '　射速: ' + d.rate.toFixed(1) + ' 发/秒<br>' +
      '伤害: ' + Math.round(d.dmgMul * 100) + '%　受击: ' + d.hitR + '<br>' +
      '特性: 独立血条（主机一半宽）· 可被敌弹击落';
    const btn = $('droneSelect');
    if (unlocked) {
      btn.textContent = current ? '卸下僚机' : '装备出战';
      btn.disabled = false;
    } else {
      btn.textContent = '解锁 (' + d.cost + ' 金币)';
      btn.disabled = save.coins < d.cost;
    }
    $('menuCoins').textContent = save.coins;
  }

  function drawDronePreview (id) {
    const c = $('dronePreview');
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    const d = G.DRONES[id];
    ctx.save();
    ctx.translate(80, 84);
    ctx.scale(2.6, 2.6);
    G.drawDroneShape(ctx, { color: d.color, shape: d.shape, x: 0 }, undefined);
    ctx.restore();
  }

  function selectDrone () {
    const save = G.save.get();
    const id = droneIds()[droneIndex];
    const d = G.DRONES[id];
    if (!save.unlockedDrones.includes(id)) {
      if (save.coins >= d.cost) { save.coins -= d.cost; save.unlockedDrones.push(id); save.currentDrone = id; G.save.commit(); G.audio.buy(); }
      else return;
    } else {
      // 已购买：装备 / 卸下切换
      save.currentDrone = (save.currentDrone === id) ? null : id;
      G.save.commit();
    }
    renderDrone();
  }

  /* ---------- 关卡选择 ---------- */
  let ssDiff = 'normal';
  function openStageSelect () {
    ssDiff = G.save.get().settings.difficulty || 'normal';
    renderStageSelect();
  }
  function renderStageSelect () {
    const save = G.save.get();
    // 难度分段按钮同步（与菜单难度联动）
    document.querySelectorAll('#ssDiff .ss-diff-btn').forEach(b => b.classList.toggle('selected', b.dataset.diff === ssDiff));
    const unlocked = Math.min(save.stageUnlock[ssDiff] || 1, G.LEVELS.length);
    const d = G.DIFFICULTIES[ssDiff];
    $('ssInfo').textContent = d.name + ' ' + d.en + ' · 已解锁 ' + unlocked + '/' + G.LEVELS.length;
    // 50 关网格：已解锁可进入（标注首领名），未解锁禁用
    const grid = $('ssGrid');
    grid.innerHTML = '';
    for (let lv = 1; lv <= G.LEVELS.length; lv++) {
      const def = G.LEVELS[lv - 1];
      const cell = document.createElement('button');
      cell.className = 'ss-cell';
      if (lv <= unlocked) {
        const isBoss = (lv - 1) % 3 === 2;
        const boss = isBoss ? G.BOSSES[G.levelBossIndex(lv, ssDiff)] : null;
        cell.innerHTML = '<b>' + lv + '</b><i>' + def.name + '</i>' +
          (boss ? '<s>' + boss.name.split(' · ')[0] + '</s>' : '');
        cell.dataset.lv = lv;
        if (lv === unlocked && unlocked < G.LEVELS.length) cell.classList.add('next');
      } else {
        cell.classList.add('locked');
        cell.disabled = true;
        cell.innerHTML = '<b>' + lv + '</b><i>未解锁</i>';
      }
      grid.appendChild(cell);
    }
    // 本难度首领池展示
    const pool = G.BOSS_POOLS[ssDiff] || G.BOSS_POOLS.normal;
    $('ssBoss').innerHTML = '<div class="ss-boss-title">本难度首领 · BOSS FORMS</div>' +
      pool.map(i => '<span class="ss-boss-item">' + G.BOSSES[i].name + '</span>').join('');
  }

  /* ---------- 设置 ---------- */
  function openSettings () {
    const s = G.save.get().settings;
    $('setBgm').checked = s.bgm;
    $('setSfx').checked = s.sfx;
    $('setShake').checked = s.shake;
    $('setStorage').checked = G.save.get().storageEnabled === true;
    // 视角模式分段按钮同步
    const vm = s.viewMode || 'standard';
    document.querySelectorAll('#viewSeg .seg-btn').forEach(b => b.classList.toggle('selected', b.dataset.view === vm));
  }
  function applySettings () {
    const s = G.save.get().settings;
    s.bgm = $('setBgm').checked;
    s.sfx = $('setSfx').checked;
    s.shake = $('setShake').checked;
    G.save.commit();
    G.audio.applyVolumes();
  }
  /** 视角模式切换：标准 / 动态跟镜 / 广阔（即时生效，存档可记） */
  function applyViewMode (mode) {
    const s = G.save.get().settings;
    if (!['standard', 'dynamic', 'wide'].includes(mode)) return;
    s.viewMode = mode;
    G.save.commit();
    document.querySelectorAll('#viewSeg .seg-btn').forEach(b => b.classList.toggle('selected', b.dataset.view === mode));
    G.audio.uiTick();
  }
  /** 设置页存档开关：开=写入本地进度，关=仅本局内存 */
  function applyStorageSetting () {
    if ($('setStorage').checked) G.save.enableStorage();
    else G.save.disableStorage();
    G.audio.uiSettings();
  }
  /** 首次进入页面：询问是否保存进度（每人可选） */
  function askStorageIfNeeded () {
    if (G.save.get().storageEnabled !== null) return false;
    showScreen('storage');
    return true;
  }

  /* ---------- 过关 ---------- */
  function showStageClear (d) {
    const def = G.LEVELS[(d.level - 1) % G.LEVELS.length];
    const title = document.querySelector('#screen-stageclear .clear-title');
    if (d.final) {
      title.textContent = 'MISSION COMPLETE';
      $('clearName').textContent = '全星域制压完成 · LV.' + d.level + ' ' + def.name;
      $('btnNextStage').textContent = '返回主菜单';
    } else {
      title.textContent = 'STAGE CLEAR';
      $('clearName').textContent = 'LV.' + d.level + '　' + def.name;
      $('btnNextStage').textContent = '进入 LV.' + (d.level + 1) + ' 星域';
    }
    $('clearDetail').innerHTML =
      '用时 ' + fmtTime(d.time) + '　击杀 ' + d.kills +
      (d.earned ? '<br>金币入账 <b>+' + d.earned + ' ★</b>' : '');
    $('clearBonus').innerHTML = '通关奖励 <b>+' + d.bonus + ' ★</b>';
    // Boss 死后温馨日常英文句子
    $('clearSentence').textContent = G.lastBossSentence ? '“' + G.lastBossSentence + '”' : '';
    // 词汇表：最终通关展示全部 50 关记录，普通关展示本关
    const cw = $('clearWords');
    const log = d.final ? G.stageWordLog : G.stageWordLog.slice(-1);
    if (log.length) {
      cw.classList.remove('hidden');
      cw.innerHTML = '<div class="cw-title">' + (d.final ? '全关卡词汇总表 · WORD LOG' : '本关词汇 · WORD LOG') + '</div>' +
        log.map(renderStageWords).join('');
    } else {
      cw.classList.add('hidden');
      cw.innerHTML = '';
    }
  }

  /** 渲染单关词汇：已击打 / 未打消 两组，含词性与释义 */
  function renderStageWords (st) {
    const hit = st.words.filter(w => w.hit);
    const miss = st.words.filter(w => !w.hit);
    const item = (w, ok) =>
      '<span class="cw-word' + (ok ? ' hit' : ' miss') + '"><b>' + w.en + '</b>' +
      (w.pos ? '<i>' + (G.POS_LABEL[w.pos] || w.pos) + '</i>' : '') +
      '<s>' + w.cn + '</s></span>';
    return '<div class="cw-stage">' +
      '<div class="cw-stage-head">LV.' + st.level + '　' + st.name +
      '<span class="cw-count">已击打 ' + hit.length + ' · 未打消 ' + miss.length + '</span></div>' +
      '<div class="cw-group"><em class="cw-tag-hit">已击打</em>' +
      (hit.length ? '<div class="cw-list">' + hit.map(w => item(w, true)).join('') + '</div>'
                  : '<div class="cw-empty">本关无击打词汇</div>') + '</div>' +
      '<div class="cw-group"><em class="cw-tag-miss">未打消</em>' +
      (miss.length ? '<div class="cw-list">' + miss.map(w => item(w, false)).join('') + '</div>'
                   : '<div class="cw-empty">全部击打，无一漏网</div>') + '</div>' +
      '</div>';
  }

  /* ---------- 结算 ---------- */
  function showGameOver (d) {
    $('rank').textContent = d.rating;
    $('rank').style.color = { S: '#FFD98A', A: '#5FE3E8', B: '#9fd8ff' }[d.rating];
    $('goScore').textContent = d.score;
    $('goDetail').innerHTML =
      'LV.' + d.level + '　用时 ' + fmtTime(d.time) + '<br>' +
      '击杀 ' + d.kills + '　擦弹 ' + d.graze + '　受击 ' + d.hits + '<br>' +
      '获得金币 ' + d.earned + '　最高分 ' + G.save.get().highScore;
    refreshMenu();
  }

  /* ---------- 事件绑定 ---------- */
  function init () {
    // 菜单三大选项：各自不同的点击音效
    const OPTION_SOUND = { start: 'uiStart', hangar: 'uiHangar', settings: 'uiSettings', stages: 'uiTick' };
    // 通用 data-action
    document.querySelectorAll('[data-action]').forEach(el => {
      el.addEventListener('click', () => {
        const act = el.dataset.action;
        // 菜单选项点击反馈：专属音效 + 放大脉冲
        if (['start', 'hangar', 'settings', 'stages'].includes(act)) {
          const snd = G.audio[OPTION_SOUND[act]];
          if (snd) snd();
          el.classList.remove('clicked');
          void el.offsetWidth;   // 强制重排，重启动画
          el.classList.add('clicked');
          setTimeout(() => el.classList.remove('clicked'), 520);
        } else if (act === 'back-menu' || act === 'quit') {
          G.audio.uiBack();
        }
        if (act === 'start') { G.startGame(); }
        else if (act === 'hangar') { buildHangar(); showScreen('hangar'); }
        else if (act === 'settings') { openSettings(); showScreen('settings'); }
        else if (act === 'stages') { openStageSelect(); showScreen('stages'); }
        else if (act === 'back-menu') { refreshMenu(); showScreen('menu'); }
        else if (act === 'quit') { G.quitToMenu(); }
      });
    });
    // 机库分页：主机 / 僚机（短促普通音效）
    document.querySelectorAll('.hangar-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        G.audio.uiTick();
        document.querySelectorAll('.hangar-tab').forEach(t => t.classList.toggle('selected', t === tab));
        $('pane-ship').classList.toggle('hidden', tab.dataset.tab !== 'ship');
        $('pane-drone').classList.toggle('hidden', tab.dataset.tab !== 'drone');
        if (tab.dataset.tab === 'drone') renderDrone();
      });
    });
    // 菜单选项光圈：点击按钮时滑动到该按钮位置
    const orbSelector = document.getElementById('orbSelector');
    const orbs = document.querySelectorAll('.menu-hero .orb');
    function moveSelectorTo (orb) {
      if (!orbSelector || !orb) return;
        const r = orb.getBoundingClientRect();
        const hr = orb.parentElement.getBoundingClientRect();
        orbSelector.style.left = (r.left + r.width / 2 - hr.left) + 'px';
        orbSelector.style.top = (r.top + r.height / 2 - hr.top) + 'px';
        orbSelector.style.width = (r.width + 8) + 'px';
        orbSelector.style.height = (r.height + 8) + 'px';
    }
    orbs.forEach(orb => {
      orb.addEventListener('pointerdown', () => moveSelectorTo(orb));
      orb.addEventListener('mouseenter', () => moveSelectorTo(orb));
    });
    // 初始定位到出击按钮
    setTimeout(() => {
      const main = document.querySelector('.orb-main');
      if (main) moveSelectorTo(main);
    }, 100);
    // 战机/僚机切换箭头：短促普通音效
    $('shipPrev').addEventListener('click', () => { G.audio.uiTick(); shipIndex = (shipIndex - 1 + shipIds().length) % shipIds().length; renderHangar(); });
    $('shipNext').addEventListener('click', () => { G.audio.uiTick(); shipIndex = (shipIndex + 1) % shipIds().length; renderHangar(); });
    $('shipSelect').addEventListener('click', selectShip);
    $('dronePrev').addEventListener('click', () => { G.audio.uiTick(); droneIndex = (droneIndex - 1 + droneIds().length) % droneIds().length; renderDrone(); });
    $('droneNext').addEventListener('click', () => { G.audio.uiTick(); droneIndex = (droneIndex + 1) % droneIds().length; renderDrone(); });
    $('droneSelect').addEventListener('click', selectDrone);
    $('upgradeList').addEventListener('click', (e) => {
      const b = e.target.closest('.u-buy');
      if (b && !b.disabled) buyUpgrade(b.dataset.id);
    });
    $('btnResume').addEventListener('click', () => G.resumeGame());
    // 暂停按钮：pointerdown + click 双绑定，任何输入路径都能暂停（pauseGame 仅在 playing 生效，重复触发无害）
    const pauseHit = (e) => { e.stopPropagation(); e.preventDefault(); G.pauseGame(); };
    $('btnPause').addEventListener('pointerdown', pauseHit);
    $('btnPause').addEventListener('click', pauseHit);
    $('btnRestart').addEventListener('click', () => G.startGame());
    $('btnAgain').addEventListener('click', () => G.startGame());
    $('btnNextStage').addEventListener('click', () => G.nextLevel());
    // 难度选择
    document.querySelectorAll('.diff-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const diff = btn.dataset.diff;
        G.save.get().settings.difficulty = diff;
        G.save.commit();
        document.querySelectorAll('.diff-btn').forEach(b => b.classList.toggle('selected', b === btn));
        $('diffDesc').textContent = G.DIFFICULTIES[diff].desc;
        // 各难度切换音效：困难搞怪 / 简单可爱 / 普通标准
        if (diff === 'hard') G.audio.hardMode();
        else if (diff === 'easy') G.audio.easyMode();
        else G.audio.uiClick();
      });
    });
    // 关卡选择：难度分段切换（与菜单难度联动，同步音效）
    document.querySelectorAll('#ssDiff .ss-diff-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const diff = btn.dataset.diff;
        if (diff === ssDiff) return;
        ssDiff = diff;
        G.save.get().settings.difficulty = diff;
        G.save.commit();
        document.querySelectorAll('.diff-btn').forEach(b => b.classList.toggle('selected', b.dataset.diff === diff));
        $('diffDesc').textContent = G.DIFFICULTIES[diff].desc;
        if (diff === 'hard') G.audio.hardMode();
        else if (diff === 'easy') G.audio.easyMode();
        else G.audio.uiClick();
        renderStageSelect();
      });
    });
    // 关卡选择：点击已解锁关卡，从该关开始新的一局
    $('ssGrid').addEventListener('click', (e) => {
      const cell = e.target.closest('.ss-cell');
      if (!cell || cell.disabled || !cell.dataset.lv) return;
      G.audio.uiStart();
      G.startAtStage(parseInt(cell.dataset.lv, 10) || 1);
    });
    $('setBgm').addEventListener('change', applySettings);
    $('setSfx').addEventListener('change', applySettings);
    $('setShake').addEventListener('change', applySettings);
    $('setStorage').addEventListener('change', applyStorageSetting);
    // 视角模式分段按钮
    document.querySelectorAll('#viewSeg .seg-btn').forEach(btn => {
      btn.addEventListener('click', () => applyViewMode(btn.dataset.view));
    });
    // 存档询问弹窗：保存 / 不保存
    $('btnStorageYes').addEventListener('click', () => {
      G.save.enableStorage();
      showScreen('menu');
      G.audio.uiSettings();
    });
    $('btnStorageNo').addEventListener('click', () => {
      G.save.disableStorage();
      showScreen('menu');
      G.audio.uiBack();
    });
    $('btnReset').addEventListener('click', () => {
      if (confirm('确定重置所有存档？')) { G.save.reset(); refreshMenu(); G.audio.applyVolumes(); }
    });
    // 触屏炸弹按钮
    const bomb = $('bombcount');
    bomb.style.pointerEvents = 'auto';
    bomb.addEventListener('pointerdown', (e) => { e.stopPropagation(); G.useBomb(); });
    refreshMenu();
  }

  return { init, showScreen, updateHUD, setWarning, buildHangar, showGameOver, showStageClear, askStorageIfNeeded, refreshMenu };
})();