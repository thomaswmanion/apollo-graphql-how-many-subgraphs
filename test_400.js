const { startSubgraphServer, startRouter, killProcess, sleep } = require('./process-manager');
const { BenchmarkClient } = require('./benchmark-client');
const { execSync } = require('child_process');

function getMemory(pid) {
  try {
    const out = execSync(`powershell -NoProfile -Command "(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).WorkingSet64"`, { encoding: 'utf8' }).trim();
    return (parseInt(out, 10) / (1024 * 1024)).toFixed(1);
  } catch (e) {
    return '0';
  }
}

async function main() {
  console.log('Testing extreme scale: N=400 subgraphs!');
  const supergraphPath = require('path').join(__dirname, 'composed', 'n_400', 'supergraph.graphql');

  // Test with Rust subgraph server (fastest and most efficient)
  const serverProc = await startSubgraphServer('rust');
  console.log('Rust subgraph server ready.');

  const routerProc = await startRouter(supergraphPath);
  console.log(`Apollo Router started with N=400. Memory: ${getMemory(routerProc.pid)} MB`);

  const client = new BenchmarkClient('http://127.0.0.1:4000/');

  try {
    // 1. Narrow query
    console.log('Testing Narrow query (1 subgraph hit)...');
    const narrowRes = await client.runLoad({
      query: 'query { user(id: "1") { id name field_1 } }',
      concurrency: 5,
      requests: 30,
      warmupRequests: 3
    });
    console.log(`Narrow: RPS=${narrowRes.rps} | p50=${narrowRes.p50}ms | p99=${narrowRes.p99}ms | Cold=${narrowRes.coldLatencyMs}ms`);

    // 2. Wide query (fanning out across ALL 400 subgraphs!)
    const fields = [];
    for (let i = 1; i <= 400; i++) fields.push(`field_${i}`);
    const wideQuery = `query { user(id: "1") { id name ${fields.join(' ')} } }`;

    console.log('Testing Wide query (400-way fan-out!)...');
    const wideRes = await client.runLoad({
      query: wideQuery,
      concurrency: 3,
      requests: 15,
      warmupRequests: 2
    });
    console.log(`Wide N=400: RPS=${wideRes.rps} | p50=${wideRes.p50}ms | p99=${wideRes.p99}ms | Cold=${wideRes.coldLatencyMs}ms`);
    console.log(`Router Memory after fan-out: ${getMemory(routerProc.pid)} MB`);
  } finally {
    client.destroy();
    killProcess(routerProc);
    killProcess(serverProc);
    await sleep(1000);
  }
}

main().catch(err => {
  console.error('Test 400 error:', err);
  process.exit(1);
});
