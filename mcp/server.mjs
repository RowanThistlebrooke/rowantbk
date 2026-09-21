// BODY over MCP. Claude reads your readings, and writes only the one you gave it.
//
// Two tools. record writes one events row, exactly as the page would, signed
// source 'claude'. history reads one metric back. There is no update and no
// delete. It signs in as you with the publishable key, so the same row level
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
export const VERSION = '1.0.0';

// The same rules the page applies in readingDraft() and readingTime() in index.html.
const NUMBER = /^[+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const WEIGHT_UNITS = ['kg', 'lbs'];
const FUTURE_SLACK = 60000;
const CONTEXT = { area: 'body', schema_version: 1 };
const PAGE = 1000;

// The page's name rule: lower case, anything else an underscore.
export const slug = s => String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

// The row as the page would write it, or why nothing can be written. Asking
// this writes nothing. value is kept as the text the user gave, so 158.0 stays
// 158.0 in the numeric column, as it does from the page's input field.
export function draftRow({ metric, value, unit, occurred_at }, now = Date.now()) {
  const m = slug(metric);
  if (!m) return { error: 'metric is empty' };
  const text = typeof value === 'number' ? String(value) : String(value ?? '').trim();
  if (!NUMBER.test(text) || !Number.isFinite(Number(text)) || Number(text) <= 0) return { error: 'value must be a number greater than zero, exactly as the user gave it' };
  const u = String(unit ?? '').trim();
  if (m === 'weight' && !WEIGHT_UNITS.includes(u)) return { error: 'weight takes unit kg or lbs, chosen by the user' };
  if (!u) return { error: 'unit is empty; the user chooses the unit' };
  const t = Date.parse(String(occurred_at ?? ''));
  if (!Number.isFinite(t)) return { error: 'occurred_at must be an ISO 8601 timestamp with its zone, the time the user measured' };
  if (t > now + FUTURE_SLACK) return { error: 'occurred_at is in the future; use the time this happened' };
  return { row: { metric: m, value: text, unit: u, occurred_at: new Date(t).toISOString() } };
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

export async function writeReading(input) {
  const drafted = draftRow(input);
  if (drafted.error) return { error: 'nothing written: ' + drafted.error };
  const { db, who } = await signIn();
  const row = { ...drafted.row, user_id: who, source: SOURCE, source_id: sourceIdOf(drafted.row), event_type: 'measurement', context: CONTEXT };
  const { data, error } = await db.from('events').insert(row).select('id,metric,value::text,unit,occurred_at,recorded_at,source').single();
  if (!error) return { written: data };
  if (error.code !== '23505') return { error: 'nothing written: ' + error.message };
  // Already there: a retry of this exact row. Confirm by reading it back, never write it again.
  const { data: saved, error: readError } = await db.from('events').select('id,metric,value::text,unit,occurred_at,recorded_at,source')
    .eq('user_id', who).eq('source', SOURCE).eq('source_id', row.source_id).eq('metric', row.metric).maybeSingle();
  if (readError || !saved) return { error: 'nothing written: ' + (readError ? readError.message : error.message) };
  return { already_saved: saved, say: 'this exact reading was already in your record; nothing new was written' };
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
  // the same filter the page's graph applies: recorded values of weight, or of a BODY measurement
  const readings = rows.filter(r => r.value !== null && (r.metric === 'weight' || r.context?.area === 'body'))
    .map(({ id, value, unit, occurred_at, recorded_at, source }) => ({ id, value, unit, occurred_at, recorded_at, source }));
  const units = [...new Set(readings.map(r => r.unit))];
  return { metric: m, days, since: from, readings: readings.length, units, rows: readings,
    ...(units.length > 1 ? { note: 'readings in different units are separate series, as on the page; they are not converted' } : {}) };
}

export function bodyServer() {
  const server = new McpServer({ name: 'body', version: VERSION }, {
    instructions:
      'BODY is a personal record of measured readings, and it is append only: a row can be added, never ' +
      'edited and never removed. Transcribe only: write a number exactly as the user gave it, never ' +
      'estimate, round, convert, fill or infer one, and never read one off a photo. If a value, unit or time ' +
      'is missing, ask for it; silence over a guess. Before any write, call record without confirmed to get ' +
      'the exact row, print that row to the user, and call record again with confirmed true only after the ' +
      'user says yes. Read history before asking for anything already in it.'
  });

  server.tool(
    'record',
    'Write one reading the user gave as one events row: event_type measurement, source claude, the same ' +
    'shape the BODY page writes. metric is weight (unit kg or lbs) or another body measurement with the ' +
    'unit the user named. value is the number exactly as the user said it. occurred_at is when the user ' +
    'measured, as an ISO 8601 timestamp with its zone; ask if unsure, and never use a future time. ' +
    'Without confirmed, nothing is written: the exact row is returned for you to print to the user. ' +
    'Pass confirmed true only after the user has seen that row and said yes. Never call this with a ' +
    'value you were not given. The same row asked twice lands once.',
    {
      metric: z.string(),
      value: z.union([z.number(), z.string()]),
      unit: z.string(),
      occurred_at: z.string(),
      confirmed: z.boolean().optional()
    },
    async ({ metric, value, unit, occurred_at, confirmed = false }) => {
      if (!confirmed) {
        const drafted = draftRow({ metric, value, unit, occurred_at });
        if (drafted.error) return fail({ error: 'nothing written: ' + drafted.error });
        return text({ proposed: { ...drafted.row, source: SOURCE, event_type: 'measurement', context: CONTEXT },
          say: 'nothing written yet. Print this row to the user; call record again with confirmed true only if they say yes' });
      }
      try {
        const out = await writeReading({ metric, value, unit, occurred_at });
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
