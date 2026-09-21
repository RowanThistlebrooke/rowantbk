// Where the database address, its publishable key and the login come from.
// The same SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY the page gets from
// /api/config, plus WIRE_EMAIL and WIRE_PASSWORD for the user the page signs
// in as. Nothing else in the environment is read here.

export function supabaseUrl() {
  return (process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
}

export function publishableKey() {
  return (process.env.SUPABASE_PUBLISHABLE_KEY || '').trim();
}

export function login() {
  return { email: (process.env.WIRE_EMAIL || '').trim(), password: process.env.WIRE_PASSWORD || '' };
}

// A key that is safe in a browser: a publishable key, or a legacy key whose
// own claims say role anon. A secret key or a service_role key is neither, so
// it is never used to sign in: it would step around row level security.
export function isPublishable(key) {
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return true;
  const parts = String(key).split('.');
  if (parts.length !== 3) return false;
  try { return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')).role === 'anon'; }
  catch { return false; }
}

// Which settings are not set, by name. A value is never printed.
export function missing() {
  const out = [];
  if (!supabaseUrl()) out.push('SUPABASE_URL');
  if (!publishableKey()) out.push('SUPABASE_PUBLISHABLE_KEY');
  else if (!isPublishable(publishableKey())) out.push('SUPABASE_PUBLISHABLE_KEY (not a publishable key)');
  const { email, password } = login();
  if (!email) out.push('WIRE_EMAIL');
  if (!password) out.push('WIRE_PASSWORD');
  return out;
}
