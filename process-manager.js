const { spawn, execSync } = require('child_process');
const http = require('http');
const path = require('path');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function killProcess(proc) {
  if (!proc || !proc.pid) return;
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /F /T /PID ${proc.pid}`, { stdio: 'ignore' });
    } else {
      process.kill(-proc.pid);
    }
  } catch (e) {
    // Process might already be stopped
  }
}

function checkHttp(port, pathStr = '/') {
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: pathStr,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        timeout: 1000
      },
      (res) => {
        resolve(res.statusCode > 0);
      }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.write(JSON.stringify({ query: '{ __typename }' }));
    req.end();
  });
}

async function waitForPort(port, pathStr = '/', timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await checkHttp(port, pathStr);
    if (ok) return true;
    await sleep(200);
  }
  return false;
}

/**
 * Spawns a subgraph/monograph server for a given runtime.
 * @param {'node'|'bun'|'rust'} runtime
 * @param {Object} envOpts { RESOLVER_DELAY_MS, TRANSIT_DELAY_MS }
 * @returns {ChildProcess}
 */
async function startSubgraphServer(runtime, envOpts = {}) {
  const env = {
    ...process.env,
    SUBGRAPH_PORT: '4001',
    MONOGRAPH_PORT: '4002',
    RESOLVER_DELAY_MS: String(envOpts.RESOLVER_DELAY_MS || 0),
    TRANSIT_DELAY_MS: String(envOpts.TRANSIT_DELAY_MS || 0)
  };

  let proc;
  if (runtime === 'node') {
    proc = spawn('node', ['server-node.js'], { env, stdio: 'pipe' });
  } else if (runtime === 'bun') {
    const bunExe = path.join(__dirname, 'bin', 'bun.exe');
    proc = spawn(bunExe, ['server-bun.ts'], { env, stdio: 'pipe' });
  } else if (runtime === 'rust') {
    const exePath = path.join(__dirname, 'server_rust', 'target', 'release', 'server_rust.exe');
    proc = spawn(exePath, [], { env, stdio: 'pipe' });
  } else {
    throw new Error(`Unknown runtime: ${runtime}`);
  }

  proc.on('error', (err) => {
    console.error(`[ProcessManager] ${runtime} failed to spawn:`, err.message);
  });

  const ready = await waitForPort(4001, '/subgraph/1', 15000);
  if (!ready) {
    killProcess(proc);
    throw new Error(`Failed to start ${runtime} server on port 4001 within timeout.`);
  }

  return proc;
}

/**
 * Spawns Apollo Router with a given supergraph schema path.
 * @param {string} supergraphPath
 * @returns {ChildProcess}
 */
async function startRouter(supergraphPath) {
  const routerExe = path.join(__dirname, 'bin', 'router.exe');
  const configPath = path.join(__dirname, 'router.yaml');

  const proc = spawn(
    routerExe,
    [
      '-s', supergraphPath,
      '-c', configPath,
      '--anonymous-telemetry-disabled',
      '--log', 'warn',
      '--listen', '127.0.0.1:4000'
    ],
    { stdio: 'pipe' }
  );

  proc.on('error', (err) => {
    console.error('[ProcessManager] Apollo Router failed to spawn:', err.message);
  });

  const ready = await waitForPort(4000, '/', 20000);
  if (!ready) {
    killProcess(proc);
    throw new Error(`Failed to start Apollo Router on port 4000 within timeout.`);
  }

  return proc;
}

module.exports = {
  startSubgraphServer,
  startRouter,
  killProcess,
  sleep
};
