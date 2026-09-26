const http = require('http');

/**
 * High-precision benchmarking client for GraphQL endpoints.
 */
class BenchmarkClient {
  constructor(baseUrl = 'http://127.0.0.1:4000') {
    this.baseUrl = baseUrl;
    this.agent = new http.Agent({
      keepAlive: true,
      maxSockets: 128,
      maxFreeSockets: 64,
      timeout: 30000
    });
  }

  /**
   * Execute a single GraphQL request and return { latencyMs, status, data, errors }
   */
  execute(query, variables = {}, headers = {}) {
    return new Promise((resolve) => {
      const payload = JSON.stringify({ query, variables });
      const url = new URL(this.baseUrl);

      const reqHeaders = {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'Accept': 'application/json',
        ...headers
      };

      const startTime = process.hrtime.bigint();

      const req = http.request(
        {
          hostname: url.hostname,
          port: url.port,
          path: url.pathname || '/',
          method: 'POST',
          headers: reqHeaders,
          agent: this.agent
        },
        (res) => {
          let body = '';
          res.on('data', (chunk) => {
            body += chunk;
          });
          res.on('end', () => {
            const endTime = process.hrtime.bigint();
            const latencyMs = Number(endTime - startTime) / 1e6;

            let parsed;
            try {
              parsed = JSON.parse(body);
            } catch (e) {
              parsed = { raw: body };
            }

            resolve({
              success: res.statusCode >= 200 && res.statusCode < 300 && !parsed.errors,
              statusCode: res.statusCode,
              latencyMs,
              data: parsed.data,
              errors: parsed.errors
            });
          });
        }
      );

      req.on('error', (err) => {
        const endTime = process.hrtime.bigint();
        const latencyMs = Number(endTime - startTime) / 1e6;
        resolve({
          success: false,
          statusCode: 0,
          latencyMs,
          error: err.message
        });
      });

      req.write(payload);
      req.end();
    });
  }

  /**
   * Warm-up and run a load benchmark with a given concurrency and total requests.
   */
  async runLoad({
    query,
    variables = {},
    headers = {},
    concurrency = 10,
    requests = 200,
    warmupRequests = 10
  }) {
    // 1. Measure Cold Request
    const coldResult = await this.execute(query, variables, headers);

    // 2. Warm up
    for (let i = 0; i < warmupRequests; i++) {
      await this.execute(query, variables, headers);
    }

    // 3. Benchmarked Requests
    const latencies = [];
    let successCount = 0;
    let errorCount = 0;
    let completed = 0;
    let index = 0;

    const overallStart = process.hrtime.bigint();

    const worker = async () => {
      while (true) {
        const currentIdx = index++;
        if (currentIdx >= requests) break;

        const res = await this.execute(query, variables, headers);
        latencies.push(res.latencyMs);
        if (res.success) {
          successCount++;
        } else {
          errorCount++;
        }
        completed++;
      }
    };

    const workers = [];
    for (let c = 0; c < concurrency; c++) {
      workers.push(worker());
    }
    await Promise.all(workers);

    const overallEnd = process.hrtime.bigint();
    const totalDurationSec = Number(overallEnd - overallStart) / 1e9;

    latencies.sort((a, b) => a - b);

    const getPercentile = (p) => {
      if (latencies.length === 0) return 0;
      const idx = Math.min(Math.floor((p / 100) * latencies.length), latencies.length - 1);
      return Number(latencies[idx].toFixed(2));
    };

    const sum = latencies.reduce((acc, v) => acc + v, 0);
    const mean = latencies.length ? Number((sum / latencies.length).toFixed(2)) : 0;
    const rps = totalDurationSec > 0 ? Number((completed / totalDurationSec).toFixed(1)) : 0;

    return {
      coldLatencyMs: Number(coldResult.latencyMs.toFixed(2)),
      coldSuccess: coldResult.success,
      requests: completed,
      concurrency,
      durationSec: Number(totalDurationSec.toFixed(3)),
      rps,
      successCount,
      errorCount,
      min: latencies.length ? Number(latencies[0].toFixed(2)) : 0,
      p50: getPercentile(50),
      p75: getPercentile(75),
      p90: getPercentile(90),
      p95: getPercentile(95),
      p99: getPercentile(99),
      max: latencies.length ? Number(latencies[latencies.length - 1].toFixed(2)) : 0,
      mean
    };
  }

  destroy() {
    this.agent.destroy();
  }
}

module.exports = { BenchmarkClient };
