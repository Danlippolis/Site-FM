/*
 * FM23 Positioning Viewer — motor de posicionamento (funções puras).
 * Modelo heurístico baseado em regras; NÃO é uma simulação do motor do FM.
 *
 * Coordenadas normalizadas 0–100: x 0 = lateral esquerda, y 0 = próprio gol.
 * Funciona como script clássico no navegador (window.FMEngine) e como módulo CommonJS no Node.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FMEngine = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // sem a bola (pressão alta, bloco médio, bloco baixo) e com a bola (saída, progressão, ataque)
  var PHASES = ['pressao', 'defendendo', 'bloco_baixo', 'saindo', 'progressao', 'ataque'];
  var BAND_ORDER = ['GK', 'D', 'DM', 'M', 'AM', 'ST'];
  var LANE_ORDER = ['L', 'CL', 'C', 'CR', 'R'];
  var CENTRAL_LANES = ['CL', 'C', 'CR'];
  var DUTIES = {
    D: { label: 'Defender', en: 'Defend' },
    S: { label: 'Apoio', en: 'Support' },
    A: { label: 'Ataque', en: 'Attack' },
    Au: { label: 'Automático', en: 'Automatic' },
    St: { label: 'Stopper', en: 'Stopper' },
    Co: { label: 'Cobertura', en: 'Cover' }
  };

  // ---------- slots ----------

  function slotInfo(formations, slot) {
    var s = formations.slots[slot];
    if (!s) throw new Error('Slot desconhecido: ' + slot);
    var x;
    if (s.band === 'GK') x = 50;
    else if (s.band === 'ST') x = formations.stLaneX[s.lane];
    else x = formations.laneX[s.lane];
    var side = s.lane === 'L' || s.lane === 'CL' ? 'L' : s.lane === 'C' ? 'C' : 'R';
    return { slot: slot, band: s.band, lane: s.lane, x: x, y: formations.bandY[s.band], side: side };
  }

  function slotOrder(formations, slot) {
    var s = formations.slots[slot];
    return BAND_ORDER.indexOf(s.band) * 10 + LANE_ORDER.indexOf(s.lane);
  }

  /** Numeração 1..11: GK primeiro, depois por faixa (trás → frente) e corredor (esq → dir). */
  function numberPlayers(players, formations) {
    var sorted = players
      .map(function (p, i) { return { i: i, o: slotOrder(formations, p.slot) }; })
      .sort(function (a, b) { return a.o - b.o; });
    var nums = new Array(players.length);
    sorted.forEach(function (s, k) { nums[s.i] = k + 1; });
    return nums;
  }

  function rolesForSlot(roles, slot) {
    return Object.keys(roles).filter(function (k) {
      return (roles[k].slots || []).indexOf(slot) >= 0;
    });
  }

  function isCentreBack(formations, slot) {
    var s = formations.slots[slot];
    return s && s.band === 'D' && CENTRAL_LANES.indexOf(s.lane) >= 0;
  }

  // ---------- validação ----------

  function validate(players, data) {
    var formations = data.formations, roles = data.roles;
    var errors = [], warnings = [];
    if (!Array.isArray(players)) return { ok: false, errors: ['Lista de jogadores inválida.'], warnings: [] };
    if (players.length !== 11) errors.push('A tática precisa de exatamente 11 jogadores (tem ' + players.length + ').');

    var seen = {}, gk = 0, centralByBand = {}, cbCount = 0;
    players.forEach(function (p) {
      if (!p || !formations.slots[p.slot]) { errors.push('Slot desconhecido: ' + (p && p.slot)); return; }
      if (seen[p.slot]) errors.push('Slot repetido: ' + p.slot);
      seen[p.slot] = true;
      var s = formations.slots[p.slot];
      if (s.band === 'GK') gk++;
      if (CENTRAL_LANES.indexOf(s.lane) >= 0 && s.band !== 'GK') {
        centralByBand[s.band] = (centralByBand[s.band] || 0) + 1;
      }
      if (isCentreBack(formations, p.slot)) cbCount++;

      var role = roles[p.role];
      if (!role) { errors.push(p.slot + ': função desconhecida "' + p.role + '".'); return; }
      if ((role.slots || []).indexOf(p.slot) < 0) errors.push(p.slot + ': ' + role.label + ' não é válida neste slot.');
      if (!role.duties || !role.duties[p.duty]) errors.push(p.slot + ': tarefa "' + p.duty + '" inválida para ' + role.label + '.');
    });
    if (gk !== 1) errors.push('A tática precisa de exatamente 1 goleiro (tem ' + gk + ').');
    Object.keys(centralByBand).forEach(function (b) {
      if (centralByBand[b] > 3) errors.push('No máximo 3 jogadores centrais na faixa ' + b + '.');
    });
    players.forEach(function (p) {
      var role = roles[p.role];
      if (role && role.requiresBack3 && cbCount !== 3) {
        warnings.push(p.slot + ': ' + role.label + ' só faz sentido numa linha de 3 zagueiros.');
      }
      if (!formations.slots[p.slot]) return;
      var pis = (data.playerInstructions || {}).instructions || {};
      var info = slotInfo(formations, p.slot);
      if (p.traits && p.traits.length) {
        var tdefs = (data.playerTraits || {}).traits || {};
        var applied = resolvePlayerInstructions(p, info, pis, roles).applied;
        var t = resolveTraits(p, info, tdefs, applied.concat(lockedFor(roles, p)));
        t.unknown.forEach(function (k) { warnings.push(p.slot + ': característica desconhecida "' + k + '".'); });
        t.ignored.forEach(function (i) { warnings.push(p.slot + ': "' + tdefs[i.key].label + '" sem efeito — ' + i.reason + '.'); });
      }
      if (!p.instructions || !p.instructions.length) return;
      var r = resolvePlayerInstructions(p, info, pis, roles);
      r.unknown.forEach(function (k) { warnings.push(p.slot + ': instrução individual desconhecida "' + k + '".'); });
      r.ignored.forEach(function (i) { warnings.push(p.slot + ': "' + pis[i.key].label + '" ignorada — ' + i.reason + '.'); });
    });
    return { ok: errors.length === 0, errors: errors, warnings: warnings };
  }

  // ---------- instruções de equipe ----------

  function pick(def, idx) {
    if (idx == null || !def.options[idx]) idx = def.default;
    return def.options[idx];
  }

  function resolveInstructions(instructions, ti) {
    ti = ti || {};
    var flags = {};
    Object.keys(instructions.flags || {}).forEach(function (k) {
      flags[k] = ti.flags && k in ti.flags ? !!ti.flags[k] : !!instructions.flags[k].default;
    });
    return {
      mentalityDy: pick(instructions.mentality, ti.mentality).dy,
      defLineY: pick(instructions.defensiveLine, ti.defensiveLine).y,
      loeDy: pick(instructions.lineOfEngagement, ti.lineOfEngagement).dy,
      widthFactor: pick(instructions.widthInPossession, ti.widthInPossession).factor,
      defWidthFactor: instructions.defensiveWidth ? pick(instructions.defensiveWidth, ti.defensiveWidth).factor : null,
      mentalityIdx: instructions.mentality.options[ti.mentality] ? ti.mentality : instructions.mentality.default,
      flags: flags
    };
  }

  // ---------- regras de função ----------

  /**
   * Tarefa efetiva para buscar regras: "Automático" segue a mentalidade
   * (engine.autoDutyByMentality), a menos que a própria tarefa Au tenha regra para a fase.
   */
  function effectiveDuty(roles, p, phase, ti, eng) {
    var role = roles[p.role];
    if (!role || p.duty !== 'Au') return p.duty;
    var own = role.duties.Au && role.duties.Au[phase];
    var map = eng && eng.autoDutyByMentality;
    if ((own && Object.keys(own).length) || !map) return 'Au';
    var d = map[ti.mentalityIdx];
    return role.duties[d] ? d : 'Au';
  }

  /**
   * Função que precisa de um slot livre ao lado para ter o comportamento próprio (ex.: no FM23 o
   * Ala Invertido só fecha para dentro com o slot de volante do seu lado livre). Sem ele, usa as
   * regras de fallbackRole na mesma tarefa. Devolve a chave da função cujas regras valem.
   */
  function ruleRole(roles, p, occupied) {
    var role = roles[p.role], need = role && role.needsFreeSlot;
    if (!need || !occupied) return p.role;
    var slots = need[p.side] || [];
    var blocked = slots.some(function (s) { return occupied[s]; });
    if (!blocked) return p.role;
    p.fallback = need.fallbackRole;
    return need.fallbackRole && roles[need.fallbackRole] ? need.fallbackRole : p.role;
  }

  function getRule(roles, p, phase, flags, duty, occupied) {
    var role = roles[ruleRole(roles, p, occupied)];
    var dutyRules = role && role.duties && (role.duties[duty || p.duty] || role.duties[p.duty]);
    var rule = dutyRules && dutyRules[phase];
    if (!rule) return null;
    if (rule.if && !flags[rule.if]) return null;
    if (rule.onlyBands && rule.onlyBands.indexOf(p.band) < 0) return null;
    if (rule.byBand) {
      // variação por faixa (ex.: DLP no volante x no meio-campo): a parte da faixa sobrescreve a base
      var merged = {};
      Object.keys(rule).forEach(function (k) { if (k !== 'byBand') merged[k] = rule[k]; });
      var extra = rule.byBand[p.band] || {};
      Object.keys(extra).forEach(function (k) { merged[k] = extra[k]; });
      return merged;
    }
    return rule;
  }

  // ---------- instruções individuais (PIs) ----------

  var BAND_NAMES = { GK: 'goleiro', D: 'defesa', DM: 'meio-defensivo', M: 'meio', AM: 'meia ofensivo', ST: 'ataque' };

  /** A instrução `def` está disponível para o jogador `p` no slot descrito por `info`? */
  /** Instruções que a função+tarefa já traz embutidas no jogo (campo "locked" da tarefa em roles.json). */
  function lockedFor(roles, p) {
    var role = roles && roles[p.role];
    var duty = role && role.duties && role.duties[p.duty];
    return (duty && duty.locked) || [];
  }

  function piAvailability(def, p, info, roles, key) {
    var locked = lockedFor(roles, p);
    if (key && locked.indexOf(key) >= 0) return { ok: false, locked: true, reason: 'já embutida na função' };
    var clash = (def.excludes || []).filter(function (k) { return locked.indexOf(k) >= 0; })[0];
    if (clash) return { ok: false, reason: 'conflita com uma instrução embutida na função' };
    if (def.notBands && def.notBands.indexOf(info.band) >= 0) return { ok: false, reason: 'não disponível para ' + BAND_NAMES[info.band] };
    if (def.bands && def.bands.indexOf(info.band) < 0) return { ok: false, reason: 'só para ' + def.bands.map(function (b) { return BAND_NAMES[b]; }).join('/') };
    if (def.lanes && def.lanes.indexOf(info.lane) < 0) return { ok: false, reason: 'não disponível neste corredor' };
    if (def.sides && def.sides.indexOf(info.side) < 0) return { ok: false, reason: 'só para jogadores com lado definido (não central)' };
    if (def.excludeRoles && def.excludeRoles.indexOf(p.role) >= 0) return { ok: false, reason: 'já embutida na função' };
    return { ok: true };
  }

  /** Separa as PIs do jogador em aplicadas, ignoradas (indisponíveis/conflitantes) e desconhecidas. */
  function resolvePlayerInstructions(p, info, pis, roles) {
    var applied = [], ignored = [], unknown = [];
    (p.instructions || []).forEach(function (k) {
      var def = pis[k];
      if (!def) { unknown.push(k); return; }
      var av = piAvailability(def, p, info, roles, k);
      if (!av.ok) { ignored.push({ key: k, reason: av.reason }); return; }
      var clash = applied.filter(function (a) {
        return (def.excludes || []).indexOf(a) >= 0 || (pis[a].excludes || []).indexOf(k) >= 0;
      })[0];
      if (clash) { ignored.push({ key: k, reason: 'conflita com "' + pis[clash].label + '"' }); return; }
      applied.push(k);
    });
    return { applied: applied, ignored: ignored, unknown: unknown };
  }

  // ---------- características do jogador (Player Traits) ----------

  /**
   * Características ativas: disponíveis no slot, sem conflito entre si e não anuladas por
   * uma instrução individual/embutida listada em overriddenBy (o manual: "can be overridden by Player Instructions").
   */
  function resolveTraits(p, info, defs, activePIs) {
    var applied = [], ignored = [], unknown = [];
    (p.traits || []).forEach(function (k) {
      var def = defs[k];
      if (!def) { unknown.push(k); return; }
      var av = piAvailability(def, p, info);
      if (!av.ok) { ignored.push({ key: k, reason: av.reason }); return; }
      var over = (def.overriddenBy || []).filter(function (x) { return activePIs.indexOf(x) >= 0; })[0];
      if (over) { ignored.push({ key: k, reason: 'uma instrução (individual ou embutida na função) prevalece', overriddenBy: over }); return; }
      var clash = applied.filter(function (a) {
        return (def.excludes || []).indexOf(a) >= 0 || (defs[a].excludes || []).indexOf(k) >= 0;
      })[0];
      if (clash) { ignored.push({ key: k, reason: 'conflita com "' + defs[clash].label + '"' }); return; }
      applied.push(k);
    });
    return { applied: applied, ignored: ignored, unknown: unknown };
  }

  // ---------- efeitos especiais ----------

  function centreBacks(list) {
    return list.filter(function (p) { return p.isCB; }).sort(function (a, b) { return a.baseX - b.baseX; });
  }

  var EFFECTS = {
    /** DCs abrem para x 25/75 e y 13 (Half-Back e, opcionalmente, DLP-D). */
    split_cbs_wide: function (list) {
      var dcs = centreBacks(list);
      if (!dcs.length) return;
      dcs.forEach(function (d) { d.by = 13; });
      if (dcs.length >= 2) {
        dcs[0].bx = 25;
        dcs[dcs.length - 1].bx = 75;
      }
    },
    /** Com um Ala Invertido de um lado, o DC daquele lado abre +5 em x na saída de bola. */
    fullback_hold: function (list, phase, source) {
      if (phase !== 'saindo' || source.side === 'C') return;
      var dcs = centreBacks(list);
      if (!dcs.length) return;
      var target = source.side === 'L' ? dcs[0] : dcs[dcs.length - 1];
      if (target.side !== source.side) return;
      target.bx += source.side === 'L' ? -5 : 5;
    },
    /** Lateral Invertido entra na linha dos zagueiros: os DCs deslizam para o lado oposto, formando uma linha de 3. */
    ifb_back_three: function (list, phase, source) {
      if (source.side === 'C') return;
      var shift = source.side === 'L' ? 10 : -10;
      centreBacks(list).forEach(function (d) { d.bx += shift; });
    }
  };

  function registerEffect(name, fn) { EFFECTS[name] = fn; }

  // ---------- colisão / clamp ----------

  /**
   * Afasta pares a menos de minDist. `aspect` = [ax, ay] mede a distância num espaço escalado
   * (ex.: [0.68, 1.05] = metros num campo 68×105); [1, 1] = unidades normalizadas puras.
   */
  function resolveCollisions(pts, minDist, iterations, aspect) {
    minDist = minDist == null ? 6 : minDist;
    iterations = iterations == null ? 5 : iterations;
    var ax = aspect ? aspect[0] : 1, ay = aspect ? aspect[1] : 1;
    for (var it = 0; it < iterations; it++) {
      var moved = false;
      for (var i = 0; i < pts.length; i++) {
        for (var j = i + 1; j < pts.length; j++) {
          var a = pts[i], b = pts[j];
          var vx = (b.x - a.x) * ax, vy = (b.y - a.y) * ay;
          var d = Math.sqrt(vx * vx + vy * vy);
          if (d >= minDist) continue;
          var ux, uy;
          if (d < 1e-6) { ux = (i + j) % 2 ? 1 : -1; uy = 0; } // vetor determinístico p/ pontos coincidentes
          else { ux = vx / d; uy = vy / d; }
          var push = (minDist - d) / 2;
          a.x -= ux * push / ax; a.y -= uy * push / ay;
          b.x += ux * push / ax; b.y += uy * push / ay;
          moved = true;
        }
      }
      if (!moved) break;
    }
    return pts;
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  /** Zona de liberdade (elipse rx × ry, unidades normalizadas) em volta da posição média. */
  function addZone(p, rx, ry) {
    if (!p.zone) p.zone = { rx: 0, ry: 0 };
    p.zone.rx = Math.max(p.zone.rx, rx);
    p.zone.ry = Math.max(p.zone.ry, ry);
  }

  // ---------- pipeline ----------

  /**
   * Calcula as posições de uma fase.
   * Ordem efetiva: base(slot) → fase da equipe → override/delta da função → efeitos
   *                → instruções de equipe (aplicadas como deslocamento sobre o resultado)
   *                → deltas da função → colisão → clamp.
   * As instruções vêm depois do override para que mentalidade/linha/largura
   * continuem valendo para jogadores com posição absoluta na regra.
   */
  function isWithBall(formations, phase) {
    var ph = formations.phases[phase];
    return ph && ph.withBall != null ? !!ph.withBall : phase !== 'defendendo';
  }

  /**
   * Fase derivada de outra(s) (data.formations.phases[fase].derive):
   *  - blend: mistura posição a posição duas fases já calculadas (ex.: progressão = entre saída e ataque);
   *  - from: desloca uma fase por faixa, ancora a linha D, estreita e soma o efeito de pressão.
   * Regras de função com a chave desta fase entram como deslocamento extra (dx espelhado, dy).
   */
  /**
   * Estrutura de pressão (FMScout, "How to press in FM": um 4-2-3-1 tende a pressionar em 4-4-2):
   * com um centroavante só e um meia central, o meia sobe ao lado dele; os meias abertos recuam
   * para a linha do meio-campo.
   */
  function applyPressShape(list, cfg) {
    var st = list.filter(function (p) { return p.band === 'ST'; });
    var amc = list.filter(function (p) { return p.band === 'AM' && p.side === 'C' || p.band === 'AM' && (p.lane === 'CL' || p.lane === 'CR'); });
    if (st.length !== 1 || amc.length !== 1) return;
    var s = st[0], a = amc[0];
    a.y = s.y - (cfg.partnerGap || 4);
    a.x = s.x + (s.x <= 50 ? 1 : -1) * (cfg.partnerX || 10);
    var mids = list.filter(function (p) { return p.band === 'DM' || p.band === 'M'; });
    var lineY = mids.length ? mids.reduce(function (t, p) { return t + p.y; }, 0) / mids.length : null;
    list.forEach(function (p) {
      if (p.band === 'AM' && (p.lane === 'L' || p.lane === 'R')) p.y = lineY != null ? lineY + (cfg.wideAboveMid || 4) : p.y - 8;
    });
  }

  function computeDerived(players, phase, data, tiState) {
    var formations = data.formations, roles = data.roles;
    var ph = formations.phases[phase], d = ph.derive;
    var eng = data.instructions.engine || {};
    var ti = resolveInstructions(data.instructions, tiState);
    var list;
    if (d.blend) {
      var A = computePhase(players, d.blend[0], data, tiState).players;
      var B = computePhase(players, d.blend[1], data, tiState).players;
      var t = d.t == null ? 0.5 : d.t;
      list = B.map(function (pb, i) {
        var pa = A[i], p = Object.assign({}, pb);
        p.x = pa.x + (pb.x - pa.x) * t;
        p.y = pa.y + (pb.y - pa.y) * t;
        p.zone = pb.zone || pa.zone;
        p.offside = false;
        return p;
      });
    } else {
      list = computePhase(players, d.from, data, tiState).players.map(function (p) { return Object.assign({}, p, { offside: false }); });
      var anchor = 0;
      if (d.lineY != null) {
        var defs = list.filter(function (p) { return p.band === 'D'; });
        if (!defs.length) defs = list.filter(function (p) { return p.band !== 'GK'; });
        anchor = d.lineY - Math.min.apply(null, defs.map(function (p) { return p.y; }));
      }
      list.forEach(function (p) {
        if (p.band === 'GK') { p.y += (d.shiftByBand && d.shiftByBand.GK) || 0; return; }
        p.y += anchor + ((d.shiftByBand && d.shiftByBand[p.band]) || 0);
        if (d.widthScale) p.x = 50 + (p.x - 50) * d.widthScale;
        if (d.press) {
          var keys = (p.instructions || []).concat(p.locked || []);
          if (keys.indexOf('close_down_more') >= 0) p.y += d.press.more || 0;
          if (keys.indexOf('close_down_less') >= 0) p.y += d.press.less || 0;
        }
      });
      if (d.pressShape) applyPressShape(list, d.pressShape);
    }
    var occD = {};
    players.forEach(function (p) { occD[p.slot] = true; });
    list.forEach(function (p) {
      p.derivedDx = 0; p.derivedDy = 0;
      var rule = getRule(roles, p, phase, ti.flags, p.effDuty, occD);
      if (!rule) return;
      p.rule = rule;
      if (rule.dx && p.side !== 'C') { p.derivedDx = rule.dx; p.x += p.side === 'R' ? -rule.dx : rule.dx; }
      if (rule.dy) { p.derivedDy = rule.dy; p.y += rule.dy; }
    });
    resolveCollisions(list, eng.collisionMinDist, eng.collisionIterations, eng.collisionAspect);
    var lo = (eng.clamp || [2, 98])[0], hi = (eng.clamp || [2, 98])[1], minOut = eng.outfieldMinY == null ? 8 : eng.outfieldMinY;
    list.forEach(function (p) {
      p.x = Math.round(clamp(p.x, lo, hi) * 10) / 10;
      p.y = Math.round(clamp(p.y, p.band === 'GK' ? lo : minOut, hi) * 10) / 10;
    });
    return { phase: phase, players: list, ball: ph.ball || null, warnings: [], derived: true };
  }

  function computePhase(players, phase, data, tiState) {
    var formations = data.formations, roles = data.roles, instructions = data.instructions;
    var ph = formations.phases[phase];
    if (!ph) throw new Error('Fase desconhecida: ' + phase);
    if (ph.derive) return computeDerived(players, phase, data, tiState);
    var eng = instructions.engine || {};
    var ti = resolveInstructions(instructions, tiState);
    var withBall = isWithBall(formations, phase);
    var nums = numberPlayers(players, formations);
    var pis = (data.playerInstructions || {}).instructions || {};
    var tdefs = (data.playerTraits || {}).traits || {};
    var defaultLineY = formations.phases.defendendo.y.D;
    var defLineWithBall = eng.defLineWithBallFactor == null ? 1 : eng.defLineWithBallFactor;

    // 1. posição base + transformação de fase
    var list = players.map(function (p, i) {
      var info = slotInfo(formations, p.slot);
      return {
        index: i, num: nums[i], slot: p.slot, role: p.role, duty: p.duty,
        band: info.band, lane: info.lane, side: info.side,
        baseX: info.x, baseY: info.y,
        isCB: isCentreBack(formations, p.slot),
        bx: 50 + (info.x - 50) * (withBall || !ti.defWidthFactor ? ph.width : ti.defWidthFactor),
        by: ph.y[info.band],
        dx: 0, dy: 0, inside: 0, outside: 0, latShift: 0, rule: null,
        instructions: resolvePlayerInstructions(p, info, pis, roles).applied,
        locked: lockedFor(roles, p).slice(),
        traits: [],
        zone: null, touch: null, effDuty: p.duty
      };
    });

    if (ph.cbSplit) {
      var dcs = centreBacks(list), xs = ph.cbSplit[String(dcs.length)];
      if (xs) dcs.forEach(function (d, k) { d.bx = xs[k]; });
    }

    // 2. regras de função + tarefa (x escrito para o lado esquerdo, espelhado à direita)
    var pending = [];
    var occupied = {};
    players.forEach(function (p) { occupied[p.slot] = true; });
    list.forEach(function (p) {
      p.effDuty = effectiveDuty(roles, p, phase, ti, eng);
      var rule = getRule(roles, p, phase, ti.flags, p.effDuty, occupied);
      if (!rule) return;
      p.rule = rule;
      var mirror = p.side === 'R';
      if (rule.x != null && p.side !== 'C') p.bx = mirror ? 100 - rule.x : rule.x;
      if (rule.y != null) p.by = rule.y;
      if (rule.dx && p.side !== 'C') p.dx = mirror ? -rule.dx : rule.dx;
      if (rule.dy) p.dy = rule.dy;
      if (rule.inside && p.side !== 'C') p.inside = rule.inside === true ? (eng.insideDefault || 8) : rule.inside;
      if (rule.outside && p.side !== 'C') p.outside = rule.outside;
      if (rule.roam) addZone(p, rule.roam, rule.roam);
      if (rule.lateral) addZone(p, rule.lateral, rule.lateralY || 3);
      (rule.effects || []).forEach(function (e) { pending.push({ name: e, source: p }); });
    });

    // 2b. instruções individuais: somam deltas por fase (dx espelhado; inside/outside relativos ao centro).
    //     As embutidas na função só contribuem com zonas (deambular/corredores): o deslocamento delas
    //     já está nas regras da função em roles.json.
    //     Características do jogador (traits) entram do mesmo jeito, depois das instruções.
    list.forEach(function (p) {
      var wideLane = p.lane === 'L' || p.lane === 'R';
      var src = players[p.index];
      p.traits = resolveTraits(src, slotInfo(formations, p.slot), tdefs, p.instructions.concat(p.locked)).applied;
      var noChannels = p.traits.some(function (k) { return tdefs[k].suppressChannels; });
      var moves = p.instructions.map(function (k) { return pis[k]; }).concat(p.traits.map(function (k) { return tdefs[k]; }));
      moves.forEach(function (def) {
        var eff = def.phases && def.phases[phase];
        if (!eff) return;
        if (eff.dx && p.side !== 'C') p.dx += p.side === 'R' ? -eff.dx : eff.dx;
        if (eff.dy) p.dy += eff.dy;
        if (eff.inside && p.side !== 'C') p.inside += eff.inside;
        if (eff.touchline != null && wideLane) p.touch = eff.touchline;
        else if (eff.wideInside && wideLane) { if (!noChannels) p.inside += eff.wideInside; }
        else if (eff.outside && p.side !== 'C' && !(noChannels && eff.centerSpread)) p.outside += eff.outside;
      });
      p.locked.map(function (k) { return pis[k]; }).concat(moves).forEach(function (def) {
        var eff = def && def.phases && def.phases[phase];
        if (!eff) return;
        if (eff.roam) addZone(p, eff.roam, eff.roam);
        if (eff.centerSpread && p.side === 'C' && !noChannels) addZone(p, eff.centerSpread, eff.centerSpreadY || 4);
      });
    });

    // 3. efeitos sobre outros jogadores
    var warnings = [];
    pending.forEach(function (e) {
      var fn = EFFECTS[e.name];
      if (fn) fn(list, phase, e.source);
      else warnings.push('Efeito desconhecido: ' + e.name);
    });

    // 4. instruções de equipe + deltas da função
    list.forEach(function (p) {
      p.tiW = withBall ? ti.widthFactor : 1;
      if (p.band === 'GK') p.tiDy = 0;
      else if (withBall) {
        // a linha defensiva também define a altura dos defensores com a bola (manual do FM23)
        // a linha defensiva com a bola move o bloco de trás central: zagueiros e volantes (que a acompanham
        // para não ficarem colados nos zagueiros). Laterais e alas (corredores L/R) sobem pela função e pela
        // mentalidade, não pela altura da linha.
        var rearCentral = (p.band === 'D' || p.band === 'DM') && p.lane !== 'L' && p.lane !== 'R';
        p.tiDy = ti.mentalityDy + (rearCentral ? (ti.defLineY - defaultLineY) * defLineWithBall : 0);
      }
      else p.tiDy = (ti.defLineY - ph.y.D) + (p.band === 'AM' || p.band === 'ST' ? ti.loeDy : 0);

      var x = 50 + (p.bx - 50) * p.tiW + p.dx;
      var y = p.by + p.tiDy + p.dy;
      if (p.side !== 'C' && (p.inside || p.outside)) {
        var toCentre = p.side === 'L' ? 1 : -1;
        var shift = -p.outside * toCentre;
        var after = x + shift;
        // "para dentro" nunca cruza o meio do campo
        var room = Math.max(0, toCentre * (50 - after));
        shift += toCentre * Math.min(p.inside, room);
        x += shift;
        p.latShift = shift;
      }
      if (p.touch != null) {
        // "Abrir mais" num jogador aberto: colado na linha lateral
        var tx = p.side === 'R' ? 100 - p.touch : p.touch;
        p.latShift += tx - x;
        x = tx;
      }
      p.x = x; p.y = y;
    });

    // 5. colisão e clamp
    resolveCollisions(list, eng.collisionMinDist, eng.collisionIterations, eng.collisionAspect);
    var lo = (eng.clamp || [2, 98])[0], hi = (eng.clamp || [2, 98])[1], minOut = eng.outfieldMinY == null ? 8 : eng.outfieldMinY;
    list.forEach(function (p) {
      p.x = Math.round(clamp(p.x, lo, hi) * 10) / 10;
      // jogador de linha nunca dentro da pequena área do próprio gol
      p.y = Math.round(clamp(p.y, p.band === 'GK' ? lo : minOut, hi) * 10) / 10;
    });

    return { phase: phase, players: list, ball: ph.ball || null, warnings: warnings };
  }

  function computeAll(players, data, tiState) {
    var out = {};
    PHASES.forEach(function (ph) { out[ph] = computePhase(players, ph, data, tiState); });
    return out;
  }

  // ---------- adversário ----------

  function opponentStyle(data, id) {
    var styles = (data.opponent && data.opponent.styles) || [];
    return styles.filter(function (s) { return s.id === id; })[0] || styles[0] || null;
  }

  /**
   * Funções típicas de um estilo de jogo aplicadas a uma formação (data.opponent.styles[].roles):
   * por grupo de slots, a lista é usada em sequência (esquerda → direita). Funções inválidas para
   * o slot ficam como estavam na formação.
   */
  function styleRoles(players, data, styleId) {
    var style = opponentStyle(data, styleId), groups = (data.opponent && data.opponent.roleGroups) || {};
    var formations = data.formations, roles = data.roles;
    if (!style || !style.roles) return players.map(function (p) { return Object.assign({}, p); });
    var groupOf = {};
    Object.keys(groups).forEach(function (g) { groups[g].forEach(function (slot) { groupOf[slot] = g; }); });
    var used = {};
    return players.slice()
      .map(function (p, i) { return { p: p, i: i }; })
      .sort(function (a, b) { return slotOrder(formations, a.p.slot) - slotOrder(formations, b.p.slot); })
      .map(function (o) {
        var p = Object.assign({}, o.p), g = groupOf[p.slot], list = g && style.roles[g];
        if (list && list.length) {
          var k = used[g] || 0; used[g] = k + 1;
          var pick = list[k % list.length].split('-'), rk = pick[0], dk = pick[1];
          var r = roles[rk];
          if (r && r.slots.indexOf(p.slot) >= 0 && r.duties[dk]) { p.role = rk; p.duty = dk; }
        }
        delete p.instructions; delete p.traits;
        return { p: p, i: o.i };
      })
      .sort(function (a, b) { return a.i - b.i; })
      .map(function (o) { return o.p; });
  }

  /**
   * Impedimento: quem ataca não passa do último defensor de linha rival (ignora o goleiro),
   * e a regra só vale no campo adversário. Mexe só nos atacantes. Retorna quantos foram contidos.
   */
  function applyOffside(attackers, defenders, attackingUp) {
    var outfield = defenders.filter(function (p) { return p.band !== 'GK'; });
    if (!outfield.length) return 0;
    var n = 0;
    if (attackingUp) {
      var line = Math.max(50, Math.max.apply(null, outfield.map(function (p) { return p.y; })));
      attackers.forEach(function (p) { if (p.band !== 'GK' && p.y > line) { p.y = line; p.offside = true; n++; } });
    } else {
      var lineD = Math.min(50, Math.min.apply(null, outfield.map(function (p) { return p.y; })));
      attackers.forEach(function (p) { if (p.band !== 'GK' && p.y < lineD) { p.y = lineD; p.offside = true; n++; } });
    }
    return n;
  }

  /**
   * Calcula o adversário em cada uma das nossas fases, com o mesmo motor:
   * formação/funções dele + instruções de equipe do estilo, na fase correspondente
   * (data.opponent.phaseMap), deslocado em y pelo estilo e espelhado (ataca para baixo).
   */
  function computeOpponentPhase(oppPlayers, ourPhase, data, styleId) {
    var cfg = data.opponent, map = cfg.phaseMap[ourPhase];
    var style = opponentStyle(data, styleId);
    var res = computePhase(oppPlayers, map.phase, data, style ? style.ti : {});
    var shift = style && style.shifts ? style.shifts[ourPhase] || 0 : 0;
    if (typeof shift === 'object' && shift.lineY != null) {
      // ancora a linha de defensores dele numa altura fixa (ex.: bloco baixo com a bola no nosso terço final)
      var defs = res.players.filter(function (p) { return p.band === 'D'; });
      var avg = defs.length ? defs.reduce(function (t, p) { return t + p.y; }, 0) / defs.length : shift.lineY;
      shift = shift.lineY - avg;
    }
    var eng = data.instructions.engine || {};
    var lo = (eng.clamp || [2, 98])[0], hi = (eng.clamp || [2, 98])[1];
    var list = res.players.map(function (p) {
      p.team = 'opp';
      p.oppPhase = map.phase;
      if (p.band !== 'GK') p.y = clamp(p.y + shift, eng.outfieldMinY == null ? 8 : eng.outfieldMinY, hi);
      p.x = 100 - p.x;
      p.y = 100 - p.y;
      p.baseX = 100 - p.baseX;
      p.baseY = 100 - p.baseY;
      return p;
    });
    return { players: list, style: style, label: map.label };
  }

  /** Nosso time + adversário (opcional) nas 3 fases, com impedimento entre os dois. */
  function computeMatch(players, data, tiState, opp) {
    var out = computeAll(players, data, tiState);
    if (!opp || !opp.enabled || !data.opponent || !opp.players) return out;
    var eng = data.instructions.engine || {};
    var lo = (eng.clamp || [2, 98])[0], hi = (eng.clamp || [2, 98])[1];
    PHASES.forEach(function (ph) {
      var o = computeOpponentPhase(opp.players, ph, data, opp.styleId);
      settleMatchPhase(out[ph].players, o.players, ph, data);
      out[ph].opponent = { players: o.players, style: o.style, label: o.label };
    });
    return out;
  }

  /** Impedimento entre os dois times numa fase (nós com a bola = atacamos para cima) e clamp final. */
  function settleMatchPhase(ours, theirs, ph, data) {
    var eng = data.instructions.engine || {};
    var lo = (eng.clamp || [2, 98])[0], hi = (eng.clamp || [2, 98])[1];
    if (data.opponent.offside) {
      var weAttack = isWithBall(data.formations, ph);
      var attackers = weAttack ? ours : theirs, defenders = weAttack ? theirs : ours;
      if (applyOffside(attackers, defenders, weAttack)) {
        resolveCollisions(attackers, eng.collisionMinDist, eng.collisionIterations, eng.collisionAspect);
        applyOffside(attackers, defenders, weAttack);
      }
    }
    // limite da pressão: quem pressiona vai até a última linha de jogadores de quem tem a bola,
    // mas não passa dela (não "marca o goleiro" dentro da área)
    var margin = eng.pressMargin == null ? 3 : eng.pressMargin;
    var withBall = isWithBall(data.formations, ph);
    var holders = (withBall ? ours : theirs).filter(function (p) { return p.band !== 'GK'; });
    var pressers = (withBall ? theirs : ours);
    if (holders.length) {
      var capped = 0;
      if (withBall) {
        var deepest = Math.min.apply(null, holders.map(function (p) { return p.y; })) - margin;
        pressers.forEach(function (p) { if (p.band !== 'GK' && p.y < deepest) { p.y = deepest; capped++; } });
      } else {
        var deepestTheirs = Math.max.apply(null, holders.map(function (p) { return p.y; })) + margin;
        pressers.forEach(function (p) { if (p.band !== 'GK' && p.y > deepestTheirs) { p.y = deepestTheirs; capped++; } });
      }
      if (capped) resolveCollisions(pressers, eng.collisionMinDist, eng.collisionIterations, eng.collisionAspect);
    }
    [ours, theirs].forEach(function (team) {
      team.forEach(function (p) {
        p.x = Math.round(clamp(p.x, lo, hi) * 10) / 10;
        p.y = Math.round(clamp(p.y, lo, hi) * 10) / 10;
      });
    });
  }

  /** Adversário calculado uma vez por fase (não depende das nossas funções); reaproveitado na busca. */
  function opponentCache(data, opp, phases) {
    if (!opp || !opp.enabled || !opp.players || !data.opponent) return null;
    var c = {};
    phases.forEach(function (ph) { c[ph] = computeOpponentPhase(opp.players, ph, data, opp.styleId); });
    return c;
  }

  // ---------- notas de estrutura (Guide to Football, "tactical theory") ----------

  function c01(v) { return Math.max(0, Math.min(1, v)); }
  function hasKey(p, k) { return (p.instructions || []).indexOf(k) >= 0 || (p.locked || []).indexOf(k) >= 0 || (p.traits || []).indexOf(k) >= 0; }

  /**
   * Notas 0–100 por fase, com as definições do framework do Guide to Football:
   * com a bola — Penetração, Solidez e Apoio; sem a bola — Pressão, Cobertura e Compactação.
   * Calculadas só com as posições da fase, a bola da fase e as tarefas/instruções de cada jogador.
   */
  function structureScores(players, phase, data) {
    var ph = data.formations.phases[phase];
    var ball = ph.ball || { x: 50, y: 50 };
    var out = players.filter(function (p) { return p.band !== 'GK'; });
    var n = out.length || 1;
    var d = function (a, b) { return Math.hypot((a.x - b.x) * 0.68, (a.y - b.y) * 1.05); };
    var ys = out.map(function (p) { return p.y; });
    if (isWithBall(data.formations, phase)) {
      var top4 = out.slice().sort(function (a, b) { return b.y - a.y; }).slice(0, 4);
      var height = top4.reduce(function (t, p) { return t + p.y; }, 0) / top4.length;
      var final3 = out.filter(function (p) { return p.y >= 67; }).length;
      var commit = out.filter(function (p) {
        return p.duty === 'A' || ['get_further_forward', 'roam_from_position', 'gets_forward_whenever_possible', 'gets_into_opposition_area', 'arrives_late', 'makes_runs_in_behind'].some(function (k) { return hasKey(p, k); });
      }).length;
      var pen = 0.5 * c01((height - 40) / 45) + 0.3 * c01(final3 / 4) + 0.2 * c01(commit / 5);

      var line = Math.max(ball.y - 5, 30);
      var behind = out.filter(function (p) { return p.y < line; }).length;
      var restrain = out.filter(function (p) {
        return p.duty === 'D' || p.duty === 'Co' || p.duty === 'St' || hasKey(p, 'hold_position') || hasKey(p, 'stays_back');
      }).length;
      var sol = 0.6 * c01(behind / 4) + 0.4 * c01(restrain / 4);

      var lines = teamShape(out).lines;
      var means = lines.map(function (l) { return l.reduce(function (t, p) { return t + p.y; }, 0) / l.length; });
      var maxGap = 0;
      for (var i = 1; i < means.length; i++) maxGap = Math.max(maxGap, (means[i] - means[i - 1]) * 1.05);
      var near = out.filter(function (p) { return d(p, ball) <= 15; }).length;
      var sup = 0.5 * c01((30 - maxGap) / 15) + 0.5 * c01(near / 3);
      return { withBall: true, scores: [
        { key: 'penetracao', label: 'Penetração', value: Math.round(pen * 100), detail: 'os 4 mais avançados a ' + Math.round(height * 1.05) + ' m do nosso gol em média, ' + final3 + ' no terço final, ' + commit + ' com compromisso de avançar' },
        { key: 'solidez', label: 'Solidez', value: Math.round(sol * 100), detail: behind + ' atrás da linha da bola (ideal 4), ' + restrain + ' com contenção (Defender/Manter posição)' },
        { key: 'apoio', label: 'Apoio', value: Math.round(sup * 100), detail: 'maior buraco entre linhas ' + Math.round(maxGap) + ' m, ' + near + ' a até 15 m da bola' }
      ] };
    }
    var contest = out.filter(function (p) { return d(p, ball) <= 25; }).length;
    var pressers = out.filter(function (p) { return p.duty === 'St' || hasKey(p, 'close_down_more'); }).length;
    var pre = 0.7 * c01(contest / 3) + 0.3 * c01(pressers / 3);
    var last = Math.min.apply(null, ys);
    var ownHalf = out.filter(function (p) { return p.y <= 50; }).length;
    var cov = 0.5 * c01(1 - last / 50) + 0.5 * c01(ownHalf / 8);
    var len = (Math.max.apply(null, ys) - last) * 1.05;
    var xs = out.map(function (p) { return p.x; });
    var wid = (Math.max.apply(null, xs) - Math.min.apply(null, xs)) * 0.68;
    var nn = out.reduce(function (t, p) {
      return t + Math.min.apply(null, out.filter(function (q) { return q !== p; }).map(function (q) { return d(p, q); }));
    }, 0) / n;
    var cmp = 0.5 * c01((55 - len) / 30) + 0.3 * c01((60 - wid) / 25) + 0.2 * c01((18 - nn) / 10);
    return { withBall: false, scores: [
      { key: 'pressao', label: 'Pressão', value: Math.round(pre * 100), detail: contest + ' a até 25 m da bola, ' + pressers + ' com pressão embutida/instruída ou Stopper (mede quem disputa a bola, não a altura do bloco)' },
      { key: 'cobertura', label: 'Cobertura', value: Math.round(cov * 100), detail: 'última linha a ' + Math.round(last * 1.05) + ' m do gol, ' + ownHalf + ' no próprio campo' },
      { key: 'compactacao', label: 'Compactação', value: Math.round(cmp * 100), detail: 'bloco de ' + Math.round(len) + ' × ' + Math.round(wid) + ' m, ' + nn.toFixed(1) + ' m até o companheiro mais próximo em média' }
    ] };
  }

  // ---------- equilíbrio da tática e sugestão de funções ----------

  function lanesOccupied(ps) {
    var lanes = [false, false, false, false, false];
    ps.forEach(function (p) { lanes[Math.min(4, Math.floor(p.x / 20))] = true; });
    return lanes.filter(Boolean).length;
  }
  function band01(v, lo, hi, zeroLo, zeroHi) {
    // 1 dentro de [lo, hi]; cai linearmente até 0 em zeroLo / zeroHi
    if (v >= lo && v <= hi) return 1;
    if (v < lo) return Math.max(0, (v - zeroLo) / (lo - zeroLo));
    return Math.max(0, (zeroHi - v) / (zeroHi - hi));
  }

  /**
   * Índice de equilíbrio (0–100) com critérios táticos gerais, medidos nas fases-base:
   * corredores ocupados e presença na área no ataque, proteção atrás da bola, linhas de passe na saída,
   * compactação do bloco médio, jogadores empilhados e distribuição de tarefas (manual do FM23:
   * mentalidade e fluidez equilibradas = 3 Defender, 4 Apoio, 3 Ataque).
   */
  var OPP_PHASES = ['progressao', 'ataque', 'defendendo', 'bloco_baixo'];

  function dist(a, b) { return Math.hypot((a.x - b.x) * 0.68, (a.y - b.y) * 1.05); }

  /**
   * Critérios contra o adversário (nas fases em que os dois se enfrentam): jogadores entre as linhas
   * dele, superioridade nas pontas, jogadores livres, atacantes dele vigiados e não amontoar na linha dele.
   */
  function opponentParts(players, data, tiState, cache, add) {
    var M = {};
    OPP_PHASES.forEach(function (ph) {
      var ours = computePhase(players, ph, data, tiState).players.map(function (p) { return Object.assign({}, p); });
      var theirs = cache[ph].players.map(function (p) { return Object.assign({}, p); });
      settleMatchPhase(ours, theirs, ph, data);
      M[ph] = { ours: ours.filter(function (p) { return p.band !== 'GK'; }), theirs: theirs.filter(function (p) { return p.band !== 'GK'; }) };
    });

    // 1) entre as linhas dele (defesa e linha seguinte), na progressão e no ataque
    var between = ['progressao', 'ataque'].map(function (ph) {
      var lines = teamShape(M[ph].theirs, { attackingDown: true }).lines;
      if (lines.length < 2) return 0;
      var mean = function (l) { return l.reduce(function (t, p) { return t + p.y; }, 0) / l.length; };
      var top = mean(lines[0]) - 2, bottom = mean(lines[1]) + 2;
      return M[ph].ours.filter(function (p) { return p.y > bottom && p.y < top; }).length;
    });
    var bscore = function (n) { return n === 2 || n === 3 ? 1 : n === 1 || n === 4 ? 0.6 : 0; };
    add('entrelinhas', 'Jogadores entre as linhas dele', 15, (bscore(between[0]) + bscore(between[1])) / 2,
      between[0] + ' na progressão e ' + between[1] + ' no ataque entre a defesa e o meio dele (ideal 2–3)', true);

    // 2) superioridade nas pontas no ataque
    var side = function (test) {
      var o = M.ataque.ours.filter(function (p) { return test(p.x) && p.y >= 60; }).length;
      var t = M.ataque.theirs.filter(function (p) { return test(p.x) && p.y >= 60; }).length;
      return { o: o, t: t, s: o === 0 ? 0 : o > t ? 1 : o === t ? 0.6 : 0.2 };
    };
    var L = side(function (x) { return x < 25; }), Rr = side(function (x) { return x > 75; });
    add('pontas', 'Superioridade nas pontas', 10, (L.s + Rr.s) / 2,
      'esquerda ' + L.o + ' × ' + L.t + ', direita ' + Rr.o + ' × ' + Rr.t + ' no terço final (nós × eles)', true);

    // 3) jogadores livres (>= 7 m do adversário mais próximo) do meio para frente
    var free = ['progressao', 'ataque'].map(function (ph) {
      return M[ph].ours.filter(function (p) {
        return p.y >= 45 && Math.min.apply(null, M[ph].theirs.map(function (q) { return dist(p, q); })) >= 7;
      }).length;
    });
    add('livres', 'Jogadores livres de marcação', 15, (Math.min(1, free[0] / 3) + Math.min(1, free[1] / 3)) / 2,
      free[0] + ' na progressão e ' + free[1] + ' no ataque a 7 m ou mais do adversário mais próximo (ideal 3+)', true);

    // 4) atacantes dele vigiados no bloco médio e no bloco baixo
    var watched = ['defendendo', 'bloco_baixo'].map(function (ph) {
      var fwd = M[ph].theirs.slice().sort(function (a, b) { return a.y - b.y; }).slice(0, 3);
      return fwd.filter(function (q) { return M[ph].ours.some(function (p) { return dist(p, q) <= 10; }); }).length;
    });
    add('vigiados', 'Atacantes dele vigiados', 15, (watched[0] + watched[1]) / 6,
      watched[0] + '/3 no bloco médio e ' + watched[1] + '/3 no bloco baixo com um dos nossos a até 10 m', true);

    // 6) tipo de atacante x altura da linha dele (FMScout, Strikers in-depth): contra linha alta,
    //    atacantes de ruptura; contra linha baixa/compacta, atacantes de ligação e referência
    var style = cache.ataque && cache.ataque.style, dl = style && style.ti ? style.ti.defensiveLine : 2;
    var RUNNERS = ['advanced_forward', 'poacher', 'pressing_forward', 'complete_forward'];
    var LINKERS = ['deep_lying_forward', 'target_forward', 'false_nine', 'trequartista', 'complete_forward'];
    var sts = players.filter(function (p) { return /^ST/.test(p.slot); });
    if (sts.length && dl !== 2) {
      var fav = dl >= 3 ? RUNNERS : LINKERS;
      var ok = sts.filter(function (p) { return fav.indexOf(p.role) >= 0; }).length;
      add('atacante', 'Atacante adequado à linha dele', 5, ok / sts.length,
        (dl >= 3 ? 'linha alta dele: rendem atacantes de ruptura (Avançado, Matador…)' : 'linha baixa dele: rendem atacantes de ligação/referência (Recuado, Pivô, Falso 9…)') +
        ' — ' + ok + ' de ' + sts.length, true);
    }

    // 5) não amontoar na linha de impedimento dele
    var held = M.ataque.ours.filter(function (p) { return p.offside; }).length;
    add('linha', 'Sem amontoar na linha dele', 5, held <= 2 ? 1 : held === 3 ? 0.5 : 0,
      held + ' jogador(es) contidos na linha de impedimento no ataque (ideal até 2)', true);
  }

  function evaluateBalance(players, data, tiState, oppCacheArg) {
    var ti = resolveInstructions(data.instructions, tiState);
    var map = (data.instructions.engine || {}).autoDutyByMentality;
    var atk = computePhase(players, 'ataque', data, tiState).players;
    var bld = computePhase(players, 'saindo', data, tiState).players;
    var def = computePhase(players, 'defendendo', data, tiState).players;
    var out = function (ps) { return ps.filter(function (p) { return p.band !== 'GK'; }); };
    var parts = [];
    function add(key, label, weight, score, detail, vsOpp) { parts.push({ key: key, label: label, weight: weight, score: Math.max(0, Math.min(1, score)), detail: detail, vsOpp: !!vsOpp }); }

    var front = out(atk).filter(function (p) { return p.y >= 65; });
    var lanes = lanesOccupied(front);
    add('corredores', 'Corredores ocupados no ataque', 20, lanes / 5, lanes + ' de 5 corredores com jogador no terço final');

    var box = out(atk).filter(function (p) { return p.y >= 83 && p.x >= 25 && p.x <= 75; }).length;
    add('area', 'Presença na área', 10, box === 2 || box === 3 ? 1 : box === 1 || box === 4 ? 0.5 : 0, box + ' jogador(es) dentro da área (ideal 2–3)');

    var rest = out(atk).filter(function (p) { return p.y <= 55; }).length;
    add('protecao', 'Proteção atrás da bola', 15, rest === 3 || rest === 4 ? 1 : rest === 2 || rest === 5 ? 0.6 : rest === 6 ? 0.3 : 0,
      rest + ' jogador(es) de linha atrás no ataque (ideal 3–4)');

    var mid = out(bld).filter(function (p) { return p.y >= 22 && p.y <= 60; });
    var bl = lanesOccupied(mid);
    add('saida', 'Linhas de passe na saída', 10, Math.min(1, bl / 4), bl + ' corredores com opção de passe entre a defesa e o meio');

    var dy = out(def).map(function (p) { return p.y; });
    var len = (Math.max.apply(null, dy) - Math.min.apply(null, dy)) * 1.05;
    add('compactacao', 'Compactação sem a bola', 15, band01(len, 0, 40, 0, 55), 'bloco médio com ' + Math.round(len) + ' m de comprimento (ideal até 40 m)');

    // "zona de ouro" (FMScout, How to defend): alguém protegendo o espaço logo à frente da defesa, por dentro
    var defs = out(def).filter(function (p) { return p.band === 'D'; });
    var dline = defs.length ? defs.reduce(function (t, p) { return t + p.y; }, 0) / defs.length : 25;
    var screen = out(def).filter(function (p) { return p.band !== 'D' && p.y >= dline + 3 && p.y <= dline + 14 && p.x >= 30 && p.x <= 70; }).length;
    add('zona', 'Zona à frente da defesa protegida', 10, screen >= 2 ? 1 : screen === 1 ? 0.8 : 0,
      screen + ' jogador(es) por dentro logo à frente da defesa no bloco médio (ideal 1–2)');

    var stacked = 0;
    [atk, bld].forEach(function (ps) {
      var o = out(ps);
      for (var i = 0; i < o.length; i++) for (var j = i + 1; j < o.length; j++) {
        if (Math.hypot((o[i].x - o[j].x) * 0.68, (o[i].y - o[j].y) * 1.05) < 8) stacked++;
      }
    });
    add('espacamento', 'Jogadores sem se empilhar', 15, 1 - stacked * 0.2, stacked + ' par(es) a menos de 8 m entre si com a bola');

    var cnt = { D: 0, S: 0, A: 0 };
    players.forEach(function (p) {
      if (p.slot === 'GK') return;
      var d = p.duty === 'St' || p.duty === 'Co' ? 'D' : p.duty === 'Au' && map ? map[ti.mentalityIdx] : p.duty;
      if (cnt[d] != null) cnt[d]++;
    });
    var dev = Math.abs(cnt.D - 3) + Math.abs(cnt.S - 4) + Math.abs(cnt.A - 3);
    add('tarefas', 'Tarefas equilibradas', 15, 1 - dev / 6, cnt.D + ' Defender · ' + cnt.S + ' Apoio · ' + cnt.A + ' Ataque (referência do manual: 3 · 4 · 3)');

    if (oppCacheArg) opponentParts(players, data, tiState, oppCacheArg, add);

    var total = parts.reduce(function (t, p) { return t + p.weight * p.score; }, 0) /
      parts.reduce(function (t, p) { return t + p.weight; }, 0) * 100;
    return { score: Math.round(total * 10) / 10, parts: parts, vsOpponent: !!oppCacheArg };
  }

  /**
   * Busca gulosa: a cada rodada testa todas as funções+tarefas válidas de cada jogador de linha
   * (mantendo o slot) e aplica a troca que mais melhora o índice; para quando nenhuma troca melhora
   * pelo menos minGain ou após maxChanges trocas. Instruções individuais e características são mantidas.
   */
  function suggestRoles(players, data, tiState, opts) {
    opts = opts || {};
    var cache = opts.opponent ? opponentCache(data, opts.opponent, OPP_PHASES) : null;
    opts = opts || {};
    var maxChanges = opts.maxChanges || 6, minGain = opts.minGain == null ? 2 : opts.minGain;
    var roles = data.roles, formations = data.formations;
    var cur = players.map(function (p) { return Object.assign({}, p); });
    var before = evaluateBalance(cur, data, tiState, cache), best = before;
    var cbs = cur.filter(function (p) { return isCentreBack(formations, p.slot); }).length;
    var changes = [];
    for (var round = 0; round < maxChanges; round++) {
      var top = null;
      cur.forEach(function (p, i) {
        if (p.slot === 'GK') return;
        rolesForSlot(roles, p.slot).forEach(function (rk) {
          if (roles[rk].requiresBack3 && cbs !== 3) return;
          Object.keys(roles[rk].duties).forEach(function (dk) {
            if (rk === p.role && dk === p.duty) return;
            var trial = cur.slice();
            trial[i] = Object.assign({}, p, { role: rk, duty: dk });
            var ev = evaluateBalance(trial, data, tiState, cache);
            if (!top || ev.score > top.ev.score) top = { i: i, role: rk, duty: dk, ev: ev };
          });
        });
      });
      if (!top || top.ev.score - best.score < minGain) break;
      var from = cur[top.i];
      var improved = top.ev.parts.filter(function (pt, k) { return pt.score > best.parts[k].score + 1e-9; }).map(function (pt) { return pt.label; });
      changes.push({ index: top.i, slot: from.slot, from: { role: from.role, duty: from.duty }, to: { role: top.role, duty: top.duty },
        gain: Math.round((top.ev.score - best.score) * 10) / 10, improved: improved });
      cur[top.i] = Object.assign({}, from, { role: top.role, duty: top.duty });
      best = top.ev;
    }
    return { before: before, after: best, changes: changes, players: cur };
  }

  // ---------- calibração (modo "editar regra") ----------

  /** Converte uma posição final arrastada em override (x, y) da regra, já desfazendo TI, deltas e espelhamento. */
  function overrideFromPosition(cp, fx, fy) {
    var out = { y: Math.round((fy - cp.tiDy - cp.dy) * 10) / 10 };
    if (cp.side !== 'C') {
      var x = 50 + (fx - cp.dx - (cp.latShift || 0) - 50) / (cp.tiW || 1);
      if (cp.side === 'R') x = 100 - x;
      out.x = Math.round(x * 10) / 10;
    }
    return out;
  }

  /** Para fases derivadas: converte a posição arrastada em deslocamento extra (dx no referencial esquerdo, dy). */
  function deltaFromPosition(cp, fx, fy) {
    var out = { dy: Math.round((fy - cp.y + (cp.derivedDy || 0)) * 10) / 10 };
    if (cp.side !== 'C') {
      var dx = fx - cp.x;
      if (cp.side === 'R') dx = -dx;
      out.dx = Math.round((dx + (cp.derivedDx || 0)) * 10) / 10;
    }
    return out;
  }

  // ---------- estrutura do time (linhas) e medidas ----------

  /**
   * Agrupa os jogadores de linha em "linhas" do time:
   *  1. semente = faixa do slot (D, DM, M, AM, ST), quebrada onde houver um buraco >= split em y;
   *  2. linhas vizinhas se juntam quando o jogador mais próximo de cada uma está a < join em y;
   *  3. no máximo maxLines linhas (junta as mais próximas).
   * Devolve as linhas (de trás para frente), a forma (ex.: "3-2-5") e medidas em metros (campo 68 × 105).
   * attackingDown: adversário (ataca para baixo) — ordena e mede a partir do gol dele.
   */
  function teamShape(players, opts) {
    opts = opts || {};
    var split = opts.split == null ? 8 : opts.split, join = opts.join == null ? 4 : opts.join, maxLines = opts.maxLines || 5;
    var down = !!opts.attackingDown;
    var out = players.filter(function (p) { return p.band !== 'GK'; });
    if (!out.length) return { lines: [], shape: '', metrics: null };
    var groups = [];
    ['D', 'DM', 'M', 'AM', 'ST'].forEach(function (b) {
      var g = out.filter(function (p) { return p.band === b; }).sort(function (a, c) { return a.y - c.y; });
      var cur = [];
      g.forEach(function (p) {
        if (cur.length && p.y - cur[cur.length - 1].y >= split) { groups.push(cur); cur = []; }
        cur.push(p);
      });
      if (cur.length) groups.push(cur);
    });
    function mean(g) { return g.reduce(function (t, p) { return t + p.y; }, 0) / g.length; }
    function lo(g) { return Math.min.apply(null, g.map(function (p) { return p.y; })); }
    function hi(g) { return Math.max.apply(null, g.map(function (p) { return p.y; })); }
    function byMean(a, b) { return mean(a) - mean(b); }
    groups.sort(byMean);
    var changed = true;
    while (changed) {
      changed = false;
      for (var i = 1; i < groups.length; i++) {
        if (lo(groups[i]) - hi(groups[i - 1]) < join) {
          groups[i - 1] = groups[i - 1].concat(groups[i]); groups.splice(i, 1); changed = true; break;
        }
      }
      if (!changed && groups.length > maxLines) {
        var bi = 1;
        for (var k = 2; k < groups.length; k++) {
          if (lo(groups[k]) - hi(groups[k - 1]) < lo(groups[bi]) - hi(groups[bi - 1])) bi = k;
        }
        groups[bi - 1] = groups[bi - 1].concat(groups[bi]); groups.splice(bi, 1); changed = true;
      }
      groups.sort(byMean);
    }
    if (down) groups.reverse();
    var lines = groups.map(function (g) { return g.slice().sort(function (a, b) { return a.x - b.x; }); });
    var xs = out.map(function (p) { return p.x; }), ys = out.map(function (p) { return p.y; });
    return {
      lines: lines,
      shape: lines.map(function (l) { return l.length; }).join('-'),
      metrics: {
        length: Math.round((Math.max.apply(null, ys) - Math.min.apply(null, ys)) * 1.05),
        width: Math.round((Math.max.apply(null, xs) - Math.min.apply(null, xs)) * 0.68),
        // altura da última linha medida a partir do próprio gol (o adversário ataca para baixo)
        lastLine: Math.round((down ? 100 - Math.max.apply(null, ys) : Math.min.apply(null, ys)) * 1.05)
      }
    };
  }

  /** Retorna uma cópia de roles com o override gravado em role/duty/fase. */
  function applyOverride(roles, roleKey, duty, phase, patch) {
    var next = JSON.parse(JSON.stringify(roles));
    var d = next[roleKey].duties[duty] || (next[roleKey].duties[duty] = {});
    var rule = d[phase] || (d[phase] = {});
    Object.keys(patch).forEach(function (k) { rule[k] = patch[k]; });
    return next;
  }

  return {
    PHASES: PHASES, BAND_ORDER: BAND_ORDER, LANE_ORDER: LANE_ORDER, DUTIES: DUTIES, EFFECTS: EFFECTS,
    slotInfo: slotInfo, slotOrder: slotOrder, numberPlayers: numberPlayers, rolesForSlot: rolesForSlot,
    validate: validate, resolveInstructions: resolveInstructions, effectiveDuty: effectiveDuty,
    piAvailability: piAvailability, resolvePlayerInstructions: resolvePlayerInstructions, lockedFor: lockedFor,
    resolveTraits: resolveTraits,
    computePhase: computePhase, computeAll: computeAll, computeMatch: computeMatch,
    computeOpponentPhase: computeOpponentPhase, opponentStyle: opponentStyle, applyOffside: applyOffside,
    styleRoles: styleRoles,
    resolveCollisions: resolveCollisions, clamp: clamp, registerEffect: registerEffect,
    overrideFromPosition: overrideFromPosition, applyOverride: applyOverride,
    deltaFromPosition: deltaFromPosition, teamShape: teamShape, isWithBall: isWithBall,
    evaluateBalance: evaluateBalance, suggestRoles: suggestRoles, opponentCache: opponentCache,
    structureScores: structureScores,
    OPP_PHASES: OPP_PHASES
  };
});
