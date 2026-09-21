// BODY over HTTP, for claude.ai and the phone.
//
// The server and both tools live in mcp/server.mjs, once. This file reads
// nothing, writes nothing and works nothing out; it only checks the token and
// hands the request over.
//
// This address is public and the events table is append only: whatever gets in
// can write rows that can never be removed. So every request must carry
// WIRE_TOKEN as the header  Authorization: Bearer <token>. If WIRE_TOKEN is not
// set, nothing gets in.

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { bodyServer } from '../mcp/server.mjs';
import { allowed, fromHeader } from '../mcp/token.mjs';

function refuse(res, status, message) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }));
}

export default async function handler(req, res) {
  if (!allowed(fromHeader(req))) return refuse(res, 401, 'unauthorized');

  // Stateless: every request is a POST answered by its own server. There is
  // no stream to hold open and no session to end.
  if (req.method !== 'POST') {
    res.setHeader('allow', 'POST');
    return refuse(res, 405, 'method not allowed');
  }

  const server = bodyServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => { transport.close(); server.close(); });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch {
    if (!res.headersSent) refuse(res, 500, 'the server could not answer');
  }
}
