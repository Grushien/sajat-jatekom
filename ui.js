/* =====================================================================
   ui.js – MEGJELENÍTÉS
   ---------------------------------------------------------------------
   A UI csak OLVASSA az állapotot (Game.State.get()) és kirajzolja:
   HUD, nézetek, "next goal" kártya, daily badge, műszak-visszaszámláló,
   Welcome-back panel, eseménynapló, floating +$ visszajelzés.
   A gomb-logikát (mi történjen kattintásra) a main.js köti be.
   ===================================================================== */

window.Game = window.Game || {};

Game.UI = (function () {
  'use strict';

  const S = () => Game.State.get();
  let el = {};            // DOM-gyorsítótár
  let _view = 'city';     // aktuális nézet
  let _away = null;       // a welcome-back panelhez tárolt offline-összeg
  let _lastInterstitial = 0;
  let _stakeFrac = 0.5;   // Bank: a betétbe rakott készpénz aránya (25/50/100%)
  let _startAvatar = 9;   // kezdő menü: ideiglenesen választott avatar

  /* ---- nézetenkénti akciósáv (jobb-lent) ---- */
  const ACTIONS = {
    city:    [ {ico:'💼', label:'Work',    act:'work'},      {ico:'🏦', label:'Bank',    act:'go-bank'},
              {ico:'🏡', label:'Housing', act:'go-housing'}, {ico:'🛍️', label:'Shop',    act:'go-shop'} ],
    home:    [ {ico:'😴', label:'Rest',   act:'rest'},   {ico:'🍽️', label:'Eat',   act:'eat'},
              {ico:'📚', label:'Study',  act:'study'},  {ico:'🏙️', label:'City',  act:'go-city'} ],
    career:  [ {ico:'💼', label:'Work',   act:'work'},   {ico:'🏙️', label:'City',  act:'go-city'} ],
    friends: [ {ico:'🏙️', label:'City',  act:'go-city'} ],
    shop:    [ {ico:'🏙️', label:'City',  act:'go-city'} ],
    settings:[ {ico:'🏙️', label:'City',  act:'go-city'} ],
    bank:    [ {ico:'🏙️', label:'City',  act:'go-city'} ],
    housing: [ {ico:'🏙️', label:'City',  act:'go-city'} ],
    travel:  [ {ico:'🏙️', label:'City',  act:'go-city'} ],
    character:[ {ico:'🏙️', label:'City',  act:'go-city'} ]
  };
  const TITLES = { city:'City', home:'Home', career:'Career', friends:'Friends', shop:'Shop', settings:'Settings', bank:'Bank', housing:'Housing', travel:'Travel', character:'Character' };

  /* ---------------------- segéd-formázók ---------------------- */
  const fmtMoney = n => '$' + Math.floor(n).toLocaleString('en-US');
  function fmtClock(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(s / 60);
    return String(m).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }
  function fmtDuration(ms) {
    const s = Math.floor(ms / 1000);
    if (s >= 3600) return Math.floor(s/3600) + 'h ' + Math.floor((s%3600)/60) + 'm';
    if (s >= 60)   return Math.floor(s/60) + 'm ' + (s%60) + 's';
    return s + 's';
  }

  /* ---------------------- inicializálás ---------------------- */
  function init() {
    const ids = [
      'stage','player-name','player-level','avatar',
      'bar-happy','bar-energy','bar-hunger','val-happy','val-energy','val-hunger',
      'stat-weather','stat-date','money','xp-text','xp-bar',
      'view-title','action-bar','log',
      'goal-name','goal-desc','goal-bar','goal-progress','btn-buy-goal',
      'btn-daily','daily-sub',
      'timer-idle','timer-running','timer-ready','passive-rate',
      'timer-count','timer-bar','timer-reward','collect-amt',
      'welcome-back','wb-time','wb-passive','wb-shift','wb-shift-row','wb-total',
      'toast','float-layer'
    ];
    ids.forEach(id => { el[id] = document.getElementById(id); });
  }

  /* ====================== TELJES ÚJRARAJZOLÁS ======================
     A nézetet a main.js a switchView()-val állítja be indításkor; itt
     csak a HUD-ot és a kártyákat frissítjük. */
  function renderAll() {
    update();
  }

  /* ====================== KÖNNYŰ FRISSÍTÉS (tickenként) ====================== */
  function update() {
    const st = S();

    // --- HUD bal: állapotsávok + név/szint ---
    el['player-name'].textContent  = st.name;
    el['player-level'].textContent = 'Lv ' + st.level;
    el['avatar'].style.backgroundImage = "url('assets/av" + st.avatarIndex + ".png')";
    setBar('happy',  st.happiness);
    setBar('energy', st.energy);
    setBar('hunger', st.hunger);

    // --- HUD jobb: idő, pénz, xp ---
    el['stat-weather'].textContent = st.weather;
    el['stat-date'].textContent    = 'Day ' + st.day;
    el['money'].textContent        = fmtMoney(st.money);
    const need = st.level * 100; // = State.xpNeeded(level)
    el['xp-text'].textContent      = Math.floor(st.xp) + ' / ' + need + ' XP';
    el['xp-bar'].style.width       = (100 * st.xp / need) + '%';

    renderGoal();
    renderDaily();
    renderTimer();
    tickFriendsPanel();
    tickBankPanel();
    tickTravelPanel();
  }

  function setBar(key, val) {
    el['bar-' + key].style.width = Math.round(val) + '%';
    el['val-' + key].textContent = Math.round(val) + '%';
  }

  /* ---------------------- NEXT GOAL kártya ---------------------- */
  function renderGoal() {
    const st = S();
    const g  = Game.State.currentGoal();
    if (!g) {
      el['goal-name'].textContent = 'All upgrades owned 🎉';
      el['goal-desc'].textContent = 'New goals coming soon.';
      el['goal-bar'].style.width  = '100%';
      el['goal-progress'].textContent = '';
      el['btn-buy-goal'].disabled = true;
      el['btn-buy-goal'].textContent = 'Done';
      return;
    }
    el['goal-name'].textContent = g.name;
    el['goal-desc'].textContent = g.desc;
    const pct = Math.min(100, 100 * st.money / g.cost);
    el['goal-bar'].style.width  = pct + '%';
    el['goal-progress'].textContent = fmtMoney(st.money) + ' / ' + fmtMoney(g.cost);
    const afford = Game.State.canAffordGoal();
    el['btn-buy-goal'].disabled    = !afford;
    el['btn-buy-goal'].textContent = afford ? 'Buy' : fmtMoney(g.cost);
  }

  /* ---------------------- DAILY badge ---------------------- */
  function renderDaily() {
    const avail = Game.State.dailyAvailable();
    const badge = el['btn-daily'];
    if (avail) {
      badge.classList.add('has-reward');
      badge.classList.remove('claimed');
      el['daily-sub'].textContent = fmtMoney(Game.State.dailyAmountPreview());
    } else {
      badge.classList.remove('has-reward');
      badge.classList.add('claimed');
      el['daily-sub'].textContent = 'done';
    }
  }

  /* ---------------------- MŰSZAK-IDŐZÍTŐ kártya ---------------------- */
  function renderTimer() {
    el['passive-rate'].textContent = '+' + fmtMoney(Game.State.passivePerHour()) + '/hr';

    const active = S().work.active;
    const ready  = Game.State.isShiftReady();

    show(el['timer-idle'],    !active);
    show(el['timer-running'], active && !ready);
    show(el['timer-ready'],   active &&  ready);

    // Inaktív állapot: a gomb a kiválasztott munkát mutatja (szint-kapuval).
    if (!active) {
      const job = Game.State.currentJob();
      const reason = Game.State.jobLockReason(job);
      const b = document.getElementById('btn-start-shift');
      b.textContent = reason
        ? ('🔒 ' + job.name + ' · ' + reason)
        : ('▶ ' + job.name + ' · ' + fmtMoney(job.pay) + ' / ' + Math.round(job.ms / 1000) + 's');
      b.disabled = !!reason;
    }

    if (active && !ready) {
      const rem = Game.State.workRemainingMs();
      el['timer-count'].textContent  = fmtClock(rem);
      el['timer-bar'].style.width    = (100 * Game.State.workProgress()) + '%';
      el['timer-reward'].textContent = fmtMoney(S().work.reward);
    }
    if (active && ready) {
      el['collect-amt'].textContent = fmtMoney(S().work.reward);
    }
  }

  /* ====================== NÉZETVÁLTÁS ====================== */
  function switchView(view) {
    if (!TITLES[view]) return;
    const changed = view !== _view;
    _view = view;

    // háttér + cím
    el['stage'].className = 'stage--' + view;
    el['view-title'].textContent = TITLES[view];

    // menü aktív állapot (Bank/Housing a City al-lokációi → City marad kiemelve)
    const navView = (view === 'bank' || view === 'housing') ? 'city' : view;
    document.querySelectorAll('.nav-btn').forEach(b => {
      b.classList.toggle('is-active', b.dataset.view === navView);
    });

    // Központi panel (Career/Settings/…); a City/Home valódi háttere marad
    renderPanel(view);
    // belépő "pop" animáció nézetváltáskor (a tickenkénti rerendernél NEM)
    if (panelEl && panelEl.style.display !== 'none') {
      panelEl.classList.remove('pop'); void panelEl.offsetWidth; panelEl.classList.add('pop');
    }

    // akciósáv újraépítése
    renderActionBar(view);

    // Köztes reklám nézetváltáskor – throttle-olva (élethűbb, nem idegesítő)
    if (changed && Date.now() - _lastInterstitial > 45000) {
      _lastInterstitial = Date.now();
      Game.Platform.showInterstitialAd();
    }
  }

  function renderActionBar(view) {
    const bar = el['action-bar'];
    bar.innerHTML = '';
    (ACTIONS[view] || []).forEach(a => {
      const b = document.createElement('button');
      b.className = 'act' + (a.act === 'work' || a.act === 'rest' ? ' is-primary' : '');
      b.dataset.act = a.act;
      b.innerHTML = '<span class="act-ico">' + a.ico + '</span>' + a.label;
      bar.appendChild(b);
    });
  }

  // Központi panel a nem-térkép nézetekhez (Career: munkák, Settings: avatar…)
  let panelEl = null;
  function ensurePanel() {
    if (!panelEl) {
      panelEl = document.createElement('div');
      panelEl.id = 'view-panel';
      panelEl.className = 'panel-card';
      el['stage'].appendChild(panelEl);
    }
  }
  function renderPanel(view) {
    ensurePanel();
    if (view === 'city' || view === 'home') { panelEl.style.display = 'none'; return; }
    panelEl.style.display = 'block';
    panelEl.classList.toggle('panel-wide', view === 'character'); // a Character oldal szélesebb
    if      (view === 'career')   panelEl.innerHTML = careerHTML();
    else if (view === 'settings') panelEl.innerHTML = settingsHTML();
    else if (view === 'shop')     panelEl.innerHTML = shopHTML();
    else if (view === 'friends')  panelEl.innerHTML = friendsHTML();
    else if (view === 'bank')     panelEl.innerHTML = bankHTML();
    else if (view === 'housing')  panelEl.innerHTML = housingHTML();
    else if (view === 'character')panelEl.innerHTML = characterHTML();
    else if (view === 'travel')   panelEl.innerHTML = travelHTML();
    else                          panelEl.innerHTML = comingSoonHTML(view);
  }
  // a main.js hívja, ha a panel tartalma változik (pl. avatar-választás, munka indítás)
  function rerenderPanel() { if (panelEl && panelEl.style.display !== 'none') renderPanel(_view); }

  // A Friends-panel cooldown-óráinak élő frissítése: csak a szöveget írjuk át,
  // hogy ne ugráljon a görgetés; ha valamelyik barát újra elérhető, újrarajzolunk.
  function tickFriendsPanel() {
    if (_view !== 'friends' || !panelEl || panelEl.style.display === 'none') return;
    let flip = false;
    panelEl.querySelectorAll('.friend-card.cooling').forEach(card => {
      const rem = Game.State.friendReadyIn(card.dataset.friend);
      if (rem <= 0) { flip = true; }
      else { const cta = card.querySelector('.friend-cta'); if (cta) cta.textContent = '⏳ ' + fmtClock(rem); }
    });
    if (flip) renderPanel('friends');
  }

  // A Bank-panel betét-órájának élő frissítése (csak a szöveg)
  function tickBankPanel() {
    if (_view !== 'bank' || !panelEl || panelEl.style.display === 'none') return;
    if (!Game.State.get().bank.deposit) return;
    if (Game.State.isDepositReady()) { renderPanel('bank'); return; }
    const c = panelEl.querySelector('#bank-count');
    if (c) c.textContent = fmtClock(Game.State.depositRemainingMs());
  }
  function tickTravelPanel() {
    if (_view !== 'travel' || !panelEl || panelEl.style.display === 'none') return;
    if (!Game.State.get().trip) return;
    if (Game.State.isTripReady()) { renderPanel('travel'); return; }
    const c = panelEl.querySelector('#trip-count');
    if (c) c.textContent = fmtClock(Game.State.tripRemainingMs());
  }

  function getStake()  { return _stakeFrac; }
  function setStake(f) { _stakeFrac = f; rerenderPanel(); }

  /* ---- Kezdő menü (első indítás: név + avatar) ---- */
  function showStartMenu() {
    _startAvatar = S().avatarIndex;
    renderStartAvatars();
    const inp = document.getElementById('start-name');
    if (inp) inp.value = '';
    document.getElementById('start-menu').classList.remove('hidden');
  }
  function renderStartAvatars() {
    const grid = document.getElementById('start-avatars');
    if (!grid) return;
    let g = '';
    for (let i = 0; i < Game.State.AVATAR_COUNT; i++) {
      g += '<button class="av-pick' + (i === _startAvatar ? ' sel' : '') +
           '" data-av="' + i + '" style="background-image:url(assets/av' + i + '.png)"></button>';
    }
    grid.innerHTML = g;
  }
  function setStartAvatar(i) { _startAvatar = i; renderStartAvatars(); }
  function getStartAvatar()  { return _startAvatar; }
  function hideStartMenu()   { document.getElementById('start-menu').classList.add('hidden'); }

  function careerHTML() {
    const st = S();
    let html = '<div class="panel-h">💼 Career — pick a shift</div>' +
               '<div class="panel-note">Study at Home to raise your education and unlock better-paid careers.</div>';
    ['service', 'trade', 'tech', 'business'].forEach(tid => {
      const jobs = Game.State.JOBS.filter(j => j.track === tid);
      if (!jobs.length) return;
      const tm = Game.State.TRACKS[tid];
      html += '<div class="shop-cat">' + tm.ico + ' ' + tm.name + '</div>';
      jobs.forEach(j => {
        const reason = Game.State.jobLockReason(j);
        const active = st.work.active && st.work.jobId === j.id;
        const locked = !!reason;
        const cls = 'job-card' + (locked ? ' locked' : '') + (active ? ' active' : '');
        const cta = active ? 'Running…' : (locked ? '🔒' : 'Start ▶');
        const mins = Math.round(j.ms / 6000) / 10;
        const reqTxt = (j.reqEdu > 0 ? '🎓 ' + Game.State.eduName(j.reqEdu) + ' · ' : '') + 'Lv ' + j.reqLevel;
        html += '<div class="' + cls + '" data-job="' + j.id + '">' +
          '<div class="job-ico">' + j.ico + '</div>' +
          '<div class="job-main"><div class="job-name">' + j.name + '</div>' +
          '<div class="job-desc">' + j.desc + '</div>' +
          '<div class="job-req' + (locked ? ' locked' : '') + '">' + reqTxt + '</div></div>' +
          '<div class="job-meta"><div class="job-pay">' + fmtMoney(j.pay) + '</div>' +
          '<div class="job-cost">' + mins + 'm · −' + j.energy + '⚡</div></div>' +
          '<div class="job-cta">' + cta + '</div></div>';
      });
    });
    return html;
  }

  function settingsHTML() {
    const st  = S();
    const snd = st.settings.sound;
    return '<div class="panel-h">⚙️ Settings</div>' +
      '<div class="set-row"><span>🔊 Sound effects</span>' +
        '<button class="toggle' + (snd ? ' on' : '') + '" data-act-panel="sound">' + (snd ? 'On' : 'Off') + '</button></div>' +
      '<div class="set-row"><span>👤 Player</span><b>' + st.name + '</b></div>' +
      '<div class="set-row"><span>🎓 Education</span><b>' + Game.State.eduName() + '</b></div>' +
      '<div class="set-row"><span>🏠 Home</span><b>' + Game.State.currentHome().name + '</b></div>' +
      '<div class="panel-note" style="margin-top:0.7em">Grushflow v0.1 · Local adapter — ads &amp; save are mocked. CrazyGames integration is the final step.</div>' +
      '<button class="btn btn-ad btn-sm" data-act-panel="reset">Reset save</button>';
  }

  function comingSoonHTML(view) {
    return '<div class="panel-h">🚧 ' + TITLES[view] + '</div>' +
           '<div class="panel-note">This screen is coming in the next step.</div>';
  }

  function travelHTML() {
    const t = Game.State.get().trip;
    let html = '<div class="panel-h">✈️ Travel</div>';
    if (t) {
      const d = Game.State.destById(t.destId);
      const ready = Game.State.isTripReady();
      html += '<div class="panel-note">You are on a trip — rewards waiting when you get back.</div>' +
        '<div class="bank-active">' +
          '<div class="bank-row"><span>' + d.ico + ' ' + d.name + '</span><b class="moneygreen">+' + t.happy + '😊 · +' + t.xp + ' XP</b></div>' +
          '<div class="bank-timer">' + (ready
            ? '<span class="moneygreen">✅ Back home!</span>'
            : '⏳ <b id="trip-count">' + fmtClock(Game.State.tripRemainingMs()) + '</b>') + '</div>' +
          (ready
            ? '<button class="btn btn-primary btn-block" data-trip="collect">Collect rewards</button>'
            : '<button class="btn btn-ad btn-block" data-trip="speedup">⚡ Come back early · Watch ad</button>') +
        '</div>';
    } else {
      html += '<div class="panel-note">Take a trip for a big happiness &amp; XP boost. Costs cash and energy; better spots need a higher level &amp; education.</div>';
      Game.State.DESTINATIONS.forEach(d => {
        const reason = Game.State.tripLockReason(d);
        const locked = !!reason;
        const cls = 'dest-card' + (locked ? ' locked' : '');
        const cta = locked ? '🔒' : (d.cost > 0 ? fmtMoney(d.cost) : 'Free');
        const mins = Math.round(d.ms / 6000) / 10;
        const meta = locked ? reason : (mins + 'm · −' + d.energy + '⚡');
        html += '<div class="' + cls + '" data-trip-go="' + d.id + '">' +
          '<div class="dest-ico">' + d.ico + '</div>' +
          '<div class="dest-main"><div class="dest-name">' + d.name + '</div>' +
          '<div class="dest-desc">' + d.desc + '</div>' +
          '<div class="dest-rew">+' + d.happy + '😊 · +' + d.xp + ' XP</div></div>' +
          '<div class="dest-meta"><div class="dest-cta">' + cta + '</div>' +
          '<div class="dest-req' + (locked ? ' locked' : '') + '">' + meta + '</div></div>' +
        '</div>';
      });
    }
    return html;
  }

  function shopHTML() {
    const st = S();
    let html = '<div class="panel-h">🛍️ Shop</div>' +
               '<div class="panel-note">Permanent perks that boost your daily actions. (Passive-income businesses live in the Next-goal card.)</div>';
    ['Electronics', 'Home & Kitchen', 'Accessories'].forEach(cat => {
      html += '<div class="shop-cat">' + cat + '</div>';
      Game.State.SHOP.filter(it => it.cat === cat).forEach(it => {
        const owned  = st.shopOwned.includes(it.id);
        const afford = st.money >= it.price;
        const cls = 'shop-item' + (owned ? ' owned' : (afford ? '' : ' cant'));
        const cta = owned ? 'Owned ✓' : fmtMoney(it.price);
        html += '<div class="' + cls + '" data-shop="' + it.id + '">' +
          '<div class="shop-ico">' + it.ico + '</div>' +
          '<div class="shop-main"><div class="shop-name">' + it.name + '</div>' +
          '<div class="shop-desc">' + it.desc + '</div></div>' +
          '<div class="shop-cta">' + cta + '</div></div>';
      });
    });
    return html;
  }

  function friendsHTML() {
    let html = '<div class="panel-h">👥 Friends</div>' +
               '<div class="panel-note">Hang out for happiness &amp; XP. Each friend needs time to recharge.</div>';
    Game.State.FRIENDS.forEach(f => {
      const rem   = Game.State.friendReadyIn(f.id);
      const ready = rem <= 0;
      const cls   = 'friend-card' + (ready ? '' : ' cooling');
      const cta   = ready ? ('Hang out +' + f.happy + '😊') : ('⏳ ' + fmtClock(rem));
      html += '<div class="' + cls + '" data-friend="' + f.id + '">' +
        '<div class="friend-av" style="background-image:url(assets/av' + f.av + '.png)"></div>' +
        '<div class="friend-main"><div class="friend-name">' + f.name + '</div>' +
        '<div class="friend-desc">+' + f.happy + '😊 · +' + f.xp + ' XP · −' + f.energy + '⚡</div></div>' +
        '<div class="friend-cta">' + cta + '</div></div>';
    });
    return html;
  }

  function bankHTML() {
    const st = S();
    const d  = Game.State.get().bank.deposit;
    let html = '<div class="panel-h">🏦 Bank</div>';

    if (d) {
      const ready = Game.State.isDepositReady();
      const ret   = Game.State.depositReturn();
      html += '<div class="panel-note">Your savings are locked and earning interest.</div>' +
        '<div class="bank-active">' +
          '<div class="bank-row"><span>Principal</span><b>' + fmtMoney(d.principal) + '</b></div>' +
          '<div class="bank-row"><span>Matures to</span><b class="moneygreen">' + fmtMoney(ret) + '</b></div>' +
          '<div class="bank-timer">' + (ready
            ? '<span class="moneygreen">✅ Ready to collect!</span>'
            : '⏳ <b id="bank-count">' + fmtClock(Game.State.depositRemainingMs()) + '</b>') + '</div>' +
          (ready
            ? '<button class="btn btn-primary btn-block" data-bank="collect">Collect ' + fmtMoney(ret) + '</button>'
            : '<button class="btn btn-ad btn-block" data-bank="speedup">⚡ Skip wait · Watch ad</button>') +
        '</div>';
    } else {
      const amount = Math.floor(st.money * _stakeFrac);
      html += '<div class="panel-note">Lock money for a fixed term to earn guaranteed interest.</div>' +
        '<div class="stake-row"><span>Stake:</span>' +
          ['0.25', '0.5', '1'].map(f =>
            '<button class="stake-btn' + (Math.abs(_stakeFrac - parseFloat(f)) < 0.001 ? ' sel' : '') +
            '" data-stake="' + f + '">' + (f === '1' ? 'Max' : (parseFloat(f) * 100) + '%') + '</button>'
          ).join('') +
          '<span class="stake-amt">= ' + fmtMoney(amount) + '</span></div>';
      Game.State.BANK_PLANS.forEach(p => {
        const ok = amount >= 50;
        html += '<div class="bank-plan' + (ok ? '' : ' cant') + '" data-plan="' + p.id + '">' +
          '<div class="bank-ico">' + p.ico + '</div>' +
          '<div class="bank-main"><div class="bank-name">' + p.name + '</div>' +
          '<div class="bank-desc">' + p.desc + '</div></div>' +
          '<div class="bank-cta">Deposit</div></div>';
      });
    }

    // Hitel szekció
    const owed = Game.State.loanOwed();
    html += '<div class="shop-cat">Loans</div>';
    if (owed > 0) {
      html += '<div class="panel-note">You owe <b>' + fmtMoney(owed) + '</b>. Repay it to borrow again.</div>' +
        '<button class="btn btn-primary btn-block" data-loan="repay">Repay ' + fmtMoney(owed) + '</button>';
    } else {
      Game.State.LOANS.forEach(l => {
        html += '<div class="bank-plan" data-loanid="' + l.id + '">' +
          '<div class="bank-ico">' + l.ico + '</div>' +
          '<div class="bank-main"><div class="bank-name">Borrow ' + fmtMoney(l.amount) + '</div>' +
          '<div class="bank-desc">Repay ' + fmtMoney(l.repay) + ' later.</div></div>' +
          '<div class="bank-cta">Borrow</div></div>';
      });
    }
    return html;
  }

  function housingHTML() {
    const st  = S();
    const cur = Game.State.get().homeIndex;
    let html = '<div class="panel-h">🏡 Housing market</div>' +
               '<div class="panel-note">Upgrade your home for passive income, a happiness floor and better rest. You can buy the next tier up.</div>';
    Game.State.HOMES.forEach((h, i) => {
      let cta, cls = 'home-card', clickable = false;
      if (i < cur)            { cls += ' past';    cta = '<div class="home-cta past">Owned ✓</div>'; }
      else if (i === cur)     { cls += ' current'; cta = '<div class="home-cta cur">Current</div>'; }
      else if (i === cur + 1) { const ok = st.money >= h.cost; clickable = true;
                                cta = '<div class="home-cta' + (ok ? '' : ' cant') + '">' + fmtMoney(h.cost) + '</div>'; }
      else                    { cls += ' locked';  cta = '<div class="home-cta locked">🔒</div>'; }
      html += '<div class="' + cls + '"' + (clickable ? (' data-home="' + h.id + '"') : '') + '>' +
        '<div class="home-ico">' + h.ico + '</div>' +
        '<div class="home-main"><div class="home-name">' + h.name + '</div>' +
        '<div class="home-desc">' + h.desc + '</div></div>' +
        cta + '</div>';
    });
    return html;
  }

  function characterHTML() {
    const st = S();
    const passive = Game.State.passivePerHour();
    const job  = Game.State.currentJob();
    const home = Game.State.currentHome();
    const owned = st.shopOwned.map(id => Game.State.shopById(id)).filter(Boolean);
    const inv = owned.length
      ? owned.map(it => '<div class="inv-item"><span class="inv-ico">' + it.ico + '</span>' + it.name + '</div>').join('')
      : '<div class="muted" style="font-size:0.85em">Empty — buy items in the Shop.</div>';
    const need = st.level * 100;

    return '<div class="char-head">' +
        '<div class="char-av" style="background-image:url(assets/av' + st.avatarIndex + '.png)"></div>' +
        '<div class="char-headinfo">' +
          '<div class="char-name">' + st.name + '</div>' +
          '<div class="char-sub">Level ' + st.level + '</div>' +
          '<div class="char-xp"><div class="char-xp-fill" style="width:' + (100 * st.xp / need) + '%"></div></div>' +
          '<div class="char-xp-text">' + Math.floor(st.xp) + ' / ' + need + ' XP</div>' +
        '</div>' +
      '</div>' +
      '<div class="char-stats">' +
        cstat('😊 Happiness', st.happiness, 'happy') +
        cstat('⚡ Energy',    st.energy,    'energy') +
        cstat('🍔 Hunger',    st.hunger,    'hunger') +
      '</div>' +
      '<div class="shop-cat">Profile</div>' +
      '<div class="char-grid">' +
        ccell('💰', 'Cash',         fmtMoney(st.money)) +
        ccell('📈', 'Passive',      '+' + fmtMoney(passive) + '/hr') +
        ccell('💼', 'Current job',  job.name) +
        ccell('🏠', 'Home',         home.name) +
        ccell('🎓', 'Education',    Game.State.eduName()) +
        ccell('🧭', 'Career track', Game.State.trackName(st.track)) +
        ccell('📅', 'Day',          String(st.day)) +
        ccell('🔥', 'Daily streak', st.daily.streak + (st.daily.streak === 1 ? ' day' : ' days')) +
      '</div>' +
      eduProgressBlock(st) +
      '<div class="shop-cat">Inventory (' + owned.length + ')</div>' +
      '<div class="inv-grid">' + inv + '</div>';
  }
  function eduProgressBlock(st) {
    if (st.eduLevel >= 3) {
      return '<div class="char-note muted">🎓 University graduate — top of the education ladder.</div>';
    }
    const pct = Game.State.eduProgressPct();
    return '<div class="shop-cat">Education progress</div>' +
      '<div class="edu-prog"><div class="edu-prog-top">' +
        '<span>' + Game.State.eduName() + ' → ' + Game.State.eduName(st.eduLevel + 1) + '</span>' +
        '<b>' + pct + '%</b></div>' +
        '<div class="cbar"><div class="bar-fill bar-fill--edu" style="width:' + pct + '%"></div></div>' +
        '<div class="muted" style="font-size:0.74em;margin-top:0.35em">Study at Home to progress. Unlocks Trade / Tech / Business careers.</div></div>';
  }
  function cstat(label, val, key) {
    return '<div class="cstat"><span class="cstat-lbl">' + label + '</span>' +
      '<div class="cbar"><div class="bar-fill bar-fill--' + key + '" style="width:' + Math.round(val) + '%"></div></div>' +
      '<b>' + Math.round(val) + '%</b></div>';
  }
  function ccell(ico, label, val) {
    return '<div class="char-cell"><div class="cc-top">' + ico + ' ' + label + '</div>' +
           '<div class="cc-val">' + val + '</div></div>';
  }

  function currentView() { return _view; }

  /* ====================== WELCOME-BACK PANEL ====================== */
  function showWelcomeBack(away) {
    _away = away;
    el['wb-time'].textContent    = fmtDuration(away.ms) + (away.capped ? ' (capped at ' + Game.State.CFG.OFFLINE_CAP_HOURS + 'h)' : '');
    el['wb-passive'].textContent = fmtMoney(away.passive);
    el['wb-shift'].textContent   = fmtMoney(away.shiftPay);
    show(el['wb-shift-row'], away.shiftPay > 0);
    el['wb-total'].textContent   = fmtMoney(away.total);
    el['welcome-back'].classList.remove('hidden');
  }
  function getAway()  { return _away; }
  function setAwayDoubled() {
    if (!_away) return;
    _away.total   += _away.total;     // a kijelzett összeg megduplázódik
    _away.passive += _away.passive;
    _away.shiftPay+= _away.shiftPay;
    el['wb-passive'].textContent = fmtMoney(_away.passive);
    el['wb-shift'].textContent   = fmtMoney(_away.shiftPay);
    el['wb-total'].textContent   = fmtMoney(_away.total);
  }
  function hideWelcomeBack() {
    el['welcome-back'].classList.add('hidden');
    _away = null;
  }

  /* ====================== VISSZAJELZÉSEK ====================== */
  // Eseménynapló – legújabb elöl, max 6 elem
  function log(msg, type) {
    const li = document.createElement('li');
    if (type) li.className = type;
    const t = new Date();
    const hh = String(t.getHours()).padStart(2,'0') + ':' + String(t.getMinutes()).padStart(2,'0');
    li.innerHTML = '<span class="t">' + hh + '</span>' + msg;
    el['log'].insertBefore(li, el['log'].firstChild);
    while (el['log'].children.length > 6) el['log'].removeChild(el['log'].lastChild);
  }

  let toastTimer = null;
  function toast(msg) {
    el['toast'].textContent = msg;
    el['toast'].classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el['toast'].classList.add('hidden'), 1600);
  }

  // Lebegő +$ a képernyő közepénél
  function floatPoint(text, good) {
    const p = document.createElement('div');
    p.className = 'float-pt' + (good ? ' good' : '');
    p.textContent = text;
    p.style.left = (45 + Math.random() * 10) + '%';
    p.style.top  = (52 + Math.random() * 6) + '%';
    el['float-layer'].appendChild(p);
    setTimeout(() => p.remove(), 1100);
  }

  function onLevelUp(level) {
    if (Game.Sound) Game.Sound.play('levelup');
    toast('⭐ Level up! You are now Lv ' + level);
    log('Reached <b>Level ' + level + '</b>', 'good');
  }

  // Pénz-érték rövid "pulzálása" (jutalom begyűjtésekor hívjuk)
  function pulseMoney() {
    const m = el['money']; if (!m) return;
    m.classList.remove('money-pulse'); void m.offsetWidth; m.classList.add('money-pulse');
  }

  /* ---- apró segéd ---- */
  function show(node, on) { if (node) node.classList.toggle('hidden', !on); }

  /* ---------------------- kifelé adott felület ---------------------- */
  return {
    init, renderAll, update,
    switchView, currentView, rerenderPanel,
    showStartMenu, hideStartMenu, setStartAvatar, getStartAvatar,
    showWelcomeBack, getAway, setAwayDoubled, hideWelcomeBack,
    log, toast, floatPoint, onLevelUp, pulseMoney,
    getStake, setStake,
    fmtMoney
  };
})();
