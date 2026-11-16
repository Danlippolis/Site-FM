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

// Versão = hash do conteúdo. Carimbada no index.html (dev/GitHub Pages) nas URLs de CSS, JS e JSON,
// para o navegador nunca misturar arquivos antigos (em cache) com novos depois de uma atualização.
const crypto = require('crypto');
const SOURCES = ['src/engine/engine.js', 'src/ui/app.js', 'src/ui/styles.css', 'data/formations.json', 'data/roles.json',
  'data/team-instructions.json', 'data/player-instructions.json', 'data/opponent.json', 'data/player-traits.json', 'data/role-guide.json'];
const version = crypto.createHash('sha1').update(SOURCES.map(read).join('\n')).digest('hex').slice(0, 10);
let index = read('index.html')
  .replace(/(href="src\/ui\/styles\.css)(\?v=[^"]*)?"/, `$1?v=${version}"`)
  .replace(/(src="src\/engine\/engine\.js)(\?v=[^"]*)?"/, `$1?v=${version}"`)
  .replace(/(src="src\/ui\/app\.js)(\?v=[^"]*)?"/, `$1?v=${version}"`);
if (/name="fm23pv-version"/.test(index)) index = index.replace(/(name="fm23pv-version" content=")[^"]*"/, `$1${version}"`);
else index = index.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n  <meta name="fm23pv-version" content="${version}">`);
fs.writeFileSync(path.join(root, 'index.html'), index);
// version.json: o site compara com a versão da página carregada e recarrega se a página estiver velha em cache
fs.writeFileSync(path.join(root, 'version.json'), JSON.stringify({ version }) + '\n');

let html = index.replace(/\?v=[0-9a-f]+"/g, '"');
const swap = (needle, replacement) => {
  if (!html.includes(needle)) throw new Error('Marcador não encontrado em index.html: ' + needle);
  html = html.replace(needle, () => replacement);
};

swap('<link rel="stylesheet" href="src/ui/styles.css">', `<style>\n${read('src/ui/styles.css')}</style>`);
swap('<!-- INLINE_DATA -->', [
  `<script type="application/json" id="data-formations">${json('data/formations.json')}</script>`,
  `<script type="application/json" id="data-roles">${json('data/roles.json')}</script>`,
  `<script type="application/json" id="data-instructions">${json('data/team-instructions.json')}</script>`,
  `<script type="application/json" id="data-player-instructions">${json('data/player-instructions.json')}</script>`,
  `<script type="application/json" id="data-opponent">${json('data/opponent.json')}</script>`,
  `<script type="application/json" id="data-player-traits">${json('data/player-traits.json')}</script>`,
  `<script type="application/json" id="data-role-guide">${json('data/role-guide.json')}</script>`
].join('\n  '));
swap('<script src="src/engine/engine.js"></script>', `<script>\n${safeScript(read('src/engine/engine.js'))}</script>`);
swap('<script src="src/ui/app.js"></script>', `<script>\n${safeScript(read('src/ui/app.js'))}</script>`);

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const out = path.join(root, 'dist', 'fm23-viewer.html');
fs.writeFileSync(out, html);
console.log(`ok: ${path.relative(root, out)} (${(Buffer.byteLength(html) / 1024).toFixed(1)} KB)`);
