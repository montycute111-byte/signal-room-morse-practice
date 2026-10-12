(() => {
  const STORAGE_KEY = 'paddle-key-settings-v1';
  const defaults = { frequency: 600, volume: 60, muted: false, wpm: 12 };
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') || {}; } catch { saved = {}; }
  const settings = { ...defaults, ...saved };

  const $ = (id) => document.getElementById(id);
  const ditPaddle = $('ditPaddle');
  const dahPaddle = $('dahPaddle');
  const shell = document.querySelector('.console-shell');
  let audioContext = null;
  let oscillator = null;
  let gainNode = null;
  let compressor = null;
  let activeSide = null;
  let toneTimer = null;

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }

  function setRangeFill(input) {
    const min = Number(input.min || 0);
    const max = Number(input.max || 100);
    const value = Number(input.value);
    const percentage = ((value - min) / (max - min)) * 100;
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

  function outputLevel() {
    if (settings.muted) return 0;
    return Math.max(0, Math.min(1, settings.volume / 100)) * 0.22;
  }

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

  function setVisualState(side) {
    const isDit = side === 'dit';
    const isDah = side === 'dah';
    ditPaddle.classList.toggle('active', isDit);
    dahPaddle.classList.toggle('active', isDah);
    shell.classList.toggle('key-down', Boolean(side));
    $('statusLed').classList.toggle('active', Boolean(side));
    $('statusText').textContent = side ? `${isDit ? 'DIT' : 'DAH'} PLAYING` : 'READY';
    $('footerState').textContent = side ? `${isDit ? 'DIT' : 'DAH'} PLAYING` : 'PADDLE RELEASED';
    ditPaddle.setAttribute('aria-pressed', String(isDit));
    dahPaddle.setAttribute('aria-pressed', String(isDah));
  }

  function stopTone() {
    if (toneTimer) {
      window.clearTimeout(toneTimer);
      toneTimer = null;
    }
    if (!activeSide) return;
    activeSide = null;
    setVisualState(null);
    if (gainNode && audioContext) {
      const now = audioContext.currentTime;
      gainNode.gain.cancelScheduledValues(now);
      gainNode.gain.setTargetAtTime(0, now, 0.006);
    }
  }

  function playPaddle(side) {
    if (!ensureAudio()) return;
    stopTone();
    activeSide = side;
    setVisualState(side);
    const now = audioContext.currentTime;
    const ditMs = 1200 / settings.wpm;
    const duration = side === 'dit' ? ditMs : ditMs * 3;
    gainNode.gain.cancelScheduledValues(now);
    gainNode.gain.setTargetAtTime(outputLevel(), now, 0.004);
    toneTimer = window.setTimeout(stopTone, duration);
  }

  function setAudioFrequency() {
    if (oscillator && audioContext) {
      oscillator.frequency.setTargetAtTime(settings.frequency, audioContext.currentTime, 0.003);
    }
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

  $('speedSlider').addEventListener('input', (event) => {
    settings.wpm = Number(event.target.value);
    $('speedOutput').textContent = `${settings.wpm} WPM`;
    setRangeFill(event.target);
    persist();
  });

  $('volumeSlider').addEventListener('input', (event) => {
    settings.volume = Number(event.target.value);
    $('volumeOutput').textContent = `${settings.volume}%`;
    setRangeFill(event.target);
    if (activeSide && gainNode && audioContext) gainNode.gain.setTargetAtTime(outputLevel(), audioContext.currentTime, 0.004);
    persist();
  });

  $('muteToggle').addEventListener('change', (event) => {
    settings.muted = event.target.checked;
    if (activeSide && gainNode && audioContext) gainNode.gain.setTargetAtTime(outputLevel(), audioContext.currentTime, 0.004);
    persist();
  });

  function wirePaddle(button, side) {
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      button.setPointerCapture?.(event.pointerId);
      playPaddle(side);
    });
    button.addEventListener('keydown', (event) => {
      if (event.repeat) return;
      if ((side === 'dit' && !['KeyD', 'ArrowLeft'].includes(event.code)) || (side === 'dah' && !['KeyK', 'ArrowRight'].includes(event.code))) return;
      event.preventDefault();
      playPaddle(side);
    });
  }

  wirePaddle(ditPaddle, 'dit');
  wirePaddle(dahPaddle, 'dah');

  document.addEventListener('keydown', (event) => {
    if (event.repeat) return;
    if (event.code === 'KeyD' || event.code === 'ArrowLeft') { event.preventDefault(); playPaddle('dit'); }
    if (event.code === 'KeyK' || event.code === 'ArrowRight') { event.preventDefault(); playPaddle('dah'); }
  });

  ['blur', 'pagehide'].forEach((eventName) => window.addEventListener(eventName, stopTone));
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopTone(); });
  [ditPaddle, dahPaddle].forEach((button) => button.addEventListener('contextmenu', (event) => event.preventDefault()));

  updateSettingsUi();
})();
