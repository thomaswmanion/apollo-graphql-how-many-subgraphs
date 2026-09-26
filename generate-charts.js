const fs = require('fs');
const path = require('path');

const assetsDir = path.join(__dirname, 'assets');
if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });

// Data points for Throughput (RPS) across frameworks:
// N: [1, 10, 50, 100, 200, 400]
const rpsData = {
  n: [1, 10, 50, 100, 200, 400],
  monograph: [4267, 4317, 4623, 4235, 4100, 4000],
  rust: [4174, 1777, 499, 243, 85, 43.5],
  bun: [3190, 1226, 208, 91, 45, 20],
  node: [3408, 551, 126, 72, 33, 12]
};

// Data points for Latency (p50 ms) and Cold Plan Delay (ms):
const latencyData = {
  n: [1, 10, 50, 100, 200, 400],
  monographP50: [2.0, 1.9, 1.8, 1.8, 1.8, 1.9],
  rustP50: [1.7, 4.2, 11.2, 22.6, 38.0, 58.5],
  bunP50: [2.7, 7.4, 45.1, 61.0, 110.0, 185.0],
  nodeP50: [2.2, 16.7, 70.5, 79.6, 138.1, 240.0],
  coldPlanMs: [4.9, 13.2, 44.4, 90.2, 408.6, 9875.4]
};

// Data points for Rover Composition (ms) & Router Memory (MB):
const opsData = {
  n: [1, 10, 50, 100, 150, 200, 250, 300, 400],
  composeMs: [779, 531, 808, 1426, 2289, 3833, 8151, 11959, 23303],
  memoryMb: [42.1, 45.0, 58.4, 76.5, 111.3, 164.3, 245.2, 380.0, 789.8]
};

// ----------------------------------------------------------------------
// CHART 1: Throughput (RPS) Scaling Curve
// ----------------------------------------------------------------------
function generateThroughputSvg() {
  const width = 850;
  const height = 480;
  const pad = { top: 60, right: 180, bottom: 60, left: 70 };

  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  const maxRps = 5000;
  const maxN = 400;

  // Scale functions
  const x = (val) => pad.left + (Math.log10(val) / Math.log10(maxN)) * innerW;
  const y = (val) => pad.top + innerH - (val / maxRps) * innerH;

  const lines = [];

  // Background
  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`);
  lines.push(`<rect width="100%" height="100%" fill="#0d1117" rx="12"/>`);

  // Title
  lines.push(`<text x="${width / 2}" y="32" fill="#f0f6fc" font-size="18" font-weight="700" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif" text-anchor="middle">Throughput (RPS) Under Fan-out vs. Number of Subgraphs (Log-X Scale)</text>`);

  // Grid Lines & Y Axis
  for (let r = 0; r <= 5000; r += 1000) {
    const yPos = y(r);
    lines.push(`<line x1="${pad.left}" y1="${yPos}" x2="${pad.left + innerW}" y2="${yPos}" stroke="#21262d" stroke-dasharray="3,3" />`);
    lines.push(`<text x="${pad.left - 10}" y="${yPos + 4}" fill="#8b949e" font-size="12" font-family="sans-serif" text-anchor="end">${r}</text>`);
  }

  // X Axis points: 1, 10, 50, 100, 200, 400
  const xTicks = [1, 2, 5, 10, 25, 50, 100, 200, 400];
  for (const t of xTicks) {
    const xPos = x(t);
    lines.push(`<line x1="${xPos}" y1="${pad.top}" x2="${xPos}" y2="${pad.top + innerH}" stroke="#21262d" stroke-dasharray="2,2" />`);
    lines.push(`<text x="${xPos}" y="${pad.top + innerH + 20}" fill="#8b949e" font-size="12" font-family="sans-serif" text-anchor="middle">N=${t}</text>`);
  }

  // Draw Path Helper
  function drawPath(dataArr, color, strokeW = 3, dash = '') {
    const pts = rpsData.n.map((nVal, i) => `${x(nVal)},${y(dataArr[i])}`).join(' ');
    lines.push(`<polyline fill="none" stroke="${color}" stroke-width="${strokeW}" ${dash ? `stroke-dasharray="${dash}"` : ''} points="${pts}" />`);
    rpsData.n.forEach((nVal, i) => {
      lines.push(`<circle cx="${x(nVal)}" cy="${y(dataArr[i])}" r="4" fill="${color}" stroke="#0d1117" stroke-width="2"/>`);
    });
  }

  // Curves
  drawPath(rpsData.monograph, '#58a6ff', 3, '6,4'); // Monograph (Dashed Blue)
  drawPath(rpsData.rust, '#f78166', 3.5);           // Native Rust (Orange/Red)
  drawPath(rpsData.bun, '#e3b341', 3);              // Bun 1.4 (Gold)
  drawPath(rpsData.node, '#56d364', 3);             // Node.js (Green)

  // Legend
  const legX = pad.left + innerW + 20;
  let legY = pad.top + 20;

  const series = [
    { label: 'Monograph (Flat ~4.2k)', color: '#58a6ff', dash: 'dashed' },
    { label: 'Rust Axum (Port 4000)', color: '#f78166' },
    { label: 'Bun 1.4 Rust (Port 4000)', color: '#e3b341' },
    { label: 'Node.js v24 (Port 4000)', color: '#56d364' },
  ];

  series.forEach((s) => {
    lines.push(`<line x1="${legX}" y1="${legY}" x2="${legX + 24}" y2="${legY}" stroke="${s.color}" stroke-width="3" ${s.dash ? 'stroke-dasharray="4,3"' : ''}/>`);
    lines.push(`<circle cx="${legX + 12}" cy="${legY}" r="4" fill="${s.color}"/>`);
    lines.push(`<text x="${legX + 32}" y="${legY + 4}" fill="#c9d1d9" font-size="12" font-family="sans-serif">${s.label}</text>`);
    legY += 28;
  });

  // Highlight Box for Extreme Scale N=400
  lines.push(`<rect x="${x(400) - 35}" y="${pad.top + 10}" width="70" height="24" fill="#ff7b72" fill-opacity="0.15" stroke="#ff7b72" rx="4"/>`);
  lines.push(`<text x="${x(400)}" y="${pad.top + 26}" fill="#ff7b72" font-size="11" font-weight="700" font-family="sans-serif" text-anchor="middle">N=400</text>`);

  lines.push(`</svg>`);
  return lines.join('\n');
}

// ----------------------------------------------------------------------
// CHART 2: Latency & Cold Query Planning Spike (Log-Y Scale)
// ----------------------------------------------------------------------
function generateLatencySvg() {
  const width = 850;
  const height = 480;
  const pad = { top: 60, right: 200, bottom: 60, left: 75 };

  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  // Log scale for Y: from 1ms to 10,000ms (10s)
  const minY = 1;
  const maxY = 15000;
  const logMin = Math.log10(minY);
  const logMax = Math.log10(maxY);

  const x = (val) => pad.left + (Math.log10(val) / Math.log10(400)) * innerW;
  const y = (val) => pad.top + innerH - ((Math.log10(Math.max(val, minY)) - logMin) / (logMax - logMin)) * innerH;

  const lines = [];
  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`);
  lines.push(`<rect width="100%" height="100%" fill="#0d1117" rx="12"/>`);

  // Title
  lines.push(`<text x="${width / 2}" y="32" fill="#f0f6fc" font-size="18" font-weight="700" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif" text-anchor="middle">Fan-Out Latency & Cold Query Plan Explosion (Log-Log Scale)</text>`);

  // Y Grid lines: 1ms, 10ms, 100ms, 1000ms (1s), 10000ms (10s)
  const yTicks = [1, 10, 100, 1000, 10000];
  yTicks.forEach((yt) => {
    const yPos = y(yt);
    lines.push(`<line x1="${pad.left}" y1="${yPos}" x2="${pad.left + innerW}" y2="${yPos}" stroke="#21262d" stroke-dasharray="3,3" />`);
    const label = yt >= 1000 ? `${yt / 1000}s` : `${yt}ms`;
    lines.push(`<text x="${pad.left - 10}" y="${yPos + 4}" fill="#8b949e" font-size="12" font-family="sans-serif" text-anchor="end">${label}</text>`);
  });

  // X Axis points
  const xTicks = [1, 2, 5, 10, 25, 50, 100, 200, 400];
  for (const t of xTicks) {
    const xPos = x(t);
    lines.push(`<line x1="${xPos}" y1="${pad.top}" x2="${xPos}" y2="${pad.top + innerH}" stroke="#21262d" stroke-dasharray="2,2" />`);
    lines.push(`<text x="${xPos}" y="${pad.top + innerH + 20}" fill="#8b949e" font-size="12" font-family="sans-serif" text-anchor="middle">N=${t}</text>`);
  }

  function drawPath(dataArr, color, strokeW = 3, dash = '') {
    const pts = latencyData.n.map((nVal, i) => `${x(nVal)},${y(dataArr[i])}`).join(' ');
    lines.push(`<polyline fill="none" stroke="${color}" stroke-width="${strokeW}" ${dash ? `stroke-dasharray="${dash}"` : ''} points="${pts}" />`);
    latencyData.n.forEach((nVal, i) => {
      lines.push(`<circle cx="${x(nVal)}" cy="${y(dataArr[i])}" r="4" fill="${color}" stroke="#0d1117" stroke-width="2"/>`);
    });
  }

  // Draw lines
  drawPath(latencyData.coldPlanMs, '#ff7b72', 3.5);           // Cold Plan (Red)
  drawPath(latencyData.nodeP50, '#56d364', 2.5);              // Node p50 (Green)
  drawPath(latencyData.bunP50, '#e3b341', 2.5);               // Bun p50 (Gold)
  drawPath(latencyData.rustP50, '#a371f7', 2.5);              // Rust p50 (Purple)
  drawPath(latencyData.monographP50, '#58a6ff', 2.5, '5,3');  // Monograph (Dashed Blue)

  // Legend
  const legX = pad.left + innerW + 18;
  let legY = pad.top + 20;

  const series = [
    { label: 'Cold Plan Time (Router)', color: '#ff7b72' },
    { label: 'Node.js p50 Latency', color: '#56d364' },
    { label: 'Bun 1.4 p50 Latency', color: '#e3b341' },
    { label: 'Rust Axum p50 Latency', color: '#a371f7' },
    { label: 'Monograph p50 (~1.8ms)', color: '#58a6ff', dash: 'dashed' },
  ];

  series.forEach((s) => {
    lines.push(`<line x1="${legX}" y1="${legY}" x2="${legX + 24}" y2="${legY}" stroke="${s.color}" stroke-width="3" ${s.dash ? 'stroke-dasharray="4,3"' : ''}/>`);
    lines.push(`<circle cx="${legX + 12}" cy="${legY}" r="4" fill="${s.color}"/>`);
    lines.push(`<text x="${legX + 32}" y="${legY + 4}" fill="#c9d1d9" font-size="12" font-family="sans-serif">${s.label}</text>`);
    legY += 28;
  });

  // Callout for Cold Plan at N=400: ~9.9s
  const x400 = x(400);
  const y400 = y(9875.4);
  lines.push(`<text x="${x400 - 10}" y="${y400 - 10}" fill="#ff7b72" font-size="12" font-weight="700" font-family="sans-serif" text-anchor="end">Cold Plan: 9.88s!</text>`);
  lines.push(`<line x1="${x400 - 8}" y1="${y400 - 6}" x2="${x400}" y2="${y400}" stroke="#ff7b72" stroke-width="2"/>`);

  lines.push(`</svg>`);
  return lines.join('\n');
}

// ----------------------------------------------------------------------
// CHART 3: Rover Composition Time & Router Memory Footprint
// ----------------------------------------------------------------------
function generateOpsSvg() {
  const width = 850;
  const height = 480;
  const pad = { top: 60, right: 180, bottom: 60, left: 75 };

  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  const maxN = 400;
  const maxCompose = 25000; // 25s
  const maxMem = 900;       // 900 MB

  const x = (val) => pad.left + (val / maxN) * innerW;
  const yCompose = (val) => pad.top + innerH - (val / maxCompose) * innerH;
  const yMem = (val) => pad.top + innerH - (val / maxMem) * innerH;

  const lines = [];
  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`);
  lines.push(`<rect width="100%" height="100%" fill="#0d1117" rx="12"/>`);

  // Title
  lines.push(`<text x="${width / 2}" y="32" fill="#f0f6fc" font-size="18" font-weight="700" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif" text-anchor="middle">Rover Composition Time & Apollo Router Memory Growth</text>`);

  // Left Y Axis (Composition Time in sec)
  for (let s = 0; s <= 25; s += 5) {
    const yPos = yCompose(s * 1000);
    lines.push(`<line x1="${pad.left}" y1="${yPos}" x2="${pad.left + innerW}" y2="${yPos}" stroke="#21262d" stroke-dasharray="3,3" />`);
    lines.push(`<text x="${pad.left - 10}" y="${yPos + 4}" fill="#ff7b72" font-size="12" font-family="sans-serif" text-anchor="end">${s}s</text>`);
  }

  // Right Y Axis (Router Memory in MB)
  for (let m = 0; m <= 900; m += 150) {
    const yPos = yMem(m);
    lines.push(`<text x="${pad.left + innerW + 12}" y="${yPos + 4}" fill="#79c0ff" font-size="12" font-family="sans-serif" text-anchor="start">${m} MB</text>`);
  }

  // X Axis (Linear N from 0 to 400)
  for (let n = 0; n <= 400; n += 50) {
    const xPos = x(n);
    lines.push(`<line x1="${xPos}" y1="${pad.top}" x2="${xPos}" y2="${pad.top + innerH}" stroke="#21262d" stroke-dasharray="2,2" />`);
    lines.push(`<text x="${xPos}" y="${pad.top + innerH + 20}" fill="#8b949e" font-size="12" font-family="sans-serif" text-anchor="middle">N=${n}</text>`);
  }

  // Draw Composition Path (Red Curve - O(N^2))
  const compPts = opsData.n.map((nVal, i) => `${x(nVal)},${yCompose(opsData.composeMs[i])}`).join(' ');
  lines.push(`<polyline fill="none" stroke="#ff7b72" stroke-width="3.5" points="${compPts}" />`);
  opsData.n.forEach((nVal, i) => {
    lines.push(`<circle cx="${x(nVal)}" cy="${yCompose(opsData.composeMs[i])}" r="4" fill="#ff7b72" stroke="#0d1117" stroke-width="2"/>`);
  });

  // Draw Memory Path (Blue Curve)
  const memPts = opsData.n.map((nVal, i) => `${x(nVal)},${yMem(opsData.memoryMb[i])}`).join(' ');
  lines.push(`<polyline fill="none" stroke="#79c0ff" stroke-width="3" stroke-dasharray="5,4" points="${memPts}" />`);
  opsData.n.forEach((nVal, i) => {
    lines.push(`<circle cx="${x(nVal)}" cy="${yMem(opsData.memoryMb[i])}" r="4" fill="#79c0ff" stroke="#0d1117" stroke-width="2"/>`);
  });

  // Legend
  const legX = pad.left + 20;
  let legY = pad.top + 25;

  lines.push(`<rect x="${legX - 10}" y="${legY - 15}" width="250" height="70" fill="#161b22" stroke="#30363d" rx="6"/>`);

  lines.push(`<line x1="${legX}" y1="${legY}" x2="${legX + 24}" y2="${legY}" stroke="#ff7b72" stroke-width="3"/>`);
  lines.push(`<circle cx="${legX + 12}" cy="${legY}" r="4" fill="#ff7b72"/>`);
  lines.push(`<text x="${legX + 32}" y="${legY + 4}" fill="#ff7b72" font-size="12" font-weight="700" font-family="sans-serif">Rover Compose Time (Left Axis)</text>`);

  lines.push(`<line x1="${legX}" y1="${legY + 28}" x2="${legX + 24}" y2="${legY + 28}" stroke="#79c0ff" stroke-width="3" stroke-dasharray="5,4"/>`);
  lines.push(`<circle cx="${legX + 12}" cy="${legY + 28}" r="4" fill="#79c0ff"/>`);
  lines.push(`<text x="${legX + 32}" y="${legY + 32}" fill="#79c0ff" font-size="12" font-weight="700" font-family="sans-serif">Router Memory Footprint (Right Axis)</text>`);

  lines.push(`</svg>`);
  return lines.join('\n');
}

fs.writeFileSync(path.join(assetsDir, 'chart_throughput_scaling.svg'), generateThroughputSvg(), 'utf8');
fs.writeFileSync(path.join(assetsDir, 'chart_latency_coldplan.svg'), generateLatencySvg(), 'utf8');
fs.writeFileSync(path.join(assetsDir, 'chart_composition_memory.svg'), generateOpsSvg(), 'utf8');

console.log('Successfully generated all 3 high-resolution SVG benchmark charts in ./assets/');
