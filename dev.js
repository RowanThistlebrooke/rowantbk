'use strict';

// Optional local preview. Only the page and its public configuration are served.
const http = require('node:http');
const {readFile} = require('node:fs/promises');
const path = require('node:path');
const config = require('./api/config');
const port = Number(process.env.BODY_PORT || 8797);

http.createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname === '/api/config') return config(request, response);
  if (request.method !== 'GET' || !['/', '/index.html'].includes(pathname)) {
    response.writeHead(404, {'Content-Type': 'text/plain'});
    response.end('Not found');
    return;
  }
  try {
    const page = await readFile(path.join(__dirname, 'index.html'));
    response.writeHead(200, {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'});
    response.end(page);
  } catch {
    response.writeHead(500, {'Content-Type': 'text/plain'});
    response.end('Could not open BODY.');
  }
}).listen(port, '127.0.0.1', () => console.log(`BODY preview: http://localhost:${port}`));
