let express = null;
try {
  express = require('express');
} catch (_) {}

let Pool = null;
try {
  Pool = require('pg').Pool;
} catch (_) {}

const http = require('http');

const PORT = process.env.PORT || 3001;
const DATABASE_URL = process.env.DATABASE_URL;

let server;

if (express) {
  const app = express();
  app.use(express.json());

  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', '*');
    next();
  });

  app.get('/api/health', (req, res) => {
    res.status(200).json({
      status: 'ok',
      service: 'nexus-deployment-test',
      databaseConfigured: Boolean(DATABASE_URL),
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/', (req, res) => {
    res.status(200).json({
      name: 'nexus-backend-test',
      status: 'running',
      healthEndpoint: '/api/health',
    });
  });

  server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Backend server listening on 0.0.0.0:${PORT}`);
  });
} else {
  // Built-in HTTP server fallback for dependency-free local testing
  server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Content-Type', 'application/json');

    if (req.url === '/api/health' || req.url === '/health') {
      res.writeHead(200);
      res.end(JSON.stringify({
        status: 'ok',
        service: 'nexus-deployment-test',
        databaseConfigured: Boolean(DATABASE_URL),
        timestamp: new Date().toISOString(),
      }));
    } else {
      res.writeHead(200);
      res.end(JSON.stringify({
        name: 'nexus-backend-test',
        status: 'running',
        healthEndpoint: '/api/health',
      }));
    }
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Backend server listening on 0.0.0.0:${PORT}`);
  });
}

module.exports = { server };
