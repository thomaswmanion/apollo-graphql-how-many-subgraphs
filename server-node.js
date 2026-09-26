const http = require('http');
const url = require('url');

const SUBGRAPH_PORT = parseInt(process.env.SUBGRAPH_PORT || '4001', 10);
const MONOGRAPH_PORT = parseInt(process.env.MONOGRAPH_PORT || '4002', 10);

const DEFAULT_RESOLVER_DELAY = parseInt(process.env.RESOLVER_DELAY_MS || '0', 10);
const DEFAULT_TRANSIT_DELAY = parseInt(process.env.TRANSIT_DELAY_MS || '0', 10);

function sleep(ms) {
  if (ms <= 0) return Promise.resolve();
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 10 * 1024 * 1024) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

// ----------------------------------------------------
// Subgraph Handler: /subgraph/:id
// ----------------------------------------------------
async function handleSubgraphRequest(req, res) {
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'text/plain' });
    return res.end('Method Not Allowed');
  }

  const parsedUrl = url.parse(req.url, true);
  const match = parsedUrl.pathname.match(/^\/subgraph\/(\d+)$/);
  if (!match) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Subgraph Not Found');
  }

  const subgraphId = parseInt(match[1], 10);

  // Levers: Delay calculation
  const transitDelay = req.headers['x-transit-delay-ms']
    ? parseInt(req.headers['x-transit-delay-ms'], 10)
    : DEFAULT_TRANSIT_DELAY;
  const resolverDelay = req.headers['x-resolver-delay-ms']
    ? parseInt(req.headers['x-resolver-delay-ms'], 10)
    : DEFAULT_RESOLVER_DELAY;

  const totalDelay = transitDelay + resolverDelay;
  if (totalDelay > 0) {
    await sleep(totalDelay);
  }

  let body;
  try {
    body = await parseJsonBody(req);
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ errors: [{ message: 'Invalid JSON' }] }));
  }

  const query = body.query || '';
  const variables = body.variables || {};

  let data = {};

  if (variables.representations && Array.isArray(variables.representations)) {
    // Apollo Federation _entities query
    const entities = variables.representations.map(rep => {
      const id = rep.id || '1';
      const entity = {
        __typename: rep.__typename || 'User',
        id: id
      };
      entity[`field_${subgraphId}`] = `val_${subgraphId}_${id}`;
      return entity;
    });
    data._entities = entities;
  } else if (query.includes('user(') || (subgraphId === 1 && query.includes('user'))) {
    // Root user query (primarily subgraph 1)
    data.user = {
      __typename: 'User',
      id: '1',
      name: 'User 1',
      field_1: 'val_1_1'
    };
  } else if (query.includes(`ping_${subgraphId}`)) {
    data[`ping_${subgraphId}`] = `pong_${subgraphId}`;
  } else {
    // Generic fallback for any requested field
    data[`subgraph_${subgraphId}`] = `ok`;
  }

  const responseJson = JSON.stringify({ data });
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(responseJson)
  });
  res.end(responseJson);
}

// ----------------------------------------------------
// Monograph Handler: /graphql
// ----------------------------------------------------
async function handleMonographRequest(req, res) {
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'text/plain' });
    return res.end('Method Not Allowed');
  }

  const resolverDelay = req.headers['x-resolver-delay-ms']
    ? parseInt(req.headers['x-resolver-delay-ms'], 10)
    : DEFAULT_RESOLVER_DELAY;

  if (resolverDelay > 0) {
    await sleep(resolverDelay);
  }

  let body;
  try {
    body = await parseJsonBody(req);
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ errors: [{ message: 'Invalid JSON' }] }));
  }

  const query = body.query || '';
  let data = {};

  if (query.includes('user')) {
    const user = {
      __typename: 'User',
      id: '1',
      name: 'User 1'
    };

    // Extract all field_N requested or populate up to 500
    const fieldMatches = query.match(/field_(\d+)/g);
    if (fieldMatches) {
      for (const f of fieldMatches) {
        user[f] = `val_${f.replace('field_', '')}_1`;
      }
    } else {
      user.field_1 = 'val_1_1';
    }
    data.user = user;
  } else if (query.includes('ping_')) {
    const pingMatches = query.match(/ping_(\d+)/g);
    if (pingMatches) {
      for (const p of pingMatches) {
        data[p] = `pong_${p.replace('ping_', '')}`;
      }
    }
  } else {
    data.status = 'ok';
  }

  const responseJson = JSON.stringify({ data });
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(responseJson)
  });
  res.end(responseJson);
}

// Start Subgraph Server (port 4001)
const subgraphServer = http.createServer(handleSubgraphRequest);
subgraphServer.keepAliveTimeout = 65000;
subgraphServer.headersTimeout = 66000;
subgraphServer.listen(SUBGRAPH_PORT, '127.0.0.1', () => {
  console.log(`[Node] Subgraph multiplexer running on http://127.0.0.1:${SUBGRAPH_PORT}/subgraph/:id`);
});

// Start Monograph Server (port 4002)
const monographServer = http.createServer(handleMonographRequest);
monographServer.keepAliveTimeout = 65000;
monographServer.headersTimeout = 66000;
monographServer.listen(MONOGRAPH_PORT, '127.0.0.1', () => {
  console.log(`[Node] Monograph server running on http://127.0.0.1:${MONOGRAPH_PORT}/graphql`);
});

process.on('SIGTERM', () => {
  subgraphServer.close();
  monographServer.close();
  process.exit(0);
});
