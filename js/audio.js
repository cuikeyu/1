/* =========================================================
 * audio.js —— Web Audio 程序化音效合成 + 音量总线
 * 说明：AudioContext 必须在首次用户手势后创建（自动播放策略）
 * ========================================================= */
window.G = window.G || {};

G.audio = (function () {
  let ctx = null;
  let master = null, sfxGain = null, bgmDuck = null;
  let busA = null, busB = null, busCur = null;   // BGM 双总线：切曲交叉隔离，旧曲尾音不会随淡入复活
  let ducked = false;                            // 当前压低状态（duck 总线统一管理）
  let bgmToken = 0;                              // 切曲令牌：消除快速切换的 setTimeout 竞态错曲
  let shootThrottle = 0;      // 射击音同帧节流
  let lastShootTime = 0;

  /** 初始化（首次点击“出击”时调用） */
  function init () {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    sfxGain = ctx.createGain();
    bgmDuck = ctx.createGain();      // 压低总线：开机/词库画面统一压低两路 BGM
    busA = ctx.createGain();         // 曲目总线 A/B：切曲时旧的淡出、新的淡入，互不叠加
    busB = ctx.createGain();
    sfxGain.connect(master);
    busA.connect(bgmDuck);
    busB.connect(bgmDuck);
    bgmDuck.connect(master);
    master.connect(ctx.destination);
    master.gain.value = 0.5;
    busCur = busA;
    applyVolumes();
  }

  function applyVolumes () {
    const s = G.save.get().settings;
    if (!sfxGain) return;
    sfxGain.gain.value = s.sfx ? 1 : 0;
    // BGM 压低总线：开关 × 压低态（平滑过渡，避免爆音）
    const target = s.bgm ? (ducked ? 0.3 : 1) : 0;
    const t = ctx.currentTime;
    bgmDuck.gain.cancelScheduledValues(t);
    bgmDuck.gain.setValueAtTime(bgmDuck.gain.value, t);
    bgmDuck.gain.linearRampToValueAtTime(target, t + 0.25);
    // BGM 开关联动：开→启动循环，关→停止
    if (s.bgm) startBgm(); else stopBgm();
  }

  /** 通用振荡器音（内部：支持绝对时间/自定义总线） */
  function oscAt (freq, dur, type, vol, when, slideTo, dest) {
    if (!ctx) return;
    const t0 = when === undefined ? ctx.currentTime : when;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type || 'square';
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(vol || 0.05, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g); g.connect(dest || sfxGain);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
  }

  /** 噪声爆破（内部：支持延迟/自定义总线/滤波器类型） */
  function noiseAt (dur, vol, filterStart, filterEnd, delay, dest, filterType) {
    if (!ctx) return;
    const t0 = ctx.currentTime + (delay || 0);
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const flt = ctx.createBiquadFilter();
    flt.type = filterType || 'lowpass';
    flt.frequency.setValueAtTime(filterStart, t0);
    flt.frequency.exponentialRampToValueAtTime(filterEnd, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol || 0.05, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(flt); flt.connect(g); g.connect(dest || sfxGain);
    src.start(t0);
  }

  /** 通用振荡器音（SFX 总线，受音效开关控制） */
  function tone (freq, dur, type, vol, delay, slideTo) {
    if (!ctx || !G.save.get().settings.sfx) return;
    oscAt(freq, dur, type, vol, ctx.currentTime + (delay || 0), slideTo, sfxGain);
  }

  /** 噪声爆破（SFX 总线，受音效开关控制） */
  function noiseBurst (dur, vol, filterStart, filterEnd, delay) {
    if (!ctx || !G.save.get().settings.sfx) return;
    noiseAt(dur, vol, filterStart, filterEnd, delay, sfxGain);
  }

  /* =========================================================
   * BGM：多曲目循环调度器（全部程序化合成，无任何外部音频素材）
   * 曲目：menu 雷霆序曲·静谧版（菜单页，动感收敛）
   *       cute 卡哇伊（简单：明亮跳音 + 俏皮啾啾 + 铃铛）
   *       heal 暖阳流动·活泼版（普通：宫调五声音调不变，节奏加快 + 弹性小鼓 + 轻 hat）
   *       storm 夜行律动·活泼版（困难：快节奏规律鼓 + 埙 + 小二度摩擦，无 hat 无刺音律动）
   * ========================================================= */
  const TRACKS = {
    menu: {   // 雷霆序曲·静谧版：氛围远雷 + 稀疏琶音 + 深沉铺底，动感收敛
      stepDur: 0.30,                                   // ~100BPM 八分音符
      kick: [0], kickWave: 'sine', kickVol: 0.24, kickFrom: 100, kickTo: 38,
      snare: [], hat: [0.016],
      bass: [55, 0, 0, 0, 49, 0, 0, 0], bassWave: 'sine', bassVol: 0.14,
      lead: [440, 0, 0, 523.25, 0, 0, 659.25, 0], leadWave: 'sine', leadVol: 0.04,
      pad: [110, 164.81, 220], thunder: 0.2            // A 小三和弦氛围铺底
    },
    cute: {   // 卡哇伊：明亮大调跳音琶音 + 俏皮啾啾 + 铃铛，弱化鼓点
      stepDur: 0.23,
      kick: [0, 4], kickWave: 'sine', kickVol: 0.15, kickFrom: 320, kickTo: 90,
      snare: [], hat: [0.022, 0.038],
      bass: [65.41, 0, 82.41, 0, 65.41, 0, 98, 0], bassWave: 'triangle', bassVol: 0.09,
      lead: [523.25, 659.25, 783.99, 880, 783.99, 659.25, 587.33, 783.99], leadWave: 'triangle', leadVol: 0.06,
      chirp: 0.45, bell: 0.32, thunder: 0               // 啾啾：高频上滑小咕啾
    },
    heal: {   // 普通·暖阳流动（活泼版）：音调不变（宫调五声），节奏加快 + 弹性小鼓 + 轻 hat
      stepDur: 0.30,                                   // ~100BPM 八分音符，轻快流动
      kick: [0, 4], kickWave: 'sine', kickVol: 0.14, kickFrom: 300, kickTo: 85,   // 弹性小鼓两点点缀
      snare: [], hat: [0.018, 0.03],                   // 轻 closed hat，增加活泼呼吸感
      bass: [65.41, 0, 73.42, 0, 65.41, 0, 73.42, 0], bassWave: 'triangle', bassVol: 0.1,   // C2→D2 律动铺底（音调不变）
      lead: [392, 440, 523.25, 587.33, 523.25, 440, 392, 0], leadWave: 'triangle', leadVol: 0.05,  // 五声上行分解（音调不变）
      drop: 0.25,                                      // 山涧水滴（稀疏透明）
      qing: 0.3,                                       // 古磬：金属泛音编钟
      pad: [130.81, 196, 261.63], thunder: 0           // C3-G3-C4 宫调空五度（不变）
    },
    storm: {  // 困难·深渊华尔兹（高质量版）：D 小调多段体，旋律大起伏 + 半音下行 bassline + 弦乐 pad + 延迟太空音
      stepDur: 0.24,                                   // ~125BPM 八分音符，律动清晰
      kick: [0, 4], kickWave: 'sine', kickVol: 0.16, kickFrom: 160, kickTo: 52,   // 深鼓两点支点
      snare: [], hat: [],                              // 无 hat，杜绝嘀嘀律动
      bass: [73.42, 0, 69.3, 0, 65.41, 0, 61.74, 0], bassWave: 'sawtooth', bassVol: 0.12,  // D→C#→C→B 半音下行 bassline（紧张推进）
      lead: [0, 440, 0, 523.25, 0, 0, 587.33, 0], leadWave: 'sine', leadVol: 0.05,           // A4→C5→D5 主旋律长音起伏
      leadEcho: true,                                  // 主旋律延迟回声（太空纵深感）
      strings: [0, 293.66, 0, 349.23, 0, 392, 0, 0],   // 弦乐副线：D4-F4-G4 对位填充
      arp: [0, 880, 1046.5, 0, 987.77, 0, 0, 880],     // 上行琶音点缀（A5-B5-C#6 三角波亮色）
      stab: 0,                                         // 无规律刺音
      whisper: 0.08,                                   // 耳语极稀疏点缀
      xun: 0.3,                                        // 埙：低沉气声吹管（困难标志音色）
      pad: [146.83, 174.61, 220, 261.63],   // D3-F3-A3-C4 小调和弦（默认级）
      // 四和弦循环起伏（Dm → Bb → F → C）：小调悬疑 → 开阔 → 明亮收束，避免单和弦疲劳
      padSeq: [
        [146.83, 174.61, 220, 261.63],      // Dm  (D3-F3-A3-C4)
        [116.54, 146.83, 174.61, 233.08],   // Bb  (Bb2-D3-F3-Bb3)
        [174.61, 220, 261.63, 349.23],      // F   (F3-A3-C4-F4)
        [130.81, 164.81, 196, 261.63]       // C   (C3-E3-G3-C4) 收束亮起
      ],
      thunder: 0.04
    }
  };
  let curTrack = 'menu';
  let bgmTimer = null;
  let bgmStep = 0;
  let bgmNextTime = 0;

  function bgmOn () { return ctx && G.save.get().settings.bgm; }

  function bgmKick (when, T) {
    oscAt(T.kickFrom, 0.14, T.kickWave, T.kickVol, when, T.kickTo, busCur);
    if (T.heartbeat) oscAt(T.kickFrom, 0.12, T.kickWave, T.kickVol * 0.7, when + 0.16, T.kickTo, busCur);  // 双连心跳
  }
  function bgmSnare (when) {
    noiseAt(0.12, 0.2, 2400, 700, 0, busCur);
    oscAt(180, 0.07, 'triangle', 0.14, when, 120, busCur);
  }
  function bgmHat (when, T, s) {
    if (!T.hat || !T.hat.length) return;   // 无 hat 配置的曲目（如流水通透）跳过
    noiseAt(0.03, s % 2 === 1 ? T.hat[1] : T.hat[0], 9000, 5000, 0, busCur);
  }
  function bgmBassNote (f, when, T) {
    oscAt(f, 0.19, T.bassWave, T.bassVol, when, f * 0.98, busCur);
    oscAt(f / 2, 0.2, 'sine', T.bassVol * 0.8, when, undefined, busCur);
  }
  function bgmLeadNote (f, when, T) {
    oscAt(f, 0.15, T.leadWave, T.leadVol, when, undefined, busCur);
    oscAt(f * 2, 0.1, 'sine', T.leadVol * 0.4, when, undefined, busCur);
    // 延迟回声（太空纵深感）：主音后 0.27s 以 45% 音量复现一次
    if (T.leadEcho) oscAt(f, 0.15, T.leadWave, T.leadVol * 0.45, when + 0.27, undefined, busCur);
  }
  function bgmStrings (f, when) {  // 弦乐副线：柔倍亮合唱音色（柔和长音填充）
    oscAt(f, 0.34, 'sine', 0.028, when, undefined, busCur);
    oscAt(f * 1.5, 0.3, 'sine', 0.012, when, undefined, busCur);   // 纯律五度叠加，厚实温暖
  }
  function bgmArp (f, when) {      // 上行琶音点缀：三角波亮色短音（增加高频光泽）
    oscAt(f, 0.16, 'triangle', 0.02, when, undefined, busCur);
  }
  function bgmBell (when) {   // 可爱风铃铛音
    oscAt(1046.5, 0.12, 'sine', 0.045, when, undefined, busCur);
    oscAt(1568, 0.09, 'sine', 0.025, when, undefined, busCur);
  }
  let bgmPadPhase = 0;   // pad 和弦序列相位（每 8 步推进一级，实现和声起伏）
  function bgmPad (when, T) {   // 铺底和弦（每循环一次；支持 padSeq 多和弦起伏）
    const chords = T.padSeq || (T.pad ? [T.pad] : []);
    if (!chords.length) return;
    const chord = chords[bgmPadPhase % chords.length];
    bgmPadPhase++;
    for (const f of chord) oscAt(f, T.stepDur * 8 * 0.95, 'sine', 0.05, when, undefined, busCur);
  }
  function bgmThunder (when) {
    // 远处雷鸣：长噪声低通下滑 + 超低正弦轰鸣
    noiseAt(1.0, 0.32, 420, 40, 0, busCur);
    oscAt(42, 0.9, 'sine', 0.26, when, 28, busCur);
    oscAt(63, 0.5, 'triangle', 0.08, when, 40, busCur);
  }
  function bgmChirp (when) {   // 卡哇伊啾啾：高频正弦快速上滑 + 微噪声
    oscAt(1100, 0.05, 'sine', 0.035, when, 1900, busCur);
    noiseAt(0.03, 0.02, 6000, 8000, 0, busCur, 'highpass');
  }
  function bgmDrop (when) {    // 水滴：高频正弦快速下滑（透明水感）
    oscAt(1750, 0.09, 'sine', 0.05, when, 720, busCur);
    oscAt(2600, 0.05, 'sine', 0.02, when, 1500, busCur);
  }
  function bgmQing (when) {    // 古磬：金属泛音结构（基音 + 非和谐泛音 + 高五度 + 顶泛音）
    oscAt(220, 0.9, 'sine', 0.05, when, undefined, busCur);
    oscAt(329.63, 0.7, 'sine', 0.028, when, undefined, busCur);
    oscAt(554.37, 0.5, 'sine', 0.02, when, undefined, busCur);
    oscAt(880, 0.35, 'sine', 0.012, when, undefined, busCur);
  }
  function bgmXun (when) {     // 埙：低沉气声吹管（基音微上滑 + 五度叠音 + 带通气声）
    oscAt(98, 1.3, 'sine', 0.055, when, 104, busCur);
    oscAt(146.83, 1.1, 'sine', 0.022, when, undefined, busCur);
    noiseAt(0.5, 0.014, 380, 800, 0, busCur, 'bandpass');
  }
  function bgmStab (when) {    // 恐怖刺音：不协和双锯齿短促爆发
    oscAt(1380, 0.07, 'sawtooth', 0.04, when, undefined, busCur);
    oscAt(1462, 0.07, 'sawtooth', 0.04, when, undefined, busCur);   // ~40 音分失谐
  }
  function bgmWhisper (when) { // 耳语：带通噪声涌动（像贴耳低语）
    noiseAt(0.4, 0.045, 700, 2400, 0, busCur, 'bandpass');
  }

  function bgmPlayStep (s, when) {
    if (!bgmOn()) return;
    const T = TRACKS[curTrack] || TRACKS.menu;
    if (T.kick.includes(s)) bgmKick(when, T);
    if (T.snare.includes(s)) bgmSnare(when);
    bgmHat(when, T, s);
    const bf = T.bass[s]; if (bf) bgmBassNote(bf, when, T);
    const lf = T.lead[s]; if (lf) bgmLeadNote(lf, when, T);
    if (T.strings) { const sf = T.strings[s]; if (sf) bgmStrings(sf, when); }   // 弦乐副线（困难曲目）
    if (T.arp) { const af = T.arp[s]; if (af) bgmArp(af, when); }               // 琶音点缀（困难曲目）
    if (T.pad && s === 0) bgmPad(when, T);
    if (T.bell && s % 2 === 1 && Math.random() < T.bell) bgmBell(when);
    if (T.chirp && s % 2 === 0 && Math.random() < T.chirp) bgmChirp(when);
    if (T.drop && Math.random() < T.drop) bgmDrop(when);
    if (T.qing && s % 4 === 0 && Math.random() < T.qing) bgmQing(when);
    if (T.xun && s % 4 === 0 && Math.random() < T.xun) bgmXun(when);
    if (T.stab && s % 4 === 2 && Math.random() < T.stab) bgmStab(when);
    if (T.whisper && s === 0 && Math.random() < T.whisper) bgmWhisper(when);
    if (T.thunder && s === 0 && Math.random() < T.thunder) bgmThunder(when);
  }

  function bgmSchedule () {
    if (!ctx) return;
    const T = TRACKS[curTrack] || TRACKS.menu;
    // lookahead 调度：提前 0.12s 排布音符，避免 setInterval 抖动
    while (bgmNextTime < ctx.currentTime + 0.12) {
      bgmPlayStep(bgmStep, bgmNextTime);
      bgmNextTime += T.stepDur;
      bgmStep = (bgmStep + 1) % 8;
    }
  }

  function startBgm (track) {
    if (!ctx || bgmTimer || !G.save.get().settings.bgm) return;
    if (track && TRACKS[track]) curTrack = track;
    bgmStep = 0;
    bgmNextTime = ctx.currentTime + 0.06;
    bgmTimer = setInterval(bgmSchedule, 25);
  }

  function stopBgm () {
    if (bgmTimer) { clearInterval(bgmTimer); bgmTimer = null; }
  }

  /** 切换 BGM 曲目（双总线交叉淡切：旧曲独占总线淡出，新曲在另一总线淡入，杜绝双曲叠加） */
  function setBgmTrack (name) {
    if (!TRACKS[name] || name === curTrack) return;
    // 未在播放（BGM 关或未初始化）：直接切换，下次启动生效
    if (!ctx || !bgmTimer) { curTrack = name; return; }
    const token = ++bgmToken;
    const old = busCur;                    // 旧曲所在总线（淡出）
    const next = (old === busA) ? busB : busA;   // 新曲总线（淡入），物理隔离
    busCur = next;
    curTrack = name;
    bgmStep = 0;                           // 新曲目从头进拍，衔接更自然
    bgmPadPhase = 0;                       // 和弦序列从头推进，每次切曲起伏结构一致
    const t0 = ctx.currentTime;
    // 旧总线：0.4s 淡出至静音（其上的长尾音随之衰减消失，不会与下一曲叠加）
    old.gain.cancelScheduledValues(t0);
    old.gain.setValueAtTime(old.gain.value, t0);
    old.gain.linearRampToValueAtTime(0.0001, t0 + 0.4);
    // 新总线：0.55s 淡入（在飞的新音符从零渐起）
    next.gain.cancelScheduledValues(t0);
    next.gain.setValueAtTime(0.0001, t0);
    next.gain.linearRampToValueAtTime(1, t0 + 0.55);
    // 守卫：若在淡出途中又切曲，丢弃本次收尾令牌，避免旧总线被错误复位的叠加
    setTimeout(() => {
      if (!ctx || bgmToken !== token) return;
      try { old.gain.cancelScheduledValues(ctx.currentTime); old.gain.value = 0; } catch (e) {}
    }, 500);
  }

  const api = {
    init,
    applyVolumes,
    startBgm,
    stopBgm,
    setBgmTrack,
    /** 诗抄机展开魔法书：上行三音风铃 */
    poetCast () {
      tone(523.25, 0.12, 'sine', 0.07, 0);
      tone(659.25, 0.12, 'sine', 0.07, 0.07);
      tone(783.99, 0.18, 'sine', 0.08, 0.14);
    },
    /** 逐字发射的轻小声符（低音量避免烦躁） */
    spell () {
      tone(880 + Math.random() * 120, 0.05, 'sine', 0.035, 0);
    },
    /** 开机引擎点火：蓄压 → 主引擎 → 加速呼啸 → 云层突破 → 入轨清音
     *  尾部落 A 音（与菜单雷霆 BGM 同根音），随后菜单 BGM 从下拍自然进入 */
    bootSound () {
      // 1. 点火前蓄压：低沉电流嗡鸣渐升
      tone(60, 0.4, 'sawtooth', 0.20, 0, 58);
      noiseBurst(0.3, 0.12, 300, 900);
      // 2. 主引擎点火：轰鸣 + 上冲滑音
      noiseBurst(0.5, 0.48, 700, 90);
      tone(48, 0.7, 'sine', 0.38, 0.1, 110);
      // 3. 加速升空：气流呼啸 + 上升音阶（承接点火）
      noiseBurst(0.65, 0.28, 220, 3000, 0.28);
      tone(196, 0.6, 'triangle', 0.12, 0.3, 587.33);
      // 4. 云层突破冲击
      noiseBurst(0.28, 0.42, 5000, 400, 0.72);
      // 5. 入轨清音：上行三音收在 A4（440），与菜单 BGM 根音同音高，衔接无落差
      tone(659.25, 0.14, 'sine', 0.11, 0.78);
      tone(880, 0.16, 'sine', 0.10, 0.9);
      tone(440, 0.34, 'sine', 0.09, 1.02);
    },
    /** BGM 压低（开机动画期间/最终关词汇表画面用，返回菜单或开局时恢复；duck 总线统一管理两路 BGM） */
    setBgmDuck (duck) {
      if (!bgmDuck) return;
      ducked = !!duck;
      const s = G.save.get().settings;
      const target = s.bgm ? (ducked ? 0.3 : 1) : 0;
      const t = ctx.currentTime;
      bgmDuck.gain.cancelScheduledValues(t);
      bgmDuck.gain.setValueAtTime(bgmDuck.gain.value, t);
      bgmDuck.gain.linearRampToValueAtTime(target, t + 0.25);
    },
    shoot () {
      const now = performance.now();
      if (now - lastShootTime < 45) return;   // 节流
      lastShootTime = now;
      // 空灵短小：高频三角波轻点 + 气泡滑音
      tone(1320, 0.05, 'triangle', 0.028, 0, 1980);
      tone(660, 0.04, 'sine', 0.014, 0.01, 990);
    },
    launch () {
      // 整体压在 ~1.1s 内收尾：点火轰鸣 → 爬升呼啸 → 入轨清远短音
      // （旧版 2.3s/2.6s 的延迟音会拖到菜单出现后才响，已修正）
      noiseBurst(0.8, 0.42, 500, 60);
      tone(55, 0.9, 'sawtooth', 0.24, 0, 90);
      tone(110, 0.8, 'sine', 0.15, 0.1, 160);
      // 中段爬升呼啸
      noiseBurst(0.7, 0.22, 300, 2400);
      tone(220, 0.8, 'triangle', 0.09, 0.3, 880);
      // 入轨清远提示音（短促，不再延迟到菜单）
      tone(880, 0.18, 'sine', 0.07, 0.6);
      tone(1320, 0.25, 'sine', 0.06, 0.78);
    },
    explode () { noiseBurst(0.3, 0.35, 1200, 100); },
    bossExplode () { noiseBurst(0.8, 0.4, 1200, 80); tone(80, 0.6, 'sine', 0.2, 0.05, 40); },
    hit () { noiseBurst(0.1, 0.3, 2000, 300); tone(220, 0.12, 'square', 0.15); },
    death () { noiseBurst(0.7, 0.45, 1600, 60); tone(320, 0.8, 'sawtooth', 0.22, 0, 40); tone(160, 0.9, 'sine', 0.25, 0.05, 30); },
    pickup () { tone(660, 0.06, 'sine', 0.1); tone(880, 0.06, 'sine', 0.1, 0.06); tone(1320, 0.08, 'sine', 0.1, 0.12); },
    graze () { tone(2000, 0.03, 'sine', 0.06); },
    bomb () { tone(200, 0.6, 'sine', 0.25, 0, 40); noiseBurst(0.6, 0.3, 2000, 100); },
    warn () { for (let i = 0; i < 3; i++) { tone(440, 0.12, 'square', 0.12, i * 0.2); tone(554, 0.12, 'square', 0.12, i * 0.2 + 0.1); } },
    powerup () { tone(1200, 0.08, 'triangle', 0.12, 0, 2000); },
    buy () { tone(800, 0.06, 'sine', 0.12); tone(1200, 0.06, 'sine', 0.12, 0.05); },
    /** 剪辑软件风抽象 UI 音效：短促电子 whoosh + 高频光点（通用/难度切换） */
    uiClick () {
      tone(420, 0.08, 'sine', 0.08, 0, 880);
      noiseBurst(0.06, 0.12, 6000, 3000);
      tone(2100, 0.04, 'triangle', 0.05, 0.04);
    },
    /** 普通短促音效：机库切换箭头 / 主机僚机分页Tab（35ms 轻点，不喧宾夺主） */
    uiTick () {
      tone(520, 0.035, 'sine', 0.06, 0, 760);
      noiseBurst(0.03, 0.06, 5000, 2600);
    },
    /** 机库：液压伺服 + 舱门开启的机械感 */
    uiHangar () {
      noiseBurst(0.22, 0.16, 900, 260);
      tone(180, 0.16, 'sawtooth', 0.1, 0, 320);
      tone(520, 0.07, 'triangle', 0.09, 0.14);
      tone(780, 0.09, 'triangle', 0.07, 0.22);
    },
    /** 设置：数字化双点滴答，像拨动开关 */
    uiSettings () {
      tone(980, 0.045, 'square', 0.06);
      tone(1320, 0.055, 'square', 0.06, 0.07);
      tone(660, 0.05, 'sine', 0.05, 0.14);
    },
    /** 出击：双音上行号角 + 气流冲刺 + 点火确认（重制版） */
    uiStart () {
      tone(392, 0.12, 'triangle', 0.12);
      tone(523, 0.14, 'triangle', 0.12, 0.1);
      noiseBurst(0.3, 0.18, 500, 3800);
      tone(1046, 0.16, 'sine', 0.1, 0.26);
      tone(1568, 0.2, 'triangle', 0.07, 0.34);
    },
    /** 简单模式：可爱风弹跳木琴 + 星光闪烁 */
    easyMode () {
      tone(659, 0.09, 'triangle', 0.1);
      tone(880, 0.1, 'triangle', 0.1, 0.09);
      tone(1319, 0.12, 'sine', 0.07, 0.18);
      tone(1760, 0.16, 'sine', 0.05, 0.27);
      noiseBurst(0.1, 0.05, 7000, 9000);
    },
    /** 返回：下行轻柔短音 */
    uiBack () {
      tone(620, 0.09, 'sine', 0.07, 0, 300);
      tone(300, 0.07, 'sine', 0.05, 0.06);
    },
    /** 困难模式搞怪音效：滑稽下滑鸭子叫 + 弹簧 boing，一听就想笑 */
    hardMode () {
      tone(520, 0.12, 'sawtooth', 0.18, 0, 140);
      tone(380, 0.1, 'square', 0.12, 0.08, 200);
      tone(160, 0.18, 'sine', 0.14, 0.18, 90);
      noiseBurst(0.08, 0.2, 800, 1200);
      tone(700, 0.06, 'triangle', 0.08, 0.05, 500);
    }
  };
  return api;
})();