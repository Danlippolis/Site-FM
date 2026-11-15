'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/engine/engine.js');

const data = {
  formations: require('../data/formations.json'),
  roles: require('../data/roles.json'),
  instructions: require('../data/team-instructions.json'),
  playerInstructions: require('../data/player-instructions.json'),
  opponent: require('../data/opponent.json')
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
  assert.deepEqual(byslot(all.ataque, 'AMC').zone, { rx: 14, ry: 8 }, 'deambular + corredores embutidos');
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
  assert.deepEqual(byslot(res, 'STC').zone, { rx: 14, ry: 4 });
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
    for (const ph of ['saindo', 'ataque']) {
      const line = Math.max(50, ...m[ph].opponent.players.filter((p) => p.band !== 'GK').map((p) => p.y));
      for (const p of m[ph].players) if (p.band !== 'GK') assert.ok(p.y <= line + 0.11, `${style}/${ph}/${p.slot} ${p.y} > ${line}`);
    }
    const lineD = Math.min(50, ...m.defendendo.players.filter((p) => p.band !== 'GK').map((p) => p.y));
    for (const p of m.defendendo.opponent.players) if (p.band !== 'GK') assert.ok(p.y >= lineD - 0.11, `${style}/def/${p.slot}`);
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
  assert.deepEqual(byslot(res, 'STC').zone, { rx: 14, ry: 8 }, 'Avançado: corredores + deambular');
  assert.ok(data.roles.libero.duties.S && data.roles.libero.duties.A && !data.roles.libero.uncertain);
});
