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
  const straightTab = $('straightTab');
  const paddleTab = $('paddleTab');
  const sentenceTab = $('sentenceTab');
  const straightPanel = $('straightPanel');
  const paddlePanel = $('paddlePanel');
  const sentencePanel = $('sentencePanel');
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
  const sosOverlay = $('sosOverlay');
  const sosDismiss = $('sosDismiss');
  const sosMessages = [...sosOverlay.querySelectorAll('.sos-messages li')];
  const transmissionElements = [];
  let liveTransmissionElement = null;
  let lastElementEndAt = null;
  let sosTriggeredForTransmission = false;
  let sosOverlayActive = false;
  let sosOverlayTimers = [];
  let sosClosingTimer = null;
  const sentenceLibrary = {
    short: [
      'The lamp is bright.', 'Waves move slowly.', 'Keep the key steady.', 'Rain taps the roof.', 'The train is late.',
      'Clouds cover the moon.', 'Turn left at dawn.', 'Practice makes progress.', 'The signal is clear.', 'Birds cross the sky.',
      'Listen for the tone.', 'Warm hands before sending.', 'The cabin feels quiet.', 'Small steps build skill.', 'Good signals travel far.',
    ],
    medium: [
      'The quiet station waits beside the river.', 'Send each character with a steady rhythm.', 'A cool breeze moves through the open window.', 'The morning operator checks every connection twice.', 'Clear timing makes difficult letters easier to hear.',
      'The old radio glows beside a cup of tea.', 'Leave enough space between letters and words.', 'A patient hand can make beautiful Morse code.', 'The signal fades slowly beyond the distant hills.', 'Tonight the band is calm and wonderfully quiet.',
      'Keep listening even when the pattern feels unfamiliar.', 'The small antenna reaches across the sleeping town.', 'A steady pace is better than a hurried one.', 'The receiver comes alive after sunset each evening.', 'Write down the rhythm that feels most natural.',
    ],
    long: [
      'The operator waited patiently while the distant station returned a faint reply.', 'Every careful transmission begins with a comfortable pace and a relaxed hand.', 'Across the quiet valley, the evening signal carried farther than anyone expected.', 'When the band becomes crowded, listening closely helps each character remain distinct.', 'A good practice session leaves room for mistakes without turning them into pressure.',
      'The old notebook held years of signals, weather reports, and friendly conversations.', 'Before sending a long message, take a breath and settle into the rhythm.', 'The lighthouse keeper heard the familiar call just before the storm arrived.', 'A strong operator knows that clear spacing is just as important as speed.', 'The radio room stayed warm while rain moved steadily across the dark roof.',
      'With every relaxed repetition, the movement between dits and dahs becomes more natural.', 'The message crossed several quiet bands before reaching the waiting listening post.', 'Some of the best practice happens when there is no one keeping score.', 'The patient listener recognized the final word and smiled at the completed transmission.', 'Use the next sentence whenever you are ready, whether the current one is finished or not.',
    ],
  };
  let sentenceCategory = 'random';
  let currentSentence = '';
  let sentenceSessionCount = 1;
  let activeKeyMode = 'straight';

  function pickSentence() {
    const pool = sentenceCategory === 'random'
      ? Object.values(sentenceLibrary).flat()
      : sentenceLibrary[sentenceCategory];
    const choices = pool.filter((sentence) => sentence !== currentSentence);
    currentSentence = (choices.length ? choices : pool)[Math.floor(Math.random() * (choices.length ? choices : pool).length)];
    $('practiceSentence').textContent = currentSentence;
    $('sentenceSessionCount').textContent = `SESSION SENTENCE ${sentenceSessionCount}`;
    $('sentenceProgress').textContent = `SENTENCE ${sentenceSessionCount} · PRACTICE ONLY`;
  }

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

  function morseDitMs() { return 1200 / Math.max(5, settings.wpm); }

  function beginTransmissionElement(mode, side) {
    const startedAt = performance.now();
    const gapBeforeMs = lastElementEndAt === null ? null : startedAt - lastElementEndAt;
    if (gapBeforeMs !== null && gapBeforeMs > morseDitMs() * 2.7) {
      transmissionElements.length = 0;
      sosTriggeredForTransmission = false;
    }
    liveTransmissionElement = { mode, side, startedAt, gapBeforeMs };
  }

  function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }

  function groupedDurationsAreConsistent(values) {
    const shortest = Math.min(...values);
    const longest = Math.max(...values);
    return shortest > 0 && longest / shortest <= 1.8;
  }

  function isSosCandidate() {
    if (transmissionElements.length < 9) return false;
    const candidate = transmissionElements.slice(-9);
    if (candidate.some((element) => element.mode !== candidate[0].mode)) return false;
    if (candidate.slice(1).some((element) => element.gapBeforeMs === null)) return false;

    const shortDurations = [...candidate.slice(0, 3), ...candidate.slice(6)].map((element) => element.durationMs);
    const longDurations = candidate.slice(3, 6).map((element) => element.durationMs);
    const shortUnit = median(shortDurations);
    const gapLimit = candidate[0].mode === 'paddle' ? morseDitMs() * 2.25 : shortUnit * 2.35;
    const continuous = candidate.slice(1).every((element) => element.gapBeforeMs <= gapLimit);
    if (!continuous) return false;

    if (candidate[0].mode === 'paddle') {
      return candidate.map((element) => element.side).join('') === 'ditditditdahdahdahditditdit';
    }

    return groupedDurationsAreConsistent(candidate.slice(0, 3).map((element) => element.durationMs))
      && groupedDurationsAreConsistent(candidate.slice(3, 6).map((element) => element.durationMs))
      && groupedDurationsAreConsistent(candidate.slice(6).map((element) => element.durationMs))
      && median(longDurations) >= shortUnit * 2.15;
  }

  function finishTransmissionElement(endedAt = performance.now()) {
    if (!liveTransmissionElement) return;
    const element = {
      ...liveTransmissionElement,
      endedAt,
      durationMs: Math.max(0, endedAt - liveTransmissionElement.startedAt),
    };
    liveTransmissionElement = null;
    lastElementEndAt = endedAt;
    transmissionElements.push(element);
    if (transmissionElements.length > 24) transmissionElements.shift();
    if (isSosCandidate() && !sosTriggeredForTransmission) {
      sosTriggeredForTransmission = true;
      showSosEasterEgg();
    }
  }

  function playStaticBurst() {
    if (settings.muted || !ensureAudio()) return;
    const sampleRate = audioContext.sampleRate;
    const duration = 0.36;
    const buffer = audioContext.createBuffer(1, Math.floor(sampleRate * duration), sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) {
      const fade = Math.min(1, index / (sampleRate * 0.025), (data.length - index) / (sampleRate * 0.04));
      data[index] = (Math.random() * 2 - 1) * fade;
    }
    const source = audioContext.createBufferSource();
    const filter = audioContext.createBiquadFilter();
    const staticGain = audioContext.createGain();
    source.buffer = buffer;
    filter.type = 'bandpass';
    filter.frequency.value = 1500;
    filter.Q.value = 0.65;
    staticGain.gain.value = 0.11;
    source.connect(filter).connect(staticGain).connect(compressor || audioContext.destination);
    source.start();
  }

  function clearSosOverlayTimers() {
    sosOverlayTimers.forEach((timer) => window.clearTimeout(timer));
    sosOverlayTimers = [];
    if (sosClosingTimer) { window.clearTimeout(sosClosingTimer); sosClosingTimer = null; }
  }

  function dismissSosEasterEgg() {
    if (!sosOverlayActive) return;
    clearSosOverlayTimers();
    sosOverlay.classList.add('is-closing');
    const closingDelay = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 430;
    sosClosingTimer = window.setTimeout(() => {
      sosOverlay.hidden = true;
      sosOverlay.setAttribute('aria-hidden', 'true');
      sosOverlay.classList.remove('is-closing');
      document.body.classList.remove('sos-easter-egg-active');
      sosOverlayActive = false;
      sosClosingTimer = null;
    }, closingDelay);
  }

  function showSosEasterEgg() {
    if (sosOverlayActive) return;
    clearSosOverlayTimers();
    sosOverlayActive = true;
    sosOverlay.hidden = false;
    sosOverlay.setAttribute('aria-hidden', 'false');
    sosOverlay.classList.remove('is-closing');
    document.body.classList.add('sos-easter-egg-active');
    sosMessages.forEach((message) => message.classList.remove('is-visible'));
    playStaticBurst();
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    sosMessages.forEach((message, index) => {
      sosOverlayTimers.push(window.setTimeout(() => message.classList.add('is-visible'), reducedMotion ? 0 : 420 + index * 560));
    });
    sosOverlayTimers.push(window.setTimeout(dismissSosEasterEgg, reducedMotion ? 5000 : 5200));
    sosDismiss.focus({ preventScroll: true });
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
    finishTransmissionElement();
    activeMode = null;
    activeSide = null;
    fadeTone();
    setVisualState(null, null);
  }

  function startElement(mode, side, duration) {
    if (!ensureAudio()) return false;
    if (elementOffTimer) window.clearTimeout(elementOffTimer);
    beginTransmissionElement(mode, side);
    activeMode = mode;
    activeSide = side;
    setVisualState(mode, side);
    const now = audioContext.currentTime;
    gainNode.gain.cancelScheduledValues(now);
    gainNode.gain.setTargetAtTime(outputLevel(), now, 0.004);
    if (duration) {
      elementOffTimer = window.setTimeout(() => {
        elementOffTimer = null;
        finishTransmissionElement();
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

  function selectMode(mode, { focus = false } = {}) {
    const sentenceSelected = mode === 'sentence';
    const paddleSelected = mode === 'paddle';
    stopAllInputs();
    straightTab.classList.toggle('active', !paddleSelected && !sentenceSelected);
    paddleTab.classList.toggle('active', paddleSelected);
    sentenceTab.classList.toggle('active', sentenceSelected);
    straightTab.setAttribute('aria-selected', String(!paddleSelected && !sentenceSelected));
    paddleTab.setAttribute('aria-selected', String(paddleSelected));
    sentenceTab.setAttribute('aria-selected', String(sentenceSelected));
    straightPanel.hidden = paddleSelected || sentenceSelected;
    paddlePanel.hidden = !paddleSelected || sentenceSelected;
    sentencePanel.hidden = !sentenceSelected;
    straightPanel.classList.toggle('mode-panel-hidden', paddleSelected || sentenceSelected);
    paddlePanel.classList.toggle('mode-panel-hidden', !paddleSelected || sentenceSelected);
    sentencePanel.classList.toggle('mode-panel-hidden', !sentenceSelected);
    if (!sentenceSelected) activeKeyMode = paddleSelected ? 'paddle' : 'straight';
    localStorage.setItem('morse-active-tab-v2', mode);
    localStorage.setItem('morse-active-tab-v1', activeKeyMode);
    if (focus) (sentenceSelected ? sentenceTab : paddleSelected ? paddleTab : straightTab).focus();
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
  document.querySelectorAll('.sentence-category').forEach((button) => button.addEventListener('click', () => {
    sentenceCategory = button.dataset.category;
    document.querySelectorAll('.sentence-category').forEach((categoryButton) => {
      const selected = categoryButton === button;
      categoryButton.classList.toggle('active', selected);
      categoryButton.setAttribute('aria-pressed', String(selected));
    });
    pickSentence();
  }));
  $('nextSentence').addEventListener('click', () => { sentenceSessionCount += 1; pickSentence(); });
  sosDismiss.addEventListener('click', dismissSosEasterEgg);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && sosOverlayActive) {
      event.preventDefault();
      dismissSosEasterEgg();
    }
  });

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

  straightTab.addEventListener('click', () => selectMode('straight'));
  paddleTab.addEventListener('click', () => selectMode('paddle'));
  sentenceTab.addEventListener('click', () => selectMode('sentence'));
  [straightTab, paddleTab, sentenceTab].forEach((tab) => tab.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const tabs = [straightTab, paddleTab, sentenceTab];
    const modes = ['straight', 'paddle', 'sentence'];
    const currentIndex = tabs.indexOf(tab);
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    selectMode(modes[nextIndex], { focus: true });
  }));

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  let savedMode = 'straight';
  try {
    const storedMode = localStorage.getItem('morse-active-tab-v2');
    savedMode = ['straight', 'paddle', 'sentence'].includes(storedMode) ? storedMode : (localStorage.getItem('morse-active-tab-v1') === 'paddle' ? 'paddle' : 'straight');
    activeKeyMode = savedMode === 'paddle' ? 'paddle' : 'straight';
  } catch {}
  pickSentence();
  selectMode(savedMode);
  updateSettingsUi();
  updatePaddleUi();
})();
