// A door for a picture. One progress photo, now, from the phone's share sheet.
//
// The same request The Wire's /api/photo takes, so the same iOS Shortcut works:
// POST with WIRE_TOKEN in the Authorization header, checked by mcp/token.mjs
// as /api/mcp's is, and the image itself as the body. The token is read from
// the header and nowhere else, because an address ends up in logs.
//
// It signs in as you through mcp/server.mjs, with the same publishable key and
// password the MCP uses, puts the file in the private body-progress bucket
// under a new path, and then writes the progress_photo row exactly as the page
// does, so the photo shows under Progress photos. A photo is a visual record:
// it carries no value and generates no body-fat, muscle or weight number.
//
// Nothing here replaces anything. The upload never overwrites, the row is only
// ever appended, and a photo already in your record, the same bytes sent twice
// by a Shortcut that was tapped twice, lands once.
//
// It takes WIRE_PHOTO_TOKEN as well as WIRE_TOKEN, so the phone can carry a
// token that opens this door and nothing else.

import { createHash, randomUUID } from 'node:crypto';
import { signedIn } from '../mcp/server.mjs';
import { allowedFor, fromHeader } from '../mcp/token.mjs';

export const config = { api: { bodyParser: { sizeLimit: '4mb' } } };

// The bucket's own list, from photos.sql, and the extensions the page's path rule accepts.
export const BUCKET = 'body-progress';
export const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
export const CAP = 4 * 1024 * 1024;   // Vercel refuses a body over 4.5MB; the Shortcut shrinks before sending
const SOURCE = 'shortcut';

function answer(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

// The body as bytes, whether the platform handed it over already read or not.
async function bytes(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  const parts = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > CAP) throw new Error('over 4MB: shrink the photo before sending it');
    parts.push(chunk);
  }
  return Buffer.concat(parts);
}

const COLUMNS = 'id,occurred_at,context';

export default async function handler(req, res) {
  if (req.query && 'token' in req.query) return answer(res, 400, { error: 'the token goes in the Authorization header, never in the address' });
  if (!allowedFor('WIRE_PHOTO_TOKEN', fromHeader(req))) return answer(res, 401, { error: 'unauthorized' });
  if (req.method !== 'POST') {
    res.setHeader('allow', 'POST');
    return answer(res, 405, { error: 'method not allowed' });
  }

  const type = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  const ext = TYPES[type];
  if (!ext) return answer(res, 400, { error: `send the image as the body, content-type one of ${Object.keys(TYPES).join(', ')}` + (type === 'image/heic' ? '; convert HEIC to JPEG in the Shortcut first' : '') });

  let file;
  try { file = await bytes(req); }
  catch (e) { return answer(res, 413, { error: 'nothing written', why: e.message }); }
  if (!file.length) return answer(res, 400, { error: 'the body is empty' });
  if (file.length > CAP) return answer(res, 413, { error: 'over 4MB: shrink the photo before sending it' });

  try {
    const { db, who } = await signedIn();
    const sha256 = createHash('sha256').update(file).digest('hex');

    // The same bytes already in the record, from a Shortcut tapped twice or a retry: nothing new lands.
    const { data: same, error: sameError } = await db.from('events').select(COLUMNS)
      .eq('user_id', who).eq('event_type', 'progress_photo').eq('metric', 'body_progress').eq('context->>sha256', sha256)
      .order('recorded_at', { ascending: true }).order('id', { ascending: true }).limit(1);
    if (sameError) return answer(res, 502, { error: 'nothing written', why: sameError.message });
    if (same && same.length) return answer(res, 200, { landed: 0, already_saved: true, path: same[0].context.path, occurred_at: same[0].occurred_at, bytes: file.length,
      say: 'this exact photo was already in your record; nothing new was written' });

    // The page's path: the owner's id first, so the bucket's own policy can check it the way the table does,
    // then a fresh UUID, so a second photo never lands on the first.
    const id = randomUUID(), path = `${who}/${id}.${ext}`, occurred_at = new Date().toISOString();
    const { error: upError } = await db.storage.from(BUCKET).upload(path, file, { contentType: type, upsert: false });
    if (upError) return answer(res, 502, { error: 'nothing written', why: `the file did not land: ${upError.message}` });

    // The file is in. Only now the row, so a row never names a file that is not there.
    const context = { area: 'body', schema_version: 1, bucket: BUCKET, path, mime_type: type, bytes: file.length, sha256 };
    const { data: row, error: rowError } = await db.from('events').insert({
      user_id: who, metric: 'body_progress', value: null, unit: null, event_type: 'progress_photo',
      source: SOURCE, source_id: id, occurred_at, context
    }).select('id').single();
    if (rowError) return answer(res, 502, { error: 'the file landed but its row did not; send the photo again', why: rowError.message, path });

    return answer(res, 200, { landed: 1, id: row.id, path, occurred_at, bytes: file.length });
  } catch (e) {
    return answer(res, 502, { error: 'nothing written', why: e.message });
  }
}
