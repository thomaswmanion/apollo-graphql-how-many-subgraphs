const SUBGRAPH_PORT = parseInt(process.env.SUBGRAPH_PORT || '4001', 10);
const MONOGRAPH_PORT = parseInt(process.env.MONOGRAPH_PORT || '4002', 10);

const DEFAULT_RESOLVER_DELAY = parseInt(process.env.RESOLVER_DELAY_MS || '0', 10);
const DEFAULT_TRANSIT_DELAY = parseInt(process.env.TRANSIT_DELAY_MS || '0', 10);

function sleep(ms: number) {
  if (ms <= 0) return Promise.resolve();
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ----------------------------------------------------
// Subgraph Server (Port 4001)
// ----------------------------------------------------
Bun.serve({
  port: SUBGRAPH_PORT,
  hostname: '127.0.0.1',
  async fetch(req) {
    if (req.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const url = new URL(req.url);
    const match = url.pathname.match(/^\/subgraph\/(\d+)$/);
    if (!match) {
      return new Response('Subgraph Not Found', { status: 404 });
    }

    const subgraphId = parseInt(match[1], 10);

    const transitDelay = req.headers.get('x-transit-delay-ms')
      ? parseInt(req.headers.get('x-transit-delay-ms')!, 10)
      : DEFAULT_TRANSIT_DELAY;
    const resolverDelay = req.headers.get('x-resolver-delay-ms')
      ? parseInt(req.headers.get('x-resolver-delay-ms')!, 10)
      : DEFAULT_RESOLVER_DELAY;

    const totalDelay = transitDelay + resolverDelay;
    if (totalDelay > 0) {
      await sleep(totalDelay);
    }

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ errors: [{ message: 'Invalid JSON' }] }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const query = body.query || '';
    const variables = body.variables || {};
    let data: any = {};

    if (variables.representations && Array.isArray(variables.representations)) {
      data._entities = variables.representations.map((rep: any) => {
        const id = rep.id || '1';
        return {
          __typename: rep.__typename || 'User',
          id: id,
          [`field_${subgraphId}`]: `val_${subgraphId}_${id}`
        };
      });
    } else if (query.includes('user(') || (subgraphId === 1 && query.includes('user'))) {
      data.user = {
        __typename: 'User',
        id: '1',
        name: 'User 1',
        field_1: 'val_1_1'
      };
    } else if (query.includes(`ping_${subgraphId}`)) {
      data[`ping_${subgraphId}`] = `pong_${subgraphId}`;
    } else {
      data[`subgraph_${subgraphId}`] = 'ok';
    }

    return new Response(JSON.stringify({ data }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
});
console.log(`[Bun] Subgraph multiplexer running on http://127.0.0.1:${SUBGRAPH_PORT}/subgraph/:id`);

// ----------------------------------------------------
// Monograph Server (Port 4002)
// ----------------------------------------------------
Bun.serve({
  port: MONOGRAPH_PORT,
  hostname: '127.0.0.1',
  async fetch(req) {
    if (req.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const resolverDelay = req.headers.get('x-resolver-delay-ms')
      ? parseInt(req.headers.get('x-resolver-delay-ms')!, 10)
      : DEFAULT_RESOLVER_DELAY;

    if (resolverDelay > 0) {
      await sleep(resolverDelay);
    }

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ errors: [{ message: 'Invalid JSON' }] }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const query = body.query || '';
    let data: any = {};

    if (query.includes('user')) {
      const user: any = {
        __typename: 'User',
        id: '1',
        name: 'User 1'
      };

      const fieldMatches = query.match(/field_(\d+)/g);
      if (fieldMatches) {
        for (const f of fieldMatches) {
          const idx = f.replace('field_', '');
          user[f] = `val_${idx}_1`;
        }
      } else {
        user.field_1 = 'val_1_1';
      }
      data.user = user;
    } else if (query.includes('ping_')) {
      const pingMatches = query.match(/ping_(\d+)/g);
      if (pingMatches) {
        for (const p of pingMatches) {
          const idx = p.replace('ping_', '');
          data[p] = `pong_${idx}`;
        }
      }
    } else {
      data.status = 'ok';
    }

    return new Response(JSON.stringify({ data }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
});
console.log(`[Bun] Monograph server running on http://127.0.0.1:${MONOGRAPH_PORT}/graphql`);
