#!/usr/bin/env node
/* Compara o modelo com as posições medidas no FM23 (data/measurements.json).
 * Para cada medida, calcula a posição do jogador na mesma tática, fase e instruções e mostra a diferença.
 * No fim, resume o erro médio por função+tarefa e por fase (em unidades do campo; 1 unidade ≈ 1 m em y, 0,7 m em x).
 *
 * Formato de data/measurements.json:
 *   tactics: { "<id>": { "players": [{ slot, role, duty }...11], "ti": { mentality, defensiveLine, ... } } }
 *   measurements: [{ tactic: "<id>", phase: "saindo"|..., slot: "MCL", x: 31, y: 48, kind: "media"|"instante", source: "..." }]
 * Instantes da mesma tática+fase+slot são agregados pela média antes da comparação. Se a medida informa ball.y
 * numa fase com a bola, o modelo é interpolado entre a Saída e o Ataque na mesma altura de bola.
 */
'use strict';
const path = require('path');
const root = path.join(__dirname, '..');
const E = require(path.join(root, 'src/engine/engine.js'));
const load = (f) => require(path.join(root, 'data', f));
const data = {
  formations: load('formations.json'), roles: load('roles.json'), instructions: load('team-instructions.json'),
  playerInstructions: load('player-instructions.json'), opponent: load('opponent.json'), playerTraits: load('player-traits.json')
};
const M = load('measurements.json');

function compare() {
  const groups = {};
  for (const m of M.measurements) {
    const k = [m.tactic, m.phase, m.slot].join('|');
    (groups[k] = groups[k] || []).push(m);
  }
  const rows = [];
  for (const [k, ms] of Object.entries(groups)) {
    const [tid, phase, slot] = k.split('|');
    const t = M.tactics[tid];
    if (!t) { rows.push({ k, error: 'tática não encontrada: ' + tid }); continue; }
    const v = E.validate(t.players, data);
    if (!v.ok) { rows.push({ k, error: v.errors.join('; ') }); continue; }
    const mx = ms.reduce((s, m) => s + m.x, 0) / ms.length, my = ms.reduce((s, m) => s + m.y, 0) / ms.length;
    let model, p, tInterp = null;
    const withBall = E.isWithBall(data.formations, phase);
    const ballYs = ms.filter((m) => m.ball && typeof m.ball.y === 'number').map((m) => m.ball.y);
    if (withBall && ballYs.length === ms.length) {
      // com a bola e com a altura da bola informada: interpola o modelo entre a Saída e o Ataque
      // na mesma altura de bola (a Saída do site tem a bola com o goleiro; o frame pode ser mais adiante)
      const b0 = data.formations.phases.saindo.ball.y, b1 = data.formations.phases.ataque.ball.y;
      const by = ballYs.reduce((s, v) => s + v, 0) / ballYs.length;
      tInterp = Math.max(0, Math.min(1, (by - b0) / (b1 - b0)));
      const A = E.computePhase(t.players, 'saindo', data, t.ti || {}).players.find((q) => q.slot === slot);
      const B = E.computePhase(t.players, 'ataque', data, t.ti || {}).players.find((q) => q.slot === slot);
      if (!A || !B) { rows.push({ k, error: 'slot ausente na tática: ' + slot }); continue; }
      p = B; model = { x: +(A.x + (B.x - A.x) * tInterp).toFixed(1), y: +(A.y + (B.y - A.y) * tInterp).toFixed(1) };
    } else {
      p = E.computePhase(t.players, phase, data, t.ti || {}).players.find((q) => q.slot === slot);
      if (!p) { rows.push({ k, error: 'slot ausente na tática: ' + slot }); continue; }
      model = { x: p.x, y: p.y };
    }
    rows.push({ k, tactic: tid, phase, slot, role: p.role, duty: p.duty, n: ms.length, t: tInterp, measured: { x: mx, y: my }, model, dx: model.x - mx, dy: model.y - my });
  }
  return rows;
}

if (require.main === module) {
  const rows = compare();
  if (!rows.length) { console.log('Nenhuma medida em data/measurements.json ainda.'); process.exit(0); }
  const by = {};
  for (const r of rows) {
    if (r.error) { console.log('ERRO', r.k, r.error); continue; }
    console.log(`${r.tactic} ${r.phase.padEnd(11)} ${r.slot.padEnd(5)} ${(r.role + '-' + r.duty).padEnd(28)} medido ${r.measured.x.toFixed(1)},${r.measured.y.toFixed(1)} (n=${r.n})  modelo ${r.model.x},${r.model.y}${r.t != null ? ' (bola: t=' + r.t.toFixed(2) + ')' : ''}  dif ${r.dx.toFixed(1)},${r.dy.toFixed(1)}`);
    for (const key of [r.role + '-' + r.duty, 'fase ' + r.phase]) (by[key] = by[key] || []).push(r);
  }
  console.log('\nErro médio (|dy|, |dx|):');
  for (const [key, rs] of Object.entries(by).sort()) {
    const ady = rs.reduce((s, r) => s + Math.abs(r.dy), 0) / rs.length, adx = rs.reduce((s, r) => s + Math.abs(r.dx), 0) / rs.length;
    console.log(`  ${key.padEnd(34)} ${ady.toFixed(1)}  ${adx.toFixed(1)}  (${rs.length})`);
  }
}
module.exports = { compare };
