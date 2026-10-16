import 'components/UnitInfoPopup.scss';
import popup from 'components/popup.js';
import unitDataMap from 'tactics/unitData.js';

const escape = value => String(value).replace(/[&<>"']/g, c => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}[c]));

const formatRange = range => {
  if (!range) return null;
  return range[0] === range[1] ? `${range[0]}` : `${range[0]}-${range[1]}`;
};

const formatModifier = mod => {
  if (!mod) return '';
  const rounded = Math.round(mod);
  const cls = rounded > 0 ? 'positive' : 'negative';
  const sign = rounded > 0 ? '+' : '';
  return ` <SPAN class="mod ${cls}">${sign}${rounded}</SPAN>`;
};

const formatPercentModifier = mod => {
  if (!mod) return '';
  const rounded = mod > 0 ? Math.floor(mod) : Math.ceil(mod);
  const cls = rounded > 0 ? 'positive' : 'negative';
  const sign = rounded > 0 ? '+' : '';
  return ` <SPAN class="mod ${cls}">${sign}${rounded}%</SPAN>`;
};

const row = (label, value) => value === null || value === undefined || value === ''
  ? ''
  : `<DIV class="row"><SPAN class="label">${label}</SPAN><SPAN class="value">${value}</SPAN></DIV>`;

const STATUS_FLAGS = [
  [ 'paralyzed', 'Paralyzed' ],
  [ 'poisoned',  'Poisoned'  ],
  [ 'focusing',  'Focusing'  ],
  [ 'barriered', 'Barriered' ],
  [ 'armored',   'Armored'   ],
];

function renderStatsPanel(unit) {
  const statuses = STATUS_FLAGS
    .filter(([ key ]) => unit[key])
    .map(([ , label ]) => `<LI>${label}</LI>`)
    .join('');

  const blockingValue = unit.blocking
    ? `${unit.blocking}%${formatPercentModifier(unit.mBlocking)}`
    : '—';

  const attackValue = unit.aType
    ? unit.aRange
      ? `${escape(unit.aType)} (range ${formatRange(unit.aRange)})`
      : escape(unit.aType)
    : '—';

  let moveValue;
  if (unit.mType === false || unit.mType === undefined || unit.mType === null)
    moveValue = 'None';
  else
    moveValue = `${escape(unit.mType)}${unit.mRadius ? ` (radius ${unit.mRadius})` : ''}`;

  const recoveryValue = unit.recovery !== undefined
    ? `${unit.mRecovery ?? 0} / ${unit.recovery}`
    : null;

  return `
    <DIV class="header">
      <DIV class="name${unit.tier ? ` tier${unit.tier}` : ''}">${escape(unit.name ?? unit.type ?? 'Unknown')}</DIV>
      ${unit.title ? `<DIV class="title">${escape(unit.title)}</DIV>` : ''}
    </DIV>
    <DIV class="stats">
      ${row('Type',     escape(unit.type ?? '—'))}
      ${row('Power',    `${unit.power ?? 0}${formatModifier(unit.mPower)}`)}
      ${row('Armor',    `${unit.armor ?? 0}${formatModifier(unit.mArmor)}`)}
      ${row('Blocking', blockingValue)}
      ${row('Recovery', recoveryValue)}
      ${row('Ability',  escape(unit.ability || 'None'))}
      ${unit.specialty ? row('Specialty', escape(unit.specialty)) : ''}
      ${row('Movement', moveValue)}
      ${row('Attack',   attackValue)}
      ${unit.aLOS  ? row('Targeting', 'Line of sight') : ''}
      ${unit.aAll  ? row('Targeting', 'All in range')  : ''}
      ${unit.aLinear ? row('Targeting', 'Linear')      : ''}
      ${unit.directional === false ? row('Facing', 'Omnidirectional') : ''}
    </DIV>
    ${statuses ? `<DIV class="statuses"><DIV class="label">Status</DIV><UL>${statuses}</UL></DIV>` : ''}
    ${unit.notice ? `<DIV class="notice">${escape(unit.notice)}</DIV>` : ''}
  `;
}

function getOpposingUnits(unit) {
  const board = unit.board;
  if (!board?.teamsUnits) return [];

  return board.teamsUnits
    .flat()
    .filter(u => u !== unit && u.assignment && u.team !== unit.team && u.disposition !== 'dead');
}

function dedupeOpponents(units) {
  const seen = new Map();
  for (const u of units) {
    const armored = u.armored && u.armored.length > 0 ? '1' : '0';
    const key = `${u.team?.id ?? '?'}|${u.type}|${armored}`;
    if (!seen.has(key)) seen.set(key, u);
  }
  return [ ...seen.values() ];
}

function formatDamageOutcome(calc) {
  if (calc.effect)
    return { text:`Effect: ${escape(calc.effect)}`, cls:'effect' };

  if (calc.miss === 'immune')
    return { text:'Immune', cls:'immune' };

  const damage = calc.damage ?? 0;
  const chance = calc.chance ?? 0;

  if (damage < 0)
    return { text:`Heal ${-damage}`, cls:'heal' };

  if (chance === 0) {
    if (calc.miss === 'block')
      return { text:`${damage} dmg • Blocked`, cls:'blocked' };
    return { text:`${damage} dmg`, cls:'blocked' };
  }

  const cls = chance === 100 ? 'damage' : 'damage chance';
  return { text:`${damage} dmg`, cls };
}

const SPECIAL_ATTACKS = {
  // Assassin: {
  //   label: 'Multi-Strike',
  //   minRange: 0,
  //   maxRange: 1,
  //   statsFor: () => ({ power:99, aType:'magic', aLOS:false, aPierce:true }),
  // },
  MudGolem: {
    label: 'Quake',
    minRange: 1,
    maxRange: 3,
    statsFor: (unit, distance) => ({
      power: Math.max(0, (unit.power ?? 0) - distance * 5),
      aType: 'magic',
      aLOS: false,
      aPierce: false,
    }),
  },
};

function renderRowFor(unit, target, stats) {
  let calc;
  try {
    calc = unit.calcAttack(target, unit.assignment, target.assignment, stats);
  } catch (err) {
    calc = { damage:0, chance:0, miss:'miss' };
  }
  const outcome = formatDamageOutcome(calc);
  const color = target.team?.colorId ? ` data-color-id="${escape(target.team.colorId)}"` : '';
  const name = target.name ?? target.type;
  const title = target.team?.colorId ? `${name} (${target.team.colorId})` : name;
  return {
    damage: calc.damage ?? 0,
    html: `
      <DIV class="damageRow">
        <SPAN class="comboUnit" data-unit-type="${escape(target.type)}"${color} title="${escape(title)}"><SPAN class="comboUnitIcon"></SPAN></SPAN>
        <SPAN class="outcome ${outcome.cls}">${outcome.text}</SPAN>
      </DIV>
    `,
  };
}

function renderSection(unit, targets, statsFor, label) {
  if (targets.length === 0) return '';
  const rows = targets
    .map(target => {
      const distance = unit.board.getDistance(unit.assignment, target.assignment);
      return renderRowFor(unit, target, statsFor(unit, distance));
    })
    .sort((a, b) => b.damage - a.damage)
    .map(r => r.html)
    .join('');

  return `
    <DIV class="damageList">
      <DIV class="damageHeader">
        <SPAN class="targetName">${escape(label)}</SPAN>
        <SPAN class="outcome">Outcome</SPAN>
      </DIV>
      ${rows}
    </DIV>
  `;
}

const ATTACK_TYPE_LABELS = { melee:'Melee', magic:'Magic', heal:'Heal' };
const attackTypeLabel = aType => ATTACK_TYPE_LABELS[aType] ?? (aType ? `${aType[0].toUpperCase()}${aType.slice(1)}` : 'Attack');

// Renders one row per target with a damage column for each provided attack
// (e.g. the MudGolem's melee plus its Quake at distances 1-3). Each column is
// { label, stats } where stats is passed to calcAttack.
function renderMultiSection(unit, targets, columns) {
  if (targets.length === 0 || columns.length === 0) return '';

  const headerCells = columns.map(c => `<SPAN class="outcome">${escape(c.label)}</SPAN>`).join('');

  const rows = targets
    .map(target => {
      const color = target.team?.colorId ? ` data-color-id="${escape(target.team.colorId)}"` : '';
      const name = target.name ?? target.type;
      const title = target.team?.colorId ? `${name} (${target.team.colorId})` : name;

      const cells = columns.map(c => {
        let calc;
        try {
          calc = unit.calcAttack(target, unit.assignment, target.assignment, c.stats);
        } catch (err) {
          calc = { damage:0, chance:0, miss:'miss' };
        }
        const outcome = formatDamageOutcome(calc);
        return { damage: calc.damage ?? 0, html: `<SPAN class="outcome ${outcome.cls}">${outcome.text}</SPAN>` };
      });

      return {
        damage: cells[0].damage,
        html: `
          <DIV class="damageRow">
            <SPAN class="comboUnit" data-unit-type="${escape(target.type)}"${color} title="${escape(title)}"><SPAN class="comboUnitIcon"></SPAN></SPAN>
            ${cells.map(c => c.html).join('')}
          </DIV>
        `,
      };
    })
    .sort((a, b) => b.damage - a.damage)
    .map(r => r.html)
    .join('');

  return `
    <DIV class="damageList multi" style="--damage-cols:${columns.length}">
      <DIV class="damageHeader">
        <SPAN class="targetName">Target</SPAN>
        ${headerCells}
      </DIV>
      ${rows}
    </DIV>
  `;
}

// Effect attacks (poison, paralyze, etc.) deal no immediate damage, so the combat
// engine reports no damage for them. The kill-combo calculator estimates a damage
// value for the ones that eventually cost the target HP (e.g. poison over time).
const EFFECT_DAMAGE = { poison: 8 };

function damageFromStats(opponent, unit, stats) {
  let calc;
  try {
    calc = opponent.calcAttack(unit, opponent.assignment, unit.assignment, stats);
  } catch (err) {
    return 0;
  }

  if (calc.miss === 'immune') return 0;
  if (calc.effect) return EFFECT_DAMAGE[calc.effect] ?? 0;
  return calc.damage ?? 0;
}

function attackerDamageTo(opponent, unit) {
  return damageFromStats(opponent, unit, {
    power: Math.max(0, (opponent.power ?? 0) + (opponent.mPower ?? 0)),
    aType: opponent.aType,
    aLOS: false,        // assume positioned for line of sight
    aPierce: false,
  });
}

// An opponent's special attack (e.g. the MudGolem's Quake) is offered at every
// range it covers, regardless of the unit's current position. Each range is its
// own option, since the damage falls off with distance.
function specialOptionsFor(opponent, unit) {
  const special = SPECIAL_ATTACKS[opponent.type];
  if (!special) return [];
  if (typeof opponent.canSpecial === 'function' && !opponent.canSpecial()) return [];

  const options = [];
  for (let distance = special.minRange; distance <= special.maxRange; distance++) {
    const damage = damageFromStats(opponent, unit, special.statsFor(opponent, distance));
    if (damage > 0)
      options.push({ label: `${special.label} ${distance}`, damage });
  }
  return options;
}

const COLLECT_CAP = 5000;   // safety bound on how many combos we enumerate
const PER_TIER_CAP = 150;   // how many (best, after sorting) we show per tier
const MAX_STEPS = 500000;

// Combos are sorted into tiers (1 = highest priority); each combo is shown only
// in its highest qualifying tier.
//   Tier 1: kills the unit before it recovers and acts again (limited by its
//           current recovery and each attacker's own recovery).
//   Tier 2: kills using only distinct units (no unit attacks twice).
//   Tier 3: kills that reuse a unit (a duplicate attacker).
const TIER_BEFORE_RECOVERY = 1;
const TIER_UNIQUE = 2;
const TIER_DUPLICATE = 3;

function computeKillCombos(unit, extraHp = 0) {
  // extraHp lets the caller account for a heal (e.g. an allied Cleric topping the
  // target up), which raises the damage needed to kill it.
  const hp = (unit.health ?? 0) + (unit.mHealth ?? 0) + extraHp;
  if (hp <= 0) return { combos: [], truncated: false, attackWindow: 0 };

  // Attacks the opponents can land before the selected unit recovers and acts
  // again: its remaining recovery plus the turn on which it would recover.
  const attackWindow = (unit.mRecovery ?? 0) + 1;

  // Group opposing attack options by type-and-variant, with the best-case damage
  // each one inflicts on the selected unit. A unit's special attack (e.g. the
  // MudGolem's Quake) is a separate option alongside its base attack. We also
  // track, per type, how many board units exist (for the unique/duplicate split)
  // and how many times one of them could attack within the recovery window.
  const groupMap = new Map();
  const typeInfo = new Map();
  const addOption = (opponent, label, damage, flags = null) => {
    if (damage <= 0) return false;

    const key = `${opponent.type}|${label ?? ''}`;
    const group = groupMap.get(key);
    if (group) {
      if (damage > group.damage) group.damage = damage;
    } else {
      groupMap.set(key, {
        type: opponent.type,
        name: opponent.name ?? opponent.type,
        colorId: opponent.team?.colorId ?? null,
        label: label ?? null,
        damage,
        // Poison (and other counted effects) can't land the killing blow — it
        // only brings HP down to 1 — and doesn't stack, so it's capped at one use.
        nonLethal: flags?.nonLethal ?? false,
        maxUses: flags?.maxUses ?? Infinity,
      });
    }
    return true;
  };

  for (const opponent of getOpposingUnits(unit)) {
    const baseIsEffect = EFFECT_DAMAGE[opponent.aType] !== undefined;
    let contributed = addOption(opponent, null, attackerDamageTo(opponent, unit),
      baseIsEffect ? { nonLethal: true, maxUses: 1 } : null);

    for (const option of specialOptionsFor(opponent, unit))
      contributed = addOption(opponent, option.label, option.damage) || contributed;

    if (!contributed) continue;

    const info = typeInfo.get(opponent.type);
    if (info)
      info.instances += 1;
    else
      typeInfo.set(opponent.type, {
        instances: 1,
        // Times a single unit of this type can attack within the window.
        perUnitAttacks: Math.max(1, Math.ceil(attackWindow / ((opponent.recovery ?? 0) + 1))),
      });
  }

  const groups = [ ...groupMap.values() ].sort((a, b) => b.damage - a.damage);

  const combos = [];
  const seen = new Set();
  let truncated = false;
  let steps = 0;

  // DFS over the types, choosing how many times each one attacks. We only record
  // a combo the moment its running total first reaches HP, so the last unit added
  // is always necessary — the combo is "minimal" (no redundant attacker) by
  // construction. Once HP is reached we stop adding units (any extra would be
  // redundant), so supersets are never produced.
  const counts = new Array(groups.length).fill(0);

  const record = (total, unitCount) => {
    const key = counts.map((c, i) => c ? `${i}:${c}` : '').filter(Boolean).join('|');
    if (seen.has(key)) return;
    seen.add(key);

    if (combos.length >= COLLECT_CAP) {
      truncated = true;
      return;
    }

    const units = [];
    const usesByType = new Map();
    let hasLethal = false;
    for (let i = 0; i < groups.length; i++) {
      if (!counts[i]) continue;
      if (!groups[i].nonLethal) hasLethal = true;
      usesByType.set(groups[i].type, (usesByType.get(groups[i].type) ?? 0) + counts[i]);
      for (let c = 0; c < counts[i]; c++)
        units.push({
          type: groups[i].type,
          name: groups[i].name,
          colorId: groups[i].colorId,
          label: groups[i].label,
        });
    }

    // A combo made up only of non-lethal attacks (e.g. the wisp alone) can't
    // actually kill — it just brings HP to 1 — so drop it.
    if (!hasLethal) return;

    // Classify into the highest tier this combo qualifies for. A unit attacks
    // once per turn, so total attacks can't exceed the window; and a single unit
    // can't attack more than its own recovery allows.
    let beforeRecovery = unitCount <= attackWindow;
    let unique = true;
    for (const [ type, uses ] of usesByType) {
      const info = typeInfo.get(type);
      const instances = info?.instances ?? 1;
      const perUnitAttacks = info?.perUnitAttacks ?? 1;
      if (uses > instances) unique = false;
      if (uses > instances * perUnitAttacks) beforeRecovery = false;
    }
    const tier = beforeRecovery ? TIER_BEFORE_RECOVERY : unique ? TIER_UNIQUE : TIER_DUPLICATE;

    combos.push({ units, total, unitCount, tier });
  };

  const dfs = (index, runningTotal, runningCount) => {
    if (truncated) return;
    if (++steps > MAX_STEPS) { truncated = true; return; }
    if (index === groups.length) return;

    const damage = groups[index].damage;
    const maxCount = Math.min(Math.ceil((hp - runningTotal) / damage), groups[index].maxUses);
    for (let c = 0; c <= maxCount; c++) {
      if (truncated) return;
      counts[index] = c;
      const newTotal = runningTotal + c * damage;
      if (newTotal >= hp) {
        // This many of the current type reaches HP; remaining types add nothing.
        for (let j = index + 1; j < groups.length; j++) counts[j] = 0;
        record(newTotal, runningCount + c);
        counts[index] = 0;
        break; // more of this type would be redundant (non-minimal)
      }
      dfs(index + 1, newTotal, runningCount + c);
    }
    counts[index] = 0;
  };
  dfs(0, 0, 0);

  const comboName = combo => combo.units.map(u => u.label ? `${u.name} (${u.label})` : u.name).join();
  combos.sort((a, b) =>
    a.tier - b.tier ||
    a.unitCount - b.unitCount ||
    b.total - a.total ||
    comboName(a).localeCompare(comboName(b))
  );

  // Cap *after* sorting, and per tier, so each tier keeps its best combos
  // (fewest units, most damage) instead of an arbitrary slice of enumeration.
  const tierCounts = new Map();
  const shown = [];
  let overflow = false;
  for (const combo of combos) {
    const n = tierCounts.get(combo.tier) ?? 0;
    if (n >= PER_TIER_CAP) { overflow = true; continue; }
    tierCounts.set(combo.tier, n + 1);
    shown.push(combo);
  }

  return { combos: shown, truncated: truncated || overflow, attackWindow };
}

// The heal an allied Cleric could restore on this unit (best current heal power
// among allied healers, falling back to a standard Cleric's heal).
function getClericHeal(unit) {
  const board = unit.board;
  let best = 0;
  if (board?.teamsUnits) {
    for (const u of board.teamsUnits.flat()) {
      if (u === unit || !u.assignment || u.disposition === 'dead') continue;
      if (u.team !== unit.team || u.aType !== 'heal') continue;
      best = Math.max(best, (u.power ?? 0) + (u.mPower ?? 0));
    }
  }
  return best || (unitDataMap.get('Cleric')?.power ?? 12);
}

function renderComboRow(combo, index) {
  const units = combo.units.map(u => {
    const color = u.colorId ? ` data-color-id="${escape(u.colorId)}"` : '';
    const title = u.label ? `${u.name} (${u.label})` : u.name;
    const tag = u.label ? `<SPAN class="comboUnitTag">${escape(u.label)}</SPAN>` : '';
    return `<SPAN class="comboUnit" data-unit-type="${escape(u.type)}"${color} title="${escape(title)}"><SPAN class="comboUnitIcon"></SPAN>${tag}</SPAN>`;
  }).join('<SPAN class="comboPlus">+</SPAN>');
  return `
    <DIV class="comboRow">
      <SPAN class="comboLabel">Combo ${index + 1}</SPAN>
      <SPAN class="comboUnits">${units}</SPAN>
      <SPAN class="comboDamage">${combo.total} dmg</SPAN>
    </DIV>
  `;
}

// The part of the kill-combos panel that changes with the heal toggle: the HP
// line and the tiered combo list.
function renderKillCombosBody(unit, extraHp) {
  const base = (unit.health ?? 0) + (unit.mHealth ?? 0);
  const maxHp = unit.health ?? 0;
  const hp = base + extraHp;
  const { combos, truncated, attackWindow } = computeKillCombos(unit, extraHp);

  const meta = `<DIV class="comboMeta">Current HP: ${base}/${maxHp}${extraHp ? ` <SPAN class="healNote">+${extraHp} heal → ${hp}</SPAN>` : ''}</DIV>`;

  if (combos.length === 0)
    return `${meta}<DIV class="empty">No combination of opponents can kill this unit${extraHp ? ' through the heal' : ''}.</DIV>`;

  const tierLabels = {
    [TIER_BEFORE_RECOVERY]: `Tier 1 · Kills before it recovers${attackWindow > 1 ? ` (≤${attackWindow} attacks)` : ''}`,
    [TIER_UNIQUE]: 'Tier 2 · Unique units',
    [TIER_DUPLICATE]: 'Tier 3 · Reusing a unit',
  };

  const sections = [ TIER_BEFORE_RECOVERY, TIER_UNIQUE, TIER_DUPLICATE ].map(tier => {
    const tierCombos = combos.filter(c => c.tier === tier);
    if (tierCombos.length === 0) return '';
    const rows = tierCombos.map((combo, index) => renderComboRow(combo, index)).join('');
    return `<DIV class="comboTier">${escape(tierLabels[tier])}</DIV>${rows}`;
  }).join('');

  return `
    ${meta}
    <DIV class="comboRows">
      ${sections}
      ${truncated ? `<DIV class="comboMeta">…and more combos not shown</DIV>` : ''}
    </DIV>
  `;
}

function renderKillCombosPanel(unit) {
  if (!unit.assignment)
    return `<DIV class="empty">This unit is not on the board.</DIV>`;

  const heal = getClericHeal(unit);

  return `
    <DIV class="comboList">
      <DIV class="comboControls">
        <LABEL class="comboToggle">
          <INPUT type="checkbox" class="clericHealToggle" data-heal="${heal}">
          Include Cleric heal (+${heal})
        </LABEL>
      </DIV>
      <DIV class="comboBody">${renderKillCombosBody(unit, 0)}</DIV>
    </DIV>
  `;
}

function renderDamagePanel(unit) {
  if (!unit.assignment)
    return `<DIV class="empty">This unit is not on the board.</DIV>`;

  const allOpposing = getOpposingUnits(unit);
  const baseStats = unit.aType ? {
    power: Math.max(0, (unit.power ?? 0) + (unit.mPower ?? 0)),
    aType: unit.aType,
    aLOS: unit.aLOS,
    aPierce: false,
  } : null;

  const special = SPECIAL_ATTACKS[unit.type];

  // When the unit has a special attack, show one combined table: a column for
  // the base attack plus a column for the special at each of its ranges (the
  // Quake's damage at distances 1-3), regardless of who is currently in range.
  if (special) {
    const columns = [];
    if (baseStats)
      columns.push({ label: attackTypeLabel(unit.aType), stats: baseStats });
    for (let d = special.minRange; d <= special.maxRange; d++)
      columns.push({ label: `${special.label} ${d}`, stats: special.statsFor(unit, d) });

    const html = renderMultiSection(unit, dedupeOpponents(allOpposing), columns);
    return html || `<DIV class="empty">No opposing units to target.</DIV>`;
  }

  const html = baseStats
    ? renderSection(unit, dedupeOpponents(allOpposing), () => baseStats, 'Target')
    : '';
  if (!html)
    return `<DIV class="empty">No opposing units to target.</DIV>`;

  return html;
}

// Replace the .comboUnit placeholders within a container with rendered avatars.
function injectComboAvatars(container) {
  container.querySelectorAll('.comboUnit').forEach(slot => {
    const iconBox = slot.querySelector('.comboUnitIcon');
    if (!iconBox || iconBox.firstChild) return;

    const avatar = { unitType: slot.dataset.unitType };
    if (slot.dataset.colorId) avatar.colorId = slot.dataset.colorId;

    let img;
    try {
      img = window.Tactics?.getAvatarImage(avatar, { withFocus:false });
    } catch (err) {
      img = null;
    }
    if (!img) return;

    const inner = document.createElement('DIV');
    inner.className = 'comboUnitInner';
    inner.appendChild(img);
    iconBox.appendChild(inner);
  });
}

export default function showUnitInfoPopup(unit) {
  if (!unit) return null;

  const canDealDamage = !!unit.aType && (unit.power ?? 0) + (unit.mPower ?? 0) > 0;
  const canShowKillCombos = !!unit.assignment && getOpposingUnits(unit).length > 0;
  const showTabs = canDealDamage || canShowKillCombos;

  const message = `
    <DIV class="unitInfo">
      ${showTabs ? `
        <DIV class="tabBar" role="tablist">
          <BUTTON type="button" class="tab active" data-panel="stats">Stats</BUTTON>
          ${canDealDamage ? `<BUTTON type="button" class="tab" data-panel="damage">Damage</BUTTON>` : ''}
          ${canShowKillCombos ? `<BUTTON type="button" class="tab" data-panel="killCombos">Kill Combos</BUTTON>` : ''}
        </DIV>
      ` : ''}
      <DIV class="tabPanel active" data-panel="stats">${renderStatsPanel(unit)}</DIV>
      ${canDealDamage ? `<DIV class="tabPanel" data-panel="damage">${renderDamagePanel(unit)}</DIV>` : ''}
      ${canShowKillCombos ? `<DIV class="tabPanel" data-panel="killCombos">${renderKillCombosPanel(unit)}</DIV>` : ''}
    </DIV>
  `;

  const popupInstance = popup({
    title: 'Unit Info',
    message,
    className: 'unitInfoPopup',
    maxWidth: '420px',
    buttons: [{ label:'Close' }],
  });

  const root = popupInstance.root;
  if (root) {
    const tabs = root.querySelectorAll('.unitInfo .tab');
    const panels = root.querySelectorAll('.unitInfo .tabPanel');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.panel;
        tabs.forEach(t => t.classList.toggle('active', t === tab));
        panels.forEach(p => p.classList.toggle('active', p.dataset.panel === target));
      });
    });

    // Replace the kill-combo/damage unit placeholders with rendered avatars.
    injectComboAvatars(root);

    // The Cleric-heal toggle re-renders the combo list with the extra HP.
    const toggle = root.querySelector('.unitInfo .clericHealToggle');
    const body = root.querySelector('.unitInfo .comboBody');
    if (toggle && body) {
      toggle.addEventListener('change', () => {
        const extraHp = toggle.checked ? (Number(toggle.dataset.heal) || 0) : 0;
        body.innerHTML = renderKillCombosBody(unit, extraHp);
        injectComboAvatars(body);
      });
    }
  }

  return popupInstance;
}
