/* =========================================================
 * save.js —— localStorage 存档（带隐私模式兜底）
 * ========================================================= */
window.G = window.G || {};

G.SAVE_KEY = 'stellarStrike.v1';

G.DEFAULT_SAVE = {
  coins: 0,
  highScore: 0,
  unlockedShips: ['assault'],
  currentShip: 'assault',
  unlockedDrones: [],      // 已购买僚机（初始不带，全靠金币解锁）
  currentDrone: null,      // 当前装备出战僚机（null = 不带）
  upgrades: { missile: 0, firepower: 0, armor: 0, ammo: 0, bomb: 0, magnet: 0, graze: 0, engine: 0 },
  settings: { bgm: true, sfx: true, shake: true, difficulty: 'normal', viewMode: 'standard' },
  stageUnlock: { easy: 1, normal: 1, hard: 1 },   // 各难度已解锁到的最高关（1=仅第1关）
  storageEnabled: null,     // 进度存档开关：null=尚未询问 / true=写入 localStorage / false=仅本机内存
  stats: { totalKills: 0, totalGraze: 0, bossKills: 0, cleared: false }
};

G.save = (function () {
  let data = null;

  function load () {
    let d = null;
    try {
      const raw = localStorage.getItem(G.SAVE_KEY);
      if (raw) d = JSON.parse(raw);
    } catch (e) { /* 隐私模式或损坏，忽略 */ }
    // 深合并默认值，防止字段缺失
    data = deepMerge(JSON.parse(JSON.stringify(G.DEFAULT_SAVE)), d || {});
    return data;
  }
  function deepMerge (base, src) {
    for (const k in src) {
      if (src[k] && typeof src[k] === 'object' && !Array.isArray(src[k])) {
        base[k] = deepMerge(base[k] || {}, src[k]);
      } else {
        base[k] = src[k];
      }
    }
    return base;
  }
  function commit () {
    // 用户选择不存档：仅保留内存，关闭页面后进度清零
    if (data && data.storageEnabled === false) return;
    try { localStorage.setItem(G.SAVE_KEY, JSON.stringify(data)); } catch (e) {}
  }
  /** 开启进度存档（写入 localStorage） */
  function enableStorage () {
    get().storageEnabled = true;
    commit();
  }
  /** 关闭进度存档（清除本地记录，此后仅内存） */
  function disableStorage () {
    get().storageEnabled = false;
    try { localStorage.removeItem(G.SAVE_KEY); } catch (e) {}
  }
  function reset () {
    data = JSON.parse(JSON.stringify(G.DEFAULT_SAVE));
    commit();
  }
  function get () { return data || (data = load()); }

  return { get, commit, reset, load, enableStorage, disableStorage };
})();

/** 计算某升级项当前所需费用 */
G.upgradeCost = function (id) {
  const u = G.UPGRADES[id];
  const lv = G.save.get().upgrades[id];
  return Math.round(u.base * Math.pow(u.mul, lv));
};