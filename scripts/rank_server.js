/**
 * Lightweight dev server for rank_lookup.html
 * Serves static files and proxies CORS-blocked APIs.
 *
 * Usage: node scripts/rank_server.js
 * Then open http://localhost:3737
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = 3737;

// Proxy config: /api/temple/* → templeosrs.com, /api/wikisync/* → sync.runescape.wiki
const PROXY_ROUTES = {
    '/api/temple/': {
        target: 'https://templeosrs.com/api/',
        rewrite: (p) => p.replace('/api/temple/', ''),
    },
    '/api/wikisync/': {
        target: 'https://sync.runescape.wiki/runelite/player/',
        rewrite: (p) => p.replace('/api/wikisync/', ''),
    },
};

function proxyRequest(targetUrl, res) {
    https.get(targetUrl, { headers: { 'User-Agent': 'Volition-Discord-Bot' } }, (upstream) => {
        res.writeHead(upstream.statusCode, {
            'Content-Type': upstream.headers['content-type'] || 'application/json',
            'Access-Control-Allow-Origin': '*',
        });
        upstream.pipe(res);
    }).on('error', (err) => {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
    });
}

const MIME = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
};

const server = http.createServer((req, res) => {
    const parsed = url.parse(req.url);
    const pathname = decodeURIComponent(parsed.pathname);

    // Check proxy routes
    for (const [prefix, route] of Object.entries(PROXY_ROUTES)) {
        if (pathname.startsWith(prefix)) {
            const suffix = route.rewrite(pathname);
            const query = parsed.search || '';
            const targetUrl = route.target + suffix + query;
            return proxyRequest(targetUrl, res);
        }
    }

    // Static file serving (from scripts/ dir)
    let filePath;
    if (pathname === '/' || pathname === '/index.html') {
        filePath = path.join(__dirname, 'rank_lookup.html');
    } else {
        filePath = path.join(__dirname, '..', pathname);
    }

    const ext = path.extname(filePath);
    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404);
            res.end('Not found');
            return;
        }
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(data);
    });
});

server.listen(PORT, () => {
    console.log(`\n  Rank Lookup running at http://localhost:${PORT}\n`);
});
