(() => {
  const STORAGE_KEY = 'straight-key-settings-v1';
  const defaults = { frequency: 600, volume: 60, muted: false };
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') || {};
  const settings = { ...defaults, ...saved };

  const $ = (id) => document.getElementById(id);
  const keySurface = $('keySurface');
  const shell = document.querySelector('.console-shell');
  const activePointers = new Set();
  let keyboardDown = false;
  let pressed = false;
  let audioContext = null;
  let oscillator = null;
  let gainNode = null;
  let compressor = null;

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
    const volumeSlider = $('volumeSlider');
    frequencySlider.value = settings.frequency;
    volumeSlider.value = settings.volume;
    $('frequencyDisplay').textContent = `${settings.frequency} Hz`;
    $('frequencyOutput').textContent = `${settings.frequency} Hz`;
    $('headerFrequency').textContent = `${settings.frequency} HZ`;
    $('volumeOutput').textContent = `${settings.volume}%`;
    $('muteToggle').checked = settings.muted;
    setRangeFill(frequencySlider);
    setRangeFill(volumeSlider);
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

  function setAudioFrequency() {
    if (oscillator && audioContext) {
      oscillator.frequency.setTargetAtTime(settings.frequency, audioContext.currentTime, 0.003);
    }
  }

  function setVisualState(isDown) {
    keySurface.classList.toggle('pressed', isDown);
    shell.classList.toggle('key-down', isDown);
    $('statusLed').classList.toggle('active', isDown);
    $('statusText').textContent = isDown ? 'KEY DOWN' : 'READY';
    $('footerState').textContent = isDown ? 'KEY PRESSED' : 'KEY RELEASED';
    keySurface.setAttribute('aria-label', isDown ? 'Key pressed' : 'Key released');
  }

  function beginTone() {
    if (!ensureAudio() || pressed) return;
    pressed = true;
    setVisualState(true);
    const now = audioContext.currentTime;
    gainNode.gain.cancelScheduledValues(now);
    gainNode.gain.setTargetAtTime(outputLevel(), now, 0.004);
  }

  function endTone() {
    if (!pressed) return;
    pressed = false;
    setVisualState(false);
    if (gainNode && audioContext) {
      const now = audioContext.currentTime;
      gainNode.gain.cancelScheduledValues(now);
      gainNode.gain.setTargetAtTime(0, now, 0.006);
    }
  }

  function releaseEverything() {
    activePointers.clear();
    keyboardDown = false;
    endTone();
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

  $('volumeSlider').addEventListener('input', (event) => {
    settings.volume = Number(event.target.value);
    $('volumeOutput').textContent = `${settings.volume}%`;
    setRangeFill(event.target);
    if (pressed && gainNode && audioContext) {
      gainNode.gain.setTargetAtTime(outputLevel(), audioContext.currentTime, 0.004);
    }
    persist();
  });

  $('muteToggle').addEventListener('change', (event) => {
    settings.muted = event.target.checked;
    if (pressed && gainNode && audioContext) {
      gainNode.gain.setTargetAtTime(outputLevel(), audioContext.currentTime, 0.004);
    }
    persist();
  });

  keySurface.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    activePointers.add(event.pointerId);
    keySurface.setPointerCapture?.(event.pointerId);
    beginTone();
  });

  function releasePointer(event) {
    activePointers.delete(event.pointerId);
    if (activePointers.size === 0 && !keyboardDown) endTone();
  }

  keySurface.addEventListener('pointerup', releasePointer);
  keySurface.addEventListener('pointercancel', releasePointer);
  keySurface.addEventListener('lostpointercapture', releasePointer);

  document.addEventListener('keydown', (event) => {
    if (event.code !== 'Space') return;
    event.preventDefault();
    if (event.repeat || keyboardDown) return;
    keyboardDown = true;
    beginTone();
  });

  document.addEventListener('keyup', (event) => {
    if (event.code !== 'Space') return;
    event.preventDefault();
    keyboardDown = false;
    if (activePointers.size === 0) endTone();
  });

  ['blur', 'pagehide'].forEach((eventName) => window.addEventListener(eventName, releaseEverything));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) releaseEverything();
  });
  keySurface.addEventListener('contextmenu', (event) => event.preventDefault());

  updateSettingsUi();
})();
