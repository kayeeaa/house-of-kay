/* ======================================================================
   engine/snap.js  —  Snap in the Creative tab's Games. Based on the old standalone Snap! game, drawn in
   Voxie's style: a bot number and your number change on their own timers; press SNAP when they match.
   Modes: classic (match the numbers) and hard (match on numbers and on colours).
   30 seconds of warm-up learns how fast you are (no score), then 30 scored seconds tuned to you:
   +5 a snap, -5 a wrong snap or a missed match. Finish above 0 to win.
   This file only plays the game: app.js saves the result and the server gives the XP (save_snap_result).
   ====================================================================== */
const SNAP_MODES = {
  classic: { label: "Classic", rule: "Match the numbers", numMax: 100, colours: false,
    description: "SNAP when the two numbers match. +5 a snap, −5 a miss. Finish above 0 to win 3 XP (1 XP for trying)." },
  hard:    { label: "Hard", rule: "Match on numbers and colours", numMax: 50, colours: true,
    description: "SNAP when the numbers match, and when the colours match. +5 a snap, −5 a miss. Finish above 0 to win 3 XP (1 XP for trying)." }
};

/* ui: { arena, cards: [bot, player], botNumber, playerNumber, snapButton, message, score, phase, progress, countdown,
         overlay, overlaySmall, overlayBig, overlayText }
   onEnd(score, won) when the 60 seconds are up. */
function createSnapGame(ui, { onEnd }) {
  const Game = {
    score: 0, botNum: 0, playerNum: 0, isMatch: false, running: false, mode: "classic",
    _justSnapped: false, _gameStartTime: 0, _duration: 60000, _isColour: false, _numMax: 100,

    // Learning phase
    _learningDuration: 30000,
    _learningSamples: [], _learningWindows: 0, _matchOpenTime: 0,
    _colorLearningSamples: [], _colorLearningWindows: 0, _colorMatchOpenTime: 0,
    _expiredWindows: 0,  // match opened but the player didn't press in time
    _falseSnaps: 0,      // player pressed when no match was open
    // Show time
    _showTimeFired: false, _showTimeTimer: null, _gamePlanStartTime: 0,
    // Tuned to the player after the warm-up
    _matchWindow: 1000, _playerStartFactor: 1.0, _colorMatchWindow: 1200, _colorPlayerStartFactor: 1.0,

    // Colour matching (hard)
    _botColor: "", _playerColor: "", _isColorMatch: false, _colorMatchWindowTimer: null,
    _lastMatchColor: "", _lastMatchClosedTime: 0, _nextGuaranteedMatchType: "number",

    _botTimer: null, _playerTimer: null, _matchWindowTimer: null, _msgTimer: null, _greedyTimer: null, _hitHoldTimer: null,
    _botColorTimer: null, _playerColorTimer: null, _firstMatchTimer: null, _safetyTimer: null,
    _gameEndTimer: null, _countdownTimer: null, _overlayTimer: null,

    BOT_MIN: 1500, BOT_MAX: 2500,
    PLAY_MIN: 1700, PLAY_MAX: 2800,
    NUDGE_CHANCE: 0.15,
    FIRST_MATCH_MIN: 2000, FIRST_MATCH_MAX: 6500,
    SAFETY_WINDOW: 30000,
    MIN_MATCH_GAP: 1200,
    SPEED_MIN_FACTOR: 0.35,
    HIT_HOLD_MS: 320,

    _colorPalette: ["#ff1744", "#ff6d00", "#ffd600", "#00c853", "#00e5ff", "#2979ff", "#d500f9", "#ff4081"],
    _hardColorPalette: ["#ff2aa3", "#0057ff", "#00d7c7", "#ffe600", "#7a00ff", "#ff6b00"],
    _activeColorPalette: [],
    _greedyMessages: ["Don't be greedy, you've got those points!", "Oi! You already got that one!", "Cool your jets, that one's yours!", "Once is enough, champ!"],

    _holdHitFrame(callback) { clearTimeout(this._hitHoldTimer); this._hitHoldTimer = setTimeout(callback, this.HIT_HOLD_MS); },
    _showOverlay(small, big, text) {
      ui.overlaySmall.textContent = small; ui.overlayBig.textContent = big; ui.overlayText.textContent = text;
      ui.overlay.hidden = false;
    },

    // ── Lifecycle ─────────────────────────────────────────
    start(mode) {
      this.stop();
      const settings = SNAP_MODES[mode] || SNAP_MODES.classic;
      this.mode = SNAP_MODES[mode] ? mode : "classic";
      this._isColour = settings.colours;
      this._numMax = settings.numMax;
      this._learningSamples = []; this._learningWindows = 0; this._matchOpenTime = 0;
      this._colorLearningSamples = []; this._colorLearningWindows = 0; this._colorMatchOpenTime = 0;
      this._expiredWindows = 0; this._falseSnaps = 0;
      this._showTimeFired = false; this._gamePlanStartTime = 0;
      this._matchWindow = 1000; this._playerStartFactor = 1.0; this._colorMatchWindow = 1200; this._colorPlayerStartFactor = 1.0;
      this._isColorMatch = false; this._lastMatchColor = ""; this._lastMatchClosedTime = 0; this._nextGuaranteedMatchType = "number";
      this._botColor = ""; this._playerColor = "";
      this._activeColorPalette = this.mode === "hard" ? this._hardColorPalette : this._colorPalette;
      this.running = true;
      ui.arena.dataset.mode = this.mode;
      ui.arena.dataset.phase = "warmup";
      ui.phase.textContent = "Warm-up";
      ui.score.textContent = "--";
      this._updateProgress(this._learningDuration, this._learningDuration);
      // The warm-up message shows first; nothing starts until it goes.
      this._showOverlay("Warm-up", "Get ready!", `Just play: I'm learning how fast you are. No score yet. ${settings.rule}.`);
      this._overlayTimer = setTimeout(() => { ui.overlay.hidden = true; this._beginGame(); }, 2500);
    },

    _beginGame() {
      this.score = 0;
      this._justSnapped = false;
      this._gameStartTime = Date.now();
      this._updateScore();
      this.botNum = this._randInt(1, this._numMax);
      do { this.playerNum = this._randInt(1, this._numMax); } while (this.playerNum === this.botNum);
      this._setWithPulse(ui.botNumber, this.botNum);
      this._setWithPulse(ui.playerNumber, this.playerNum);
      this._scheduleBotChange();
      this._schedulePlayerChange();
      if (this._isColour) this._startColorCycles();
      this._scheduleFirstMatch();
      this._resetSafetyTimer();
      this._startCountdown();
      this._showTimeTimer = setTimeout(() => this._triggerShowTime(), this._learningDuration);
      this._gameEndTimer = setTimeout(() => this._endGame(), this._duration);
    },

    /* Stops without a result (leaving the screen, or Stop). */
    stop() {
      if (!this.running) return;
      this._stopRun();
    },

    _endGame() {
      const score = this.score, won = score > 0;
      this._stopRun();
      onEnd(score, won);
    },

    _stopRun() {
      [this._botTimer, this._playerTimer, this._matchWindowTimer, this._colorMatchWindowTimer, this._msgTimer, this._greedyTimer,
       this._hitHoldTimer, this._firstMatchTimer, this._safetyTimer, this._showTimeTimer, this._gameEndTimer, this._overlayTimer].forEach(clearTimeout);
      this._stopCountdown();
      this._stopColorCycles();
      ui.overlay.hidden = true;
      delete ui.arena.dataset.phase;
      this.running = false;
      this.isMatch = false;
      this._isColorMatch = false;
      this._justSnapped = false;
      ui.botNumber.textContent = "--";
      ui.playerNumber.textContent = "--";
      ui.message.className = "snap-message";
      ui.message.textContent = "";
    },

    // ── Learning → Show time ──────────────────────────────
    _triggerShowTime() {
      // Close any open match without scheduling new numbers.
      if (this.isMatch) { clearTimeout(this._matchWindowTimer); this.isMatch = false; this._matchOpenTime = 0; this._divergeBoth(); }
      if (this._isColorMatch) { clearTimeout(this._colorMatchWindowTimer); this._isColorMatch = false; this._colorMatchOpenTime = 0; this._divergeBoth(); }
      // Freeze every timer while GO! shows.
      [this._botTimer, this._playerTimer, this._firstMatchTimer, this._safetyTimer, this._gameEndTimer].forEach(clearTimeout);
      this._stopCountdown();

      this._buildPlayerProfile();
      this._showTimeFired = true;
      this._gamePlanStartTime = 0;
      this.score = 0;
      this._updateScore();
      ui.arena.dataset.phase = "scored";
      ui.phase.textContent = "Now it counts";
      this._updateProgress(this._duration - this._learningDuration, this._duration - this._learningDuration);
      this._showOverlay("Show time", "GO!", "Now it counts: beat your own speed. +5 a snap, -5 a miss. Finish above 0 to win.");

      this._overlayTimer = setTimeout(() => {
        ui.overlay.hidden = true;
        // A fresh 30-second scored run.
        const scoredDuration = this._duration - this._learningDuration, now = Date.now();
        this._gamePlanStartTime = now;
        this._gameStartTime = now - this._learningDuration;
        this._scheduleBotChange();
        this._schedulePlayerChange();
        this._resetSafetyTimer();
        this._startCountdown();
        this._gameEndTimer = setTimeout(() => this._endGame(), scoredDuration);
      }, 2000);
    },

    /* Tunes the scored half to the player: their reaction times, hit rate, steadiness and wrong snaps. */
    _buildPlayerProfile() {
      // Of all presses, how many were wrong guesses? (Missed matches aren't presses; they're in the hit rate.)
      const successfulPresses = this._learningSamples.length + this._colorLearningSamples.length;
      const totalPresses = successfulPresses + this._falseSnaps;
      const falseSnapRate = totalPresses > 0 ? this._falseSnaps / totalPresses : 0.2;

      const hits = this._learningSamples.length;
      const hitRate = this._learningWindows > 0 ? hits / this._learningWindows : 0.5;
      const numberProfile = this._reactionProfile(this._learningSamples, 450, 350);
      const rxnNorm = Math.max(0, Math.min(1, (numberProfile.avg - 150) / 600));
      // 0 = sharp (tight window, fast start) → 1 = finding it hard (more time, slower start)
      const difficulty = rxnNorm * 0.35 + (1 - hitRate) * 0.35 + numberProfile.sdNorm * 0.20 + falseSnapRate * 0.10;
      this._matchWindow = Math.round(650 + difficulty * 550);
      this._playerStartFactor = 0.50 + difficulty * 0.35;
      if (!this._isColour) return;

      const cHitRate = this._colorLearningWindows > 0 ? this._colorLearningSamples.length / this._colorLearningWindows : 0.5;
      const colorProfile = this._reactionProfile(this._colorLearningSamples, 500, 400);
      const cRxnNorm = Math.max(0, Math.min(1, (colorProfile.avg - 150) / 700));
      const cDifficulty = cRxnNorm * 0.35 + (1 - cHitRate) * 0.35 + colorProfile.sdNorm * 0.20 + falseSnapRate * 0.10;
      this._colorMatchWindow = Math.round(850 + cDifficulty * 650);
      this._colorPlayerStartFactor = 0.55 + cDifficulty * 0.35;
    },

    // ── Match guarantees ──────────────────────────────────
    _scheduleFirstMatch() {
      this._firstMatchTimer = setTimeout(() => this._forceGuaranteedMatch(), this._randInt(this.FIRST_MATCH_MIN, this.FIRST_MATCH_MAX));
    },
    _resetSafetyTimer() {
      clearTimeout(this._safetyTimer);
      this._safetyTimer = setTimeout(() => { this._forceGuaranteedMatch(); this._resetSafetyTimer(); }, this.SAFETY_WINDOW);
    },
    _forceGuaranteedMatch() {
      if (this.isMatch || this._isColorMatch) return;
      if (this._isColour && this._nextGuaranteedMatchType === "color") { this._forceColorMatch(); this._nextGuaranteedMatchType = "number"; return; }
      this._forceNumberMatch();
      if (this._isColour) this._nextGuaranteedMatchType = "color";
    },
    _forceNumberMatch() {
      clearTimeout(this._botTimer);
      this.botNum = this.playerNum;
      this._setWithPulse(ui.botNumber, this.botNum);
      if (this._isColour) this._cycleBotColor();
      this._checkMatch(true);
    },
    _forceColorMatch() {
      [this._botColorTimer, this._botTimer, this._playerTimer].forEach(clearTimeout);
      const matchColor = this._playerColor === this._lastMatchColor
        ? this._pick(this._activeColorPalette.filter(color => color !== this._lastMatchColor))
        : this._playerColor;
      this.botNum = this._randInt(1, this._numMax);
      this._setWithPulse(ui.botNumber, this.botNum);
      do { this.playerNum = this._randInt(1, this._numMax); } while (this.playerNum === this.botNum);
      this._setWithPulse(ui.playerNumber, this.playerNum);
      this._botColor = matchColor; this._playerColor = matchColor;
      ui.botNumber.style.color = matchColor; ui.playerNumber.style.color = matchColor;
      this._checkColorMatch(true);
    },

    // ── Speed ramps: numbers change faster as the scored half goes on ──
    _rampFactor(startFactor) {
      if (!this._showTimeFired) return 1.0;
      const t = Math.min((Date.now() - this._gamePlanStartTime) / (this._duration - this._learningDuration), 1);
      return startFactor - t * (startFactor - this.SPEED_MIN_FACTOR);
    },
    _scaledRandInt(min, max) { const f = this._rampFactor(this._playerStartFactor); return this._randInt(Math.round(min * f), Math.round(max * f)); },

    // ── Countdown ─────────────────────────────────────────
    _updateProgress(remaining, duration) {
      ui.countdown.textContent = Math.ceil(remaining / 1000);
      ui.progress.style.transform = `scaleX(${remaining / duration})`;
    },
    _startCountdown() {
      const tick = () => {
        const phaseDuration = this._showTimeFired ? this._duration - this._learningDuration : this._learningDuration;
        const phaseStart = this._showTimeFired ? this._gamePlanStartTime : this._gameStartTime;
        const remaining = Math.max(0, phaseDuration - (Date.now() - phaseStart));
        this._updateProgress(remaining, phaseDuration);
        if (remaining > 0) this._countdownTimer = setTimeout(tick, 200);
      };
      tick();
    },
    _stopCountdown() { clearTimeout(this._countdownTimer); },

    // ── Each number changes on its own timer ──────────────
    _scheduleBotChange() {
      this._botTimer = setTimeout(() => {
        const nudge = this._showTimeFired ? this.NUDGE_CHANCE : 0.25;
        this.botNum = Math.random() < nudge ? this.playerNum : this._randInt(1, this._numMax);
        this._setWithPulse(ui.botNumber, this.botNum);
        if (this._isColour) this._cycleBotColor();
        this._checkMatch();
        if (!this.isMatch) this._checkColorMatch();
        if (!this.isMatch && !this._isColorMatch) this._scheduleBotChange();
      }, this._scaledRandInt(this.BOT_MIN, this.BOT_MAX));
    },
    _schedulePlayerChange() {
      this._playerTimer = setTimeout(() => {
        this.playerNum = this._randInt(1, this._numMax);
        this._setWithPulse(ui.playerNumber, this.playerNum);
        if (this._isColour) this._cyclePlayerColor();
        this._checkMatch();
        if (!this.isMatch) this._checkColorMatch();
        if (!this.isMatch && !this._isColorMatch) this._schedulePlayerChange();
      }, this._scaledRandInt(this.PLAY_MIN, this.PLAY_MAX));
    },

    // ── Number match ──────────────────────────────────────
    _checkMatch(isGuaranteed = false) {
      if (this.botNum !== this.playerNum) return;
      if (this.isMatch || this._isColorMatch) return;   // one open match at a time
      if (!isGuaranteed && !this._canOpenMatch()) return;
      [this._botTimer, this._playerTimer, this._firstMatchTimer].forEach(clearTimeout);
      this._resetSafetyTimer();
      this.isMatch = true;
      this._matchOpenTime = Date.now();
      this._justSnapped = false;
      clearTimeout(this._greedyTimer);
      if (!this._showTimeFired) this._learningWindows++;
      this._matchWindowTimer = setTimeout(() => {
        this.isMatch = false; this._matchOpenTime = 0;
        this._markMatchClosed();
        this._recordMiss(true);
        this._divergeBoth();
        this._scheduleBotChange(); this._schedulePlayerChange();
      }, this._matchWindow);
    },

    // ── Colour match (hard) ───────────────────────────────
    _checkColorMatch(isGuaranteed = false) {
      if (!this._isColour) return false;
      if (this._botColor !== this._playerColor) return false;
      if (this.isMatch || this._isColorMatch) return false;
      if (!isGuaranteed && !this._canOpenMatch()) return false;
      if (this._botColor === this._lastMatchColor) return false;   // never the same colour twice in a row
      [this._botColorTimer, this._playerColorTimer, this._botTimer, this._playerTimer].forEach(clearTimeout);
      this._isColorMatch = true;
      this._colorMatchOpenTime = Date.now();
      this._justSnapped = false;
      clearTimeout(this._greedyTimer);
      if (!this._showTimeFired) this._colorLearningWindows++;
      this._resetSafetyTimer();
      this._colorMatchWindowTimer = setTimeout(() => {
        this._isColorMatch = false; this._colorMatchOpenTime = 0;
        this._markMatchClosed();
        this._recordMiss(true);
        this._divergeBoth();
        this._scheduleBotChange(); this._schedulePlayerChange();
      }, this._colorMatchWindow);
      return true;
    },

    // ── SNAP! ─────────────────────────────────────────────
    handleSnap() {
      if (!this.running || !ui.overlay.hidden) return;
      if (this.isMatch || this._isColorMatch) {
        const colour = this._isColorMatch;
        if (!this._showTimeFired) {
          if (colour && this._colorMatchOpenTime > 0) this._colorLearningSamples.push(Date.now() - this._colorMatchOpenTime);
          if (!colour && this._matchOpenTime > 0) this._learningSamples.push(Date.now() - this._matchOpenTime);
        }
        if (colour) {
          this._colorMatchOpenTime = 0; this._isColorMatch = false;
          clearTimeout(this._colorMatchWindowTimer);
          this._lastMatchColor = this._botColor;
        } else {
          this._matchOpenTime = 0; this.isMatch = false;
          clearTimeout(this._matchWindowTimer);
        }
        this._markMatchClosed();
        this.score += 5;
        this._updateScore();
        this._flashCards("snap-hit");
        this._justSnapped = true;
        clearTimeout(this._greedyTimer);
        this._greedyTimer = setTimeout(() => { this._justSnapped = false; }, colour ? this._colorMatchWindow : this._matchWindow);
        // Hold the matched numbers for a moment so the hit feels good.
        this._holdHitFrame(() => { this._divergeBoth(); this._scheduleBotChange(); this._schedulePlayerChange(); });
      } else if (this._justSnapped) {
        this.showMessage(this._pick(this._greedyMessages), "fail");
      } else {
        this._recordMiss(false);
      }
    },

    // ── Colours: a card's colour changes only when its number does ──
    _startColorCycles() { this._cycleBotColor(true); this._cyclePlayerColor(true); },
    _cycleBotColor(avoidMatch = false) {
      let colour;
      do { colour = this._pick(this._activeColorPalette); }
      while (colour === this._botColor || (avoidMatch && colour === this._playerColor) || (colour === this._playerColor && colour === this._lastMatchColor));
      this._botColor = colour;
      ui.botNumber.style.color = colour;
    },
    _cyclePlayerColor(avoidMatch = false) {
      let colour;
      do { colour = this._pick(this._activeColorPalette); }
      while (colour === this._playerColor || (avoidMatch && colour === this._botColor) || (colour === this._botColor && colour === this._lastMatchColor));
      this._playerColor = colour;
      ui.playerNumber.style.color = colour;
    },
    _stopColorCycles() {
      [this._botColorTimer, this._playerColorTimer].forEach(clearTimeout);
      ui.botNumber.style.color = ""; ui.playerNumber.style.color = "";
      this._botColor = ""; this._playerColor = "";
    },

    // ── Helpers ───────────────────────────────────────────
    showMessage(text, type) {
      clearTimeout(this._msgTimer);
      ui.message.textContent = text;
      ui.message.className = `snap-message show ${type}`;
      this._msgTimer = setTimeout(() => { ui.message.className = "snap-message"; ui.message.textContent = ""; }, 1100);
    },
    _updateScore() { ui.score.textContent = this._showTimeFired ? this.score : "--"; },
    _recordMiss(expired = false) {
      if (!this._showTimeFired) { if (expired) this._expiredWindows++; else this._falseSnaps++; }
      this._flashCards("snap-miss");
      this.score -= 5;
      this._updateScore();
      if (expired) this.showMessage("MISSED!", "fail");
    },
    _setWithPulse(element, value) {
      element.textContent = value;
      element.classList.remove("pulse"); void element.offsetWidth; element.classList.add("pulse");
    },
    _flashCards(className) {
      ui.cards.forEach(card => {
        card.classList.remove("snap-hit", "snap-miss"); void card.offsetWidth;
        card.classList.add(className);
        setTimeout(() => card.classList.remove(className), className === "snap-hit" ? 750 : 500);
      });
    },
    _canOpenMatch() { return Date.now() - this._lastMatchClosedTime >= this.MIN_MATCH_GAP; },
    _markMatchClosed() { this._lastMatchClosedTime = Date.now(); },
    /* Average reaction (the fastest and slowest 15% trimmed) and how steady it is (0 steady → 1 all over the place). */
    _reactionProfile(samples, fallbackAvg, sdScale) {
      if (!samples.length) return { avg: fallbackAvg, sdNorm: 0.5 };
      const sorted = [...samples].sort((a, b) => a - b);
      const trim = sorted.length >= 5 ? Math.floor(sorted.length * 0.15) : 0;
      const usable = sorted.slice(trim, sorted.length - trim || sorted.length);
      const avg = usable.reduce((a, b) => a + b, 0) / usable.length;
      if (usable.length < 3) return { avg, sdNorm: 0.5 };
      const sd = Math.sqrt(usable.reduce((sum, t) => sum + (t - avg) ** 2, 0) / usable.length);
      return { avg, sdNorm: Math.min(1, sd / sdScale) };
    },
    _divergeBoth() {
      this.botNum = this._randInt(1, this._numMax);
      this._setWithPulse(ui.botNumber, this.botNum);
      do { this.playerNum = this._randInt(1, this._numMax); } while (this.playerNum === this.botNum);
      this._setWithPulse(ui.playerNumber, this.playerNum);
      if (this._isColour) { this._cycleBotColor(true); this._cyclePlayerColor(true); }
    },
    _pick(list) { return list[Math.floor(Math.random() * list.length)]; },
    _randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
  };

  // SNAP counts on press-down (finger, mouse or pen), so a match is judged when you press, not when you let go.
  let handledOnPress = false;
  ui.snapButton.addEventListener("pointerdown", event => {
    if (event.button && event.button !== 0) return;
    handledOnPress = true;
    event.preventDefault();
    Game.handleSnap();
  });
  ui.snapButton.addEventListener("click", () => { if (handledOnPress) { handledOnPress = false; return; } Game.handleSnap(); });
  // Space or Enter snaps while a game is on screen.
  document.addEventListener("keydown", event => {
    if (event.repeat || (event.key !== " " && event.key !== "Enter") || !Game.running || !ui.arena.offsetParent) return;
    event.preventDefault();
    Game.handleSnap();
  });

  return { start: mode => Game.start(mode), stop: () => Game.stop(), isRunning: () => Game.running };
}
