const { generateAndCompose } = require('./generator');
const { startSubgraphServer, startRouter, killProcess, sleep } = require('./process-manager');
const { BenchmarkClient } = require('./benchmark-client');

async function main() {
  console.log('=== Step 1: Composing Supergraph N=3 ===');
  const comp = generateAndCompose(3);
  if (!comp.success) {
    throw new Error('Composition failed: ' + comp.error);
  }

  console.log('\n=== Step 2: Starting Node Subgraph Server ===');
  const serverProc = await startSubgraphServer('node');
  console.log('Subgraph server ready.');

  console.log('\n=== Step 3: Starting Apollo Router ===');
  const routerProc = await startRouter(comp.supergraphPath);
  console.log('Apollo Router ready on port 4000.');

  const client = new BenchmarkClient('http://127.0.0.1:4000/');

  try {
    console.log('\n=== Step 4: Testing Queries against Apollo Router ===');

    // Narrow query: Hits Subgraph 1 only
    console.log('Testing Narrow Query...');
    const q1 = await client.execute('query { user(id: "1") { id name field_1 } }');
    console.log('Narrow Query result:', JSON.stringify(q1));

    // Wide query: Fans out to Subgraphs 1, 2, 3
    console.log('\nTesting Wide Query (Fan-out to 3 subgraphs)...');
    const q2 = await client.execute('query { user(id: "1") { id name field_1 field_2 field_3 } }');
    console.log('Wide Query result:', JSON.stringify(q2));

    // Ping query: Fan-out to ping_1, ping_2, ping_3
    console.log('\nTesting Top-Level Fan-out Query...');
    const q3 = await client.execute('query { ping_1 ping_2 ping_3 }');
    console.log('Ping Query result:', JSON.stringify(q3));

    if (q1.success && q2.success && q3.success) {
      console.log('\n>>> ALL APOLLO ROUTER FEDERATION TESTS PASSED SUCCESSFULLY! <<<');
    } else {
      console.error('\n>>> ONE OR MORE QUERIES RETURNED ERRORS <<<');
    }
  } finally {
    console.log('\n=== Step 5: Shutting down processes ===');
    client.destroy();
    killProcess(routerProc);
    killProcess(serverProc);
    await sleep(1000);
    console.log('Clean shutdown complete.');
  }
}

main().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
