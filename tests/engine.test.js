'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/engine/engine.js');

const data = {
  formations: require('../data/formations.json'),
  roles: require('../data/roles.json'),
  instructions: require('../data/team-instructions.json')
};
const preset = (id) => data.formations.presets.find((p) => p.id === id).players;
const byslot = (res, slot) => res.players.find((p) => p.slot === slot);
const neutralTI = {};

test('todos os atalhos são válidos e têm 11 jogadores', () => {
  for (const p of data.formations.presets) {
    const v = E.validate(p.players, data);
    assert.equal(p.players.length, 11, p.id);
    assert.deepEqual(v.errors, [], p.id);
  }
});

test('defaultRoles são válidos para cada slot', () => {
  for (const [slot, [role, duty]] of Object.entries(data.formations.defaultRoles)) {
    assert.ok(data.roles[role].slots.includes(slot), `${slot} → ${role}`);
    assert.ok(data.roles[role].duties[duty], `${slot} → ${role}-${duty}`);
  }
});

test('validação detecta 10 jogadores, 2 goleiros e slot repetido', () => {
  const p = preset('4-4-2');
  assert.ok(E.validate(p.slice(0, 10), data).errors.some((e) => e.includes('11')));
  const twoGk = p.slice(0, 10).concat([{ slot: 'GK', role: 'goalkeeper', duty: 'D' }]);
  const v = E.validate(twoGk, data);
  assert.ok(v.errors.some((e) => e.includes('goleiro')));
  assert.ok(v.errors.some((e) => e.includes('repetido')));
});

test('validação rejeita função fora do slot e tarefa inválida', () => {
  const p = preset('4-4-2').map((x) => ({ ...x }));
  p[1] = { slot: 'DL', role: 'poacher', duty: 'A' };
  p[2] = { slot: 'DCL', role: 'central_defender', duty: 'A' };
  const v = E.validate(p, data);
  assert.equal(v.ok, false);
  assert.equal(v.errors.length, 2);
});

test('computeAll devolve 11 jogadores por fase, tudo dentro de [2, 98]', () => {
  for (const pr of data.formations.presets) {
    const all = E.computeAll(pr.players, data, { mentality: 6, widthInPossession: 4, defensiveLine: 4, lineOfEngagement: 2 });
    for (const ph of E.PHASES) {
      assert.equal(all[ph].players.length, 11);
      for (const pl of all[ph].players) {
        assert.ok(pl.x >= 2 && pl.x <= 98 && pl.y >= 2 && pl.y <= 98, `${pr.id}/${ph}/${pl.slot} ${pl.x},${pl.y}`);
      }
    }
  }
});

test('espelhamento: mesma função à esquerda e à direita fica simétrica', () => {
  const p = preset('4-4-2').map((x) => ({ ...x }));
  p.find((x) => x.slot === 'ML').role = 'winger';
  p.find((x) => x.slot === 'ML').duty = 'A';
  const res = E.computePhase(p, 'ataque', data, neutralTI);
  const l = byslot(res, 'ML'), r = byslot(res, 'MR');
  assert.equal(l.x, 5);
  assert.equal(r.x, 95);
  assert.equal(l.y, r.y);
});

test('regra override: Atacante Interior (A) no ataque vai para x 32 / 68', () => {
  const p = preset('4-2-3-1-dm-wide').map((x) => ({ ...x }));
  p.find((x) => x.slot === 'AMR').role = 'inside_forward';
  const res = E.computePhase(p, 'ataque', data, neutralTI);
  assert.ok(Math.abs(byslot(res, 'AML').x - 32) < 1.5);
  assert.ok(Math.abs(byslot(res, 'AMR').x - 68) < 1.5);
});

test('Half-Back abre os zagueiros (split_cbs_wide) na saída de bola', () => {
  const res = E.computePhase(preset('4-3-3-dm-wide'), 'saindo', data, neutralTI);
  assert.equal(byslot(res, 'DCL').x, 25);
  assert.equal(byslot(res, 'DCR').x, 75);
  assert.equal(byslot(res, 'DMC').x, 50);
  assert.ok(byslot(res, 'DMC').y < 20);
});

test('saída de bola: 2 DCs em 32/68 e 3 DCs em 25/50/75 (sem efeitos)', () => {
  const r2 = E.computePhase(preset('4-4-2'), 'saindo', data, neutralTI);
  assert.equal(byslot(r2, 'DCL').x, 32);
  assert.equal(byslot(r2, 'DCR').x, 68);
  const r3 = E.computePhase(preset('3-4-3'), 'saindo', data, neutralTI);
  assert.deepEqual(['DCL', 'DC', 'DCR'].map((s) => byslot(r3, s).x), [25, 50, 75]);
});

test('fullback_hold: Ala Invertido à esquerda abre o DC esquerdo em 5', () => {
  const res = E.computePhase(preset('4-2-3-1-dm-wide'), 'saindo', data, neutralTI);
  assert.equal(byslot(res, 'DCL').x, 27);
  assert.equal(byslot(res, 'DCR').x, 68);
});

test('DLP (D) só divide os DCs com a flag ligada', () => {
  const p = preset('4-1-4-1-dm-wide').map((x) => ({ ...x }));
  Object.assign(p.find((x) => x.slot === 'DMC'), { role: 'deep_lying_playmaker', duty: 'D' });
  const off = E.computePhase(p, 'saindo', data, {});
  const on = E.computePhase(p, 'saindo', data, { flags: { dlp_drop: true } });
  assert.equal(byslot(off, 'DCL').x, 32);
  assert.equal(byslot(on, 'DCL').x, 25);
});

test('mentalidade desloca as fases com bola, mas não o goleiro nem a fase defensiva', () => {
  const p = preset('4-4-2');
  const bal = E.computeAll(p, data, { mentality: 3 });
  const att = E.computeAll(p, data, { mentality: 6 });
  assert.equal(byslot(att.ataque, 'MCL').y - byslot(bal.ataque, 'MCL').y, 8);
  assert.equal(byslot(att.ataque, 'GK').y, byslot(bal.ataque, 'GK').y);
  assert.equal(byslot(att.defendendo, 'MCL').y, byslot(bal.defendendo, 'MCL').y);
});

test('linha defensiva move o bloco; linha de pressão move só AM/ST', () => {
  const p = preset('4-4-1-1');
  const std = E.computePhase(p, 'defendendo', data, {});
  const high = E.computePhase(p, 'defendendo', data, { defensiveLine: 4 });
  const loe = E.computePhase(p, 'defendendo', data, { lineOfEngagement: 2 });
  assert.equal(byslot(high, 'DCL').y, 35);
  assert.equal(byslot(high, 'MCL').y - byslot(std, 'MCL').y, 10);
  assert.equal(byslot(high, 'GK').y, byslot(std, 'GK').y);
  assert.equal(byslot(loe, 'MCL').y, byslot(std, 'MCL').y);
  assert.ok(byslot(loe, 'STC').y > byslot(std, 'STC').y);
});

test('colisão: nenhum par termina a menos de ~6 unidades em casos comuns', () => {
  const pts = [{ x: 50, y: 50 }, { x: 50, y: 50 }, { x: 52, y: 51 }];
  E.resolveCollisions(pts, 6, 5);
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++)
      assert.ok(Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) > 5.5);
});

test('overrideFromPosition é o inverso do pipeline (lado direito, com largura e mentalidade)', () => {
  const p = preset('4-2-3-1-dm-wide');
  const ti = { mentality: 5, widthInPossession: 3 };
  const res = E.computePhase(p, 'ataque', data, ti);
  const amr = byslot(res, 'AMR');
  const ov = E.overrideFromPosition(amr, 80, 70);
  const roles = E.applyOverride(data.roles, amr.role, amr.duty, 'ataque', ov);
  const res2 = E.computePhase(p, 'ataque', { ...data, roles }, ti);
  const amr2 = byslot(res2, 'AMR');
  assert.ok(Math.abs(amr2.x - 80) < 0.3 && Math.abs(amr2.y - 70) < 0.3, `${amr2.x},${amr2.y}`);
  assert.equal(data.roles.winger.duties.A.ataque.x, 5, 'applyOverride não pode mutar o original');
});

test('colisão com aspecto de campo: distância medida em metros (68×105)', () => {
  const pts = [{ x: 40, y: 50 }, { x: 44, y: 50 }];
  E.resolveCollisions(pts, 6, 5, [0.68, 1.05]);
  assert.ok(Math.abs((pts[1].x - pts[0].x) * 0.68 - 6) < 0.01);
});
