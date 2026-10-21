const FIELDS = [
  'enabled', 'hotkey.key', 'stt.provider', 'stt.local.baseUrl', 'stt.local.model', 'stt.deepgram.apiKey', 'stt.deepgram.model', 'stt.openai.baseUrl',
  'stt.openai.apiKey', 'stt.openai.model', 'formatter.provider', 'formatter.anthropic.apiKey',
  'formatter.anthropic.model', 'formatter.anthropic.effort', 'formatter.style', 'insert.method',
  'overlay.enabled', 'overlay.sounds', 'context.enabled',
];

const get = (obj, p) => p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const setPath = (obj, p, v) => {
  const keys = p.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) o = o[k] = o[k] || {};
  o[keys.at(-1)] = v;
};

function dictToText(entries) {
  return entries.map((e) => (e.from ? `${e.from} => ${e.to}` : e.word)).join('\n');
}

function textToDict(text) {
  return text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = l.match(/^(.*?)\s*=>\s*(.*)$/);
    return m ? { from: m[1].trim(), to: m[2].trim() } : { word: l };
  });
}

async function load() {
  const { config, dictionary, history, stats } = await window.settings.get();
  for (const f of FIELDS) {
    const el = document.getElementById(f);
    if (!el) continue;
    const v = get(config, f);
    if (el.type === 'checkbox') el.checked = !!v;
    else el.value = v ?? '';
  }
  document.getElementById('dictionary').value = dictToText(dictionary);
  document.getElementById('stats').textContent = `${stats.dictations} dictations · ${stats.words} words · ${stats.audioMinutes} minutes of audio`;
  const tbody = document.querySelector('#history tbody');
  tbody.innerHTML = '';
  for (const h of history) {
    const tr = document.createElement('tr');
    const cells = [new Date(h.ts).toLocaleTimeString(), h.app || '', h.text || h.outcome, h.latencyMs?.total ?? ''];
    for (const c of cells) {
      const td = document.createElement('td');
      td.textContent = String(c);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
}

document.getElementById('save').addEventListener('click', async () => {
  const patch = {};
  for (const f of FIELDS) {
    const el = document.getElementById(f);
    if (!el) continue;
    setPath(patch, f, el.type === 'checkbox' ? el.checked : el.value);
  }
  await window.settings.set(patch);
  await window.settings.setDictionary(textToDict(document.getElementById('dictionary').value));
  document.getElementById('status').textContent = 'Saved';
  setTimeout(() => { document.getElementById('status').textContent = ''; }, 1500);
  load();
});

load();
