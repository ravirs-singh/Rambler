'use strict';
// Clipboard adapter. Electron 45 made the clipboard async (`read()` returns
// ClipboardItem[]); earlier versions are synchronous with per-format readers.
// Both are wrapped behind the same promise-based surface so the insertion
// code and tests do not care which one is underneath.

function createClipboardAdapter(electron) {
  const { clipboard, ClipboardItem } = electron;
  const isAsync = typeof clipboard.availableFormats !== 'function';

  if (isAsync) {
    return {
      kind: 'async',
      readText: () => clipboard.readText(),
      writeText: (t) => clipboard.writeText(t),
      async snapshot() {
        try {
          const items = await clipboard.read();
          const copies = [];
          for (const item of items) {
            const record = {};
            for (const type of item.types) {
              try { record[type] = await item.getType(type); } catch { /* skip unreadable format */ }
            }
            if (Object.keys(record).length) copies.push(record);
          }
          return { items: copies };
        } catch {
          return { items: [] };
        }
      },
      async restore(snap) {
        if (!snap) return;
        if (!snap.items.length) { clipboard.clear(); return; }
        await clipboard.write(snap.items.map((record) => new ClipboardItem(record)));
      },
    };
  }

  return {
    kind: 'sync',
    readText: async () => clipboard.readText(),
    writeText: async (t) => clipboard.writeText(t),
    async snapshot() {
      const formats = clipboard.availableFormats();
      const snap = { text: clipboard.readText(), html: clipboard.readHTML(), rtf: clipboard.readRTF() };
      if (formats.some((f) => f.startsWith('image/'))) snap.image = clipboard.readImage();
      return snap;
    },
    async restore(snap) {
      if (!snap) return;
      if (snap.image && !snap.image.isEmpty()) { clipboard.writeImage(snap.image); return; }
      const data = {};
      if (snap.text) data.text = snap.text;
      if (snap.html) data.html = snap.html;
      if (snap.rtf) data.rtf = snap.rtf;
      if (Object.keys(data).length) clipboard.write(data); else clipboard.clear();
    },
  };
}

module.exports = { createClipboardAdapter };
