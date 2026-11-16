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
/** Posições médias (todas as fases misturadas): acha a mistura de fases do modelo (pesos de 5% em 5%) que melhor as reproduz. */
function compareAverages() {
  const PH = ['pressao', 'defendendo', 'bloco_baixo', 'saindo', 'progressao', 'ataque'];
  return (M.averages || []).map((a) => {
    const t = M.tactics[a.tactic];
    if (!t || !E.validate(t.players, data).ok) return { id: a.id, error: 'tática inválida ou ausente: ' + a.tactic };
    const pos = {};
    PH.forEach((ph) => { pos[ph] = E.computePhase(t.players, ph, data, t.ti || {}).players; });
    const slots = Object.keys(a.positions);
    const mix = (w, s) => PH.reduce((acc, ph, i) => {
      const p = pos[ph].find((q) => q.slot === s);
      return { x: acc.x + w[i] * 0.05 * p.x, y: acc.y + w[i] * 0.05 * p.y };
    }, { x: 0, y: 0 });
    let best = null;
    const rec = (i, left, w) => {
      if (i === PH.length - 1) {
        w[i] = left;
        let err = 0;
        for (const s of slots) { const m = mix(w, s); err += (m.x - a.positions[s].x) ** 2 + (m.y - a.positions[s].y) ** 2; }
        if (!best || err < best.err) best = { err, w: w.slice() };
        return;
      }
      for (let k = 0; k <= left; k++) { w[i] = k; rec(i + 1, left - k, w); }
    };
    rec(0, 20, new Array(PH.length));
    const rows = slots.map((s) => { const m = mix(best.w, s); return { slot: s, measured: a.positions[s], model: m, dx: m.x - a.positions[s].x, dy: m.y - a.positions[s].y }; });
    return { id: a.id, weights: Object.fromEntries(PH.map((ph, i) => [ph, best.w[i] * 5])), rms: Math.sqrt(best.err / slots.length), rows };
  });
}

if (require.main === module) {
  for (const r of compareAverages()) {
    if (r.error) { console.log('ERRO', r.id, r.error); continue; }
    console.log(`\nMédias ${r.id}: mistura de fases que melhor as reproduz: ` + Object.entries(r.weights).filter(([, w]) => w).map(([ph, w]) => ph + ' ' + w + '%').join(', ') + `; erro médio ${r.rms.toFixed(1)}`);
    for (const x of r.rows) console.log(`  ${x.slot.padEnd(5)} medido ${x.measured.x},${x.measured.y}  modelo ${x.model.x.toFixed(1)},${x.model.y.toFixed(1)}  dif ${x.dx.toFixed(1)},${x.dy.toFixed(1)}`);
  }
}
module.exports = { compare, compareAverages };
