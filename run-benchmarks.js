const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { generateAndCompose } = require('./generator');
const { startSubgraphServer, startRouter, killProcess, sleep } = require('./process-manager');
const { BenchmarkClient } = require('./benchmark-client');

function getProcessMemoryMb(pid) {
  try {
    if (process.platform === 'win32' && pid) {
      const out = execSync(
        `powershell -NoProfile -Command "(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).WorkingSet64"`,
        { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }
      ).trim();
      const bytes = parseInt(out, 10);
      return bytes ? Number((bytes / (1024 * 1024)).toFixed(2)) : 0;
    }
  } catch (e) {
    // Ignore errors
  }
  return 0;
}

function buildWideUserQuery(n) {
  const fields = ['id', 'name'];
  for (let i = 1; i <= n; i++) {
    fields.push(`field_${i}`);
  }
  return `query GetUserWide { user(id: "1") { ${fields.join(' ')} } }`;
}

function buildNarrowUserQuery() {
  return `query GetUserNarrow { user(id: "1") { id name field_1 } }`;
}

// Global results store
const results = {
  timestamp: new Date().toISOString(),
  environment: {
    node: process.version,
    platform: process.platform,
    arch: process.arch
  },
  compositionMetrics: {},
  scalingN: [],
  runtimes: [],
  resolverDelays: [],
  transitDelays: [],
  summary: {}
};

async function benchmarkPoint({
  name,
  url,
  query,
  headers = {},
  concurrency = 8,
  requests = 50,
  warmupRequests = 5
}) {
  const client = new BenchmarkClient(url);
  try {
    const res = await client.runLoad({
      query,
      headers,
      concurrency,
      requests,
      warmupRequests
    });
    return res;
  } finally {
    client.destroy();
  }
}

// ----------------------------------------------------------------------
// Suite 1: Scaling N (Monograph vs 1 up to N Subgraphs)
// ----------------------------------------------------------------------
async function runScalingSuite(nValues = [1, 2, 5, 10, 20, 35, 50, 75, 100, 150, 200]) {
  console.log('\n======================================================');
  console.log(' SUITE 1: Scaling N Subgraphs (Monograph vs Router)');
  console.log('======================================================');

  const serverProc = await startSubgraphServer('node');
  console.log('[Setup] Node Subgraph & Monograph server started.');

  try {
    for (const n of nValues) {
      console.log(`\n--- Benchmarking N = ${n} ---`);

      // 1. Compose supergraph if not already cached
      let comp = generateAndCompose(n);
      if (!comp.success) {
        console.error(`Composition failed for N=${n}, stopping scaling curve.`);
        break;
      }
      results.compositionMetrics[n] = {
        compositionTimeMs: comp.durationMs,
        schemaSizeKb: comp.schemaSizeKb
      };

      // 2. Start Apollo Router with this supergraph
      console.log(`[Router] Starting Apollo Router for N=${n}...`);
      const routerProc = await startRouter(comp.supergraphPath);
      await sleep(500);

      const routerMemoryMb = getProcessMemoryMb(routerProc.pid);

      try {
        const wideQuery = buildWideUserQuery(n);
        const narrowQuery = buildNarrowUserQuery();

        const concurrency = n > 50 ? 5 : (n > 20 ? 8 : 10);
        const requests = n > 50 ? 40 : 60;

        // A. Monograph Baseline (Direct to port 4002)
        console.log(`  -> Testing Monograph (N=${n})...`);
        const monoNarrow = await benchmarkPoint({
          name: `Monograph Narrow N=${n}`,
          url: 'http://127.0.0.1:4002/graphql',
          query: narrowQuery,
          concurrency,
          requests
        });
        const monoWide = await benchmarkPoint({
          name: `Monograph Wide N=${n}`,
          url: 'http://127.0.0.1:4002/graphql',
          query: wideQuery,
          concurrency,
          requests
        });

        // B. Apollo Router Federation (Port 4000)
        console.log(`  -> Testing Apollo Router Narrow (N=${n})...`);
        const routerNarrow = await benchmarkPoint({
          name: `Router Narrow N=${n}`,
          url: 'http://127.0.0.1:4000/',
          query: narrowQuery,
          concurrency,
          requests
        });

        console.log(`  -> Testing Apollo Router Wide (Fan-out across all ${n} subgraphs)...`);
        const routerWide = await benchmarkPoint({
          name: `Router Wide N=${n}`,
          url: 'http://127.0.0.1:4000/',
          query: wideQuery,
          concurrency,
          requests
        });

        const entry = {
          n,
          compositionTimeMs: comp.durationMs,
          schemaSizeKb: comp.schemaSizeKb,
          routerMemoryMb,
          monograph: {
            narrow: { rps: monoNarrow.rps, p50: monoNarrow.p50, p95: monoNarrow.p95, p99: monoNarrow.p99, coldMs: monoNarrow.coldLatencyMs },
            wide: { rps: monoWide.rps, p50: monoWide.p50, p95: monoWide.p95, p99: monoWide.p99, coldMs: monoWide.coldLatencyMs }
          },
          router: {
            narrow: { rps: routerNarrow.rps, p50: routerNarrow.p50, p95: routerNarrow.p95, p99: routerNarrow.p99, coldMs: routerNarrow.coldLatencyMs },
            wide: { rps: routerWide.rps, p50: routerWide.p50, p95: routerWide.p95, p99: routerWide.p99, coldMs: routerWide.coldLatencyMs }
          }
        };

        results.scalingN.push(entry);

        console.log(`  [Results N=${n}] Memory=${routerMemoryMb} MB`);
        console.log(`    Monograph Wide: RPS=${monoWide.rps} | p50=${monoWide.p50}ms | p99=${monoWide.p99}ms`);
        console.log(`    Router Narrow:  RPS=${routerNarrow.rps} | p50=${routerNarrow.p50}ms | p99=${routerNarrow.p99}ms | Cold=${routerNarrow.coldLatencyMs}ms`);
        console.log(`    Router Wide:    RPS=${routerWide.rps} | p50=${routerWide.p50}ms | p99=${routerWide.p99}ms | Cold=${routerWide.coldLatencyMs}ms`);

        if (routerWide.errorCount > 20) {
          console.warn(`High error count detected at N=${n}, halting scaling progression for safety.`);
          break;
        }
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

// ----------------------------------------------------------------------
// Suite 2: Subgraph Runtime Comparison (Node vs Bun vs Rust)
// ----------------------------------------------------------------------
async function runRuntimeSuite(testNs = [10, 50]) {
  console.log('\n======================================================');
  console.log(' SUITE 2: Subgraph Runtimes (Node vs Bun vs Rust)');
  console.log('======================================================');

  const runtimes = ['node', 'bun', 'rust'];

  for (const n of testNs) {
    console.log(`\n--- Runtime Comparison at N=${n} ---`);
    const comp = generateAndCompose(n);
    const wideQuery = buildWideUserQuery(n);

    for (const rt of runtimes) {
      console.log(`[Runtime: ${rt.toUpperCase()}] Starting server and router for N=${n}...`);
      const serverProc = await startSubgraphServer(rt);
      const routerProc = await startRouter(comp.supergraphPath);

      try {
        const res = await benchmarkPoint({
          name: `Runtime ${rt} N=${n}`,
          url: 'http://127.0.0.1:4000/',
          query: wideQuery,
          concurrency: 8,
          requests: 60
        });

        console.log(`  -> ${rt.toUpperCase()} Results: RPS=${res.rps} | p50=${res.p50}ms | p95=${res.p95}ms | p99=${res.p99}ms | Cold=${res.coldLatencyMs}ms`);
        results.runtimes.push({
          runtime: rt,
          n,
          rps: res.rps,
          p50: res.p50,
          p90: res.p90,
          p95: res.p95,
          p99: res.p99,
          coldMs: res.coldLatencyMs
        });
      } finally {
        killProcess(routerProc);
        killProcess(serverProc);
        await sleep(800);
      }
    }
  }
}

// ----------------------------------------------------------------------
// Suite 3: Query Resolver Latency Lever (0ms, 5ms, 20ms)
// ----------------------------------------------------------------------
async function runResolverDelaySuite(n = 20, delays = [0, 5, 20]) {
  console.log('\n======================================================');
  console.log(` SUITE 3: Query Resolver Latency (N=${n})`);
  console.log('======================================================');

  const comp = generateAndCompose(n);
  const wideQuery = buildWideUserQuery(n);

  for (const delay of delays) {
    console.log(`\n--- Resolver Delay = ${delay}ms ---`);
    const serverProc = await startSubgraphServer('node', { RESOLVER_DELAY_MS: delay });
    const routerProc = await startRouter(comp.supergraphPath);

    try {
      // Monograph
      const monoRes = await benchmarkPoint({
        name: `Monograph Delay=${delay}ms`,
        url: 'http://127.0.0.1:4002/graphql',
        query: wideQuery,
        headers: { 'x-resolver-delay-ms': String(delay) },
        concurrency: 8,
        requests: 50
      });

      // Router
      const routerRes = await benchmarkPoint({
        name: `Router Delay=${delay}ms`,
        url: 'http://127.0.0.1:4000/',
        query: wideQuery,
        headers: { 'x-resolver-delay-ms': String(delay) },
        concurrency: 8,
        requests: 50
      });

      console.log(`  -> Monograph: RPS=${monoRes.rps} | p50=${monoRes.p50}ms | p99=${monoRes.p99}ms`);
      console.log(`  -> Router:    RPS=${routerRes.rps} | p50=${routerRes.p50}ms | p99=${routerRes.p99}ms`);

      results.resolverDelays.push({
        resolverDelayMs: delay,
        n,
        monograph: { rps: monoRes.rps, p50: monoRes.p50, p95: monoRes.p95, p99: monoRes.p99 },
        router: { rps: routerRes.rps, p50: routerRes.p50, p95: routerRes.p95, p99: routerRes.p99 }
      });
    } finally {
      killProcess(routerProc);
      killProcess(serverProc);
      await sleep(800);
    }
  }
}

// ----------------------------------------------------------------------
// Suite 4: Network Transit Latency Lever (0ms, 2ms, 10ms)
// ----------------------------------------------------------------------
async function runTransitDelaySuite(n = 20, transitDelays = [0, 2, 10]) {
  console.log('\n======================================================');
  console.log(` SUITE 4: Time to Subgraph / Network Latency (N=${n})`);
  console.log('======================================================');

  const comp = generateAndCompose(n);
  const wideQuery = buildWideUserQuery(n);

  for (const transit of transitDelays) {
    console.log(`\n--- Network Transit Latency = ${transit}ms ---`);
    const serverProc = await startSubgraphServer('node', { TRANSIT_DELAY_MS: transit });
    const routerProc = await startRouter(comp.supergraphPath);

    try {
      const routerRes = await benchmarkPoint({
        name: `Router Transit=${transit}ms`,
        url: 'http://127.0.0.1:4000/',
        query: wideQuery,
        headers: { 'x-transit-delay-ms': String(transit) },
        concurrency: 8,
        requests: 50
      });

      console.log(`  -> Router Fan-out: RPS=${routerRes.rps} | p50=${routerRes.p50}ms | p95=${routerRes.p95}ms | p99=${routerRes.p99}ms`);

      results.transitDelays.push({
        transitDelayMs: transit,
        n,
        router: { rps: routerRes.rps, p50: routerRes.p50, p95: routerRes.p95, p99: routerRes.p99 }
      });
    } finally {
      killProcess(routerProc);
      killProcess(serverProc);
      await sleep(800);
    }
  }
}

// ----------------------------------------------------------------------
// Main Runner
// ----------------------------------------------------------------------
async function main() {
  console.log('>>> STARTING COMPREHENSIVE APOLLO SUBGRAPH BENCHMARK HARNESS <<<');
  const startTime = Date.now();

  try {
    // 1. Scaling N: 1, 2, 5, 10, 20, 35, 50, 75, 100, 150, 200, 250
    await runScalingSuite([1, 2, 5, 10, 20, 35, 50, 75, 100, 150, 200, 250]);

    // 2. Runtimes: Node vs Bun vs Rust at N=10 and N=50
    await runRuntimeSuite([10, 50]);

    // 3. Resolver Delays: 0ms, 5ms, 20ms at N=20
    await runResolverDelaySuite(20, [0, 5, 20]);

    // 4. Transit Delays: 0ms, 2ms, 10ms at N=20
    await runTransitDelaySuite(20, [0, 2, 10]);

    results.durationTotalSec = Number(((Date.now() - startTime) / 1000).toFixed(1));

    const outputPath = path.join(__dirname, 'benchmark_results.json');
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2), 'utf8');
    console.log(`\n======================================================`);
    console.log(`>>> BENCHMARKS COMPLETE in ${results.durationTotalSec}s <<<`);
    console.log(`>>> Saved results to: ${outputPath} <<<`);
    console.log(`======================================================\n`);
  } catch (err) {
    console.error('Fatal benchmark error:', err);
    process.exit(1);
  }
}

main();
