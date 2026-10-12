(() => {
  const STORAGE_KEY = 'morse-key-settings-v2';
  const defaults = { frequency: 600, volume: 60, muted: false, wpm: 12 };
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || localStorage.getItem('paddle-key-settings-v1') || localStorage.getItem('straight-key-settings-v1') || 'null') || {};
  } catch { saved = {}; }
  const settings = { ...defaults, ...saved };

  const $ = (id) => document.getElementById(id);
  const straightKey = $('straightKey');
  const ditPaddle = $('ditPaddle');
  const dahPaddle = $('dahPaddle');
  const shell = document.querySelector('.console-shell');
  const heldPaddles = new Set();
  const paddleQueue = [];
  let audioContext = null;
  let oscillator = null;
  let gainNode = null;
  let compressor = null;
  let activeMode = null;
  let activeSide = null;
  let elementOffTimer = null;
  let paddleAdvanceTimer = null;

  function persist() { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); }

  function setRangeFill(input) {
    const min = Number(input.min || 0);
    const max = Number(input.max || 100);
    const percentage = ((Number(input.value) - min) / (max - min)) * 100;
    input.style.setProperty('--range-progress', `${percentage}%`);
  }

  function updateSettingsUi() {
    const frequencySlider = $('frequencySlider');
    const speedSlider = $('speedSlider');
    const volumeSlider = $('volumeSlider');
    frequencySlider.value = settings.frequency;
    speedSlider.value = settings.wpm;
    volumeSlider.value = settings.volume;
    $('frequencyDisplay').textContent = `${settings.frequency} Hz`;
    $('frequencyOutput').textContent = `${settings.frequency} Hz`;
    $('headerFrequency').textContent = `${settings.frequency} HZ`;
    $('speedOutput').textContent = `${settings.wpm} WPM`;
    $('volumeOutput').textContent = `${settings.volume}%`;
    $('muteToggle').checked = settings.muted;
    [frequencySlider, speedSlider, volumeSlider].forEach(setRangeFill);
  }

  function outputLevel() { return settings.muted ? 0 : Math.max(0, Math.min(1, settings.volume / 100)) * 0.22; }

  function ensureAudio() {
    if (!audioContext) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return false;
      audioContext = new AudioContextClass();
      oscillator = audioContext.createOscillator();
      gainNode = audioContext.createGain();
      compressor = audioContext.createDynamicsCompressor();
      oscillator.type = 'sine';
      oscillator.frequency.value = settings.frequency;
      gainNode.gain.value = 0;
      compressor.threshold.value = -18;
      compressor.knee.value = 12;
      compressor.ratio.value = 4;
      compressor.attack.value = 0.002;
      compressor.release.value = 0.08;
      oscillator.connect(gainNode).connect(compressor).connect(audioContext.destination);
      oscillator.start();
    }
    if (audioContext.state === 'suspended') audioContext.resume();
    return true;
  }

  function updatePaddleUi() {
    const ditHeld = heldPaddles.has('dit');
    const dahHeld = heldPaddles.has('dah');
    ditPaddle.classList.toggle('held', ditHeld);
    dahPaddle.classList.toggle('held', dahHeld);
    ditPaddle.setAttribute('aria-pressed', String(ditHeld));
    dahPaddle.setAttribute('aria-pressed', String(dahHeld));
  }

  function setVisualState(mode, side) {
    const straightActive = mode === 'straight';
    const ditActive = mode === 'paddle' && side === 'dit';
    const dahActive = mode === 'paddle' && side === 'dah';
    straightKey.classList.toggle('pressed', straightActive);
    ditPaddle.classList.toggle('active', ditActive);
    dahPaddle.classList.toggle('active', dahActive);
    shell.classList.toggle('key-down', Boolean(mode));
    $('statusLed').classList.toggle('active', Boolean(mode));
    const label = straightActive ? 'STRAIGHT KEY' : ditActive ? 'DIT' : dahActive ? 'DAH' : '';
    $('statusText').textContent = label ? `${label} PLAYING` : 'READY';
    $('footerState').textContent = label ? `${label} PLAYING` : 'KEYS RELEASED';
    $('statusLed').setAttribute('aria-label', label ? `${label} playing` : 'Keys released');
    straightKey.setAttribute('aria-pressed', String(straightActive));
    updatePaddleUi();
  }

  function fadeTone() {
    if (!gainNode || !audioContext) return;
    const now = audioContext.currentTime;
    gainNode.gain.cancelScheduledValues(now);
    gainNode.gain.setTargetAtTime(0, now, 0.006);
  }

  function stopCurrentTone() {
    if (elementOffTimer) { window.clearTimeout(elementOffTimer); elementOffTimer = null; }
    activeMode = null;
    activeSide = null;
    fadeTone();
    setVisualState(null, null);
  }

  function startElement(mode, side, duration) {
    if (!ensureAudio()) return false;
    if (elementOffTimer) window.clearTimeout(elementOffTimer);
    activeMode = mode;
    activeSide = side;
    setVisualState(mode, side);
    const now = audioContext.currentTime;
    gainNode.gain.cancelScheduledValues(now);
    gainNode.gain.setTargetAtTime(outputLevel(), now, 0.004);
    if (duration) {
      elementOffTimer = window.setTimeout(() => {
        elementOffTimer = null;
        fadeTone();
        activeMode = null;
        activeSide = null;
        setVisualState(null, null);
      }, duration);
    }
    return true;
  }

  function nextPaddleSide(previousSide) {
    if (heldPaddles.size === 2) return previousSide === 'dit' ? 'dah' : 'dit';
    return heldPaddles.has('dit') ? 'dit' : 'dah';
  }

  function emitPaddleElement(side) {
    const ditMs = 1200 / settings.wpm;
    const duration = side === 'dit' ? ditMs : ditMs * 3;
    if (!startElement('paddle', side, duration)) return;
    paddleAdvanceTimer = window.setTimeout(() => {
      paddleAdvanceTimer = null;
      const queuedSide = paddleQueue.shift();
      const nextSide = queuedSide || (heldPaddles.size ? nextPaddleSide(side) : null);
      if (nextSide) emitPaddleElement(nextSide);
    }, duration + ditMs);
  }

  function pressPaddle(side) {
    if (heldPaddles.has(side)) return;
    if (activeMode === 'straight') stopCurrentTone();
    heldPaddles.add(side);
    updatePaddleUi();
    if (activeMode === 'paddle' || paddleAdvanceTimer) {
      paddleQueue.push(side);
    } else {
      emitPaddleElement(side);
    }
  }

  function releasePaddle(side) {
    heldPaddles.delete(side);
    updatePaddleUi();
  }

  function startStraightTone() {
    if (activeMode === 'straight') return;
    heldPaddles.clear();
    paddleQueue.length = 0;
    if (paddleAdvanceTimer) { window.clearTimeout(paddleAdvanceTimer); paddleAdvanceTimer = null; }
    stopCurrentTone();
    startElement('straight', 'straight', null);
  }

  function stopAllInputs() {
    heldPaddles.clear();
    paddleQueue.length = 0;
    if (paddleAdvanceTimer) { window.clearTimeout(paddleAdvanceTimer); paddleAdvanceTimer = null; }
    stopCurrentTone();
  }

  function isFormField(target) {
    const tagName = target?.tagName?.toLowerCase();
    return target?.isContentEditable || ['input', 'select', 'textarea'].includes(tagName);
  }

  function setAudioFrequency() {
    if (oscillator && audioContext) oscillator.frequency.setTargetAtTime(settings.frequency, audioContext.currentTime, 0.003);
  }

  $('frequencySlider').addEventListener('input', (event) => {
    settings.frequency = Number(event.target.value);
    $('frequencyDisplay').textContent = `${settings.frequency} Hz`;
    $('frequencyOutput').textContent = `${settings.frequency} Hz`;
    $('headerFrequency').textContent = `${settings.frequency} HZ`;
    setRangeFill(event.target);
    setAudioFrequency();
    persist();
  });
  $('speedSlider').addEventListener('input', (event) => { settings.wpm = Number(event.target.value); $('speedOutput').textContent = `${settings.wpm} WPM`; setRangeFill(event.target); persist(); });
  $('volumeSlider').addEventListener('input', (event) => { settings.volume = Number(event.target.value); $('volumeOutput').textContent = `${settings.volume}%`; setRangeFill(event.target); if (activeMode && gainNode && audioContext) gainNode.gain.setTargetAtTime(outputLevel(), audioContext.currentTime, 0.004); persist(); });
  $('muteToggle').addEventListener('change', (event) => { settings.muted = event.target.checked; if (activeMode && gainNode && audioContext) gainNode.gain.setTargetAtTime(outputLevel(), audioContext.currentTime, 0.004); persist(); });

  straightKey.addEventListener('pointerdown', (event) => { event.preventDefault(); straightKey.setPointerCapture?.(event.pointerId); startStraightTone(); });
  straightKey.addEventListener('pointerup', () => { if (activeMode === 'straight') stopCurrentTone(); });
  straightKey.addEventListener('pointercancel', () => { if (activeMode === 'straight') stopCurrentTone(); });
  straightKey.addEventListener('keydown', (event) => { if (event.code !== 'Space' && event.code !== 'Enter') return; event.preventDefault(); if (!event.repeat) startStraightTone(); });
  straightKey.addEventListener('keyup', (event) => { if ((event.code === 'Space' || event.code === 'Enter') && activeMode === 'straight') stopCurrentTone(); });

  function wirePaddle(button, side) {
    button.addEventListener('pointerdown', (event) => { event.preventDefault(); button.setPointerCapture?.(event.pointerId); pressPaddle(side); });
    button.addEventListener('pointerup', () => releasePaddle(side));
    button.addEventListener('pointercancel', () => releasePaddle(side));
    button.addEventListener('keydown', (event) => {
      const valid = side === 'dit' ? ['KeyD', 'ArrowLeft'] : ['KeyK', 'ArrowRight'];
      if (!valid.includes(event.code)) return;
      event.preventDefault();
      pressPaddle(side);
    });
    button.addEventListener('keyup', (event) => {
      const valid = side === 'dit' ? ['KeyD', 'ArrowLeft'] : ['KeyK', 'ArrowRight'];
      if (valid.includes(event.code)) releasePaddle(side);
    });
  }

  wirePaddle(ditPaddle, 'dit');
  wirePaddle(dahPaddle, 'dah');
  document.addEventListener('keydown', (event) => {
    if (event.code === 'Space' && !isFormField(event.target)) { event.preventDefault(); if (!event.repeat) startStraightTone(); return; }
    if (event.code === 'KeyD' || event.code === 'ArrowLeft') { event.preventDefault(); pressPaddle('dit'); }
    if (event.code === 'KeyK' || event.code === 'ArrowRight') { event.preventDefault(); pressPaddle('dah'); }
  });
  document.addEventListener('keyup', (event) => {
    if (event.code === 'Space' && !isFormField(event.target) && activeMode === 'straight') stopCurrentTone();
    if (event.code === 'KeyD' || event.code === 'ArrowLeft') releasePaddle('dit');
    if (event.code === 'KeyK' || event.code === 'ArrowRight') releasePaddle('dah');
  });
  ['blur', 'pagehide'].forEach((eventName) => window.addEventListener(eventName, stopAllInputs));
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopAllInputs(); });
  [straightKey, ditPaddle, dahPaddle].forEach((button) => button.addEventListener('contextmenu', (event) => event.preventDefault()));

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  updateSettingsUi();
  updatePaddleUi();
})();
