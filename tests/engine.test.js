'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/engine/engine.js');

const data = {
  formations: require('../data/formations.json'),
  roles: require('../data/roles.json'),
  instructions: require('../data/team-instructions.json'),
  playerInstructions: require('../data/player-instructions.json'),
  opponent: require('../data/opponent.json'),
  playerTraits: require('../data/player-traits.json'),
  alerts: require('../data/alerts.json')
};
const preset = (id) => data.formations.presets.find((p) => p.id === id).players;
const byslot = (res, slot) => res.players.find((p) => p.slot === slot);
const neutralTI = {};
// mesmos dados sem colisão, para medir um efeito isolado
const noCol = { ...data, instructions: { ...data.instructions, engine: { ...data.instructions.engine, collisionMinDist: 0 } } };

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

test('fullback_hold: Ala Invertido à esquerda abre o DC esquerdo em 5 (com o DMCL livre)', () => {
  const p = preset('4-3-3-dm-wide').map((x) => (x.slot === 'DL' ? { ...x, role: 'inverted_wing_back', duty: 'S' } : x.slot === 'DMC' ? { ...x, role: 'defensive_midfielder', duty: 'D' } : { ...x }));
  const res = E.computePhase(p, 'saindo', data, neutralTI);
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
  assert.equal(byslot(high, 'DCL').y, 38);
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

// ---------- instruções individuais ----------

const withPI = (presetId, slot, instructions) =>
  preset(presetId).map((x) => (x.slot === slot ? { ...x, instructions } : { ...x }));

test('PI "Avançar mais" sobe o jogador só nas fases com bola', () => {
  const base = E.computeAll(preset('4-4-2'), noCol, {});
  const pi = E.computeAll(withPI('4-4-2', 'ML', ['get_further_forward']), noCol, {});
  assert.equal(byslot(pi.ataque, 'ML').y - byslot(base.ataque, 'ML').y, 6);
  assert.equal(byslot(pi.saindo, 'ML').y - byslot(base.saindo, 'ML').y, 3);
  assert.equal(byslot(pi.defendendo, 'ML').y, byslot(base.defendendo, 'ML').y);
});

test('PI "Fechar mais" é espelhada: esquerda vai para a direita e vice-versa', () => {
  const p = preset('4-4-2').map((x) =>
    x.slot === 'DL' || x.slot === 'DR' ? { ...x, instructions: ['sit_narrower'] } : { ...x });
  const base = E.computePhase(preset('4-4-2'), 'ataque', data, {});
  const res = E.computePhase(p, 'ataque', data, {});
  assert.equal(byslot(res, 'DL').x - byslot(base, 'DL').x, 7);
  assert.equal(byslot(res, 'DR').x - byslot(base, 'DR').x, -7);
});

test('PI "para dentro" nunca cruza o meio do campo', () => {
  const pts = withPI('3-5-2-wb', 'MCL', []);
  // força um caso extremo: inside enorme via dados de teste
  const pis = JSON.parse(JSON.stringify(data.playerInstructions));
  pis.instructions.test_inside = { label: 't', en: 't', group: 'com_bola', phases: { ataque: { inside: 99 } } };
  pts.find((x) => x.slot === 'WBL').instructions = ['test_inside'];
  const res = E.computePhase(pts, 'ataque', { ...data, playerInstructions: pis }, {});
  assert.ok(byslot(res, 'WBL').x <= 50 + 6, String(byslot(res, 'WBL').x));
});

test('PI indisponível ou conflitante é ignorada e gera aviso', () => {
  const p = withPI('4-4-2', 'GK', ['get_further_forward']);
  p.find((x) => x.slot === 'MCR').instructions = ['get_further_forward', 'hold_position'];
  const v = E.validate(p, data);
  assert.equal(v.ok, true);
  assert.equal(v.warnings.length, 2);
  const res = E.computePhase(p, 'ataque', data, {});
  assert.deepEqual(byslot(res, 'GK').instructions, []);
  assert.deepEqual(byslot(res, 'MCR').instructions, ['get_further_forward']);
});

test('PI já embutida na função fica indisponível (Atacante Interior + Cortar para dentro)', () => {
  const pis = data.playerInstructions.instructions;
  const info = E.slotInfo(data.formations, 'AML');
  const av = (key, role, duty) => E.piAvailability(pis[key], { role, duty }, info, data.roles, key).ok;
  assert.equal(av('cut_inside', 'inside_forward', 'A'), false);
  assert.equal(av('cut_inside', 'winger', 'A'), false, 'Extremo já corre pela lateral (oposto)');
  assert.equal(av('cut_inside', 'advanced_playmaker', 'S'), true);
});

test('modo edição continua inverso exato com PIs laterais ativas', () => {
  const p = withPI('4-4-2', 'DR', ['sit_narrower', 'get_further_forward']);
  const res = E.computePhase(p, 'ataque', data, { widthInPossession: 1 });
  const dr = byslot(res, 'DR');
  const ov = E.overrideFromPosition(dr, 80, 60);
  const roles = E.applyOverride(data.roles, dr.role, dr.duty, 'ataque', ov);
  const dr2 = byslot(E.computePhase(p, 'ataque', { ...data, roles }, { widthInPossession: 1 }), 'DR');
  assert.ok(Math.abs(dr2.x - 80) < 0.3 && Math.abs(dr2.y - 60) < 0.3, `${dr2.x},${dr2.y}`);
});

// ---------- pesquisa de funções: Automático, deambular, descrições ----------

test('toda função tem descrição e toda combinação função+tarefa é avaliável', () => {
  for (const [k, r] of Object.entries(data.roles)) {
    assert.ok(r.desc && r.desc.length > 10, k);
  }
});

test('tarefa Automático segue a mentalidade (Defensiva → D, Ofensiva → A)', () => {
  const p = preset('4-4-2').map((x) => (x.slot === 'DL' ? { ...x, role: 'full_back', duty: 'Au' } : { ...x }));
  const def = E.computePhase(p, 'ataque', data, { mentality: 1 });
  const att = E.computePhase(p, 'ataque', data, { mentality: 5 });
  assert.equal(byslot(def, 'DL').effDuty, 'D');
  assert.equal(byslot(att, 'DL').effDuty, 'A');
  assert.ok(byslot(att, 'DL').y > byslot(def, 'DL').y);
});

test('deambular: zona só nas fases com bola; embutido no Trequartista; PI para os demais', () => {
  const p = preset('4-2-3-1-dm-wide').map((x) => (x.slot === 'AMC' ? { ...x, role: 'trequartista', duty: 'A' } : { ...x }));
  p.find((x) => x.slot === 'DMCL').instructions = ['roam_from_position'];
  const all = E.computeAll(p, data, {});
  assert.equal(byslot(all.defendendo, 'AMC').zone, null);
  assert.deepEqual(byslot(all.ataque, 'AMC').zone, { rx: 18, ry: 8 }, 'deambular + corredores embutidos');
  assert.equal(byslot(all.ataque, 'DMCL').zone.rx, 8);
  assert.equal(byslot(all.saindo, 'DMCL').zone.rx, 6);
  const info = E.slotInfo(data.formations, 'AMC');
  const pis = data.playerInstructions.instructions;
  assert.equal(E.piAvailability(pis.roam_from_position, { role: 'trequartista', duty: 'A' }, info, data.roles, 'roam_from_position').ok, false);
  assert.equal(E.piAvailability(pis.roam_from_position, { role: 'enganche', duty: 'S' }, info, data.roles, 'roam_from_position').ok, false, 'Enganche tem Manter posição embutido');
});

// ---------- manual oficial do FM23 + instruções embutidas ----------

test('toda instrução embutida (locked) existe em player-instructions.json', () => {
  const pis = data.playerInstructions.instructions;
  for (const [k, r] of Object.entries(data.roles))
    for (const [d, rules] of Object.entries(r.duties))
      for (const l of rules.locked || []) assert.ok(pis[l], `${k}-${d}: ${l}`);
});

test('linha defensiva também sobe/desce os defensores com a bola', () => {
  const p = preset('4-4-2');
  const std = E.computePhase(p, 'ataque', noCol, {});
  const high = E.computePhase(p, 'ataque', noCol, { defensiveLine: 4 });
  assert.equal(byslot(high, 'DCL').y - byslot(std, 'DCL').y, 10);
  assert.equal(byslot(high, 'MCL').y, byslot(std, 'MCL').y);
});

test('largura defensiva abre/fecha o bloco só sem a bola', () => {
  const p = preset('4-4-2');
  const narrow = E.computePhase(p, 'defendendo', data, { defensiveWidth: 0 });
  const wide = E.computePhase(p, 'defendendo', data, { defensiveWidth: 2 });
  assert.ok(byslot(wide, 'DL').x < byslot(narrow, 'DL').x);
  assert.equal(E.computePhase(p, 'ataque', data, { defensiveWidth: 0 }).players[1].x,
               E.computePhase(p, 'ataque', data, { defensiveWidth: 2 }).players[1].x);
});

test('"Abrir mais" cola o jogador aberto na linha lateral (espelhado)', () => {
  const p = preset('4-4-2').map((x) => (x.slot === 'ML' || x.slot === 'DR' ? { ...x, instructions: ['stay_wider'] } : { ...x }));
  const res = E.computePhase(p, 'ataque', data, { widthInPossession: 0 });
  assert.equal(byslot(res, 'ML').x, 4);
  assert.equal(byslot(res, 'DR').x, 96);
});

test('"Mover-se para os corredores": zona horizontal no centroavante central; fecha por dentro no aberto', () => {
  const p = preset('4-2-3-1-wide').map((x) => ({ ...x }));
  Object.assign(p.find((x) => x.slot === 'STC'), { role: 'target_forward', duty: 'S', instructions: ['move_into_channels'] });
  Object.assign(p.find((x) => x.slot === 'AMR'), { role: 'winger', duty: 'S', instructions: ['move_into_channels'] });
  const base = E.computePhase(preset('4-2-3-1-wide').map((x) => (x.slot === 'AMR' ? { ...x, role: 'winger', duty: 'S' } : x)), 'ataque', data, {});
  const res = E.computePhase(p, 'ataque', data, {});
  assert.deepEqual(byslot(res, 'STC').zone, { rx: 18, ry: 4 });
  assert.ok(byslot(res, 'AMR').x < byslot(base, 'AMR').x);
});

test('Lateral Invertido vira terceiro zagueiro na construção e empurra os DCs', () => {
  const p = preset('4-4-2').map((x) => (x.slot === 'DL' ? { ...x, role: 'inverted_full_back', duty: 'D' } : { ...x }));
  assert.equal(E.validate(p, data).ok, true);
  const res = E.computePhase(p, 'saindo', data, {});
  assert.equal(byslot(res, 'DL').x, 20);
  assert.equal(byslot(res, 'DCL').x, 42);
  assert.equal(byslot(res, 'DCR').x, 78);
});

test('Zagueiro Simples tem tarefa Stopper', () => {
  assert.ok(data.roles.no_nonsense_cb.duties.St);
});

// ---------- adversário ----------

const oppOf = (id, styleId) => ({ enabled: true, players: preset(id), styleId });

test('adversário: 11 jogadores por fase, espelhado (goleiro dele no alto do campo)', () => {
  const m = E.computeMatch(preset('4-3-3-dm-wide'), data, {}, oppOf('4-4-2', 'equilibrado'));
  for (const ph of E.PHASES) {
    const opp = m[ph].opponent.players;
    assert.equal(opp.length, 11);
    const gk = opp.find((p) => p.slot === 'GK');
    assert.ok(gk.y > 85, `${ph}: GK ${gk.y}`);
    for (const p of opp) assert.ok(p.x >= 2 && p.x <= 98 && p.y >= 2 && p.y <= 98);
  }
});

test('adversário desligado não altera o nosso time', () => {
  const a = E.computeAll(preset('4-3-3-dm-wide'), data, {});
  const b = E.computeMatch(preset('4-3-3-dm-wide'), data, {}, { enabled: false, players: preset('4-4-2') });
  assert.deepEqual(b.ataque.players.map((p) => [p.x, p.y]), a.ataque.players.map((p) => [p.x, p.y]));
  assert.equal(b.ataque.opponent, undefined);
});

test('estilo muda a altura do bloco: pressão alta pressiona mais a saída que o bloco baixo', () => {
  const press = E.computeMatch(preset('4-3-3-dm-wide'), data, {}, oppOf('4-4-2', 'pressao_alta'));
  const low = E.computeMatch(preset('4-3-3-dm-wide'), data, {}, oppOf('4-4-2', 'bloco_baixo'));
  const st = (m) => Math.min(...m.saindo.opponent.players.filter((p) => p.band === 'ST').map((p) => p.y));
  assert.ok(st(press) < st(low) - 15, `${st(press)} vs ${st(low)}`);
});

test('impedimento: ninguém passa do último defensor rival no campo adversário', () => {
  for (const style of data.opponent.styles.map((s) => s.id)) {
    const m = E.computeMatch(preset('4-2-3-1-dm-wide'), data, {}, oppOf('4-4-2', style));
    for (const ph of E.PHASES.filter((f) => E.isWithBall(data.formations, f))) {
      const line = Math.max(50, ...m[ph].opponent.players.filter((p) => p.band !== 'GK').map((p) => p.y));
      for (const p of m[ph].players) if (p.band !== 'GK') assert.ok(p.y <= line + 0.11, `${style}/${ph}/${p.slot} ${p.y} > ${line}`);
    }
    for (const ph of E.PHASES.filter((f) => !E.isWithBall(data.formations, f))) {
      const lineD = Math.min(50, ...m[ph].players.filter((p) => p.band !== 'GK').map((p) => p.y));
      for (const p of m[ph].opponent.players) if (p.band !== 'GK') assert.ok(p.y >= lineD - 0.11, `${style}/${ph}/${p.slot}`);
    }
  }
});

test('no nosso ataque, a linha do adversário fica perto da própria área em qualquer estilo', () => {
  for (const style of data.opponent.styles) {
    const m = E.computeMatch(preset('4-2-3-1-dm-wide'), data, {}, oppOf('4-4-2', style.id));
    const ds = m.ataque.opponent.players.filter((p) => p.band === 'D');
    const avg = ds.reduce((t, p) => t + p.y, 0) / ds.length;
    assert.ok(Math.abs(avg - (100 - style.shifts.ataque.lineY)) < 3, `${style.id}: ${avg}`);
  }
});

test('DLP (S) no volante fica à frente dos zagueiros no ataque; no meio-campo, um pouco atrás dos meias', () => {
  const p = preset('4-2-3-1-dm-wide');
  const res = E.computePhase(p, 'ataque', noCol, {});
  const dlp = byslot(res, 'DMCR'), cb = byslot(res, 'DCR');
  assert.ok(dlp.y - cb.y >= 12, `DLP ${dlp.y} vs DC ${cb.y}`);
  const p2 = preset('4-2-3-1-wide');
  const r2 = E.computePhase(p2, 'ataque', noCol, {});
  assert.ok(byslot(r2, 'MCL').y < byslot(r2, 'MCR').y, 'DLP no MC abaixo do Box-to-Box');
});

test('na saída de bola o Construtor Avançado recua para receber e o Meia Ofensivo (A) fica alto', () => {
  const p = preset('3-5-2-wb').map((x) => ({ ...x }));
  // dois meias ofensivos lado a lado, como no 3-4-2-1 do usuário
  const i1 = p.findIndex((x) => x.slot === 'MCL'), i2 = p.findIndex((x) => x.slot === 'MCR');
  p[i1] = { slot: 'AMCL', role: 'attacking_midfielder', duty: 'A' };
  p[i2] = { slot: 'AMCR', role: 'advanced_playmaker', duty: 'S' };
  const res = E.computePhase(p, 'saindo', noCol, {});
  assert.ok(byslot(res, 'AMCL').y - byslot(res, 'AMCR').y >= 8, `${byslot(res, 'AMCL').y} vs ${byslot(res, 'AMCR').y}`);
});

test('guia FM23 (Seif Khaled): corridas laterais do AP/Carrilero e corredores embutidos nos atacantes', () => {
  const p = preset('4-3-3-dm-wide').map((x) => ({ ...x }));
  Object.assign(p.find((x) => x.slot === 'STC'), { role: 'advanced_forward', duty: 'A' });
  const res = E.computePhase(p, 'ataque', data, {});
  assert.deepEqual(byslot(res, 'MCR').zone, { rx: 8, ry: 3 }, 'Carrilero: zona lateral');
  assert.deepEqual(byslot(res, 'STC').zone, { rx: 18, ry: 8 }, 'Avançado: corredores + deambular');
  assert.ok(data.roles.libero.duties.S && data.roles.libero.duties.A && !data.roles.libero.uncertain);
});

// ---------- características (traits) ----------

const withTraits = (presetId, slot, traits, extra = {}) =>
  preset(presetId).map((x) => (x.slot === slot ? { ...x, ...extra, traits } : { ...x }));

test('trait "Cola na linha lateral" prende o aberto na linha; "Corta para dentro pela esquerda" só vale à esquerda', () => {
  const p = withTraits('4-4-2', 'ML', ['hugs_line']);
  assert.equal(byslot(E.computePhase(p, 'ataque', noCol, {}), 'ML').x, 4);
  const base = E.computePhase(preset('4-4-2'), 'ataque', noCol, {});
  const l = E.computePhase(withTraits('4-4-2', 'ML', ['cuts_inside_left']), 'ataque', noCol, {});
  assert.equal(byslot(l, 'ML').x - byslot(base, 'ML').x, 6);
  const r = E.computePhase(withTraits('4-4-2', 'MR', ['cuts_inside_left']), 'ataque', noCol, {});
  assert.equal(byslot(r, 'MR').x, byslot(base, 'MR').x, 'trait da esquerda não vale na direita');
});

test('trait de avançar é anulado por "Manter posição" (embutida ou PI), como diz o manual', () => {
  // DL Lateral (D) tem Manter posição embutido
  const p = withTraits('4-4-2', 'DL', ['gets_forward_whenever_possible'], { role: 'full_back', duty: 'D' });
  const base = E.computePhase(preset('4-4-2').map((x) => (x.slot === 'DL' ? { ...x, duty: 'D' } : x)), 'ataque', noCol, {});
  const res = E.computePhase(p, 'ataque', noCol, {});
  assert.equal(byslot(res, 'DL').y, byslot(base, 'DL').y);
  assert.deepEqual(byslot(res, 'DL').traits, []);
  assert.ok(E.validate(p, data).warnings.some((w) => w.includes('sem efeito')));
});

test('"Recua para buscar a bola" baixa o atacante; "Não se move para os corredores" remove a zona de corredor', () => {
  const p = preset('4-3-3-dm-wide').map((x) => (x.slot === 'STC' ? { ...x, traits: ['comes_deep', 'does_not_move_into_channels'] } : { ...x }));
  const base = E.computePhase(preset('4-3-3-dm-wide'), 'saindo', noCol, {});
  const res = E.computePhase(p, 'saindo', noCol, {});
  assert.equal(byslot(base, 'STC').y - byslot(res, 'STC').y, 6);
  assert.equal(byslot(res, 'STC').zone.rx, byslot(res, 'STC').zone.ry, 'só a zona circular do deambular');
});

test('glossário do FM23: a zona de corredor do centroavante chega ao espaço entre zagueiro e lateral (x ~32/68)', () => {
  const p = preset('4-3-3-dm-wide').map((x) => (x.slot === 'STC' ? { ...x, role: 'target_forward', duty: 'S', instructions: ['move_into_channels'] } : { ...x }));
  const st = byslot(E.computePhase(p, 'ataque', data, {}), 'STC');
  assert.ok(st.x - st.zone.rx <= 33 && st.x + st.zone.rx >= 67, `${st.x} ± ${st.zone.rx}`);
});

// ---------- 6 fases e estrutura ----------

const avgY = (res, band) => { const ps = res.players.filter((p) => p.band === band); return ps.reduce((t, p) => t + p.y, 0) / ps.length; };

test('6 fases, 3 sem bola e 3 com bola, todas com 11 jogadores', () => {
  assert.equal(E.PHASES.length, 6);
  assert.deepEqual(E.PHASES.filter((f) => E.isWithBall(data.formations, f)), ['saindo', 'progressao', 'ataque']);
  const all = E.computeAll(preset('4-2-3-1-dm-wide'), data, {});
  for (const ph of E.PHASES) assert.equal(all[ph].players.length, 11, ph);
});

test('sem a bola: pressão alta > bloco médio > bloco baixo, por faixa; bloco baixo com a linha perto da área', () => {
  const all = E.computeAll(preset('4-4-2'), noCol, {});
  for (const b of ['D', 'M', 'ST']) {
    assert.ok(avgY(all.pressao, b) > avgY(all.defendendo, b) + 5, `pressão ${b}`);
    assert.ok(avgY(all.defendendo, b) > avgY(all.bloco_baixo, b) + 5, `bloco baixo ${b}`);
  }
  assert.ok(Math.abs(Math.min(...all.bloco_baixo.players.filter((p) => p.band === 'D').map((p) => p.y)) - 14) < 0.5);
});

test('progressão fica entre a saída e o ataque', () => {
  const all = E.computeAll(preset('4-3-3-dm-wide'), noCol, {});
  for (const b of ['D', 'M', 'ST']) {
    assert.ok(avgY(all.progressao, b) > avgY(all.saindo, b) && avgY(all.progressao, b) < avgY(all.ataque, b), b);
  }
});

test('na pressão alta, quem tem "pressionar mais" embutido sobe e quem tem "pressionar menos" fica', () => {
  const p = preset('4-4-2').map((x) => (x.slot === 'STCL' ? { ...x, role: 'pressing_forward', duty: 'S' } : x.slot === 'STCR' ? { ...x, role: 'trequartista', duty: 'A' } : { ...x }));
  const r = E.computePhase(p, 'pressao', noCol, {}), d = E.computePhase(p, 'defendendo', noCol, {});
  const up = (s) => byslot(r, s).y - byslot(d, s).y;
  assert.ok(up('STCL') - up('STCR') >= 9, `${up('STCL')} vs ${up('STCR')}`);
});

test('modo edição em fase derivada grava deslocamento e reproduz a posição arrastada', () => {
  const p = preset('4-2-3-1-dm-wide');
  const cp = byslot(E.computePhase(p, 'progressao', noCol, {}), 'AMR');
  const patch = E.deltaFromPosition(cp, cp.x - 5, cp.y + 4);
  const roles = E.applyOverride(data.roles, cp.role, cp.duty, 'progressao', patch);
  const cp2 = byslot(E.computePhase(p, 'progressao', { ...noCol, roles }, {}), 'AMR');
  assert.ok(Math.abs(cp2.x - (cp.x - 5)) < 0.2 && Math.abs(cp2.y - (cp.y + 4)) < 0.2, `${cp2.x},${cp2.y}`);
});

test('estrutura: 4-4-2, 4-2-3-1 e 4-1-4-1 aparecem como tais no bloco médio; medidas em metros', () => {
  assert.equal(E.teamShape(E.computePhase(preset('4-1-4-1-dm-wide'), 'defendendo', data, {}).players).shape, '4-1-4-1');
  assert.equal(E.teamShape(E.computePhase(preset('4-4-2'), 'defendendo', data, {}).players).shape, '4-4-2');
  const sh = E.teamShape(E.computePhase(preset('4-2-3-1-dm-wide'), 'defendendo', data, {}).players);
  assert.equal(sh.shape, '4-2-3-1');
  assert.ok(sh.metrics.length > 20 && sh.metrics.length < 60 && sh.metrics.width > 30 && sh.metrics.width <= 68);
});

test('estrutura do adversário (ataca para baixo) mede a última linha a partir do gol dele', () => {
  const m = E.computeMatch(preset('4-4-2'), data, {}, oppOf('4-4-2', 'equilibrado'));
  // na nossa progressão o adversário está em bloco médio
  const sh = E.teamShape(m.progressao.opponent.players, { attackingDown: true });
  assert.equal(sh.shape, '4-4-2');
  assert.ok(sh.metrics.lastLine > 10 && sh.metrics.lastLine < 50, String(sh.metrics.lastLine));
});

test('estrutura com a bola mostra o escalonamento (4-2-3-1 vira 2-4-3-1 na saída)', () => {
  assert.equal(E.teamShape(E.computePhase(preset('4-2-3-1-dm-wide'), 'saindo', data, {}).players).shape, '2-4-3-1');
});

// ---------- equilíbrio e sugestão de funções ----------

test('índice de equilíbrio fica entre 0 e 100 e tem os 7 critérios', () => {
  for (const pr of data.formations.presets) {
    const ev = E.evaluateBalance(pr.players, data, {});
    assert.ok(ev.score >= 0 && ev.score <= 100, pr.id);
    assert.equal(ev.parts.length, 9);
  }
});

test('tarefas: 3 D / 4 S / 3 A pontua mais que todo mundo em Ataque', () => {
  const p = preset('4-2-3-1-dm-wide');
  const allA = p.map((x) => {
    if (x.slot === 'GK') return x;
    const r = data.roles[x.role];
    return r.duties.A ? { ...x, duty: 'A' } : x;
  });
  const t = (pl) => E.evaluateBalance(pl, data, {}).parts.find((q) => q.key === 'tarefas').score;
  assert.ok(t(p) > t(allA));
});

test('sugestão nunca piora o índice, mantém slots e só usa funções válidas', () => {
  for (const id of ['4-2-3-1-dm-wide', '4-3-3-dm-wide', '4-4-2']) {
    const p = preset(id);
    const sug = E.suggestRoles(p, data, {}, { maxChanges: 4 });
    assert.ok(sug.after.score >= sug.before.score, id);
    assert.deepEqual(sug.players.map((x) => x.slot), p.map((x) => x.slot));
    assert.deepEqual(E.validate(sug.players, data).errors, [], id);
    for (const c of sug.changes) assert.ok(c.gain > 0);
  }
});

test('sugestão melhora uma tática desequilibrada (todos em Defender)', () => {
  const p = preset('4-2-3-1-dm-wide').map((x) => {
    if (x.slot === 'GK') return x;
    const r = data.roles[x.role];
    return r.duties.D ? { ...x, duty: 'D' } : x;
  });
  const sug = E.suggestRoles(p, data, {}, { maxChanges: 5 });
  assert.ok(sug.changes.length > 0 && sug.after.score - sug.before.score > 5, `${sug.before.score} → ${sug.after.score}`);
});

// ---------- funções do adversário por estilo ----------

test('funções típicas de cada estilo são válidas em todas as formações', () => {
  for (const st of data.opponent.styles) {
    for (const pr of data.formations.presets) {
      const ps = E.styleRoles(pr.players, data, st.id);
      assert.deepEqual(E.validate(ps, data).errors, [], `${st.id}/${pr.id}`);
      assert.deepEqual(ps.map((p) => p.slot), pr.players.map((p) => p.slot));
    }
  }
});

test('Atacar pelas alas põe extremos nas pontas; Gegenpress põe atacantes de pressão; Tiki-Taka usa falso 9', () => {
  const wing = E.styleRoles(preset('4-4-2'), data, 'pontas');
  assert.equal(wing.find((p) => p.slot === 'ML').role, 'winger');
  assert.equal(wing.find((p) => p.slot === 'MR').role, 'winger');
  const gp = E.styleRoles(preset('4-4-2'), data, 'pressao_alta');
  assert.ok(gp.filter((p) => p.role === 'pressing_forward').length === 2);
  const tk = E.styleRoles(preset('4-3-3-dm-wide'), data, 'posse');
  assert.equal(tk.find((p) => p.slot === 'STC').role, 'false_nine');
});

test('o adversário usa as funções informadas (ex.: Atacante de Pressão sobe mais na pressão que um Matador)', () => {
  const base = preset('4-4-2');
  const a = E.computeMatch(base, data, {}, { enabled: true, styleId: 'equilibrado', players: base.map((p) => (p.slot.startsWith('ST') ? { ...p, role: 'pressing_forward', duty: 'D' } : p)) });
  const b = E.computeMatch(base, data, {}, { enabled: true, styleId: 'equilibrado', players: base.map((p) => (p.slot.startsWith('ST') ? { ...p, role: 'poacher', duty: 'A' } : p)) });
  const stY = (m) => Math.min(...m.saindo.opponent.players.filter((p) => p.band === 'ST').map((p) => p.y));
  assert.notEqual(stY(a), stY(b));
});

// ---------- sugestão considerando o adversário ----------

test('com adversário, o índice ganha 5 critérios contra ele e continua entre 0 e 100', () => {
  const opp = oppOf('4-4-2', 'pressao_alta');
  const cache = E.opponentCache(data, opp, E.OPP_PHASES);
  const ev = E.evaluateBalance(preset('4-2-3-1-dm-wide'), data, {}, cache);
  assert.equal(ev.parts.length, 15);
  assert.equal(ev.parts.filter((p) => p.vsOpp).length, 6);
  assert.ok(ev.score >= 0 && ev.score <= 100 && ev.vsOpponent);
});

test('sugestão contra o adversário: não piora, é válida e pode diferir da sugestão sem adversário', () => {
  const p = preset('4-2-3-1-dm-wide');
  const plain = E.suggestRoles(p, data, {}, { maxChanges: 4 });
  const results = data.opponent.styles.map((st) => E.suggestRoles(p, data, {}, { maxChanges: 4, opponent: oppOf('4-4-2', st.id) }));
  for (const r of results) {
    assert.ok(r.after.score >= r.before.score);
    assert.deepEqual(E.validate(r.players, data).errors, []);
  }
  const key = (r) => r.changes.map((c) => c.slot + c.to.role + c.to.duty).join('|');
  assert.ok(results.some((r) => key(r) !== key(plain)), 'o adversário deveria mudar a sugestão em pelo menos um estilo');
});

// ---------- documentação extra: FM-Arena, Book of Roles, guias de pressão/defesa/atacantes ----------

test('Ala Invertido só inverte com o slot de volante do seu lado livre (FM23); senão age como Ala', () => {
  // 4-3-3 DM Wide: DMCL livre → inverte
  const a = preset('4-3-3-dm-wide').map((x) => (x.slot === 'DL' ? { ...x, role: 'inverted_wing_back', duty: 'S' } : { ...x }));
  const ra = byslot(E.computePhase(a, 'ataque', noCol, {}), 'DL');
  // 4-2-3-1 DM Wide: DMCL ocupado → age como Ala (Apoio)
  const b = preset('4-2-3-1-dm-wide');
  const rb = byslot(E.computePhase(b, 'ataque', noCol, {}), 'DL');
  assert.ok(ra.x > 30, `inverte: ${ra.x}`);
  assert.ok(rb.x < 15 && rb.fallback === 'wing_back', `não inverte: ${rb.x}`);
});

// ---------- The Book of Roles (Daljit Singh, FM23), PDF enviado pelo usuário ----------

const P = (slot, role, duty) => ({ slot, role, duty });
// 4-1-4-1 de teste: troque um slot com `swap(slot, role, duty)`
const book = [
  P('GK', 'goalkeeper', 'D'), P('DL', 'full_back', 'S'), P('DCL', 'central_defender', 'D'), P('DCR', 'central_defender', 'D'),
  P('DR', 'full_back', 'S'), P('DMC', 'defensive_midfielder', 'D'), P('ML', 'wide_midfielder', 'S'),
  P('MCL', 'central_midfielder', 'S'), P('MCR', 'central_midfielder', 'S'), P('MR', 'winger', 'S'), P('STC', 'advanced_forward', 'A')
];
const swap = (...changes) => book.map((p) => {
  const c = changes.find((x) => x[0] === p.slot);
  return c ? P(c[0], c[1], c[2]) : p;
});

test('Ala Invertido sem ponta/meia aberto à frente age como Ala (Book of Roles)', () => {
  // sem ninguém em ML/AML (o ponta do lado direito não conta para o lado esquerdo)
  const xi = swap(['DL', 'inverted_wing_back', 'S']).filter((p) => p.slot !== 'ML').concat([P('MC', 'central_midfielder', 'S')]);
  const dl = byslot(E.computePhase(xi, 'ataque', noCol, {}), 'DL');
  assert.equal(dl.fallback, 'wing_back');
  assert.equal(dl.fallbackWhy, 'no_wide_ahead');
  const withWinger = byslot(E.computePhase(swap(['DL', 'inverted_wing_back', 'S']), 'ataque', noCol, {}), 'DL');
  assert.ok(!withWinger.fallback && withWinger.x > 30, `com meia aberto à frente, inverte: ${withWinger.x}`);
});

test('Ala (D) fica acima do Lateral (S) na saída e no ataque', () => {
  const xi = swap(['DL', 'wing_back', 'D']);
  for (const ph of ['saindo', 'ataque']) {
    const r = E.computePhase(xi, ph, noCol, {});
    assert.ok(byslot(r, 'DL').y > byslot(r, 'DR').y, `${ph}: WB(D) ${byslot(r, 'DL').y} x FB(S) ${byslot(r, 'DR').y}`);
  }
});

test('Half Back no ataque fica um pouco à frente dos zagueiros, não atrás', () => {
  const r = E.computePhase(swap(['DMC', 'half_back', 'D']), 'ataque', noCol, {});
  const hb = byslot(r, 'DMC').y, cb = byslot(r, 'DCL').y;
  assert.ok(hb > cb && hb - cb <= 8, `HB ${hb} x DC ${cb}`);
});

test('Atacante de Pressão volta mais que um Avançado sem a bola; o (D) é o mais recuado', () => {
  const y = (duty, ph) => byslot(E.computePhase(swap(['STC', 'pressing_forward', duty]), ph, noCol, {}), 'STC').y;
  const af = (ph) => byslot(E.computePhase(book, ph, noCol, {}), 'STC').y;
  for (const ph of ['defendendo', 'bloco_baixo']) {
    assert.ok(y('D', ph) < y('S', ph) && y('S', ph) <= y('A', ph), `${ph}: D ${y('D', ph)}, S ${y('S', ph)}, A ${y('A', ph)}`);
    assert.ok(y('A', ph) < af(ph), `${ph}: PF(A) ${y('A', ph)} x AF ${af(ph)}`);
  }
});

test('Trequartista recua na saída, mais fundo que o Enganche e que um Meia (S)', () => {
  const ys = (role, duty) => byslot(E.computePhase(swap(['STC', 'advanced_forward', 'A']).concat([P('AMC', role, duty)])
    .filter((p) => p.slot !== 'MCR'), 'saindo', noCol, {}), 'AMC').y;
  assert.ok(ys('trequartista', 'A') < ys('enganche', 'S'), 'T x EG');
  assert.ok(ys('trequartista', 'A') < ys('attacking_midfielder', 'S'), 'T x AM(S)');
  const st = byslot(E.computePhase(swap(['STC', 'trequartista', 'A']), 'saindo', noCol, {}), 'STC').y;
  const af = byslot(E.computePhase(book, 'saindo', noCol, {}), 'STC').y;
  assert.ok(st < af - 10, `T no ataque recua: ${st} x AF ${af}`);
});

test('Segundo Atacante recua um pouco na saída; Pivô recua como o Atacante Recuado', () => {
  const am = (role, duty) => byslot(E.computePhase(book.filter((p) => p.slot !== 'MCR').concat([P('AMC', role, duty)]), 'saindo', noCol, {}), 'AMC').y;
  assert.ok(am('shadow_striker', 'A') < am('attacking_midfielder', 'S'));
  const st = (role, duty) => byslot(E.computePhase(swap(['STC', role, duty]), 'saindo', noCol, {}), 'STC').y;
  assert.ok(st('target_forward', 'S') <= st('deep_lying_forward', 'S'));
  assert.ok(st('target_forward', 'A') <= st('deep_lying_forward', 'A'));
});

test('Meia Aberto (S) fecha para o meio-espaço na saída', () => {
  const r = E.computePhase(book, 'saindo', noCol, {});
  assert.ok(byslot(r, 'ML').x > 15 && byslot(r, 'ML').x < byslot(r, 'MCL').x, `WM(S) x ${byslot(r, 'ML').x}`);
});

test('No ataque: Carrilero e IWB(S) acima de um Meia Central (S); RPM perto da entrada da área', () => {
  const r = E.computePhase(swap(['MCR', 'carrilero', 'S']), 'ataque', noCol, {});
  assert.ok(byslot(r, 'MCR').y > byslot(r, 'MCL').y, 'CAR x CM(S)');
  const dm = E.computePhase(swap(['DMC', 'roaming_playmaker', 'S']), 'ataque', noCol, {});
  assert.ok(byslot(dm, 'DMC').y >= 70, `RPM ${byslot(dm, 'DMC').y}`);
  const iwb = E.computePhase(swap(['DL', 'inverted_wing_back', 'S']), 'ataque', noCol, {});
  assert.ok(Math.abs(byslot(iwb, 'DL').y - byslot(iwb, 'MCL').y) <= 4, 'IWB(S) chega à altura do CM(S)');
});

test('Zagueiro com Bola conduz na saída (sobe mais que o Zagueiro Central)', () => {
  const r = E.computePhase(preset('4-2-3-1-dm-wide'), 'saindo', noCol, {});
  assert.ok(byslot(r, 'DCR').y - byslot(r, 'DCL').y >= 2.5);
});

test('pressão alta: 4-2-3-1 pressiona em 4-4-2 (meia central ao lado do centroavante)', () => {
  const r = E.computePhase(preset('4-2-3-1-dm-wide'), 'pressao', data, {});
  assert.equal(E.teamShape(r.players).shape, '4-4-2');
});

test('zona à frente da defesa: um volante protege; sem ninguém ali o critério zera', () => {
  const z = (pl) => E.evaluateBalance(pl, data, {}).parts.find((p) => p.key === 'zona').score;
  assert.ok(z(preset('4-1-4-1-dm-wide')) >= 0.8);
  // 3-4-3 com os dois meias centrais em Apoio: ninguém por dentro logo à frente da defesa
  const noScreen = preset('3-4-3').map((x) => (x.slot === 'MCL' ? { ...x, role: 'central_midfielder', duty: 'S' } : x));
  assert.equal(z(noScreen), 0, '3-4-3 sem ninguém por dentro logo à frente da defesa');
  // com o Médio Centro (D), que senta mais recuado (Book of Roles), a zona passa a ter proteção
  assert.ok(z(preset('3-4-3')) > 0);
});

test('atacante adequado: contra bloco baixo pontua o Pivô, contra Gegenpress pontua o Avançado', () => {
  const p = preset('4-2-3-1-dm-wide');
  const score = (pl, st) => E.evaluateBalance(pl, data, {}, E.opponentCache(data, oppOf('4-4-2', st), E.OPP_PHASES)).parts.find((q) => q.key === 'atacante').score;
  const tf = p.map((x) => (x.slot === 'STC' ? { ...x, role: 'target_forward', duty: 'S' } : x));
  assert.equal(score(p, 'pressao_alta'), 1);
  assert.equal(score(p, 'bloco_baixo'), 0);
  assert.equal(score(tf, 'bloco_baixo'), 1);
});

test('saída de bola: com linha alta os volantes sobem junto e ficam à frente dos zagueiros', () => {
  const P = [
    { slot: 'GK', role: 'sweeper_keeper', duty: 'S' }, { slot: 'DCL', role: 'ball_playing_defender', duty: 'D' }, { slot: 'DC', role: 'central_defender', duty: 'Co' }, { slot: 'DCR', role: 'ball_playing_defender', duty: 'D' },
    { slot: 'WBL', role: 'wing_back', duty: 'S' }, { slot: 'WBR', role: 'wing_back', duty: 'S' }, { slot: 'DMCL', role: 'segundo_volante', duty: 'S' }, { slot: 'DMCR', role: 'deep_lying_playmaker', duty: 'S' },
    { slot: 'AMCL', role: 'attacking_midfielder', duty: 'A' }, { slot: 'AMCR', role: 'advanced_playmaker', duty: 'S' }, { slot: 'STC', role: 'complete_forward', duty: 'S' }];
  for (const dl of [2, 3, 4]) {
    const r = E.computePhase(P, 'saindo', noCol, { defensiveLine: dl });
    const cb = Math.max(...['DCL', 'DC', 'DCR'].map((s) => byslot(r, s).y));
    for (const dm of ['DMCL', 'DMCR']) assert.ok(byslot(r, dm).y - cb >= 7, `linha ${dl}: ${dm} ${byslot(r, dm).y} vs zagueiros ${cb}`);
  }
});

test('pressão realista: quem pressiona não passa da última linha de quem tem a bola (nem marca o goleiro)', () => {
  for (const st of data.opponent.styles) {
    const m = E.computeMatch(preset('4-2-3-1-dm-wide'), data, { defensiveLine: 3 }, oppOf('4-3-3-dm-wide', st.id));
    for (const ph of E.PHASES) {
      const ours = m[ph].players.filter((p) => p.band !== 'GK'), theirs = m[ph].opponent.players.filter((p) => p.band !== 'GK');
      if (E.isWithBall(data.formations, ph)) {
        const lim = Math.min(...ours.map((p) => p.y)) - 3 - 1.5;
        for (const p of theirs) assert.ok(p.y >= lim, `${st.id}/${ph}: adversário ${p.slot} em ${p.y} < ${lim}`);
      } else {
        const lim = Math.max(...theirs.map((p) => p.y)) + 3 + 1.5;
        for (const p of ours) assert.ok(p.y <= lim, `${st.id}/${ph}: nosso ${p.slot} em ${p.y} > ${lim}`);
      }
      for (const p of ours.concat(theirs)) assert.ok(p.y >= 7.9 && p.y <= 92.1, `${st.id}/${ph}: ${p.slot} colado num gol (${p.y})`);
    }
  }
});

// ---------- notas de estrutura (Guide to Football) ----------

test('notas de estrutura: 3 com a bola e 3 sem a bola, entre 0 e 100', () => {
  const all = E.computeAll(preset('4-2-3-1-dm-wide'), data, {});
  for (const ph of E.PHASES) {
    const s = E.structureScores(all[ph].players, ph, data);
    assert.equal(s.scores.length, 3);
    assert.equal(s.withBall, E.isWithBall(data.formations, ph));
    for (const x of s.scores) assert.ok(x.value >= 0 && x.value <= 100, `${ph}/${x.key}`);
  }
});

test('notas fazem sentido: todos em Ataque penetram mais e são menos sólidos que todos em Defender', () => {
  const dutyAll = (duty) => preset('4-2-3-1-dm-wide').map((x) => (x.slot !== 'GK' && data.roles[x.role].duties[duty] ? { ...x, duty } : x));
  const sc = (pl, k) => E.structureScores(E.computePhase(pl, 'ataque', data, {}).players, 'ataque', data).scores.find((q) => q.key === k).value;
  assert.ok(sc(dutyAll('A'), 'penetracao') > sc(dutyAll('D'), 'penetracao'));
  assert.ok(sc(dutyAll('A'), 'solidez') < sc(dutyAll('D'), 'solidez'));
});

test('sem a bola: pressão alta pressiona mais; bloco baixo cobre mais', () => {
  const all = E.computeAll(preset('4-4-2'), data, {});
  const sc = (ph, k) => E.structureScores(all[ph].players, ph, data).scores.find((q) => q.key === k).value;
  assert.ok(sc('bloco_baixo', 'cobertura') > sc('pressao', 'cobertura'));
  assert.ok(sc('bloco_baixo', 'compactacao') >= sc('pressao', 'compactacao'));
});

test('laterais e alas não sobem com a linha defensiva (só zagueiros e volantes)', () => {
  const P = preset('3-5-2-wb').map((x) => (x.slot === 'WBR' ? { ...x, role: 'wing_back', duty: 'A' } : x));
  const std = E.computePhase(P, 'ataque', noCol, {}), high = E.computePhase(P, 'ataque', noCol, { defensiveLine: 3 });
  assert.equal(byslot(high, 'WBR').y, byslot(std, 'WBR').y);
  assert.equal(byslot(high, 'DC').y - byslot(std, 'DC').y, 5);
  const P4 = preset('4-4-2');
  assert.equal(byslot(E.computePhase(P4, 'ataque', noCol, { defensiveLine: 3 }), 'DL').y, byslot(E.computePhase(P4, 'ataque', noCol, {}), 'DL').y);
});

// ---------- Book of Roles: medidas tiradas das capturas 2D do livro (grade de 10% sobre o campo) ----------

test('Capturas: Segundo Volante (A) já sobe na progressão; Regista alto no ataque', () => {
  const xi = book.filter((p) => p.slot !== 'DMC').concat([P('DMCL', 'segundo_volante', 'A'), P('DMCR', 'regista', 'S')])
    .filter((p) => p.slot !== 'MCR');
  const prog = E.computePhase(xi, 'progressao', noCol, {});
  assert.ok(byslot(prog, 'DMCL').y >= 62, `SV(A) na progressão: ${byslot(prog, 'DMCL').y} (livro ~68)`);
  const atk = E.computePhase(xi, 'ataque', noCol, {});
  assert.ok(byslot(atk, 'DMCR').y >= 70, `Regista no ataque: ${byslot(atk, 'DMCR').y} (livro 76-78)`);
});

test('Capturas: Âncora e Volante (D) ficam ~10 acima dos zagueiros no ataque', () => {
  for (const role of ['anchor', 'defensive_midfielder']) {
    const r = E.computePhase(swap(['DMC', role, 'D']), 'ataque', noCol, {});
    const gap = byslot(r, 'DMC').y - byslot(r, 'DCL').y;
    assert.ok(gap >= 8 && gap <= 14, `${role}: ${gap}`);
  }
});

test('Capturas: Half Back sobe ao terço adversário com Alas em Apoio/Ataque', () => {
  const xi = swap(['DMC', 'half_back', 'D'], ['DL', 'wing_back', 'S']);
  const withWb = byslot(E.computePhase(xi, 'ataque', noCol, {}), 'DMC').y;
  const withFb = byslot(E.computePhase(swap(['DMC', 'half_back', 'D']), 'ataque', noCol, {}), 'DMC').y;
  assert.ok(withWb >= 60 && withWb > withFb + 10, `com Ala ${withWb}, com Lateral ${withFb}`);
});

test('Capturas: Meia Aberto (S) no ataque fica no meio-espaço; Lateral (S) segura na progressão', () => {
  const atk = E.computePhase(book, 'ataque', noCol, {});
  assert.ok(byslot(atk, 'ML').x >= 18 && byslot(atk, 'ML').y >= 70, `WM(S) ${byslot(atk, 'ML').x},${byslot(atk, 'ML').y}`);
  const prog = E.computePhase(book, 'progressao', noCol, {});
  assert.ok(byslot(prog, 'DL').y <= 40, `FB(S) na progressão: ${byslot(prog, 'DL').y} (livro 29-37)`);
});

// ---------- guia das funções (data/role-guide.json) ----------

test('guia das funções: cobre todas as funções e só referencia funções, tarefas e atributos que existem', () => {
  const guide = require('../data/role-guide.json');
  const roles = data.roles;
  assert.deepEqual(Object.keys(guide.roles).sort(), Object.keys(roles).sort());
  for (const [key, g] of Object.entries(guide.roles)) {
    if (g.notCovered) continue;
    assert.ok(g.summary && g.page, `${key}: resumo e página`);
    for (const d of Object.keys(g.duties)) assert.ok(roles[key].duties[d], `${key}: tarefa ${d}`);
    const lists = Array.isArray(g.attributes) ? [g.attributes] : Object.entries(g.attributes).map(([d, l]) => {
      assert.ok(roles[key].duties[d], `${key}: atributos da tarefa ${d}`);
      return l;
    });
    for (const l of lists) for (const a of l) assert.ok(guide.attributes[a], `${key}: atributo ${a}`);
    for (const c of g.combos || []) {
      assert.ok(roles[c.role], `${key}: combinação ${c.role}`);
      assert.notEqual(c.role, key, `${key}: combinação consigo mesmo`);
    }
  }
});

// ---------- overlap/underlap (instrução de equipe) ----------

test('Overlap: o lateral daquele lado sobe e vai por fora; underlap: sobe por dentro; o outro lado não muda', () => {
  const xi = swap(['DL', 'full_back', 'S'], ['DR', 'full_back', 'S']);
  const at = (ti, slot) => byslot(E.computePhase(xi, 'ataque', noCol, ti), slot);
  const base = at({}, 'DL'), ov = at({ runsLeft: 1 }, 'DL'), un = at({ runsRight: 2 }, 'DR');
  assert.ok(ov.y > base.y && ov.run === 'overlap' && ov.x <= 15, `overlap ${ov.x},${ov.y}`);
  assert.ok(un.y > at({}, 'DR').y && un.x <= 75 && un.run === 'underlap', `underlap ${un.x},${un.y}`);
  assert.equal(at({ runsLeft: 1 }, 'DR').y, at({}, 'DR').y);
  assert.ok(byslot(E.computePhase(xi, 'saindo', noCol, { runsLeft: 1 }), 'DL').y > byslot(E.computePhase(xi, 'saindo', noCol, {}), 'DL').y);
  // sem a bola, nada muda
  assert.equal(byslot(E.computePhase(xi, 'defendendo', noCol, { runsLeft: 1 }), 'DL').y, byslot(E.computePhase(xi, 'defendendo', noCol, {}), 'DL').y);
});

test('Overlap no Ala Invertido: desce por fora no ataque (captura da p. 27)', () => {
  const xi = swap(['DL', 'inverted_wing_back', 'S']);
  const iwb = byslot(E.computePhase(xi, 'ataque', noCol, { runsLeft: 1 }), 'DL');
  assert.ok(iwb.x <= 15 && iwb.y >= 60, `${iwb.x},${iwb.y}`);
});

// ---------- alertas de combinação (Book of Roles) ----------

const alertIds = (xi, ti, opp) => E.tacticalAlerts(xi, data, ti || {}, opp).map((a) => a.id);

test('Alertas: os atalhos de formação quase não disparam (só o 3-5-2, com ala em Ataque sem largura)', () => {
  for (const p of data.formations.presets) {
    const ids = alertIds(p.players);
    if (p.id === '3-5-2-wb') assert.deepEqual(ids, ['wb_attack_no_width']);
    else assert.deepEqual(ids, [], p.id);
  }
});

test('Alertas: Construtor Avançado com overlap do mesmo lado', () => {
  const xi = swap(['MCL', 'advanced_playmaker', 'S']);
  assert.ok(!alertIds(xi).includes('ap_overlap'));
  assert.ok(alertIds(xi, { runsLeft: 1 }).includes('ap_overlap'));
  assert.ok(!alertIds(xi, { runsRight: 1 }).includes('ap_overlap'));
});

test('Alertas: Mezzala + Extremo Invertido do mesmo lado; Mezzala (A) sem proteção', () => {
  const xi = swap(['MCL', 'mezzala', 'A'], ['ML', 'inverted_winger', 'S']);
  assert.ok(alertIds(xi).includes('mez_iw_same_side'));
  assert.ok(!alertIds(xi).includes('mezzala_no_cover'), 'o Volante (D) segura a posição');
  const noCover = swap(['MCL', 'mezzala', 'A'], ['DMC', 'segundo_volante', 'S']);
  assert.ok(alertIds(noCover).includes('mezzala_no_cover'));
});

test('Alertas: volante que deambula sem ninguém segurando a posição', () => {
  assert.ok(alertIds(swap(['DMC', 'roaming_playmaker', 'S'])).includes('roamer_unscreened'));
  const ok = swap(['DMC', 'roaming_playmaker', 'S'], ['MCL', 'central_midfielder', 'D']);
  assert.ok(!alertIds(ok).includes('roamer_unscreened'));
});

test('Alertas: Avançado sozinho sem ninguém aberto em Ataque', () => {
  assert.ok(alertIds(swap(['MR', 'wide_midfielder', 'S'])).includes('af_lone'));
  assert.ok(!alertIds(swap(['MR', 'winger', 'A'])).includes('af_lone'));
});

test('Alertas: Regista com Zagueiro Simples só com mentalidade alta; Trequartista com linha de pressão alta', () => {
  const xi = book.filter((p) => p.slot !== 'DMC').concat([P('DMCL', 'regista', 'S'), P('DMCR', 'anchor', 'D')])
    .map((p) => (p.slot === 'DCL' ? P('DCL', 'no_nonsense_cb', 'D') : p)).filter((p) => p.slot !== 'MCR');
  assert.ok(!alertIds(xi, { mentality: 3 }).includes('regista_bypassed'));
  assert.ok(alertIds(xi, { mentality: 5 }).includes('regista_bypassed'));
  const tq = book.filter((p) => p.slot !== 'MCR').concat([P('AMC', 'trequartista', 'A')]);
  assert.ok(!alertIds(tq).includes('treq_press'));
  assert.ok(alertIds(tq, { lineOfEngagement: 2 }).includes('treq_press'));
});

test('Alertas: Segundo Atacante contra dois volantes (só com adversário)', () => {
  const xi = book.filter((p) => p.slot !== 'MCR').concat([P('AMC', 'shadow_striker', 'A')]);
  const twoDm = data.formations.presets.find((p) => p.id === '4-2-3-1-dm-wide').players;
  assert.ok(!alertIds(xi).includes('ss_vs_two_dm'));
  assert.ok(alertIds(xi, {}, twoDm).includes('ss_vs_two_dm'));
  assert.ok(!alertIds(xi, {}, preset('4-4-2')).includes('ss_vs_two_dm'));
});

test('Alertas entram no índice de equilíbrio e a sugestão evita combinações arriscadas', () => {
  const risky = swap(['DMC', 'roaming_playmaker', 'S'], ['MR', 'wide_midfielder', 'S']);
  const part = (xi) => E.evaluateBalance(xi, data, {}).parts.find((p) => p.key === 'combinacoes');
  const clean = swap(['MR', 'winger', 'A']);
  assert.deepEqual(alertIds(clean), []);
  assert.ok(part(risky).score < 1 && part(clean).score === 1);
  const sug = E.suggestRoles(risky, data, {}, { maxChanges: 6 });
  assert.ok(alertIds(sug.players).length < alertIds(risky).length);
});

test('alerts.json: toda regra detectada tem texto e aponta para uma função existente', () => {
  for (const [id, r] of Object.entries(data.alerts.rules)) {
    assert.ok(r.text.includes('{slots}') && r.page, id);
    assert.ok(data.roles[r.role], `${id}: ${r.role}`);
  }
});

// ---------- bola de um lado ----------

test('Bola no centro (ou sem lado) não muda nada', () => {
  const pr = preset('4-2-3-1-dm-wide');
  for (const ph of E.PHASES) {
    const a = E.computePhase(pr, ph, data, {}), b = E.computePhase(pr, ph, data, { ballSide: 'C' });
    assert.deepEqual(b.players.map((p) => [p.x, p.y]), a.players.map((p) => [p.x, p.y]), ph);
    assert.deepEqual(b.ball, a.ball, ph);
  }
});

test('Bola na esquerda: o time desliza para ela, mais sem a bola; o lado oposto fecha sem a bola', () => {
  const pr = preset('4-4-2');
  const meanX = (r) => r.players.filter((p) => p.band !== 'GK').reduce((t, p) => t + p.x, 0) / 10;
  const shift = (ph) => meanX(E.computePhase(pr, ph, noCol, { ballSide: 'L' })) - meanX(E.computePhase(pr, ph, noCol, {}));
  assert.ok(shift('defendendo') < -8, `sem a bola: ${shift('defendendo')}`);
  assert.ok(shift('ataque') < -2 && shift('ataque') > shift('defendendo'), `com a bola: ${shift('ataque')}`);
  // lado oposto: o lateral direito fecha mais do que o time desliza
  const dr = (ti) => byslot(E.computePhase(pr, 'defendendo', noCol, ti), 'DR').x;
  assert.ok(dr({}) - dr({ ballSide: 'L' }) > -shift('defendendo') + 3, 'lateral do lado oposto fecha');
  // a bola desenhada vai junto
  assert.ok(E.computePhase(pr, 'defendendo', noCol, { ballSide: 'L' }).ball.x < 30);
  assert.ok(E.computePhase(pr, 'pressao', noCol, { ballSide: 'L' }).ball.x < 30, 'fase derivada também');
});

test('Bola na direita é o espelho da esquerda numa formação simétrica', () => {
  const pr = preset('4-4-2').map((p) => ({ ...p, role: p.slot === 'MR' ? 'wide_midfielder' : p.role, duty: p.slot === 'MR' ? 'S' : p.duty }))
    .map((p) => (p.slot === 'STCL' ? { ...p, role: 'advanced_forward', duty: 'A' } : p))
    .map((p) => (p.slot === 'MCL' ? { ...p, role: 'central_midfielder', duty: 'S' } : p))
    .map((p) => (p.slot === 'MCR' ? { ...p, role: 'central_midfielder', duty: 'S' } : p));
  const L = E.computePhase(pr, 'defendendo', noCol, { ballSide: 'L' }), R = E.computePhase(pr, 'defendendo', noCol, { ballSide: 'R' });
  const mirror = { DL: 'DR', DR: 'DL', DCL: 'DCR', DCR: 'DCL', ML: 'MR', MR: 'ML', MCL: 'MCR', MCR: 'MCL', STCL: 'STCR', STCR: 'STCL', GK: 'GK' };
  for (const p of L.players) {
    const q = byslot(R, mirror[p.slot]);
    assert.ok(Math.abs(p.x - (100 - q.x)) < 0.2 && Math.abs(p.y - q.y) < 0.2, `${p.slot}: ${p.x} x ${100 - q.x}`);
  }
});

test('Bola de um lado: o adversário desliza para o mesmo lado do campo', () => {
  const pr = preset('4-2-3-1-dm-wide');
  const opp = { enabled: true, styleId: data.opponent.styles[0].id, players: preset('4-4-2') };
  const mean = (ti) => {
    const m = E.computeMatch(pr, data, ti, opp).defendendo.opponent.players;
    return m.reduce((t, p) => t + p.x, 0) / m.length;
  };
  assert.ok(mean({ ballSide: 'L' }) < mean({}) - 2);
  assert.ok(mean({ ballSide: 'R' }) > mean({}) + 2);
});

test('guia: tipos de atacante só citam atacantes e tarefas que existem; glossário cobre atributos usados', () => {
  const guide = require('../data/role-guide.json');
  const ft = guide.forwardTypes;
  assert.deepEqual(ft.types.map((t) => t.key), ['creative', 'support', 'pure']);
  for (const t of ft.types) {
    assert.ok(t.label && t.desc && t.roles.length, t.key);
    for (const r of t.roles) {
      const role = data.roles[r.role];
      assert.ok(role && role.slots.some((s) => s.startsWith('ST')), `${t.key}: ${r.role} é atacante`);
      if (r.duty) assert.ok(role.duties[r.duty], `${t.key}: ${r.role}-${r.duty}`);
      assert.ok(r.note, `${t.key}: ${r.role} tem nota`);
    }
  }
  const withDesc = Object.entries(guide.attributes).filter(([, a]) => a.desc).map(([k]) => k);
  assert.ok(withDesc.length >= 20, `${withDesc.length} atributos com explicação`);
  for (const k of ['first_touch', 'decisions', 'off_the_ball', 'positioning', 'teamwork', 'concentration']) assert.ok(guide.attributes[k].desc, k);
  assert.ok(/9 é a média/.test(guide.attributesNote));
});

// ---------- fases sem a bola: bloco que se move junto ----------

const shapeOf = (pl, ph, ti) => E.teamShape(E.computePhase(pl, ph, data, ti || {}).players);

test('Sem a bola: compactação em todos os atalhos (pressão até ~42 m, bloco médio até ~42 m, bloco baixo até ~32 m)', () => {
  for (const p of data.formations.presets) {
    const pr = shapeOf(p.players, 'pressao'), md = shapeOf(p.players, 'defendendo'), lo = shapeOf(p.players, 'bloco_baixo');
    assert.ok(pr.metrics.length <= 44, `${p.id} pressão ${pr.metrics.length} m`);
    assert.ok(md.metrics.length <= 42, `${p.id} bloco médio ${md.metrics.length} m`);
    assert.ok(lo.metrics.length <= 32, `${p.id} bloco baixo ${lo.metrics.length} m`);
    assert.ok(pr.metrics.length <= md.metrics.length + 10, `${p.id}: a pressão não pode esticar o bloco`);
    assert.ok(pr.metrics.lastLine > md.metrics.lastLine + 10 && md.metrics.lastLine > lo.metrics.lastLine + 10, `${p.id}: linhas sobem e descem com a fase`);
  }
});

test('Sem a bola: o bloco sobe junto na pressão (defesa e meio sobem quase o mesmo)', () => {
  const p = preset('4-4-2');
  const md = E.computePhase(p, 'defendendo', noCol, {}), pr = E.computePhase(p, 'pressao', noCol, {});
  const up = (slot) => byslot(pr, slot).y - byslot(md, slot).y;
  assert.ok(Math.abs(up('DCL') - up('ML')) <= 3 && up('DCL') >= 15, `defesa ${up('DCL')}, meio ${up('ML')}`);
});

test('Sem a bola: volantes ficam à frente da zaga; alas de linha de 3 fecham a linha de 5', () => {
  for (const p of data.formations.presets) {
    for (const ph of ['pressao', 'defendendo', 'bloco_baixo']) {
      const r = E.computePhase(p.players, ph, noCol, {});
      const line = Math.min(...r.players.filter((q) => q.band === 'D').map((q) => q.y));
      for (const q of r.players) {
        if (q.band === 'GK' || q.band === 'D' || (q.band === 'DM' && (q.lane === 'L' || q.lane === 'R'))) continue;
        assert.ok(q.y >= line + 5.9, `${p.id}/${ph}: ${q.slot} a ${q.y - line} da zaga`);
      }
    }
  }
  assert.ok(shapeOf(preset('3-5-2-wb'), 'defendendo').shape.startsWith('5-'));
  assert.ok(shapeOf(preset('3-5-2-wb'), 'bloco_baixo').shape.startsWith('5-'));
});

test('Goleiro Líbero: adiantado no bloco médio e na pressão, no gol no bloco baixo', () => {
  const sk = preset('4-2-3-1-dm-wide'), gk = sk.map((p) => (p.slot === 'GK' ? P('GK', 'goalkeeper', 'D') : p));
  const y = (pl, ph) => byslot(E.computePhase(pl, ph, noCol, {}), 'GK').y;
  assert.ok(y(sk, 'defendendo') > y(gk, 'defendendo') && y(sk, 'pressao') > y(gk, 'pressao'));
  assert.ok(y(sk, 'bloco_baixo') <= y(gk, 'bloco_baixo') + 1);
  assert.ok(y(gk, 'pressao') <= 15, 'goleiro comum não sai da área');
});

// ---------- revisão geral: invariantes e correções ----------

test('Invariante: em todas as funções, Ataque ≥ Apoio ≥ Defender com a bola e o contrário sem a bola', () => {
  const PH_COM = ['saindo', 'progressao', 'ataque'], PH_SEM = ['pressao', 'defendendo', 'bloco_baixo'];
  let n = 0;
  for (const [rk, r] of Object.entries(data.roles)) {
    for (const slot of r.slots) {
      const base = data.formations.presets.find((p) => p.players.some((q) => q.slot === slot));
      if (!base) continue;
      const order = ['D', 'S', 'A'].filter((x) => r.duties[x]);
      const ys = {};
      for (const duty of order) {
        const xi = base.players.map((q) => (q.slot === slot ? P(slot, rk, duty) : q));
        if (!E.validate(xi, data).ok) continue;
        ys[duty] = {};
        for (const ph of PH_COM.concat(PH_SEM)) ys[duty][ph] = byslot(E.computePhase(xi, ph, noCol, {}), slot).y;
      }
      for (let i = 1; i < order.length; i++) {
        const lo = ys[order[i - 1]], hi = ys[order[i]];
        if (!lo || !hi) continue;
        for (const ph of PH_COM.concat(PH_SEM)) { n++; assert.ok(hi[ph] >= lo[ph] - 0.5, `${rk} ${slot} ${ph}: ${order[i - 1]} ${lo[ph]} > ${order[i]} ${hi[ph]}`); }
      }
    }
  }
  assert.ok(n > 200, `${n} comparações`);
});

test('Invariante: toda função no lado esquerdo é o espelho do lado direito', () => {
  const base = [P('GK', 'goalkeeper', 'D'), P('DL', 'full_back', 'S'), P('DCL', 'central_defender', 'D'), P('DCR', 'central_defender', 'D'), P('DR', 'full_back', 'S'),
    P('DMCL', 'defensive_midfielder', 'S'), P('DMCR', 'defensive_midfielder', 'S'), P('AML', 'winger', 'S'), P('AMC', 'attacking_midfielder', 'S'), P('AMR', 'winger', 'S'), P('STC', 'pressing_forward', 'S')];
  const mirror = { DL: 'DR', DCL: 'DCR', DMCL: 'DMCR', AML: 'AMR' };
  for (const [sl, sr] of Object.entries(mirror)) {
    for (const [rk, r] of Object.entries(data.roles)) {
      if (!r.slots.includes(sl)) continue;
      for (const duty of Object.keys(r.duties)) {
        const L = base.map((p) => (p.slot === sl ? P(sl, rk, duty) : p)), R = base.map((p) => (p.slot === sr ? P(sr, rk, duty) : p));
        if (!E.validate(L, data).ok) continue;
        for (const ph of E.PHASES) {
          const a = byslot(E.computePhase(L, ph, noCol, {}), sl), b = byslot(E.computePhase(R, ph, noCol, {}), sr);
          assert.ok(Math.abs(a.x - (100 - b.x)) < 0.6 && Math.abs(a.y - b.y) < 0.6, `${rk}-${duty} ${sl}/${sr} ${ph}`);
        }
      }
    }
  }
});

test('Revisão: correções da revisão geral', () => {
  const b4231 = preset('4-2-3-1-dm-wide'), b433 = preset('4-3-3-dm-wide');
  const sw = (base, ...ch) => base.map((p) => { const c = ch.find((x) => x[0] === p.slot); return c ? P(c[0], c[1], c[2]) : p; });
  const at = (xi, ph, slot) => byslot(E.computePhase(xi, ph, noCol, {}), slot);
  // Segundo Volante: (S) perto da bola na progressão; (A) bem acima
  const sv = (duty) => at(sw(b4231, ['DMCL', 'segundo_volante', duty]), 'progressao', 'DMCL').y;
  assert.ok(sv('S') <= 52 && sv('A') >= 60, `SV(S) ${sv('S')}, SV(A) ${sv('A')}`);
  // Segundo Atacante na altura da bola na progressão
  assert.ok(Math.abs(at(sw(b4231, ['AMC', 'shadow_striker', 'A']), 'progressao', 'AMC').y - 50) <= 8);
  // Ala Invertido (D) fecha para dentro e segura a posição abaixo do (S)
  const iwbD = sw(b433, ['DL', 'inverted_wing_back', 'D']), iwbS = sw(b433, ['DL', 'inverted_wing_back', 'S']);
  assert.ok(at(iwbD, 'saindo', 'DL').x >= 30 && at(iwbD, 'ataque', 'DL').x >= 30);
  assert.ok(at(iwbD, 'ataque', 'DL').y < at(iwbS, 'ataque', 'DL').y);
  // Construtor Avançado aberto fecha; (S) no bolsão como o Meia Ofensivo (S)
  assert.ok(at(sw(b4231, ['AML', 'advanced_playmaker', 'S']), 'ataque', 'AML').x >= 25);
  assert.ok(Math.abs(at(sw(b4231, ['AMC', 'advanced_playmaker', 'S']), 'ataque', 'AMC').y - at(sw(b4231, ['AMC', 'attacking_midfielder', 'S']), 'ataque', 'AMC').y) <= 2);
  // Avançado é o mais avançado
  assert.ok(at(sw(b4231, ['STC', 'poacher', 'A']), 'ataque', 'STC').y < at(b4231, 'ataque', 'STC').y);
  // Laterais no ataque: (D) acima dos zagueiros e abaixo do (S); Simples e Invertido na linha dos zagueiros
  const cb = at(b4231, 'ataque', 'DCL').y;
  const fbD = at(sw(b4231, ['DL', 'full_back', 'D']), 'ataque', 'DL').y, fbS = at(sw(b4231, ['DL', 'full_back', 'S']), 'ataque', 'DL').y;
  assert.ok(fbD >= cb + 5 && fbD < fbS, `FB(D) ${fbD}`);
  assert.ok(at(sw(b4231, ['DL', 'no_nonsense_fb', 'D']), 'ataque', 'DL').y >= cb - 1);
  // Carrilero entre o Médio Centro (S) e a Mezzala (S); Mezzala (S) abaixo da (A)
  const m = (role, duty) => at(sw(preset('4-3-3-dm-wide'), ['MCR', role, duty]), 'ataque', 'MCR').y;
  assert.ok(m('central_midfielder', 'S') < m('carrilero', 'S') && m('carrilero', 'S') < m('mezzala', 'S') && m('mezzala', 'S') < m('mezzala', 'A'));
  // Ala (D) < (S) < (A); Ala Completo (S) acima do Ala (S)
  const wb = (role, duty) => at(sw(b4231, ['DL', role, duty]), 'ataque', 'DL').y;
  assert.ok(wb('wing_back', 'D') < wb('wing_back', 'S') && wb('wing_back', 'S') < wb('wing_back', 'A') && wb('complete_wing_back', 'S') > wb('wing_back', 'S'));
  // Recuperador (D) não fica abaixo do Âncora na faixa de volante
  assert.ok(at(sw(b4231, ['DMCL', 'ball_winning_midfielder', 'D']), 'ataque', 'DMCL').y >= at(sw(b4231, ['DMCL', 'anchor', 'D']), 'ataque', 'DMCL').y);
  // Falso 9 recua mais que o Atacante Recuado (S)
  assert.ok(at(sw(b4231, ['STC', 'false_nine', 'S']), 'saindo', 'STC').y < at(sw(b4231, ['STC', 'deep_lying_forward', 'S']), 'saindo', 'STC').y);
  // Extremo Defensivo (D) entre a defesa e o meio sem a bola; Médio Centro (D) abaixo do (S)
  const dw = at(sw(preset('4-4-2'), ['ML', 'defensive_winger', 'D']), 'defendendo', 'ML').y;
  assert.ok(dw > at(preset('4-4-2'), 'defendendo', 'DL').y + 5 && dw < at(preset('4-4-2'), 'defendendo', 'MR').y);
  const cmD = at(sw(preset('4-4-2'), ['MCL', 'central_midfielder', 'D']), 'defendendo', 'MCL').y, cmS = at(sw(preset('4-4-2'), ['MCL', 'central_midfielder', 'S']), 'defendendo', 'MCL').y;
  assert.ok(cmD < cmS);
});

// ---------- FM23 (página oficial da SI) e calibração com dados do jogo ----------

test('FM23: Mezzala, Construtor Avançado e Médio Centro (A) mais altos nos meios-espaços na saída com volante atrás', () => {
  const sw = (base, role, duty) => base.map((p) => (p.slot === 'MCL' ? P('MCL', role, duty) : p));
  for (const [role, duty] of [['mezzala', 'S'], ['mezzala', 'A'], ['advanced_playmaker', 'S'], ['advanced_playmaker', 'A'], ['central_midfielder', 'A']]) {
    const withDm = byslot(E.computePhase(sw(preset('4-3-3-dm-wide'), role, duty), 'saindo', noCol, {}), 'MCL');
    const noDm = byslot(E.computePhase(sw(preset('4-4-2'), role, duty), 'saindo', noCol, {}), 'MCL');
    assert.ok(withDm.y >= noDm.y + 4 && withDm.x <= 32, `${role}-${duty}: ${withDm.x},${withDm.y} x ${noDm.x},${noDm.y}`);
  }
  // o Médio Centro (S) não é citado pela SI e não muda
  const cmS = (base) => byslot(E.computePhase(sw(base, 'central_midfielder', 'S'), 'saindo', noCol, {}), 'MCL').y;
  assert.equal(cmS(preset('4-3-3-dm-wide')), cmS(preset('4-4-2')));
});

test('FM23: instrução de cruzamentos no bloco baixo (impedir abre os laterais; defender fecha a linha)', () => {
  const x = (ti, slot) => byslot(E.computePhase(preset('4-4-2'), 'bloco_baixo', noCol, ti), slot).x;
  assert.ok(x({ crosses: 1 }, 'DL') < x({}, 'DL') && x({ crosses: 1 }, 'DCL') === x({}, 'DCL'));
  assert.ok(x({ crosses: 2 }, 'DL') > x({}, 'DL') && x({ crosses: 2 }, 'DCL') > x({}, 'DCL'));
  // não muda o bloco médio
  assert.equal(byslot(E.computePhase(preset('4-4-2'), 'defendendo', noCol, { crosses: 1 }), 'DL').x, byslot(E.computePhase(preset('4-4-2'), 'defendendo', noCol, {}), 'DL').x);
  // linha de pressão e armadilha com os nomes do FM23
  assert.deepEqual(data.instructions.lineOfEngagement.options.map((o) => o.en), ['Low Block', 'Mid Block', 'High Press']);
  assert.deepEqual(data.instructions.defensiveWidth.options.map((o) => o.en), ['Trap Outside', 'None', 'Trap Inside']);
});

test('measurements.json: formato válido e comparador roda', () => {
  const M = require('../data/measurements.json');
  const PH = ['pressao', 'defendendo', 'bloco_baixo', 'saindo', 'progressao', 'ataque'];
  for (const [id, t] of Object.entries(M.tactics)) assert.ok(E.validate(t.players, data).ok, id);
  for (const m of M.measurements) {
    assert.ok(M.tactics[m.tactic], `tática ${m.tactic}`);
    assert.ok(PH.includes(m.phase) && data.formations.slots[m.slot] && typeof m.x === 'number' && typeof m.y === 'number', JSON.stringify(m));
  }
  const rows = require('../tools/compare.js').compare();
  assert.ok(rows.every((r) => !r.error), JSON.stringify(rows.filter((r) => r.error)));
});

test('Alertas: Ala Completo (A) sem largura à frente e sem ajuda em Apoio/Defender do mesmo lado', () => {
  const P = (slot, role, duty) => ({ slot, role, duty });
  // 3-4-1-2 do usuário: CWB (A) à direita, DLP (S) do mesmo lado
  const xi = [P('GK', 'sweeper_keeper', 'S'), P('DCL', 'ball_playing_defender', 'D'), P('DC', 'central_defender', 'Co'), P('DCR', 'ball_playing_defender', 'D'),
    P('WBL', 'wing_back', 'S'), P('WBR', 'complete_wing_back', 'A'), P('DMCL', 'segundo_volante', 'S'), P('DMCR', 'deep_lying_playmaker', 'S'),
    P('AMCL', 'attacking_midfielder', 'S'), P('AMCR', 'advanced_playmaker', 'A'), P('STC', 'complete_forward', 'A')];
  const ids = alertIds(xi);
  assert.ok(ids.includes('wb_attack_no_width'), 'única largura do lado direito');
  assert.ok(!ids.includes('cwb_attack_no_support'), 'o DLP (S) do mesmo lado conta como ajuda');
  const noHelp = xi.map((p) => (p.slot === 'DMCR' ? P('DMCR', 'segundo_volante', 'A') : p));
  assert.ok(alertIds(noHelp).includes('cwb_attack_no_support'));
});

test('Impedimento comprime em vez de achatar: o mais avançado fica na linha e a ordem se mantém', () => {
  const P = (slot, role, duty) => ({ slot, role, duty });
  const xi = [P('GK', 'sweeper_keeper', 'S'), P('DCL', 'ball_playing_defender', 'D'), P('DC', 'central_defender', 'Co'), P('DCR', 'ball_playing_defender', 'D'),
    P('WBL', 'wing_back', 'S'), P('WBR', 'wing_back', 'S'), P('DMCL', 'segundo_volante', 'S'), P('DMCR', 'deep_lying_playmaker', 'S'),
    P('AMCL', 'attacking_midfielder', 'S'), P('AMCR', 'advanced_playmaker', 'S'), P('STC', 'complete_forward', 'S')];
  const opp = { enabled: true, styleId: 'pressao_alta', players: E.styleRoles(preset('4-3-3-dm-wide'), data, 'pressao_alta') };
  const free = E.computeMatch(xi, data, {}, null).saindo, held = E.computeMatch(xi, data, {}, opp).saindo;
  const y = (r, s) => byslot(r, s).y;
  assert.equal(y(held, 'STC'), 50, 'o mais avançado fica na linha (meio-campo: a defesa dele está no nosso campo)');
  // mesma ordem de antes, sem empate
  const order = (r) => ['AMCR', 'AMCL', 'STC'].map((s) => y(r, s));
  const [a, b, c] = order(held);
  assert.ok(a < b && b < c, `AP ${a} < AM ${b} < CF ${c}`);
  assert.deepEqual(['AMCR', 'AMCL', 'STC'].sort((s, t) => y(free, s) - y(free, t)), ['AMCR', 'AMCL', 'STC']);
  // ninguém passa da linha, e quem estava bem atrás não muda
  assert.ok(held.players.every((p) => p.band === 'GK' || p.y <= 50.01));
  assert.equal(y(held, 'DCL'), y(free, 'DCL'));
});
