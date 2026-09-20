// BODY presentation adapter. Every score comes from the canonical WireReader.
// Raw measurements stay raw; no direction, unit conversion or score is inferred.
(function (root) {
'use strict';

function reader() {
  if (!root.WireReader) throw new Error('The shared index reader could not load. Reload BODY.');
  return root.WireReader;
}

function decimalIdentity(value) {
  const match = String(value).trim().toLowerCase().match(/^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/);
  if (!match || !(match[2] || match[3])) return null;
  let digits = (match[2] + (match[3] || '')).replace(/^0+/, '');
  if (!digits) return '0';
  let exponent = Number(match[4] || 0) - (match[3] || '').length;
  while (digits.endsWith('0')) { digits = digits.slice(0, -1); exponent++; }
  return (match[1] === '-' ? '-' : '') + digits + 'e' + exponent;
}

function preciseNumber(value) {
  if (!['string', 'number'].includes(typeof value) || !Number.isFinite(Number(value))) return false;
  const identity = decimalIdentity(value);
  return identity !== null && identity === decimalIdentity(String(Number(value)));
}

function validRule(rule) {
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return false;
  if (!['up', 'down', 'band', 'ignore'].includes(rule.kind)) return false;
  return rule.kind !== 'band' || (typeof rule.lo === 'number' && typeof rule.hi === 'number' &&
    Number.isFinite(rule.lo) && Number.isFinite(rule.hi) && rule.lo <= rule.hi);
}

function groupedRows(rawRows) {
  const byMetric = new Map();
  for (const row of rawRows) {
    if (!row || typeof row.metric !== 'string' || !row.metric || row.value == null ||
        (row.event_type && row.event_type !== 'measurement')) continue;
    if (!byMetric.has(row.metric)) byMetric.set(row.metric, []);
    byMetric.get(row.metric).push(row);
  }
  return byMetric;
}

function evaluate({ day, rawRows = [], dayRows = [], rules = {}, starts = {}, voids = {} }) {
  const wire = reader();
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('The ledger day is unavailable.');
  const byMetric = groupedRows(rawRows), eligibleUnits = Object.create(null);
  const reasons = Object.create(null), details = Object.create(null), acceptedRules = Object.create(null);
  const members = [], ignoredMembers = [];

  for (const [metric, readings] of byMetric) {
    const units = new Set(readings.map(row => typeof row.unit === 'string' ? row.unit.trim() : ''));
    const unit = units.size === 1 && !units.has('') ? [...units][0] : null;
    const precise = readings.every(row => preciseNumber(row.value));
    if (unit && precise) eligibleUnits[metric] = unit;

    const rule = Object.hasOwn(rules, metric) ? rules[metric] : null;
    const ruleValid = validRule(rule);
    const unitMatches = !rule || !Object.hasOwn(rule, 'unit') ||
      (typeof rule.unit === 'string' && rule.unit.trim() === unit);
    if (ruleValid && rule.kind === 'ignore' && unitMatches) {
      ignoredMembers.push(metric);
      continue;
    }
    members.push(metric);
    if (!unit) { reasons[metric] = units.size > 1 ? 'Mixed units' : 'Unit missing'; continue; }
    if (!precise) { reasons[metric] = 'Reading exceeds index precision'; continue; }
    if (!rule) { reasons[metric] = 'Choose direction'; continue; }
    if (!ruleValid) { reasons[metric] = 'Direction needs review'; continue; }
    if (!unitMatches) { reasons[metric] = 'Rule unit differs'; continue; }
    const daily = dayRows.filter(row => row.metric === metric);
    if (daily.some(row => row.mean == null || !Number.isFinite(Number(row.mean)) ||
        typeof row.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.day))) {
      reasons[metric] = 'Daily reading unavailable'; continue;
    }
    acceptedRules[metric] = rule;
  }

  const series = Object.assign(Object.create(null), wire.rankSeries(dayRows, acceptedRules, voids, starts));
  for (const metric of members) {
    if (reasons[metric]) continue;
    const points = series[metric];
    if (!points?.length) { reasons[metric] = 'No eligible readings'; continue; }
    if (wire.indexState(points) === 'none') {
      const why = wire.noIndexWhy(points);
      details[metric] = why;
      reasons[metric] = /outgrown|no longer varies/.test(why) ? 'Baseline no longer fits' :
        points.start && points.baselineCount === 0 ? 'No readings since index start' : 'Baseline needs variation';
    } else if (!wire.indexOn(points, day)) reasons[metric] = 'No index on this day';
  }

  // Individual index gates apply. An available aggregate can legitimately have
  // only one scored date, so its own historical spread is not a second gate.
  const point = wire.availableSeries(series, members).find(row => row.day === day);
  const includedMembers = point?.included || [];
  const missingMembers = members.filter(metric => !includedMembers.includes(metric));
  const value = Number.isFinite(point?.rank) ? point.rank : null;
  const state = value === null ? 'none' : includedMembers.some(metric => wire.indexState(series[metric]) === 'moving') ? 'moving' : 'firm';
  const distinctReasons = [...new Set(missingMembers.map(metric => reasons[metric]).filter(Boolean))];
  const reason = value !== null ? (state === 'moving' ? 'Baseline forming' : missingMembers.length ? 'Some outcomes not scored' : '') :
    !members.length ? (ignoredMembers.length ? 'All measurements ignored' : 'Log a reading') :
    distinctReasons.length === 1 ? distinctReasons[0] : 'Not enough usable outcomes';

  return { value, day, state, included: includedMembers.length, total: members.length,
    members, includedMembers, missingMembers, ignoredMembers, rules, eligibleUnits, reasons, details, reason };
}

async function load(db, rawMeasurementRows, userId) {
  if (typeof userId !== 'string' || !userId.trim()) throw new Error('Sign in to read your index.');
  if (!Array.isArray(rawMeasurementRows)) throw new Error('The measurement history is unavailable.');
  const wire = reader();
  // RLS remains authoritative. The explicit owner filter also keeps each
  // exported reader scoped to the user whose BODY page requested the index.
  const scoped = {
    from(table) { return { select(...args) { return db.from(table).select(...args).eq('user_id', userId); } }; },
    rpc(...args) { return db.rpc(...args); }
  };
  const rawRows = rawMeasurementRows.filter(row => row && (!row.user_id || row.user_id === userId));
  const metrics = [...groupedRows(rawRows).keys()];
  const [day, rules, starts, voids, dayRows] = await Promise.all([
    wire.readDay(scoped), wire.readRules(scoped), wire.readStarts(scoped), wire.readVoids(scoped),
    metrics.length ? wire.readDays(scoped, metrics) : Promise.resolve([])
  ]);
  return evaluate({ day, rawRows, dayRows, rules, starts, voids });
}

root.BodyIndex = Object.freeze({ load, evaluate, validRule, preciseNumber });
})(window);
