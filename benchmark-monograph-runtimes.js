const { startSubgraphServer, startRouter, killProcess, sleep } = require('./process-manager');
const { generateAndCompose } = require('./generator');
const { BenchmarkClient } = require('./benchmark-client');

function buildWideUserQuery(n) {
  const fields = ['id', 'name'];
  for (let i = 1; i <= n; i++) {
    fields.push(`field_${i}`);
  }
  return `query GetUserWide { user(id: "1") { ${fields.join(' ')} } }`;
}

async function benchmark(url, query, concurrency = 10, requests = 100) {
  const client = new BenchmarkClient(url);
  try {
    return await client.runLoad({ query, concurrency, requests, warmupRequests: 10 });
  } finally {
    client.destroy();
  }
}

async function main() {
  console.log('=== BENCHMARKING MONOGRAPH RUNTIMES (DIRECT TO PORT 4002 - NO ROUTER) ===');

  const runtimes = ['node', 'bun', 'rust'];
  const testNs = [1, 10, 50, 100];
  const results = {
    monographDirect: {},
    throughRouter: {}
  };

  for (const rt of runtimes) {
    results.monographDirect[rt] = {};
    results.throughRouter[rt] = {};

    console.log(`\nStarting ${rt.toUpperCase()} server...`);
    const serverProc = await startSubgraphServer(rt);

    try {
      for (const n of testNs) {
        const query = buildWideUserQuery(n);

        // 1. Monograph Direct (Port 4002 - NO ROUTER)
        console.log(`  [${rt.toUpperCase()}] Testing Monograph Direct (N=${n})...`);
        const monoRes = await benchmark('http://127.0.0.1:4002/graphql', query, 10, 80);
        results.monographDirect[rt][n] = {
          rps: monoRes.rps,
          p50: monoRes.p50,
          p99: monoRes.p99
        };

        // 2. Through Apollo Router (Port 4000)
        console.log(`  [${rt.toUpperCase()}] Testing Through Router (N=${n})...`);
        const comp = generateAndCompose(n);
        const routerProc = await startRouter(comp.supergraphPath);
        try {
          const routerRes = await benchmark('http://127.0.0.1:4000/', query, n > 50 ? 6 : 10, n > 50 ? 50 : 80);
          results.throughRouter[rt][n] = {
            rps: routerRes.rps,
            p50: routerRes.p50,
            p99: routerRes.p99
          };
        } finally {
          killProcess(routerProc);
          await sleep(500);
        }
      }
    } finally {
      killProcess(serverProc);
      await sleep(1000);
    }
  }

  console.log('\n=== FINAL RESULTS COMPARISON ===');
  console.log(JSON.stringify(results, null, 2));

  // Save to file
  const fs = require('fs');
  fs.writeFileSync('monograph_runtime_comparison.json', JSON.stringify(results, null, 2), 'utf8');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
