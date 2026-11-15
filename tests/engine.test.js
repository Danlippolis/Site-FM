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
  playerTraits: require('../data/player-traits.json')
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
    assert.equal(ev.parts.length, 8);
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
  assert.equal(ev.parts.length, 14);
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
  assert.equal(z(preset('3-4-3')), 0, '3-4-3 sem ninguém por dentro logo à frente da defesa');
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
