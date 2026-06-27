/* =====================================================================
   main.js – INIT + ÖSSZEKÖTÉS + JÁTÉK-LOOP + MENTÉS-CIKLUS
   ---------------------------------------------------------------------
   Itt fut össze minden: betöltés (offline-számítással), a felület
   bekötése a State akciókhoz, a másodperces game-loop, és az autosave.
   ===================================================================== */

(function () {
  'use strict';

  const State = Game.State;
  const UI    = Game.UI;
  const Plat  = Game.Platform;
  const $     = id => document.getElementById(id);
  const sfx   = n => { if (Game.Sound) Game.Sound.play(n); };

  let lastTick   = Date.now();
  let wasReady   = false;  // a műszak "kész" átmenetének észleléséhez
  let dailyShown = false;

  /* =========================== INDÍTÁS =========================== */
  function boot() {
    Plat.init();
    UI.init();

    // Betöltés + offline-haladás kiszámítása
    const { firstTime, away } = State.load();

    // Kezdő nézet + első kirajzolás
    UI.switchView('city');
    UI.renderAll();

    if (firstTime) {
      // Első indítás: előbb a kezdő menü (név + avatar); a játék a Start után indul.
      UI.showStartMenu();
    } else {
      UI.log('Loaded your save.', '');
    }

    // Visszatéréskor: Welcome-back panel az offline-jövedelemmel
    if (away) {
      UI.showWelcomeBack(away);
      UI.log('While away you earned <b>' + UI.fmtMoney(away.total) + '</b>', 'good');
    }

    wireEvents();
    startLoop();
    startAutosave();
  }

  /* =========================== ESEMÉNYEK =========================== */
  function wireEvents() {
    // Bal menü
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => { sfx('click'); UI.switchView(btn.dataset.view); });
    });

    // Hang feloldása/újraélesztése MINDEN gesztusnál. (iOS a háttérbe tételkor
    // felfüggeszti az AudioContextet, ezért nem elég egyszer feloldani — a
    // CrazyGames doksi is touchend/click gesztusban kéri a resume()-ot.)
    const resumeAudio = () => { if (Game.Sound) Game.Sound.unlock(); };
    document.addEventListener('pointerdown', resumeAudio);
    document.addEventListener('touchend',    resumeAudio);
    document.addEventListener('keydown',     resumeAudio);

    // Akciósáv (delegálva, mert dinamikusan épül)
    $('action-bar').addEventListener('click', e => {
      const b = e.target.closest('.act');
      if (!b) return;
      handleAction(b.dataset.act);
    });

    // Központi panel: Career-munkák és Settings avatar-választó (delegálva a #stage-en)
    $('stage').addEventListener('click', e => {
      const job = e.target.closest('.job-card');
      if (job) { startJobFromCard(job.dataset.job); return; }
      const av = e.target.closest('.av-pick');
      if (av)  { pickAvatar(parseInt(av.dataset.av, 10)); return; }
      const sh = e.target.closest('.shop-item');
      if (sh) { buyShop(sh.dataset.shop); return; }
      const fr = e.target.closest('.friend-card');
      if (fr) { doHangOut(fr.dataset.friend); return; }
      const bk = e.target.closest('[data-bank]');
      if (bk) { if (bk.dataset.bank === 'collect') bankCollect(); else if (bk.dataset.bank === 'speedup') bankSpeedup(); return; }
      const pl = e.target.closest('[data-plan]');
      if (pl) { depositPlan(pl.dataset.plan); return; }
      const stk = e.target.closest('[data-stake]');
      if (stk) { UI.setStake(parseFloat(stk.dataset.stake)); return; }
      const li = e.target.closest('[data-loanid]');
      if (li) { borrow(li.dataset.loanid); return; }
      const lr = e.target.closest('[data-loan]');
      if (lr && lr.dataset.loan === 'repay') { repayLoanAct(); return; }
      const hm = e.target.closest('[data-home]');
      if (hm) { buyHomeAct(hm.dataset.home); return; }
      const tg = e.target.closest('[data-trip-go]');
      if (tg) { startTripAct(tg.dataset.tripGo); return; }
      const tp = e.target.closest('[data-trip]');
      if (tp) { if (tp.dataset.trip === 'collect') tripCollect(); else if (tp.dataset.trip === 'speedup') tripSpeedup(); return; }
      const pa = e.target.closest('[data-act-panel]');
      if (pa) {
        if (pa.dataset.actPanel === 'reset') resetSave();
        else if (pa.dataset.actPanel === 'sound') toggleSound();
        return;
      }
    });

    // Műszak indítása
    $('btn-start-shift').addEventListener('click', doStartShift);

    // Rewarded HORog #1 – Speed up (azonnali befejezés reklámért)
    $('btn-speedup').addEventListener('click', () => {
      Plat.showRewardedAd(() => {
        State.speedUpShift();
        UI.update();
        sfx('success');
        UI.log('Shift sped up with an ad ⚡', 'good');
      });
    });

    // Begyűjtés / Begyűjtés ×2 (Rewarded HORog #2)
    $('btn-collect').addEventListener('click', () => collectShift(false));
    $('btn-collect2').addEventListener('click', () => {
      Plat.showRewardedAd(() => collectShift(true));
    });

    // Next goal megvásárlása
    $('btn-buy-goal').addEventListener('click', buyGoal);

    // Daily reward
    $('btn-daily').addEventListener('click', claimDaily);

    // Kezdő menü: avatar-választás + Start
    document.getElementById('start-avatars').addEventListener('click', e => {
      const a = e.target.closest('.av-pick');
      if (a) UI.setStartAvatar(parseInt(a.dataset.av, 10));
    });
    $('btn-start-game').addEventListener('click', startNewGame);
    $('start-name').addEventListener('keydown', e => { if (e.key === 'Enter') startNewGame(); });
    $('btn-tutorial-ok').addEventListener('click', () => { sfx('click'); hideTutorial(); });

    // HUD bal-felső (karakter) → Character oldal
    $('hud-left').addEventListener('click', () => UI.switchView('character'));

    // Welcome-back: Collect + Double (Rewarded HORog #3)
    $('btn-wb-collect').addEventListener('click', () => {
      sfx('coin'); UI.pulseMoney();
      UI.hideWelcomeBack();
      State.save();
    });
    $('btn-wb-double').addEventListener('click', () => {
      const away = UI.getAway();
      if (!away) return;
      $('btn-wb-double').disabled = true;
      const extra = away.total; // a jelenleg mutatott összeggel egyenlő extra
      Plat.showRewardedAd(() => {
        State.grantMoney(extra);   // a hiányzó másik felét írjuk jóvá
        UI.setAwayDoubled();        // a kijelzett összeg megduplázódik
        UI.update();
        sfx('coin'); UI.pulseMoney();
        UI.log('Doubled offline earnings: <b>+' + UI.fmtMoney(extra) + '</b>', 'good');
        UI.floatPoint('+' + UI.fmtMoney(extra), true);
      });
    });

    // Mentés, ha a fül háttérbe kerül / az oldal bezárul
    document.addEventListener('visibilitychange', () => { if (document.hidden) State.save(); });
    window.addEventListener('beforeunload', () => State.save());
    window.addEventListener('pagehide',     () => State.save());
  }

  /* ---- akciósáv-gombok ---- */
  function handleAction(act) {
    sfx('click');
    switch (act) {
      case 'work':         doStartShift(); break;
      case 'rest':         doRest();       break;
      case 'eat':          doEat();        break;
      case 'study':        doStudy();      break;
      case 'go-city':      UI.switchView('city');     break;
      case 'go-shop':      UI.switchView('shop');     break;
      case 'go-friends':   UI.switchView('friends');  break;
      case 'go-settings':  UI.switchView('settings'); break;
      case 'go-bank':      UI.switchView('bank');     break;
      case 'go-housing':   UI.switchView('housing');  break;
      case 'soon':         UI.toast('Coming in the next step ✨'); break;
    }
  }

  /* =========================== AKCIÓK =========================== */
  function doStartShift() {
    if (State.get().work.active) {
      UI.toast('A shift is already running ⏱️');
      if (UI.currentView() !== 'city') UI.switchView('city');
      return;
    }
    State.startShift();
    UI.update();
    UI.log('Started a work shift (' + Math.round(State.CFG.SHIFT_MS / 1000) + 's)', '');
    UI.toast('Shift started — watch the timer ⏱️');
  }

  function collectShift(doubled) {
    const pay = State.collectShift(doubled);
    if (!pay) return;
    UI.update();
    sfx('coin'); UI.pulseMoney();
    UI.floatPoint('+' + UI.fmtMoney(pay), true);
    UI.log('Collected shift pay <b>+' + UI.fmtMoney(pay) + '</b>' + (doubled ? ' (×2)' : '') + ' · −energy', 'good');
    UI.toast('Nice work! +' + UI.fmtMoney(pay));
    wasReady = false;
    State.save();
  }

  function doRest() {
    State.rest();
    UI.update();
    UI.floatPoint('+energy', true);
    UI.log('Rested at home — <b>energy restored</b>', 'good');
    UI.toast('Energy restored 😴');
  }

  function doEat() {
    if (!State.eat()) { UI.toast('Not enough cash to eat 🍽️'); return; }
    UI.update();
    UI.floatPoint('+food', true);
    UI.log('Ate a meal — <b>hunger restored</b> (−' + UI.fmtMoney(State.CFG.EAT_COST) + ')', 'good');
    UI.toast('Yum! Hunger restored 🍔');
    State.save();
  }

  function doStudy() {
    const r = State.study();
    if (!r) { UI.toast('Too tired to study — rest first 😴'); return; }
    UI.update();
    if (r.leveled) {
      sfx('levelup');
      UI.floatPoint('🎓 ' + State.eduName(), true);
      UI.log('Graduated to <b>' + State.eduName() + '</b> — new careers unlocked!', 'good');
      UI.toast('🎓 Education up: ' + State.eduName() + '!');
    } else {
      UI.floatPoint('+XP', true);
      UI.log('Studied at home — <b>+' + State.CFG.STUDY_XP + ' XP</b> · education progress', 'good');
      UI.toast('Studied! 📚 Keep going to graduate.');
    }
    State.save();
  }

  // Career: munka indítása a panel-kártyáról
  function startJobFromCard(id) {
    const job = State.jobById(id);
    if (State.get().work.active) { UI.toast('Finish your current shift first ⏱️'); return; }
    const reason = State.jobLockReason(job);
    if (reason) { UI.toast('🔒 ' + job.name + ' — ' + reason); return; }
    State.selectJob(id);
    State.startShift(id);
    UI.update();
    UI.rerenderPanel();
    UI.log('Started job: <b>' + job.name + '</b>', '');
    UI.toast('Shift started: ' + job.name + ' ⏱️');
  }

  // Settings: avatar kiválasztása
  function pickAvatar(i) {
    State.setAvatar(i);
    UI.update();
    UI.rerenderPanel();
    UI.toast('Avatar updated 🙂');
    State.save();
  }

  function resetSave() {
    localStorage.removeItem('varosi_elet_save_v1');
    location.reload();
  }

  // A kezdő menü "Start" gombja: név + avatar rögzítése, majd a játék indul
  function startNewGame() {
    State.setName($('start-name').value);
    State.setAvatar(UI.getStartAvatar());
    UI.hideStartMenu();
    UI.update();
    UI.log('Welcome, <b>' + State.get().name + '</b>!', 'good');
    UI.toast('Welcome to Grushflow 👋');
    State.startShift();
    UI.log('Your first shift started — come back to collect!', 'good');
    State.save();
    if (!State.get().settings.tutorialSeen) showTutorial();
  }
  function showTutorial() { $('tutorial').classList.remove('hidden'); }
  function hideTutorial() {
    $('tutorial').classList.add('hidden');
    State.get().settings.tutorialSeen = true;
    State.save();
  }

  function toggleSound() {
    const st = State.get();
    st.settings.sound = !st.settings.sound;
    UI.rerenderPanel();
    State.save();
  }

  // Shop: tárgy vásárlása
  function buyShop(id) {
    const it = State.shopById(id);
    if (!it) return;
    if (State.get().shopOwned.includes(it.id)) { UI.toast('Already owned ✓'); return; }
    if (State.get().money < it.price)          { sfx('error'); UI.toast('Not enough cash 💸'); return; }
    State.buyShopItem(id);
    UI.update();
    UI.rerenderPanel();
    sfx('coin'); UI.pulseMoney();
    UI.floatPoint('−' + UI.fmtMoney(it.price), false);
    UI.log('Bought <b>' + it.name + '</b> in the Shop', 'good');
    UI.toast('Purchased: ' + it.name + ' 🛍️');
    State.save();
  }

  // Friends: hang out egy baráttal (cooldown + energia-feltétel)
  function doHangOut(id) {
    const r = State.hangOut(id);
    if (r === 'cooldown') { UI.toast('Still recharging — come back later ⏳'); return; }
    if (r === 'energy')   { UI.toast('Too tired to hang out — rest first 😴'); return; }
    if (!r) return;
    UI.update();
    UI.rerenderPanel();
    UI.floatPoint('+' + r.happy + '😊', true);
    UI.log('Hung out with <b>' + r.name + '</b> · +' + r.happy + ' happiness, +' + r.xp + ' XP', 'good');
    UI.toast('Great time with ' + r.name + '! 😊');
    State.save();
  }

  // Bank: betét indítása a választott aránnyal
  function depositPlan(planId) {
    const amount = Math.floor(State.get().money * UI.getStake());
    const d = State.startDeposit(planId, amount);
    if (!d) { UI.toast('Need at least $50 to deposit 🏦'); return; }
    UI.update();
    UI.rerenderPanel();
    UI.log('Deposited <b>' + UI.fmtMoney(amount) + '</b> · matures to ' + UI.fmtMoney(State.depositReturn()), '');
    UI.toast('Deposit locked in 🏦');
    State.save();
  }
  function bankCollect() {
    const pay = State.collectDeposit();
    if (!pay) return;
    UI.update();
    UI.rerenderPanel();
    sfx('coin'); UI.pulseMoney();
    UI.floatPoint('+' + UI.fmtMoney(pay), true);
    UI.log('Savings matured <b>+' + UI.fmtMoney(pay) + '</b>', 'good');
    UI.toast('Savings matured! +' + UI.fmtMoney(pay));
    State.save();
  }
  function bankSpeedup() {
    Plat.showRewardedAd(() => {
      State.speedUpDeposit();
      UI.update();
      UI.rerenderPanel();
      sfx('success');
      UI.log('Skipped the deposit wait with an ad ⚡', 'good');
    });
  }
  function borrow(id) {
    const l = State.takeLoan(id);
    if (!l) return;
    UI.update();
    UI.rerenderPanel();
    UI.floatPoint('+' + UI.fmtMoney(l.amount), true);
    UI.log('Took a loan <b>+' + UI.fmtMoney(l.amount) + '</b> · owe ' + UI.fmtMoney(l.repay), '');
    UI.toast('Loan received 💳');
    State.save();
  }
  function repayLoanAct() {
    if (!State.repayLoan()) { UI.toast('Not enough cash to repay 💸'); return; }
    UI.update();
    UI.rerenderPanel();
    UI.log('Repaid the loan ✓', 'good');
    UI.toast('Loan repaid 🪙');
    State.save();
  }
  // Lakáspiac: beköltözés a következő lakásba
  function buyHomeAct(id) {
    const h = State.buyHome(id);
    if (!h) { sfx('error'); UI.toast('Not enough cash for this home 🏠'); return; }
    UI.update();
    UI.rerenderPanel();
    sfx('coin'); UI.pulseMoney();
    UI.floatPoint('−' + UI.fmtMoney(h.cost), false);
    UI.log('Moved into <b>' + h.name + '</b> · passive now ' + UI.fmtMoney(State.passivePerHour()) + '/hr', 'good');
    UI.toast('New home: ' + h.name + ' 🏡');
    State.save();
  }

  // Travel: utazás indítása / hazaérkezés / korai visszatérés
  function startTripAct(id) {
    const d = State.destById(id);
    const r = State.startTrip(id);
    if (r === 'busy')   { UI.toast('You are already travelling ✈️'); return; }
    if (r === 'locked') { UI.toast('🔒 ' + d.name + ' — ' + State.tripLockReason(d)); return; }
    if (r === 'money')  { UI.toast('Not enough cash for this trip 💸'); return; }
    if (r === 'energy') { UI.toast('Too tired to travel — rest first 😴'); return; }
    if (!r) return;
    UI.update();
    UI.rerenderPanel();
    UI.log('Set off to <b>' + d.name + '</b> ' + d.ico, '');
    UI.toast('Bon voyage! ' + d.ico);
    State.save();
  }
  function tripCollect() {
    const r = State.collectTrip();
    if (!r) return;
    UI.update();
    UI.rerenderPanel();
    sfx('success'); UI.pulseMoney();
    UI.floatPoint('+' + r.happy + '😊', true);
    UI.log('Back from <b>' + r.dest.name + '</b> · +' + r.happy + ' happiness, +' + r.xp + ' XP', 'good');
    UI.toast('Welcome home! +' + r.happy + '😊');
    State.save();
  }
  function tripSpeedup() {
    Plat.showRewardedAd(() => {
      State.speedUpTrip();
      UI.update();
      UI.rerenderPanel();
      sfx('success');
      UI.log('Came back early with an ad ⚡', 'good');
    });
  }

  function buyGoal() {
    const g = State.buyGoal();
    if (!g) return;
    UI.update();
    sfx('coin'); UI.pulseMoney();
    UI.floatPoint('−' + UI.fmtMoney(g.cost), false);
    UI.log('Bought <b>' + g.name + '</b> · passive now ' + UI.fmtMoney(State.passivePerHour()) + '/hr', 'good');
    UI.toast('Unlocked: ' + g.name + ' 🎉');
    State.save();
  }

  function claimDaily() {
    if (!State.dailyAvailable()) { UI.toast('Come back tomorrow for the next reward 🎁'); return; }
    const r = State.claimDaily();
    UI.update();
    sfx('coin'); UI.pulseMoney();
    UI.floatPoint('+' + UI.fmtMoney(r.amount), true);
    UI.log('Daily reward <b>+' + UI.fmtMoney(r.amount) + '</b> · streak ' + r.streak + ' 🔥', 'good');
    UI.toast('Daily reward! +' + UI.fmtMoney(r.amount) + ' (streak ' + r.streak + ')');
    State.save();
  }

  /* =========================== GAME-LOOP =========================== */
  function startLoop() {
    setInterval(() => {
      const t  = Date.now();
      const dt = t - lastTick;
      lastTick = t;

      State.tick(dt);   // passzív jövedelem + állapot-sodródás
      UI.update();      // HUD + visszaszámláló frissítése

      // A műszak épp most lett kész? → egyszeri értesítés
      if (State.isShiftReady() && !wasReady) {
        wasReady = true;
        UI.toast('✅ Shift complete — collect your pay!');
        UI.log('Shift complete — ready to collect', 'good');
      }
      if (!State.get().work.active) wasReady = false;
    }, 1000);
  }

  /* =========================== AUTOSAVE =========================== */
  function startAutosave() {
    setInterval(() => State.save(), 10000); // 10 mp-enként mentünk
  }

  /* ---- indítás a DOM betöltése után ---- */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
