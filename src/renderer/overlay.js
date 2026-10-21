// Floating status pill: level meter, streaming partial text, outcome, sounds.
const pill = document.getElementById('pill');
const bars = [...document.querySelectorAll('#bars i')];
const text = document.getElementById('text');
const lock = document.getElementById('lock');
let levels = new Array(bars.length).fill(0);
let audioCtx = null;

function beep(freqs, ms = 70, gain = 0.08) {
  try {
    audioCtx = audioCtx || new AudioContext();
    const t = audioCtx.currentTime;
    freqs.forEach((f, i) => {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0, t + i * ms / 1000);
      g.gain.linearRampToValueAtTime(gain, t + i * ms / 1000 + 0.01);
      g.gain.linearRampToValueAtTime(0, t + (i + 1) * ms / 1000);
      o.connect(g).connect(audioCtx.destination);
      o.start(t + i * ms / 1000);
      o.stop(t + (i + 1) * ms / 1000 + 0.02);
    });
  } catch { /* audio output optional */ }
}

function setText(t, cls = '') {
  text.textContent = t;
  text.className = cls;
}

window.overlay.onLevel((level) => {
  levels.push(Math.min(1, level * 6));
  levels = levels.slice(-bars.length);
  bars.forEach((b, i) => { b.style.height = `${4 + Math.round(levels[i] * 18)}px`; });
});

window.overlay.onPartial((t) => {
  if (t) setText(t, 'partial');
});

window.overlay.onState((s) => {
  pill.classList.add('visible');
  lock.textContent = s.locked ? 'locked' : '';
  switch (s.state) {
    case 'listening':
      setText('Listening…');
      levels.fill(0);
      if (s.sounds) beep([660, 880]);
      break;
    case 'transcribing':
      setText('Transcribing…', 'partial');
      if (s.sounds) beep([880, 660]);
      break;
    case 'formatting':
      setText(s.text || 'Formatting…', 'partial');
      break;
    case 'inserting':
      setText(s.text || 'Inserting…');
      break;
    case 'done':
      setText(s.text || 'Done');
      if (s.sounds) beep([990], 50, 0.05);
      break;
    case 'error':
      setText(s.message || 'Error', 'error');
      if (s.sounds) beep([330, 330], 90);
      break;
    case 'idle':
      setText(s.reason === 'too-short' ? 'Hold the key a little longer' : s.reason === 'cancelled' ? 'Cancelled' : '');
      if (!s.reason || s.reason === 'empty') pill.classList.remove('visible');
      break;
  }
});
