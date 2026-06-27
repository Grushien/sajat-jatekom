/* =====================================================================
   sound.js – EGYSZERŰ HANGEFFEKTEK (Web Audio, asset-fájlok NÉLKÜL)
   ---------------------------------------------------------------------
   A hangokat menet közben "szintetizáljuk" oszcillátorral, így nem kell
   semmilyen .mp3/.wav. A Settings → Sound kapcsoló némítja
   (Game.State settings.sound). A böngésző miatt az AudioContextet csak
   egy felhasználói gesztus (kattintás) után szabad elindítani → unlock().
   ===================================================================== */

window.Game = window.Game || {};

Game.Sound = (function () {
  'use strict';

  let ctx = null;

  function ac() {
    if (!ctx) {
      try { ctx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch (e) { ctx = null; }
    }
    return ctx;
  }

  function enabled() {
    // ha nincs még State, alapból szól; ha a beállítás false, néma
    try { return Game.State.get().settings.sound !== false; }
    catch (e) { return true; }
  }

  // Egy rövid hang: hangmagasság-szekvencia + lágy lecsengés.
  function tone(freqs, dur, type, gain) {
    if (!enabled()) return;
    const a = ac(); if (!a) return;
    if (a.state === 'suspended') a.resume();
    const t0 = a.currentTime;
    const g = a.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain || 0.12, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    g.connect(a.destination);
    freqs.forEach((f, i) => {
      const o = a.createOscillator();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(f, t0 + i * 0.06);
      o.connect(g);
      o.start(t0 + i * 0.06);
      o.stop(t0 + dur + 0.02);
    });
  }

  // Effekt-könyvtár
  const SOUNDS = {
    click:   () => tone([520],                 0.07, 'triangle', 0.07),
    coin:    () => tone([880, 1320],           0.18, 'square',   0.06),
    success: () => tone([660, 990],            0.22, 'triangle', 0.11),
    levelup: () => tone([523, 659, 784, 1046], 0.42, 'triangle', 0.12),
    error:   () => tone([200, 150],            0.18, 'sawtooth', 0.07)
  };

  return {
    play(name) { const f = SOUNDS[name]; if (f) f(); },
    // Első felhasználói gesztusnál meghívandó, hogy a hang engedélyezett legyen.
    unlock() { const a = ac(); if (a && a.state === 'suspended') a.resume(); }
  };
})();
