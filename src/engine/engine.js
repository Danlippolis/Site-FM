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

  var PHASES = ['defendendo', 'saindo', 'ataque'];
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
      if (!formations.slots[p.slot] || !p.instructions || !p.instructions.length) return;
      var pis = (data.playerInstructions || {}).instructions || {};
      var r = resolvePlayerInstructions(p, slotInfo(formations, p.slot), pis);
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
      flags: flags
    };
  }

  // ---------- regras de função ----------

  function getRule(roles, p, phase, flags) {
    var role = roles[p.role];
    var duty = role && role.duties && role.duties[p.duty];
    var rule = duty && duty[phase];
    if (!rule) return null;
    if (rule.if && !flags[rule.if]) return null;
    if (rule.onlyBands && rule.onlyBands.indexOf(p.band) < 0) return null;
    return rule;
  }

  // ---------- instruções individuais (PIs) ----------

  var BAND_NAMES = { GK: 'goleiro', D: 'defesa', DM: 'meio-defensivo', M: 'meio', AM: 'meia ofensivo', ST: 'ataque' };

  /** A instrução `def` está disponível para o jogador `p` no slot descrito por `info`? */
  function piAvailability(def, p, info) {
    if (def.notBands && def.notBands.indexOf(info.band) >= 0) return { ok: false, reason: 'não disponível para ' + BAND_NAMES[info.band] };
    if (def.bands && def.bands.indexOf(info.band) < 0) return { ok: false, reason: 'só para ' + def.bands.map(function (b) { return BAND_NAMES[b]; }).join('/') };
    if (def.lanes && def.lanes.indexOf(info.lane) < 0) return { ok: false, reason: 'não disponível neste corredor' };
    if (def.sides && def.sides.indexOf(info.side) < 0) return { ok: false, reason: 'só para jogadores com lado definido (não central)' };
    if (def.excludeRoles && def.excludeRoles.indexOf(p.role) >= 0) return { ok: false, reason: 'já embutida na função' };
    return { ok: true };
  }

  /** Separa as PIs do jogador em aplicadas, ignoradas (indisponíveis/conflitantes) e desconhecidas. */
  function resolvePlayerInstructions(p, info, pis) {
    var applied = [], ignored = [], unknown = [];
    (p.instructions || []).forEach(function (k) {
      var def = pis[k];
      if (!def) { unknown.push(k); return; }
      var av = piAvailability(def, p, info);
      if (!av.ok) { ignored.push({ key: k, reason: av.reason }); return; }
      var clash = applied.filter(function (a) {
        return (def.excludes || []).indexOf(a) >= 0 || (pis[a].excludes || []).indexOf(k) >= 0;
      })[0];
      if (clash) { ignored.push({ key: k, reason: 'conflita com "' + pis[clash].label + '"' }); return; }
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

  // ---------- pipeline ----------

  /**
   * Calcula as posições de uma fase.
   * Ordem efetiva: base(slot) → fase da equipe → override/delta da função → efeitos
   *                → instruções de equipe (aplicadas como deslocamento sobre o resultado)
   *                → deltas da função → colisão → clamp.
   * As instruções vêm depois do override para que mentalidade/linha/largura
   * continuem valendo para jogadores com posição absoluta na regra.
   */
  function computePhase(players, phase, data, tiState) {
    var formations = data.formations, roles = data.roles, instructions = data.instructions;
    var ph = formations.phases[phase];
    if (!ph) throw new Error('Fase desconhecida: ' + phase);
    var eng = instructions.engine || {};
    var ti = resolveInstructions(instructions, tiState);
    var withBall = phase !== 'defendendo';
    var nums = numberPlayers(players, formations);
    var pis = (data.playerInstructions || {}).instructions || {};

    // 1. posição base + transformação de fase
    var list = players.map(function (p, i) {
      var info = slotInfo(formations, p.slot);
      return {
        index: i, num: nums[i], slot: p.slot, role: p.role, duty: p.duty,
        band: info.band, lane: info.lane, side: info.side,
        baseX: info.x, baseY: info.y,
        isCB: isCentreBack(formations, p.slot),
        bx: 50 + (info.x - 50) * ph.width,
        by: ph.y[info.band],
        dx: 0, dy: 0, inside: 0, outside: 0, latShift: 0, rule: null,
        instructions: resolvePlayerInstructions(p, info, pis).applied
      };
    });

    if (ph.cbSplit) {
      var dcs = centreBacks(list), xs = ph.cbSplit[String(dcs.length)];
      if (xs) dcs.forEach(function (d, k) { d.bx = xs[k]; });
    }

    // 2. regras de função + tarefa (x escrito para o lado esquerdo, espelhado à direita)
    var pending = [];
    list.forEach(function (p) {
      var rule = getRule(roles, p, phase, ti.flags);
      if (!rule) return;
      p.rule = rule;
      var mirror = p.side === 'R';
      if (rule.x != null && p.side !== 'C') p.bx = mirror ? 100 - rule.x : rule.x;
      if (rule.y != null) p.by = rule.y;
      if (rule.dx && p.side !== 'C') p.dx = mirror ? -rule.dx : rule.dx;
      if (rule.dy) p.dy = rule.dy;
      if (rule.inside && p.side !== 'C') p.inside = rule.inside === true ? (eng.insideDefault || 8) : rule.inside;
      if (rule.outside && p.side !== 'C') p.outside = rule.outside;
      (rule.effects || []).forEach(function (e) { pending.push({ name: e, source: p }); });
    });

    // 2b. instruções individuais: somam deltas por fase (dx espelhado; inside/outside relativos ao centro)
    list.forEach(function (p) {
      p.instructions.forEach(function (k) {
        var eff = pis[k].phases && pis[k].phases[phase];
        if (!eff) return;
        if (eff.dx && p.side !== 'C') p.dx += p.side === 'R' ? -eff.dx : eff.dx;
        if (eff.dy) p.dy += eff.dy;
        if (eff.inside && p.side !== 'C') p.inside += eff.inside;
        if (eff.outside && p.side !== 'C') p.outside += eff.outside;
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
      else if (withBall) p.tiDy = ti.mentalityDy;
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
      p.x = x; p.y = y;
    });

    // 5. colisão e clamp
    resolveCollisions(list, eng.collisionMinDist, eng.collisionIterations, eng.collisionAspect);
    var lo = (eng.clamp || [2, 98])[0], hi = (eng.clamp || [2, 98])[1];
    list.forEach(function (p) {
      p.x = Math.round(clamp(p.x, lo, hi) * 10) / 10;
      p.y = Math.round(clamp(p.y, lo, hi) * 10) / 10;
    });

    return { phase: phase, players: list, ball: ph.ball || null, warnings: warnings };
  }

  function computeAll(players, data, tiState) {
    var out = {};
    PHASES.forEach(function (ph) { out[ph] = computePhase(players, ph, data, tiState); });
    return out;
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
    validate: validate, resolveInstructions: resolveInstructions,
    piAvailability: piAvailability, resolvePlayerInstructions: resolvePlayerInstructions,
    computePhase: computePhase, computeAll: computeAll,
    resolveCollisions: resolveCollisions, clamp: clamp, registerEffect: registerEffect,
    overrideFromPosition: overrideFromPosition, applyOverride: applyOverride
  };
});
