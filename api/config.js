'use strict';

// These two settings are public. No other environment variable leaves the server.
module.exports = function config(request, response) {
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    response.statusCode = 405;
    response.end(JSON.stringify({error: 'Method not allowed.'}));
    return;
  }

  const url = (process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
  const key = (process.env.SUPABASE_PUBLISHABLE_KEY || '').trim();
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url) ||
      !/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) {
    response.statusCode = 503;
    response.end(JSON.stringify({error: 'Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in Vercel, then redeploy BODY.'}));
    return;
  }

  response.statusCode = 200;
  response.end(JSON.stringify({url, key}));
};
