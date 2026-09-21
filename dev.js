'use strict';

// Optional local preview. The page, its public configuration, the MCP endpoint and the photo door are served.
const http = require('node:http');
const {readFile} = require('node:fs/promises');
const path = require('node:path');
const config = require('./api/config');
const port = Number(process.env.BODY_PORT || 8797);

// Vercel hands the function a parsed JSON body; here the same is done by hand.
async function mcp(request, response) {
  const {default: handler} = await import('./api/mcp.mjs');
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  try { request.body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined; }
  catch { response.writeHead(400, {'Content-Type': 'application/json'}); response.end(JSON.stringify({jsonrpc:'2.0',error:{code:-32700,message:'parse error'},id:null})); return; }
  return handler(request, response);
}

http.createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname === '/api/config') return config(request, response);
  if (pathname === '/api/mcp') return mcp(request, response);
  if (pathname === '/api/photo') { request.query = Object.fromEntries(new URL(request.url, 'http://localhost').searchParams); return (await import('./api/photo.mjs')).default(request, response); }
  const pages={'/':'index.html','/index.html':'index.html','/you-reader.js':'you-reader.js','/body-index.js':'body-index.js'};
  if (request.method !== 'GET' || !Object.hasOwn(pages,pathname)) {
    response.writeHead(404, {'Content-Type': 'text/plain'});
    response.end('Not found');
    return;
  }
  try {
    const page = await readFile(path.join(__dirname,pages[pathname]));
    response.writeHead(200, {'Content-Type': (pathname.endsWith('.js')?'application/javascript':'text/html')+'; charset=utf-8', 'Cache-Control': 'no-store'});
    response.end(page);
  } catch {
    response.writeHead(500, {'Content-Type': 'text/plain'});
    response.end('Could not open BODY.');
  }
}).listen(port, '127.0.0.1', () => console.log(`BODY preview: http://localhost:${port}`));
