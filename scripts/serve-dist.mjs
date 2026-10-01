// Servidor estático mínimo para el build de producción (dist/) con
// `Cache-Control: no-store`: Safari/iOS cachea agresivamente el HTML y el
// bundle, y al iterar fixes de input el teléfono puede seguir corriendo un
// build viejo sin que nadie lo note. Uso: `node scripts/serve-dist.mjs 5200`.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../dist', import.meta.url)));
const port = Number(process.argv[2] ?? process.env.PORT ?? 5200);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/')) {
      pathname += 'index.html';
    }

    // Resuelve dentro de dist/ (anti path-traversal) con fallback a index.html.
    let file = resolve(join(root, '.' + pathname));
    if (!file.startsWith(root + sep) && file !== root) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    if (!(await stat(file).then(() => true).catch(() => false))) {
      file = join(root, 'index.html'); // fallback SPA
    }

    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    });
    res.end(body);
  } catch (error) {
    res.writeHead(500).end(`error: ${String(error)}`);
  }
});

server.listen(port, () => {
  console.log(`formulita dist en http://localhost:${port}/ (Cache-Control: no-store)`);
});
