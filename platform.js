/* =====================================================================
   platform.js – PORTÁL-WRAPPER
   ---------------------------------------------------------------------
   Ez a réteg választja el a játékot a konkrét portáltól (CrazyGames,
   Poki, GameDistribution...). A játék MINDIG csak a `Game.Platform`
   felületet hívja, sosem közvetlenül egy SDK-t. Így éles kiadáskor
   elég ITT lecserélni az adaptert, a játékkód nem változik.

   Fix felület (ez marad minden adapternél):
     init()                     – adapter indítása
     loadData()                 – mentett állapot (időbélyeggel) vagy null
     saveData(stateObject)      – ment + frissíti a lastSeen időbélyeget
     showRewardedAd(onReward)   – siker esetén meghívja onReward()
     showInterstitialAd()       – köztes reklám (nézetváltáskor)
   ===================================================================== */

window.Game = window.Game || {};

Game.Platform = (function () {
  'use strict';

  const SAVE_KEY = 'varosi_elet_save_v1';

  /* -------------------------------------------------------------------
     LOCAL ADAPTER (mock) – SDK NÉLKÜL is tesztelhető.
     A mentés a böngésző localStorage-ébe megy. A reklámok csak
     "szimulálnak": rövid késleltetés után meghívják a jutalom-callbacket.
     Éles kiadáskor ezt váltja le pl. a CrazyGamesAdapter.
  ------------------------------------------------------------------- */
  const LocalAdapter = {
    name: 'Local',

    init() {
      console.log('[Platform] Local adapter elindult (mock mentés + mock reklámok).');
    },

    loadData() {
      try {
        const raw = localStorage.getItem(SAVE_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (e) {
        console.warn('[Platform] loadData hiba:', e);
        return null;
      }
    },

    // FONTOS: a mentés tartalmazza a lastSeen időbélyeget – ebből számoljuk
    // visszatéréskor az offline-haladást.
    saveData(state) {
      state.lastSeen = Date.now();
      try {
        localStorage.setItem(SAVE_KEY, JSON.stringify(state));
      } catch (e) {
        console.warn('[Platform] saveData hiba:', e);
      }
      return state.lastSeen;
    },

    // Jutalmazott reklám: a valódi SDK itt teljes képernyős videót játszana,
    // és CSAK végignézés után hívná a callbacket. A mockban ezt egy rövid
    // "Loading ad…" toast + 0.6s késleltetés szimulálja.
    showRewardedAd(onReward) {
      if (Game.UI) Game.UI.toast('🎬 Rewarded ad… (Local stub)');
      setTimeout(() => {
        if (typeof onReward === 'function') onReward();
      }, 600);
    },

    // Köztes reklám: itt csak logol + toastol. Éles SDK teljes képernyőset mutatna.
    showInterstitialAd() {
      console.log('[Platform] Interstitial ad (Local stub).');
      if (Game.UI) Game.UI.toast('🎬 Interstitial ad (Local stub)');
    }
  };

  /* -------------------------------------------------------------------
     PÉLDA a későbbi cserére (most NINCS bekapcsolva):

     const CrazyGamesAdapter = {
       name: 'CrazyGames',
       async init(){ this.sdk = window.CrazyGames.SDK; await this.sdk.init(); },
       async loadData(){ return await this.sdk.data.getItem(SAVE_KEY); },
       async saveData(s){ s.lastSeen = Date.now(); await this.sdk.data.setItem(SAVE_KEY, s); return s.lastSeen; },
       showRewardedAd(cb){ this.sdk.ad.requestAd('rewarded', { adFinished: cb }); },
       showInterstitialAd(){ this.sdk.ad.requestAd('midgame'); }
     };
  ------------------------------------------------------------------- */

  // Az AKTÍV adapter. Éles kiadáskor: active = CrazyGamesAdapter;
  let active = LocalAdapter;

  return {
    init()                  { return active.init(); },
    loadData()              { return active.loadData(); },
    saveData(state)         { return active.saveData(state); },
    showRewardedAd(onReward){ return active.showRewardedAd(onReward); },
    showInterstitialAd()    { return active.showInterstitialAd(); },
    name()                  { return active.name; }
  };
})();
