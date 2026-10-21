'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createClipboardAdapter } = require('../src/main/insert/clipboard');
const { insertText } = require('../src/main/insert');

const log = { info() {}, warn() {}, error() {} };

function fakeAsyncElectron() {
  let items = [];
  class ClipboardItem {
    constructor(record) { this.record = record; this.types = Object.keys(record); }
    async getType(t) { return this.record[t]; }
  }
  const clipboard = {
    clear: () => { items = []; },
    read: async () => items,
    write: async (list) => { items = list; },
    readText: async () => {
      for (const it of items) if (it.record['text/plain']) return it.record['text/plain'];
      return '';
    },
    writeText: async (t) => { items = [new ClipboardItem({ 'text/plain': t })]; },
  };
  return { clipboard, ClipboardItem };
}

function fakeSyncElectron() {
  let data = { text: 'old', html: '<b>old</b>', rtf: '' };
  const clipboard = {
    availableFormats: () => ['text/plain', 'text/html'],
    readText: () => data.text,
    readHTML: () => data.html,
    readRTF: () => data.rtf,
    writeText: (t) => { data = { text: t, html: '', rtf: '' }; },
    write: (d) => { data = { text: d.text || '', html: d.html || '', rtf: d.rtf || '' }; },
    clear: () => { data = { text: '', html: '', rtf: '' }; },
  };
  return { clipboard };
}

test('async adapter snapshots and restores every format', async () => {
  const el = fakeAsyncElectron();
  const clip = createClipboardAdapter(el);
  assert.equal(clip.kind, 'async');
  await el.clipboard.write([new el.ClipboardItem({ 'text/plain': 'before', 'text/html': '<i>before</i>' })]);
  const snap = await clip.snapshot();
  await clip.writeText('dictated');
  assert.equal(await clip.readText(), 'dictated');
  await clip.restore(snap);
  assert.equal(await clip.readText(), 'before');
  const [item] = await el.clipboard.read();
  assert.deepEqual(item.types.sort(), ['text/html', 'text/plain']);
});

test('sync adapter round-trips text and html', async () => {
  const el = fakeSyncElectron();
  const clip = createClipboardAdapter(el);
  assert.equal(clip.kind, 'sync');
  const snap = await clip.snapshot();
  await clip.writeText('new');
  assert.equal(await clip.readText(), 'new');
  await clip.restore(snap);
  assert.equal(el.clipboard.readText(), 'old');
  assert.equal(el.clipboard.readHTML(), '<b>old</b>');
});

test('clipboard insertion mode writes without a paste chord', async () => {
  const clip = createClipboardAdapter(fakeAsyncElectron());
  const r = await insertText('hello', { method: 'clipboard' }, { clip }, log);
  assert.equal(r.method, 'clipboard');
  assert.equal(await clip.readText(), 'hello');
});

test('empty text is a no-op', async () => {
  const r = await insertText('', { method: 'paste' }, { clip: createClipboardAdapter(fakeAsyncElectron()) }, log);
  assert.equal(r.method, 'none');
});
