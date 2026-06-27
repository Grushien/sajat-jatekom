/* =====================================================================
   state.js – ÁLLAPOT + IDŐ/OFFLINE-LOGIKA + GAZDASÁG
   ---------------------------------------------------------------------
   Itt él a retention-mag:
     • központi állapot `lastSeen` időbélyeggel,
     • offline-haladás (now - lastSeen) → passzív jövedelem visszatéréskor,
     • egy időzített akció (műszak) látható visszaszámlálóhoz,
     • "next goal" fejlesztések (a húzó cél),
     • daily reward / streak.
   A UI csak olvassa az állapotot és hívja az itteni akciókat.
   ===================================================================== */

window.Game = window.Game || {};

Game.State = (function () {
  'use strict';

  /* ============ HANGOLHATÓ GAZDASÁGI ÁLLANDÓK ============ */
  const CFG = {
    OFFLINE_CAP_HOURS:     8,      // ennyi óránál többet nem fizet az offline-idle (casual-barát)
    BASE_PASSIVE_PER_HOUR: 30,     // alap "city income" – 8h sapka × 30 = $240 welcome-back
    SHIFT_MS:              60 * 1000, // egy műszak hossza (Step 1: 1 perc, hogy tesztelhető legyen)
    SHIFT_PAY:             65,     // műszak jutalma ($)
    SHIFT_ENERGY:          12,     // műszak energiaköltsége
    SHIFT_HUNGER:          8,      // műszak alatt csökkenő jóllakottság
    SHIFT_XP:              20,
    REST_ENERGY:           35,     // "Rest" akció energiát ad vissza
    REST_HAPPY:            6,
    ENERGY_DECAY_PER_HOUR: 6,      // állapotok lassú sodródása idővel
    HUNGER_DECAY_PER_HOUR: 5,
    HAPPY_DRIFT_PER_HOUR:  4,      // boldogság közelít a 50-hez
    HAPPY_TARGET:          50,
    DAILY_BASE:            50,     // 1. napi jutalom
    DAILY_STEP:            25,     // +ennyi naponta a streakben
    DAILY_CAP:             300,    // maximális napi jutalom
    EAT_COST:              20,     // "Eat" akció pénzköltsége
    EAT_HUNGER:            30,     // +jóllakottság
    EAT_HAPPY:             5,
    STUDY_ENERGY:          15,     // "Study" akció energiaköltsége
    STUDY_XP:              40,     // +tapasztalat
    STUDY_HAPPY:           4,
    WELCOME_MIN_MS:        20 * 1000 // ennyi távollét alatt nem mutatunk welcome-back panelt
  };

  /* ============ "NEXT GOAL" FEJLESZTÉSEK (sorrendben) ============
     Mindegyik megvásárlása növeli a passzív óradíjat → erősödő idle-loop. */
  const UPGRADES = [
    { id: 'coffee',  name: 'Coffee Cart',      cost: 300,  rate: 25,  desc: 'A little street business. +$25/hr passive.' },
    { id: 'news',    name: 'Newsstand',        cost: 750,  rate: 50,  desc: 'Papers & snacks downtown. +$50/hr passive.' },
    { id: 'taxi',    name: 'Taxi Medallion',   cost: 1600, rate: 95,  desc: 'A car on the road 24/7. +$95/hr passive.' },
    { id: 'rental',  name: 'Rental Apartment', cost: 3400, rate: 180, desc: 'Rent income while you sleep. +$180/hr passive.' },
    { id: 'cafe',    name: 'Corner Café',      cost: 6800, rate: 340, desc: 'Your own café brand. +$340/hr passive.' }
  ];

  /* ============ AVATAR + MUNKÁK (Career) ============ */
  const AVATAR_COUNT = 10; // assets/av0.png ... av9.png

  // Változó hosszú/jutalmú műszakok – ez adja a "rövid/közepes/hosszú" idő-loopot,
  // szint-kapuval (reqLevel), hogy legyen mire fejlődni.
  // Karrier-ágak (irányok). A 'service' bárkinek elérhető, a többi képzettséget kér.
  const TRACKS = {
    service:  { name:'Service',  ico:'🧹' },
    trade:    { name:'Trade',    ico:'🔧' },
    tech:     { name:'Tech',     ico:'💻' },
    business: { name:'Business', ico:'💼' }
  };
  function trackName(id) { return (TRACKS[id] && TRACKS[id].name) || 'Undecided'; }

  // Minden munka egy ághoz tartozik, és igényelhet képzettséget (reqEdu) + szintet (reqLevel).
  const JOBS = [
    // Service – nem kell képzettség (belépő szint)
    { id:'cleaner',  track:'service',  ico:'🧹', name:'Street Cleaner',   ms:60000,  pay:65,   energy:12, xp:20,  reqLevel:1,  reqEdu:0, desc:'No qualifications needed.' },
    { id:'courier',  track:'service',  ico:'🚲', name:'Bike Courier',     ms:120000, pay:160,  energy:20, xp:45,  reqLevel:2,  reqEdu:0, desc:'Quick on your feet.' },
    { id:'barista',  track:'service',  ico:'☕', name:'Café Barista',      ms:180000, pay:280,  energy:26, xp:70,  reqLevel:3,  reqEdu:0, desc:'Service with a smile.' },
    // Trade – High School kell
    { id:'mechanic', track:'trade',    ico:'🔧', name:'Mechanic',         ms:150000, pay:340,  energy:24, xp:80,  reqLevel:3,  reqEdu:1, desc:'Hands-on repairs.' },
    { id:'electric', track:'trade',    ico:'💡', name:'Electrician',      ms:210000, pay:520,  energy:28, xp:120, reqLevel:5,  reqEdu:1, desc:'Wiring and power.' },
    // Tech – College / University kell
    { id:'coder',    track:'tech',     ico:'💻', name:'Junior Coder',     ms:240000, pay:620,  energy:26, xp:150, reqLevel:5,  reqEdu:2, desc:'Write your first apps.' },
    { id:'webdev',   track:'tech',     ico:'🌐', name:'Web Developer',    ms:300000, pay:900,  energy:30, xp:220, reqLevel:7,  reqEdu:2, desc:'Build for the web.' },
    { id:'engineer', track:'tech',     ico:'🛰️', name:'Software Engineer',ms:360000, pay:1400, energy:34, xp:340, reqLevel:10, reqEdu:3, desc:'Architect big systems.' },
    // Business – College / University kell
    { id:'account',  track:'business', ico:'📊', name:'Accountant',       ms:240000, pay:680,  energy:24, xp:160, reqLevel:6,  reqEdu:2, desc:'Master the numbers.' },
    { id:'investor', track:'business', ico:'📈', name:'Investor',         ms:360000, pay:1600, energy:30, xp:380, reqLevel:11, reqEdu:3, desc:'Make money work for you.' }
  ];
  function jobById(id) { return JOBS.find(j => j.id === id) || JOBS[0]; }

  /* ============ SHOP (tartós életminőség-fejlesztések) ============
     Ezek NEM a passzív jövedelmet növelik (azt a UPGRADES/next-goal teszi),
     hanem az AKCIÓK hatékonyságát: rest/eat/study/munka – tiszta szétválasztás. */
  const SHOP = [
    // Electronics
    { id:'tv',     cat:'Electronics',    ico:'📺', name:'Smart TV',       price:250, desc:'Cozy nights in. +20 happiness now.',     instant:{ happiness:20 } },
    { id:'pc',     cat:'Electronics',    ico:'💻', name:'Gaming PC',      price:650, desc:'Study & play. Study XP ×1.6.',           mult:{ studyXp:1.6 } },
    { id:'phone',  cat:'Electronics',    ico:'📱', name:'Smartphone',     price:420, desc:'Stay connected. +15 happiness now.',     instant:{ happiness:15 } },
    // Home & Kitchen
    { id:'bed',    cat:'Home & Kitchen', ico:'🛏️', name:'Comfy Bed',      price:300, desc:'Sleep better. Rest gives ×1.5 energy.',  mult:{ restEnergy:1.5 } },
    { id:'fridge', cat:'Home & Kitchen', ico:'🧊', name:'Fridge',         price:340, desc:'Fresh food. Eat gives ×1.5 hunger.',     mult:{ eatHunger:1.5 } },
    { id:'coffee', cat:'Home & Kitchen', ico:'☕', name:'Coffee Machine', price:200, desc:'Morning boost. +25 energy now.',        instant:{ energy:25 } },
    // Accessories
    { id:'shoes',  cat:'Accessories',    ico:'👟', name:'Sneakers',       price:180, desc:'Work smarter. Job energy cost ×0.8.',   mult:{ jobEnergy:0.8 } },
    { id:'watch',  cat:'Accessories',    ico:'⌚', name:'Smartwatch',      price:520, desc:'Track everything. Job XP ×1.4.',        mult:{ jobXp:1.4 } }
  ];
  function shopById(id) { return SHOP.find(x => x.id === id) || null; }
  // Egy szorzó-kulcs eredője a megvett tárgyakból (1 = nincs hatás).
  function shopMult(key) {
    let m = 1;
    for (const it of SHOP) {
      if (s.shopOwned.includes(it.id) && it.mult && it.mult[key] != null) m *= it.mult[key];
    }
    return m;
  }

  /* ============ FRIENDS (közösségi loop cooldownnal) ============
     A "hang out" boldogságot/XP-t ad energiáért cserébe, majd a barát
     egy ideig "tölt" (cooldown) – ez újabb visszatérési ok. */
  const FRIENDS = [
    { id:'mia',  av:2, name:'Mia',  happy:12, xp:15, energy:8,  cool:120000 },
    { id:'leo',  av:9, name:'Leo',  happy:15, xp:20, energy:10, cool:180000 },
    { id:'sara', av:7, name:'Sara', happy:10, xp:12, energy:6,  cool:90000  },
    { id:'max',  av:3, name:'Max',  happy:18, xp:25, energy:12, cool:300000 },
    { id:'nora', av:5, name:'Nora', happy:14, xp:18, energy:9,  cool:240000 }
  ];
  function friendById(id) { return FRIENDS.find(f => f.id === id) || null; }

  /* ============ BANK (lekötött betét = időzített megtérülés) ============ */
  const BANK_PLANS = [
    { id:'short', ico:'💵', name:'Short term',  termMs:5 * 60000,    rate:0.08, desc:'5 min · +8% interest' },
    { id:'mid',   ico:'💰', name:'Medium term', termMs:30 * 60000,   rate:0.20, desc:'30 min · +20% interest' },
    { id:'long',  ico:'🏦', name:'Long term',   termMs:4 * 3600000,  rate:0.60, desc:'4 hours · +60% interest' }
  ];
  function bankPlanById(id) { return BANK_PLANS.find(p => p.id === id) || null; }

  // Egyszerű hitel: kapsz most pénzt, többet fizetsz vissza később.
  const LOANS = [
    { id:'small', ico:'🪙', amount:500,  repay:625  },
    { id:'big',   ico:'💳', amount:2000, repay:2500 }
  ];
  function loanById(id) { return LOANS.find(l => l.id === id) || null; }

  /* ============ LAKÁSPIAC (otthon-létra) ============
     Minden lakás: passzív bónusz ($/hr) + boldogság-padló (nem esik alá)
     + jobb pihenés. Csak a következő szintre lehet lépni. */
  const HOMES = [
    { id:'studio',    ico:'🛖', name:'Tiny Studio',    cost:0,     passive:0,   floor:0,  rest:0,  desc:'Where you start. Small but yours.' },
    { id:'apartment', ico:'🏠', name:'City Apartment', cost:1200,  passive:20,  floor:35, rest:5,  desc:'+$20/hr · happiness floor 35 · +5 rest' },
    { id:'loft',      ico:'🏢', name:'Modern Loft',    cost:4000,  passive:55,  floor:45, rest:8,  desc:'+$55/hr · happiness floor 45 · +8 rest' },
    { id:'townhouse', ico:'🏡', name:'Townhouse',      cost:12000, passive:140, floor:55, rest:12, desc:'+$140/hr · happiness floor 55 · +12 rest' },
    { id:'penthouse', ico:'🌆', name:'Penthouse',      cost:30000, passive:320, floor:65, rest:16, desc:'+$320/hr · happiness floor 65 · +16 rest' }
  ];
  function currentHome() { return HOMES[s.homeIndex] || HOMES[0]; }
  function homeFloor()   { return currentHome().floor; }

  /* ============ TRAVEL (időzített kirándulások) ============
     Egy utazás pénzbe + energiába kerül, megy az óra, hazaérve boldogság + XP.
     A jobb úti célok szintet/képzettséget kérnek (életstílus-kapu). */
  const DESTINATIONS = [
    { id:'park',   ico:'🏞️', name:'City Park',       cost:0,    energy:10, happy:12, xp:15,  reqLevel:1, reqEdu:0, ms:60000,  desc:'A relaxing afternoon nearby.' },
    { id:'beach',  ico:'🏖️', name:'Sunny Beach',     cost:120,  energy:14, happy:22, xp:30,  reqLevel:2, reqEdu:0, ms:120000, desc:'A weekend by the sea.' },
    { id:'mount',  ico:'🏔️', name:'Mountain Resort', cost:400,  energy:18, happy:35, xp:55,  reqLevel:4, reqEdu:0, ms:180000, desc:'Fresh air and hiking trails.' },
    { id:'metro',  ico:'🌆', name:'Big City Trip',   cost:900,  energy:20, happy:45, xp:90,  reqLevel:6, reqEdu:1, ms:240000, desc:'Bright lights, big city.' },
    { id:'island', ico:'🏝️', name:'Tropical Island', cost:2200, energy:24, happy:70, xp:160, reqLevel:9, reqEdu:2, ms:360000, desc:'A once-in-a-lifetime getaway.' }
  ];
  function destById(id) { return DESTINATIONS.find(d => d.id === id) || null; }
  function tripLockReason(d) {
    if (s.eduLevel < d.reqEdu) return 'Needs ' + eduName(d.reqEdu);
    if (s.level    < d.reqLevel) return 'Needs Lv ' + d.reqLevel;
    return null;
  }

  let s = null; // a teljes állapot-objektum

  /* ------------------------- segédek ------------------------- */
  const now   = () => Date.now();
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function genGuestId() {
    // Rejtett vendég-azonosító (a portál-only mentés kulcsa, és későbbi
    // felhő-szinkronhoz is jó). LocalStorage-ban él a mentésen belül.
    return 'guest_' + Math.random().toString(36).slice(2, 10) + now().toString(36);
  }

  function defaults() {
    const t = now();
    return {
      guestId:   genGuestId(),
      createdAt: t,
      lastSeen:  t,

      name:  'Alex',
      level: 1,
      xp:    0,

      money:     150,    // kezdőtőke – az első cél ($300) épphogy karnyújtásnyi
      energy:    80,
      hunger:    70,     // "jóllakottság": magasabb = jobb
      happiness: 75,

      day:     1,
      weather: pickWeather(t),

      avatarIndex: 9,      // alapból a "Művész fiú" (av9.png)
      jobId:    'cleaner', // a Career-ben kiválasztott munka

      // Egy időzített akció (műszak). Ha active, fut a visszaszámláló.
      work: { active: false, startTs: 0, durationMs: 60000, reward: 65, energyCost: 12, hungerCost: 8, xpGain: 20, jobId: 'cleaner' },

      purchased: [],     // megvett fejlesztések id-jei (passzív jövedelem-létra)
      shopOwned: [],     // megvett Shop-tárgyak id-jei
      friendsCd: {},     // barátonkénti utolsó "hang out" időbélyeg (cooldownhoz)
      homeIndex: 0,      // jelenlegi lakás a HOMES létrában
      bank:     { deposit: null, loan: null }, // lekötött betét + hitel
      trip:     null,    // aktív utazás (időzített) vagy null
      eduLevel: 0,       // iskolázottság (0=none) – a Career-kapuhoz
      eduProgress: 0,    // haladás a következő képzettségi szint felé (0–100%)
      track:    null,    // aktuális karrier-ág id-je (a munkából) – pl. 'tech'
      settings: { sound: true, tutorialSeen: false }, // játék-beállítások
      daily:    { lastKey: null, streak: 0 } // napi jutalom állapota
    };
  }

  function pickWeather(seed) {
    const list = ['☀️ Sunny', '⛅ Cloudy', '🌧️ Rainy', '🌤️ Mild'];
    // a nap kulcsából determinisztikus, hogy egy napon belül ne ugráljon
    const day = Math.floor(seed / 86400000);
    return list[day % list.length];
  }

  function dayKey(ts) {
    // helyi naptári nap kulcsa (YYYY-MM-DD) – a daily reward ehhez igazodik
    const d = new Date(ts);
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }

  /* ------------------------- passzív óradíj ------------------------- */
  function passivePerHour() {
    let rate = CFG.BASE_PASSIVE_PER_HOUR;
    for (const up of UPGRADES) {
      if (s.purchased.includes(up.id)) rate += up.rate;
    }
    rate += currentHome().passive; // a lakás is hoz passzív jövedelmet
    return rate;
  }

  /* ------------------------- állapot-sodródás ------------------------- */
  // Ugyanazt használjuk élőben (kis dt) és offline (sok óra) is.
  function applyDrift(hours) {
    s.energy    = clamp(s.energy    - CFG.ENERGY_DECAY_PER_HOUR * hours, 0, 100);
    s.hunger    = clamp(s.hunger    - CFG.HUNGER_DECAY_PER_HOUR * hours, 0, 100);
    const target = CFG.HAPPY_TARGET;
    const step   = CFG.HAPPY_DRIFT_PER_HOUR * hours;
    if (s.happiness > target) s.happiness = clamp(s.happiness - step, target, 100);
    else                      s.happiness = clamp(s.happiness + step, 0, target);
    // a lakás "boldogság-padlója": ennél lejjebb nem csúszik
    s.happiness = clamp(s.happiness, homeFloor(), 100);
  }

  /* ============================================================
     BETÖLTÉS + OFFLINE-SZÁMÍTÁS
     Visszaad: { firstTime, away }  – away = welcome-back infó vagy null
     ============================================================ */
  function load() {
    const raw = Game.Platform.loadData();

    if (!raw) {
      s = defaults();
      return { firstTime: true, away: null };
    }

    // Meglévő mentés – egészítsük ki az esetleg hiányzó új mezőkkel.
    s = Object.assign(defaults(), raw);
    s.work  = Object.assign({ active: false, startTs: 0, durationMs: 60000, reward: 65, energyCost: 12, hungerCost: 8, xpGain: 20, jobId: 'cleaner' }, raw.work || {});
    s.daily = Object.assign({ lastKey: null, streak: 0 }, raw.daily || {});
    if (!Array.isArray(s.purchased)) s.purchased = [];
    if (!Array.isArray(s.shopOwned)) s.shopOwned = [];
    if (!s.friendsCd || typeof s.friendsCd !== 'object') s.friendsCd = {};
    s.bank = Object.assign({ deposit: null, loan: null }, raw.bank || {});
    s.settings = Object.assign({ sound: true, tutorialSeen: false }, raw.settings || {});
    if (s.trip === undefined) s.trip = null;
    if (typeof s.homeIndex   !== 'number') s.homeIndex = 0;
    if (typeof s.eduLevel    !== 'number') s.eduLevel = 0;
    if (typeof s.eduProgress !== 'number') s.eduProgress = 0;

    // ---- Eltelt idő a legutóbbi mentés óta ----
    const last = raw.lastSeen || now();
    let elapsedMs = now() - last;
    if (elapsedMs < 0) elapsedMs = 0; // óra-visszaállítás elleni egyszerű védelem

    const capMs  = CFG.OFFLINE_CAP_HOURS * 3600000;
    const paidMs = Math.min(elapsedMs, capMs);   // csak a sapkáig fizetünk
    const hours  = paidMs / 3600000;

    // 1) Offline passzív jövedelem
    const passive = Math.floor(passivePerHour() * hours);

    // 2) Ha futott egy műszak és letelt távollét alatt → automatikusan beérik
    let shiftPay = 0;
    if (s.work.active && now() >= s.work.startTs + s.work.durationMs) {
      shiftPay = s.work.reward;
      s.energy = clamp(s.energy - (s.work.energyCost || CFG.SHIFT_ENERGY), 0, 100);
      s.hunger = clamp(s.hunger - (s.work.hungerCost || CFG.SHIFT_HUNGER), 0, 100);
      addXp(s.work.xpGain || CFG.SHIFT_XP);
      s.work.active = false;
    }

    // 3) Állapotok sodródása a teljes (nem sapkázott) távollétre
    applyDrift(Math.min(elapsedMs, capMs) / 3600000);

    // 4) Jóváírás
    s.money += passive + shiftPay;

    // 5) Új naptári nap? → frissítjük a "Day" számlálót és az időjárást
    s.weather = pickWeather(now());
    s.day = Math.max(s.day, Math.floor((now() - s.createdAt) / 86400000) + 1);

    // 6) Welcome-back infó – csak ha érdemi idő telt és van mit mutatni
    let away = null;
    if (elapsedMs >= CFG.WELCOME_MIN_MS && (passive + shiftPay) > 0) {
      away = {
        ms:       elapsedMs,
        capped:   elapsedMs > capMs,
        passive:  passive,
        shiftPay: shiftPay,
        total:    passive + shiftPay
      };
    }
    return { firstTime: false, away };
  }

  function save() {
    Game.Platform.saveData(s); // ez állítja be a lastSeen-t és ment
  }

  /* ============================================================
     ÉLŐ JÁTÉK-TICK (másodpercenként hívja a main.js)
     dtMs = az előző tick óta eltelt valós idő.
     ============================================================ */
  function tick(dtMs) {
    const hours = dtMs / 3600000;
    // passzív jövedelem élőben is csorog (folyamatosan "fut" → mindig van haladás)
    s.money += passivePerHour() * hours;
    applyDrift(hours);
  }

  /* ------------------------- XP / szint ------------------------- */
  function xpNeeded(level) { return level * 100; }
  function addXp(n) {
    s.xp += n;
    while (s.xp >= xpNeeded(s.level)) {
      s.xp -= xpNeeded(s.level);
      s.level += 1;
      if (Game.UI) Game.UI.onLevelUp(s.level);
    }
  }

  /* ============================================================
     MŰSZAK (időzített akció látható visszaszámlálóval)
     ============================================================ */
  // jobId opcionális – ha nincs megadva, a kiválasztott munkát (s.jobId) indítja.
  function startShift(jobId) {
    if (s.work.active) return false;
    const job = jobById(jobId || s.jobId);
    if (jobLockReason(job)) return false; // szint VAGY képzettség hiányzik → nem indítható
    s.jobId = job.id;
    s.track = job.track;                  // a karrier-irány a munkából jön
    s.work = {
      active: true, startTs: now(), durationMs: job.ms, reward: job.pay,
      energyCost: Math.round(job.energy * shopMult('jobEnergy')),
      hungerCost: Math.round(job.energy * 0.6),
      xpGain: Math.round(job.xp * shopMult('jobXp')),
      jobId: job.id
    };
    return true;
  }
  function workRemainingMs() {
    if (!s.work.active) return 0;
    return Math.max(0, s.work.startTs + s.work.durationMs - now());
  }
  function workProgress() {
    if (!s.work.active) return 0;
    return clamp(1 - workRemainingMs() / s.work.durationMs, 0, 1);
  }
  function isShiftReady() {
    return s.work.active && workRemainingMs() <= 0;
  }
  // Rewarded HORog #1: azonnal befejezi a műszakot (idő ugrik a végére).
  function speedUpShift() {
    if (!s.work.active) return false;
    s.work.startTs = now() - s.work.durationMs;
    return true;
  }
  // Begyűjtés. doubled=true → 2× jutalom (Rewarded HORog #2).
  function collectShift(doubled) {
    if (!isShiftReady()) return 0;
    const w   = s.work;
    const pay = w.reward * (doubled ? 2 : 1);
    s.money  += pay;
    s.energy  = clamp(s.energy - w.energyCost, 0, 100);
    s.hunger  = clamp(s.hunger - w.hungerCost, 0, 100);
    addXp(w.xpGain);
    s.work.active = false;
    return pay;
  }

  /* ------------------------- egyszerű otthoni akció ------------------------- */
  function rest() {
    s.energy    = clamp(s.energy + CFG.REST_ENERGY * shopMult('restEnergy') + currentHome().rest, 0, 100);
    s.happiness = clamp(s.happiness + CFG.REST_HAPPY, 0, 100);
    addXp(5);
  }
  // Eat: pénzbe kerül, jóllakottságot ad. false, ha nincs elég pénz.
  function eat() {
    if (s.money < CFG.EAT_COST) return false;
    s.money    -= CFG.EAT_COST;
    s.hunger    = clamp(s.hunger + CFG.EAT_HUNGER * shopMult('eatHunger'), 0, 100);
    s.happiness = clamp(s.happiness + CFG.EAT_HAPPY, 0, 100);
    addXp(5);
    return true;
  }
  // Study: energiába kerül, XP-t ad, ÉS a képzettség-létrán is előrevisz.
  // Visszaad: false (nincs energia) | { leveled:null } | { leveled:újSzint }.
  function study() {
    if (s.energy < CFG.STUDY_ENERGY) return false;
    s.energy    = clamp(s.energy - CFG.STUDY_ENERGY, 0, 100);
    s.happiness = clamp(s.happiness + CFG.STUDY_HAPPY, 0, 100);
    addXp(Math.round(CFG.STUDY_XP * shopMult('studyXp')));

    let leveled = null;
    if (s.eduLevel < 3) {
      s.eduProgress += 100 / eduSessionsNeeded(); // egy tanóra haladása
      if (s.eduProgress >= 100 - 0.001) {
        s.eduLevel  += 1;
        s.eduProgress = 0;
        leveled = s.eduLevel;                     // új képzettségi szint
      }
    }
    return { leveled };
  }
  function setAvatar(i)  { if (i >= 0 && i < AVATAR_COUNT) { s.avatarIndex = i; return true; } return false; }
  function selectJob(id) { const j = jobById(id); s.jobId = j.id; return j; }
  function currentJob()  { return jobById(s.jobId); }
  function setName(n)    { n = (n || '').trim().slice(0, 14); if (n) s.name = n; return s.name; }

  // Iskolázottság: 0=No schooling → 1=High School → 2=College → 3=University.
  const EDU_LEVELS = ['No schooling', 'High School', 'College', 'University'];
  const EDU_SESSIONS = [3, 5, 8];       // hány tanóra a következő szinthez (0→1, 1→2, 2→3)
  function eduName(lvl)        { lvl = (lvl == null ? s.eduLevel : lvl); return EDU_LEVELS[lvl] || EDU_LEVELS[0]; }
  function eduSessionsNeeded() { return EDU_SESSIONS[s.eduLevel] || 0; }
  function eduProgressPct()    { return s.eduLevel >= 3 ? 100 : Math.round(s.eduProgress); }

  // Egy munka zárolva van-e? Visszaadja az okot (string) vagy null (elérhető).
  function jobLockReason(job) {
    if (s.eduLevel < job.reqEdu) return 'Needs ' + eduName(job.reqEdu);
    if (s.level    < job.reqLevel) return 'Needs Lv ' + job.reqLevel;
    return null;
  }
  function canWorkJob(job) { return jobLockReason(job) == null; }

  /* ---- Shop ---- */
  function buyShopItem(id) {
    const it = shopById(id);
    if (!it || s.shopOwned.includes(it.id) || s.money < it.price) return null;
    s.money -= it.price;
    s.shopOwned.push(it.id);
    if (it.instant) {               // azonnali stat-bónusz (pl. happiness/energy)
      for (const k in it.instant) s[k] = clamp(s[k] + it.instant[k], 0, 100);
    }
    addXp(15);
    return it;
  }

  /* ---- Friends ---- */
  function friendReadyIn(id) {
    const f = friendById(id); if (!f) return 0;
    const last = s.friendsCd[id] || 0;
    return Math.max(0, last + f.cool - now());
  }
  // Visszaad: 'cooldown' / 'energy' (sikertelen), vagy a barát-objektum (siker).
  function hangOut(id) {
    const f = friendById(id); if (!f) return null;
    if (friendReadyIn(id) > 0) return 'cooldown';
    if (s.energy < f.energy)   return 'energy';
    s.energy    = clamp(s.energy - f.energy, 0, 100);
    s.happiness = clamp(s.happiness + f.happy, 0, 100);
    addXp(f.xp);
    s.friendsCd[id] = now();
    return f;
  }

  /* ---- Bank: lekötött betét ---- */
  function startDeposit(planId, amount) {
    if (s.bank.deposit) return null;            // egyszerre egy betét
    const p = bankPlanById(planId); if (!p) return null;
    amount = Math.floor(amount);
    if (amount < 50 || amount > s.money) return null;
    s.money -= amount;
    s.bank.deposit = { planId: p.id, principal: amount, startTs: now(), termMs: p.termMs, rate: p.rate };
    return s.bank.deposit;
  }
  function depositRemainingMs() { const d = s.bank.deposit; return d ? Math.max(0, d.startTs + d.termMs - now()) : 0; }
  function isDepositReady()     { const d = s.bank.deposit; return !!d && depositRemainingMs() <= 0; }
  function depositReturn()      { const d = s.bank.deposit; return d ? Math.round(d.principal * (1 + d.rate)) : 0; }
  function depositProgress()    { const d = s.bank.deposit; return d ? clamp(1 - depositRemainingMs() / d.termMs, 0, 1) : 0; }
  function speedUpDeposit()     { const d = s.bank.deposit; if (!d) return false; d.startTs = now() - d.termMs; return true; }
  function collectDeposit()     { if (!isDepositReady()) return 0; const pay = depositReturn(); s.money += pay; s.bank.deposit = null; return pay; }

  /* ---- Bank: hitel ---- */
  function loanOwed() { return s.bank.loan ? s.bank.loan.repay : 0; }
  function takeLoan(id) {
    if (s.bank.loan) return null;               // egyszerre egy hitel
    const l = loanById(id); if (!l) return null;
    s.money += l.amount;
    s.bank.loan = { id: l.id, amount: l.amount, repay: l.repay, ts: now() };
    return l;
  }
  function repayLoan() {
    const l = s.bank.loan; if (!l) return false;
    if (s.money < l.repay) return false;
    s.money -= l.repay; s.bank.loan = null; return true;
  }

  /* ---- Lakáspiac ---- */
  function buyHome(id) {
    const idx = HOMES.findIndex(h => h.id === id);
    if (idx !== s.homeIndex + 1) return null;   // csak a következő szintre
    const h = HOMES[idx];
    if (s.money < h.cost) return null;
    s.money -= h.cost;
    s.homeIndex = idx;
    addXp(30);
    return h;
  }

  /* ---- Travel ---- */
  // Visszaad: 'busy' | 'locked' | 'money' | 'energy' (hiba), vagy az úti cél (siker).
  function startTrip(destId) {
    if (s.trip) return 'busy';
    const d = destById(destId); if (!d) return null;
    if (tripLockReason(d))  return 'locked';
    if (s.money  < d.cost)  return 'money';
    if (s.energy < d.energy) return 'energy';
    s.money  -= d.cost;
    s.energy  = clamp(s.energy - d.energy, 0, 100);
    s.trip = { destId: d.id, startTs: now(), durationMs: d.ms, happy: d.happy, xp: d.xp };
    return d;
  }
  function tripRemainingMs() { const t = s.trip; return t ? Math.max(0, t.startTs + t.durationMs - now()) : 0; }
  function isTripReady()     { const t = s.trip; return !!t && tripRemainingMs() <= 0; }
  function tripProgress()    { const t = s.trip; return t ? clamp(1 - tripRemainingMs() / t.durationMs, 0, 1) : 0; }
  function speedUpTrip()     { const t = s.trip; if (!t) return false; t.startTs = now() - t.durationMs; return true; }
  function collectTrip() {
    if (!isTripReady()) return null;
    const t = s.trip;
    s.happiness = clamp(s.happiness + t.happy, 0, 100);
    addXp(t.xp);
    const dest = destById(t.destId);
    s.trip = null;
    return { happy: t.happy, xp: t.xp, dest };
  }

  /* ============================================================
     NEXT GOAL (fejlesztések)
     ============================================================ */
  function currentGoal() {
    return UPGRADES.find(up => !s.purchased.includes(up.id)) || null;
  }
  function canAffordGoal() {
    const g = currentGoal();
    return g ? s.money >= g.cost : false;
  }
  function buyGoal() {
    const g = currentGoal();
    if (!g || s.money < g.cost) return null;
    s.money -= g.cost;
    s.purchased.push(g.id);
    addXp(40);
    return g; // a megvett fejlesztés
  }

  /* ============================================================
     DAILY REWARD / STREAK
     ============================================================ */
  function dailyAvailable() {
    return s.daily.lastKey !== dayKey(now());
  }
  function dailyAmountPreview() {
    // a MAI igényelhető összeg (a streak következő lépcsője)
    const nextStreak = nextStreakValue();
    return Math.min(CFG.DAILY_CAP, CFG.DAILY_BASE + CFG.DAILY_STEP * (nextStreak - 1));
  }
  function nextStreakValue() {
    if (s.daily.lastKey === null) return 1;
    const yesterday = dayKey(now() - 86400000);
    return s.daily.lastKey === yesterday ? s.daily.streak + 1 : 1; // kihagyott nap → reset
  }
  function claimDaily() {
    if (!dailyAvailable()) return null;
    const streak = nextStreakValue();
    const amount = Math.min(CFG.DAILY_CAP, CFG.DAILY_BASE + CFG.DAILY_STEP * (streak - 1));
    s.daily.streak  = streak;
    s.daily.lastKey = dayKey(now());
    s.money += amount;
    addXp(10);
    return { amount, streak };
  }

  // Rewarded HORog #3: az offline welcome-back összeg megduplázása.
  function grantMoney(n) { s.money += n; }

  /* ------------------------- kifelé adott felület ------------------------- */
  return {
    CFG, UPGRADES,
    get: () => s,
    load, save, tick,

    passivePerHour,

    startShift, workRemainingMs, workProgress, isShiftReady,
    speedUpShift, collectShift,
    rest, eat, study,
    JOBS, TRACKS, AVATAR_COUNT, jobById, trackName, currentJob, selectJob, setAvatar, setName,
    eduName, EDU_LEVELS, eduSessionsNeeded, eduProgressPct, jobLockReason, canWorkJob,
    SHOP, FRIENDS, shopById, buyShopItem, friendById, friendReadyIn, hangOut,
    BANK_PLANS, LOANS, HOMES, bankPlanById, loanById, currentHome, homeFloor, buyHome,
    DESTINATIONS, destById, tripLockReason, startTrip, tripRemainingMs, isTripReady, tripProgress, speedUpTrip, collectTrip,
    startDeposit, depositRemainingMs, isDepositReady, depositReturn, depositProgress,
    speedUpDeposit, collectDeposit, loanOwed, takeLoan, repayLoan,

    currentGoal, canAffordGoal, buyGoal,

    dailyAvailable, dailyAmountPreview, nextStreakValue, claimDaily,

    grantMoney, addXp
  };
})();
