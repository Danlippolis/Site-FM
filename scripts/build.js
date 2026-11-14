#!/usr/bin/env node
/* Gera dist/fm23-viewer.html: um único HTML autocontido (CSS, JS e JSON embutidos),
 * que funciona aberto direto do disco (file://), sem servidor. */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const safeScript = (s) => s.replace(/<\/script/gi, '<\\/script');
const json = (p) => JSON.stringify(JSON.parse(read(p))).replace(/</g, '\\u003c');

let html = read('index.html');
const swap = (needle, replacement) => {
  if (!html.includes(needle)) throw new Error('Marcador não encontrado em index.html: ' + needle);
  html = html.replace(needle, () => replacement);
};

swap('<link rel="stylesheet" href="src/ui/styles.css">', `<style>\n${read('src/ui/styles.css')}</style>`);
swap('<!-- INLINE_DATA -->', [
  `<script type="application/json" id="data-formations">${json('data/formations.json')}</script>`,
  `<script type="application/json" id="data-roles">${json('data/roles.json')}</script>`,
  `<script type="application/json" id="data-instructions">${json('data/team-instructions.json')}</script>`,
  `<script type="application/json" id="data-player-instructions">${json('data/player-instructions.json')}</script>`
].join('\n  '));
swap('<script src="src/engine/engine.js"></script>', `<script>\n${safeScript(read('src/engine/engine.js'))}</script>`);
swap('<script src="src/ui/app.js"></script>', `<script>\n${safeScript(read('src/ui/app.js'))}</script>`);

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const out = path.join(root, 'dist', 'fm23-viewer.html');
fs.writeFileSync(out, html);
console.log(`ok: ${path.relative(root, out)} (${(Buffer.byteLength(html) / 1024).toFixed(1)} KB)`);
