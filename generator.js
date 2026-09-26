const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Generates subgraph SDLs, supergraph.yaml, and executes Rover composition for N subgraphs.
 * Returns { durationMs, schemaSizeKb, supergraphPath }
 */
function generateAndCompose(n, baseDir = __dirname) {
  const targetDir = path.join(baseDir, 'composed', `n_${n}`);
  const subgraphsDir = path.join(targetDir, 'subgraphs');

  fs.mkdirSync(subgraphsDir, { recursive: true });

  const yamlLines = [
    'federation_version: =2.11.0',
    'subgraphs:'
  ];

  for (let i = 1; i <= n; i++) {
    const subgraphName = `subgraph_${i}`;
    const sdlPath = path.join(subgraphsDir, `${subgraphName}.graphql`);

    let sdl;
    if (i === 1) {
      sdl = `extend schema
  @link(url: "https://specs.apollo.dev/federation/v2.0", import: ["@key", "@shareable"])

type Query {
  user(id: ID!): User
  ping_1: String
}

type User @key(fields: "id") {
  id: ID!
  name: String
  field_1: String
}
`;
    } else {
      sdl = `extend schema
  @link(url: "https://specs.apollo.dev/federation/v2.0", import: ["@key", "@shareable"])

type Query {
  ping_${i}: String
}

type User @key(fields: "id") {
  id: ID!
  field_${i}: String
}
`;
    }

    fs.writeFileSync(sdlPath, sdl.trim() + '\n', 'utf8');

    yamlLines.push(`  ${subgraphName}:`);
    yamlLines.push(`    routing_url: http://127.0.0.1:4001/subgraph/${i}`);
    yamlLines.push(`    schema:`);
    yamlLines.push(`      file: ./subgraphs/${subgraphName}.graphql`);
  }

  const yamlPath = path.join(targetDir, 'supergraph.yaml');
  fs.writeFileSync(yamlPath, yamlLines.join('\n') + '\n', 'utf8');

  const roverPath = path.join(baseDir, 'bin', 'rover.exe');
  const supergraphOutPath = path.join(targetDir, 'supergraph.graphql');

  console.log(`Composing supergraph for N=${n}...`);
  const startTime = Date.now();

  try {
    const stdout = execSync(
      `"${roverPath}" supergraph compose --config "${yamlPath}" --elv2-license accept`,
      { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 }
    );
    const durationMs = Date.now() - startTime;
    fs.writeFileSync(supergraphOutPath, stdout, 'utf8');
    const stats = fs.statSync(supergraphOutPath);
    const schemaSizeKb = (stats.size / 1024).toFixed(2);

    console.log(`Composed N=${n} in ${durationMs}ms (Schema size: ${schemaSizeKb} KB)`);
    return {
      success: true,
      n,
      durationMs,
      schemaSizeKb: parseFloat(schemaSizeKb),
      supergraphPath: supergraphOutPath
    };
  } catch (err) {
    console.error(`Composition failed for N=${n}:`, err.message);
    return {
      success: false,
      n,
      error: err.message
    };
  }
}

module.exports = { generateAndCompose };

if (require.main === module) {
  const n = parseInt(process.argv[2] || '5', 10);
  const res = generateAndCompose(n);
  console.log('Result:', JSON.stringify(res, null, 2));
}
