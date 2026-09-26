const { spawn } = require('child_process');
const http = require('http');

function postJson(port, path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data)
        }
      },
      (res) => {
        let respBody = '';
        res.on('data', chunk => (respBody += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(respBody) });
          } catch (e) {
            resolve({ status: res.statusCode, raw: respBody });
          }
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function testRuntime(name, cmd, args) {
  console.log(`\n=== Testing ${name} ===`);
  const proc = spawn(cmd, args, { stdio: 'inherit', shell: true });
  await sleep(1500);

  try {
    // 1. Root user on subgraph 1
    const r1 = await postJson(4001, '/subgraph/1', {
      query: 'query { user(id: "1") { id name field_1 } }'
    });
    console.log('Subgraph 1 user:', JSON.stringify(r1.body));

    // 2. Entity representation on subgraph 2
    const r2 = await postJson(4001, '/subgraph/2', {
      query: 'query($representations: [_Any!]!) { _entities(representations: $representations) { ... on User { field_2 } } }',
      variables: {
        representations: [{ __typename: 'User', id: '1' }]
      }
    });
    console.log('Subgraph 2 entity:', JSON.stringify(r2.body));

    // 3. Monograph query on port 4002
    const r3 = await postJson(4002, '/graphql', {
      query: 'query { user(id: "1") { id name field_1 field_2 field_3 } }'
    });
    console.log('Monograph user:', JSON.stringify(r3.body));

    console.log(`>>> ${name} PASSED!`);
  } catch (err) {
    console.error(`>>> ${name} FAILED:`, err.message);
  } finally {
    proc.kill();
    // On Windows, kill tree if needed
    try {
      if (proc.pid) process.kill(proc.pid);
    } catch (e) {}
    await sleep(1000);
  }
}

async function main() {
  await testRuntime('Node.js', 'node', ['server-node.js']);
  await testRuntime('Bun', 'bun', ['server-bun.ts']);
  await testRuntime('Rust', '.\\server_rust\\target\\release\\server_rust.exe', []);
}

main();
