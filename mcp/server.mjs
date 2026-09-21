// BODY over MCP. Claude reads your readings, and writes only the one you gave it.
//
// Four tools, and one door beside them: api/photo.mjs takes a photo from the
// phone and writes its progress_photo row through the same sign-in.
// record writes one events row for any metric the user names, exactly as the
// page would, signed source 'claude'. list names every metric already in the
// record, so a new name is never made where an old one will do. estimate writes a guess Claude read off a photo the user
// sent, signed source 'photo', under a name ending _est, so an estimate and a
// measurement can never be taken for one another. history reads one metric
// back. There is no update and no delete. It signs in as you with the publishable key, so the same row level
// security that protects the page protects this.
//
// This file is the server and both tools, defined once. api/mcp.mjs serves it
// over HTTP on Vercel; dev.js serves it locally.

import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { supabaseUrl, publishableKey, isPublishable, login, missing } from './env.mjs';

export const SOURCE = 'claude';
export const VERSION = '1.3.0';

// The ways one number reaches the record, and the whole of the difference
// between them. A number the user gave is a measurement, signed claude. A
// number Claude read off a picture is an estimate: signed photo, never claude,
// its name ending _est, and carrying the model that read it. Neither ever
// takes the other's name or source: the table has no delete, so a series that
// mixed the two could never be untangled again.
export const WRITERS = {
  record: { source: 'claude', name: m => /_est$/.test(m) ? 'a name ending _est is an estimate\'s; a number the user gave is a measurement and goes under its own name' : null },
  estimate: { source: 'photo', name: m => /_est$/.test(m) ? null : 'an estimate\'s name must end _est, so it can never be taken for something measured' }
};

// The estimates a photo can yield, each with the one unit it is written in and
// the values that can be read at all. Nothing else goes through estimate.
export const ESTIMATES = {
  bodyfat_est: { unit: 'percent', check: v => v > 0 && v < 100 ? null : 'bodyfat_est is a percent between 0 and 100' },
  muscle_est: { unit: '1-10', check: v => Number.isInteger(v) && v >= 1 && v <= 10 ? null : 'muscle_est is a whole number rating from 1 to 10' }
};

// The same rules the page applies in readingDraft() and readingTime() in index.html.
const NUMBER = /^[+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const WEIGHT_UNITS = ['kg', 'lbs'];
const FUTURE_SLACK = 60000;
const CONTEXT = { area: 'body', schema_version: 1 };
// Where a reading shows. body is the BODY page, gym the GYM page; a metric with neither is in the
// record, in history and in list, and on no page's graph. Weight is always body. reps, for a lift,
// is kept beside the value in context and shown under each reading on the GYM page.
export const AREAS = ['body', 'gym'];
export const contextFor = (metric, area, reps) => {
  const where = metric === 'weight' ? 'body' : area || null;
  return { ...(where ? { area: where } : {}), ...(reps != null ? { reps } : {}), schema_version: 1 };
};
const PAGE = 1000;

// The page's name rule: lower case, anything else an underscore.
export const slug = s => String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

// The row as the page would write it, or why nothing can be written. Asking
// this writes nothing. value is kept as the text the user gave, so 158.0 stays
// 158.0 in the numeric column, as it does from the page's input field.
export function draftRow({ metric, value, unit, occurred_at, area, reps }, now = Date.now(), writer = WRITERS.record) {
  const m = slug(metric);
  if (!m) return { error: 'metric is empty' };
  if (area != null && area !== '' && !AREAS.includes(area)) return { error: `area is ${AREAS.join(' or ')}, or left out` };
  if (reps != null && !(Number.isInteger(reps) && reps > 0)) return { error: 'reps is a whole number greater than zero, exactly as the user said, or left out' };
  const badName = writer.name(m);
  if (badName) return { error: badName };
  const text = typeof value === 'number' ? String(value) : String(value ?? '').trim();
  if (!NUMBER.test(text) || !Number.isFinite(Number(text)) || Number(text) <= 0) return { error: 'value must be a number greater than zero, exactly as the user gave it' };
  const u = String(unit ?? '').trim();
  if (m === 'weight' && !WEIGHT_UNITS.includes(u)) return { error: 'weight takes unit kg or lbs, chosen by the user' };
  if (!u) return { error: 'unit is empty; the user chooses the unit' };
  const t = Date.parse(String(occurred_at ?? ''));
  if (!Number.isFinite(t)) return { error: 'occurred_at must be an ISO 8601 timestamp with its zone, the time the user measured' };
  if (t > now + FUTURE_SLACK) return { error: 'occurred_at is in the future; use the time this happened' };
  return { row: { metric: m, value: text, unit: u, occurred_at: new Date(t).toISOString() }, context: contextFor(m, area || undefined, reps ?? undefined) };
}

// The estimate rows as they would land, or why nothing can be written. Each
// takes the unit its name fixes, so a percent is never written as a rating.
export function draftEstimates({ rows, occurred_at, model }, now = Date.now()) {
  if (!Array.isArray(rows) || !rows.length) return { error: 'no rows' };
  const out = [], seen = new Set();
  for (const r of rows) {
    const m = slug(r.metric);
    const known = ESTIMATES[m];
    if (!known) return { error: `${m || 'an empty name'} is not an estimate this tool writes; it writes ${Object.keys(ESTIMATES).join(' and ')}` };
    if (typeof r.value !== 'number' || !Number.isFinite(r.value)) return { error: `${m}: the value is not a number` };
    const bad = known.check(r.value);
    if (bad) return { error: bad };
    if (seen.has(m)) return { error: `${m} appears twice; one guess per photo` };
    seen.add(m);
    const drafted = draftRow({ metric: m, value: r.value, unit: known.unit, occurred_at }, now, WRITERS.estimate);
    if (drafted.error) return { error: drafted.error };
    out.push(drafted.row);
  }
  const who = String(model ?? '').trim();
  if (!who) return { error: 'model is empty: name the model that read the photo' };
  return { rows: out, context: { ...CONTEXT, estimate: true, model: who } };
}

// One save, one source_id: the same row asked twice, by a retry after an
// uncertain network answer, lands once under the events_once index. A different
// value, unit or time is a different reading and gets its own id.
export const sourceIdOf = row => createHash('sha256')
  .update([row.metric, row.value, row.unit, row.occurred_at].join('\n')).digest('hex').slice(0, 32);

// Sign in on the first question, not at startup. A failed sign in is not kept,
// so the next question tries again. A kept session is dropped after a while,
// so a warm function never presents a token that has run out.
let db = null, authed = null, since = 0;
const KEEP = 30 * 60000;
async function signIn() {
  const gone = missing();
  if (gone.length) throw new Error('set ' + gone.join(', ') + ' in Vercel, then redeploy BODY');
  if (!db) {
    if (!isPublishable(publishableKey())) throw new Error('SUPABASE_PUBLISHABLE_KEY is not a publishable key');
    db = createClient(supabaseUrl(), publishableKey(), { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  }
  if (authed && Date.now() - since > KEEP) authed = null;
  authed = authed || db.auth.signInWithPassword(login()).then(({ data, error }) => {
    if (error || !data?.user?.id) { authed = null; throw new Error('sign in failed: ' + (error ? error.message : 'no user')); }
    since = Date.now();
    return data.user.id;
  });
  return { db, who: await authed };
}

// The signed in client and the user's id, for a door that is not a tool:
// /api/photo writes a file and a row through the same session the tools write
// through. Signing in lives here once, so no door invents a second way to hold
// the password.
export const signedIn = () => signIn();

const text = o => ({ content: [{ type: 'text', text: JSON.stringify(o, null, 2) }] });
const fail = o => ({ ...text(o), isError: true });

// Every page of a query in a stable order. A failed page is an error, never a
// shorter history.
async function readAll(query) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query().range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...data);
    if (data.length < PAGE) return out;
  }
}

const COLUMNS = 'id,metric,value::text,unit,occurred_at,recorded_at,source,context';

// One row into events, as the page writes it. A row already there, from a
// retry of this exact row, is read back and never written again.
async function insertOne(db, who, drafted, writer, context) {
  const row = { ...drafted, user_id: who, source: writer.source, source_id: sourceIdOf(drafted), event_type: 'measurement', context };
  const { data, error } = await db.from('events').insert(row).select(COLUMNS).single();
  if (!error) return { written: data };
  if (error.code !== '23505') return { error: error.message };
  const { data: saved, error: readError } = await db.from('events').select(COLUMNS)
    .eq('user_id', who).eq('source', writer.source).eq('source_id', row.source_id).eq('metric', row.metric).maybeSingle();
  if (readError || !saved) return { error: readError ? readError.message : error.message };
  return { already_saved: saved };
}

export async function writeReading(input) {
  const drafted = draftRow(input);
  if (drafted.error) return { error: 'nothing written: ' + drafted.error };
  const { db, who } = await signIn();
  const out = await insertOne(db, who, drafted.row, WRITERS.record, drafted.context);
  if (out.error) return { error: 'nothing written: ' + out.error };
  return out.already_saved ? { ...out, say: 'this exact reading was already in your record; nothing new was written' } : out;
}

// Each estimate row goes in on its own, so one already there never stops the
// others, and the answer names every row written, already saved, or refused.
export async function writeEstimates(input) {
  const drafted = draftEstimates(input);
  if (drafted.error) return { error: 'nothing written: ' + drafted.error };
  const { db, who } = await signIn();
  const written = [], already_saved = [];
  for (const row of drafted.rows) {
    const out = await insertOne(db, who, row, WRITERS.estimate, drafted.context);
    if (out.error) return { error: out.error, written, already_saved };
    (out.written ? written : already_saved).push(out.written || out.already_saved);
  }
  return { estimate: true, written, already_saved,
    say: 'these are guesses read from a photo, not measurements; say so whenever you show them' };
}

export async function readHistory(metric, days) {
  const m = slug(metric);
  if (!m) return { error: 'metric is empty' };
  if (!Number.isFinite(days) || days <= 0) return { error: 'days must be a number greater than zero' };
  const { db, who } = await signIn();
  const from = new Date(Date.now() - days * 86400000).toISOString();
  const rows = await readAll(() => db.from('events').select('id,metric,value::text,unit,occurred_at,recorded_at,source,context')
    .eq('user_id', who).eq('event_type', 'measurement').eq('metric', m).gte('occurred_at', from)
    .order('occurred_at', { ascending: true }).order('id', { ascending: true }));
  // every recorded value of the metric; the BODY page shows only weight and area body, and says so here
  const readings = rows.filter(r => r.value !== null)
    .map(({ id, value, unit, occurred_at, recorded_at, source, context }) => ({ id, value, unit, ...(context?.reps != null ? { reps: context.reps } : {}), occurred_at, recorded_at, source }));
  const units = [...new Set(readings.map(r => r.unit))];
  const areas = [...new Set(rows.map(r => r.context?.area).filter(Boolean))];
  const estimate = /_est$/.test(m);
  return { metric: m, days, since: from, readings: readings.length, units, ...(areas.length ? { area: areas.length === 1 ? areas[0] : areas } : {}),
    on_body_page: m === 'weight' || areas.includes('body'), on_gym_page: areas.includes('gym'), rows: readings,
    ...(estimate ? { estimate: true, note: 'these are guesses read from photos, not measurements; say so whenever you show them' } : {}),
    ...(units.length > 1 ? { note: 'readings in different units are separate series, as on the page; they are not converted' } : {}) };
}

// Every metric in the record, once each: its units, how many readings, the latest one, and where
// it shows. Read before a new name is made, so an old name is reused instead. Latest is by when
// it was measured, then by when it was saved, as the page orders a series.
export async function listMetrics() {
  const { db, who } = await signIn();
  const rows = await readAll(() => db.from('events').select('id,metric,value::text,unit,occurred_at,recorded_at,source,context')
    .eq('user_id', who).eq('event_type', 'measurement').not('value', 'is', null)
    .order('occurred_at', { ascending: true }).order('recorded_at', { ascending: true }).order('id', { ascending: true }));
  const by = new Map();
  for (const r of rows) {
    const m = by.get(r.metric) || { metric: r.metric, units: [], readings: 0, sources: [], areas: [], latest: null };
    m.readings++;
    if (!m.units.includes(r.unit)) m.units.push(r.unit);
    if (!m.sources.includes(r.source)) m.sources.push(r.source);
    const area = r.context?.area; if (area && !m.areas.includes(area)) m.areas.push(area);
    m.latest = { value: r.value, unit: r.unit, ...(r.context?.reps != null ? { reps: r.context.reps } : {}), occurred_at: r.occurred_at, source: r.source };
    by.set(r.metric, m);
  }
  const metrics = [...by.values()].sort((a, b) => a.metric.localeCompare(b.metric)).map(m => ({
    metric: m.metric, unit: m.units.length === 1 ? m.units[0] : m.units, readings: m.readings, latest: m.latest, sources: m.sources,
    ...(m.areas.length ? { area: m.areas.length === 1 ? m.areas[0] : m.areas } : {}),
    on_body_page: m.metric === 'weight' || m.areas.includes('body'), on_gym_page: m.areas.includes('gym'),
    ...(/_est$/.test(m.metric) ? { estimate: true } : {})
  }));
  return { metrics: metrics.length, rows: metrics,
    say: metrics.length ? 'reuse one of these names and its unit for anything it already carries; a new metric is a cost, not a free addition'
                        : 'nothing recorded yet' };
}

export function bodyServer() {
  const server = new McpServer({ name: 'body', version: VERSION }, {
    instructions:
      'BODY is a personal record of measured readings, and it is append only: a row can be added, never ' +
      'edited and never removed. Transcribe only: write a number exactly as the user gave it, never ' +
      'estimate, round, convert, fill or infer one, and never read one off a photo. If a value, unit or time ' +
      'is missing, ask for it; silence over a guess. Before any write, call record without confirmed to get ' +
      'the exact row, print that row to the user, and call record again with confirmed true only after the ' +
      'user says yes. Read history before asking for anything already in it. ' +
      'record takes any metric the user names, not only body measurements: the name in lowercase with ' +
      'underscores, the value exactly as given, and the unit the user said. Before recording under a name ' +
      'you have not seen in this conversation, call list and reuse an existing name and unit if one ' +
      'already carries that fact; never make a near-duplicate of a metric that exists. A new metric is a ' +
      'cost, not a free addition. Weight stays as it is: unit kg or lbs, always on the BODY page. ' +
      'area body puts a metric on the BODY page and area gym on the GYM page, where each lift is one line; ' +
      'a lift takes reps as well, the count the user said, kept beside the weight. ' +
      'A number you read off a photo the user sent is not a measurement: it goes through estimate, never ' +
      'record, under a name ending _est and signed photo. An estimate is a guess. Say so every time you ' +
      'show or mention one, and never present it as a measurement or beside one as if it were. estimate ' +
      'writes only bodyfat_est and muscle_est; it never writes weight or any metric without _est, and it ' +
      'never changes or replaces a measured reading. The same confirm rule applies: print the exact rows ' +
      'and write only after the user says yes.'
  });

  server.tool(
    'record',
    'Write one reading the user gave as one events row: event_type measurement, source claude, the same ' +
    'shape the BODY page writes. metric is any name the user gives, written in lowercase with underscores: ' +
    'weight (unit kg or lbs) or anything else with the unit the user named. Call list first for a name you ' +
    'have not seen in this conversation and reuse an existing one instead of making a duplicate. ' +
    'area is optional, body or gym: body puts the metric on the BODY page beside weight, gym on the GYM ' +
    'page as a lift, one line per lift; left out, the reading is in the record and in history but on ' +
    'neither page. reps is optional, for a lift: the whole number of repetitions the user said, saved ' +
    'beside the weight and shown under the reading. A name ending _est is refused, because that is an ' +
    'estimate and goes through estimate. value is the number exactly as the user said it. occurred_at is when the user ' +
    'measured, as an ISO 8601 timestamp with its zone; ask if unsure, and never use a future time. ' +
    'Without confirmed, nothing is written: the exact row is returned for you to print to the user. ' +
    'Pass confirmed true only after the user has seen that row and said yes. Never call this with a ' +
    'value you were not given. The same row asked twice lands once.',
    {
      metric: z.string(),
      value: z.union([z.number(), z.string()]),
      unit: z.string(),
      occurred_at: z.string(),
      area: z.enum(AREAS).optional(),
      reps: z.number().int().positive().optional(),
      confirmed: z.boolean().optional()
    },
    async ({ metric, value, unit, occurred_at, area, reps, confirmed = false }) => {
      if (!confirmed) {
        const drafted = draftRow({ metric, value, unit, occurred_at, area, reps });
        if (drafted.error) return fail({ error: 'nothing written: ' + drafted.error });
        return text({ proposed: { ...drafted.row, source: SOURCE, event_type: 'measurement', context: drafted.context },
          say: 'nothing written yet. Print this row to the user; call record again with confirmed true only if they say yes' });
      }
      try {
        const out = await writeReading({ metric, value, unit, occurred_at, area, reps });
        return out.error ? fail(out) : text(out);
      } catch (e) { return fail({ error: 'nothing written: ' + e.message }); }
    }
  );

  server.tool(
    'list',
    'Every metric already in the record, once each, sorted by name: its area, its unit, how many readings, ' +
    'the latest reading (with reps for a lift) and when it was measured, which inputs wrote it, and whether ' +
    'it shows on the BODY or GYM page. Call it before recording under a name you have not seen in this conversation, and reuse an ' +
    'existing name and unit instead of making a duplicate. It writes nothing.',
    {},
    async () => {
      try { return text(await listMetrics()); }
      catch (e) { return fail({ error: e.message }); }
    }
  );

  server.tool(
    'estimate',
    'Write guesses you read off a photo the user sent in this chat, one events row each, signed source ' +
    'photo, event_type measurement, under names ending _est so they can never be taken for measurements. ' +
    'Only bodyfat_est (unit percent, a number between 0 and 100) and muscle_est (unit 1-10, a whole-number ' +
    'rating) are written. It never writes weight or any metric without _est, and it never changes or ' +
    'replaces a measured reading. occurred_at is when the photo was taken, as an ISO 8601 timestamp with ' +
    'its zone; ask if unsure. model is the name of the model reading the photo. Without confirmed, ' +
    'nothing is written: the exact rows are returned for you to print to the user, saying they are ' +
    'guesses. Pass confirmed true only after the user has seen those rows and said yes. An estimate is ' +
    'a guess: say so every time, and never present it as a measurement.',
    {
      rows: z.array(z.object({ metric: z.string(), value: z.number() })).min(1),
      occurred_at: z.string(),
      model: z.string(),
      confirmed: z.boolean().optional()
    },
    async ({ rows, occurred_at, model, confirmed = false }) => {
      if (!confirmed) {
        const drafted = draftEstimates({ rows, occurred_at, model });
        if (drafted.error) return fail({ error: 'nothing written: ' + drafted.error });
        return text({ estimate: true, proposed: drafted.rows.map(r => ({ ...r, source: WRITERS.estimate.source, event_type: 'measurement', context: drafted.context })),
          say: 'nothing written yet. Print these rows to the user as guesses read from the photo, not measurements; call estimate again with confirmed true only if they say yes' });
      }
      try {
        const out = await writeEstimates({ rows, occurred_at, model });
        return out.error ? fail(out) : text(out);
      } catch (e) { return fail({ error: 'nothing written: ' + e.message }); }
    }
  );

  server.tool(
    'history',
    'The recorded readings of one metric over the last days, oldest first, in their original units, with ' +
    'when each was measured, when it was saved and which input saved it. Readings in kg and in lbs are ' +
    'separate series and are not converted. It writes nothing.',
    { metric: z.string(), days: z.number().optional() },
    async ({ metric, days = 60 }) => {
      try {
        const out = await readHistory(metric, days);
        return out.error ? fail(out) : text(out);
      } catch (e) { return fail({ error: e.message }); }
    }
  );

  return server;
}
