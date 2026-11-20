#!/usr/bin/env node
/* Gera dist/artifact/fm23-viewer-claude.html: a versão do site para publicar como Artifact do claude.ai,
 * com o painel "Perguntar ao Claude" (src/claude/*). Parte do dist/fm23-viewer.html (rode `npm run build` antes)
 * e, como o Artifact embrulha a página no próprio <html>/<head>/<body>, tira esses tags. */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const safeScript = (s) => s.replace(/<\/script/gi, '<\\/script');

let html = read('dist/fm23-viewer.html');
const swap = (re, replacement, label) => {
  if (!re.test(html)) throw new Error('Marcador não encontrado: ' + label);
  html = html.replace(re, () => replacement);
};

// Gancho para o painel ler e alterar a tática (dentro do IIFE de app.js, antes do init).
const HOOK = `  window.__fm = {
    E: E, ui: ui, clone: clone,
    get data() { return data; },
    get state() { return state; }, set state(v) { state = v; },
    get lastComputed() { return lastComputed; },
    renderAll: function () { renderAll(); }, syncTIForm: function () { syncTIForm(); }, syncOppForm: function () { syncOppForm(); },
    fixPlayer: function (p) { return fixPlayer(p); }, presetById: function (id) { return presetById(id); }, oppConfig: function () { return oppConfig(); }
  };

  function init() {`;
if ((html.match(/\n  function init\(\) \{/g) || []).length !== 1) throw new Error('init() de app.js não é único');
swap(/\n  function init\(\) \{/, '\n' + HOOK, 'init()');

// Esqueleto do documento: o Artifact fornece o seu.
swap(/^<!doctype html>\s*<html[^>]*>\s*<head>\s*/i, '', 'doctype/html/head');
swap(/<meta charset="utf-8">\s*/, '', 'meta charset');
html = html.replace(/<meta name="fm23pv-version"[^>]*>\s*/, '');
swap(/<meta name="viewport"[^>]*>\s*/, '', 'meta viewport');
swap(/<\/head>\s*<body>\s*/, '', '</head><body>');
swap(/\s*<\/body>\s*<\/html>\s*$/, '', '</body></html>');

html += `\n<style>\n${read('src/claude/panel.css')}</style>\n<script>\n${safeScript(read('src/claude/panel.js'))}</script>\n`;

const outDir = path.join(root, 'dist', 'artifact');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, 'fm23-viewer-claude.html');
fs.writeFileSync(out, html);
console.log(`ok: ${path.relative(root, out)} (${(Buffer.byteLength(html) / 1024).toFixed(1)} KB)`);
