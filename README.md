# Apollo Federation: How Many Subgraphs Is Too Many?

This repository contains the complete experimental test harness, benchmark driver, and research article investigating the architectural and performance limits of **Apollo Federation v2 (Apollo Router)** compared to a **Monograph baseline**, scaling from **1 to 250 subgraphs**.

---

## Read the Article
The full published article with all benchmarks, charts, and architectural takeaways is available here:
👉 **[HOW-MANY-SUBGRAPHS-IS-TOO-MANY.md](./HOW-MANY-SUBGRAPHS-IS-TOO-MANY.md)**

Project goals, levers, and methodology are documented in:
👉 **[GOAL.md](./GOAL.md)**

---

## Experimental Architecture

- **Single-Process Dynamic Subgraph Multiplexer**: Dynamically routes requests for any subgraph $i \in [1 \dots N]$ via `/subgraph/:id`, eliminating OS process overhead.
- **Three Subgraph Runtimes**:
  - `server-node.js`: Node.js v24 HTTP server.
  - `server-bun.ts`: Bun v1.3 native HTTP server.
  - `server_rust/`: Compiled multi-threaded Rust Axum/Tokio server.
- **Monograph Baseline**: Direct in-memory GraphQL resolution on port 4002.
- **Apollo Router v2.17**: Rust-based Apollo Router listening on port 4000.
- **Automated Composition**: `generator.js` dynamically generates subgraphs and invokes Rover v0.41.0 to compose `supergraph.graphql`.
- **High-Precision Benchmark Harness**: `run-benchmarks.js` and `benchmark-client.js` measure RPS, latency distributions (min, p50, p75, p90, p95, p99, max), cold query planning times, Rover composition times, and Router memory.

---

## How to Run the Benchmarks

### 1. Prerequisites
- Node.js (v20+)
- Bun (v1.0+)
- Rust & Cargo (1.80+)

### 2. Install Dependencies
```bash
npm install
```

### 3. Build Rust Subgraph Server
```bash
cargo build --release --manifest-path server_rust/Cargo.toml
```

### 4. Run the Complete Benchmark Suite
```bash
node run-benchmarks.js
```
All benchmark data will be output to console and saved as JSON in:
`benchmark_results.json`

---

## Project Structure
```
├── HOW-MANY-SUBGRAPHS-IS-TOO-MANY.md  # Final publication article
├── GOAL.md                           # Project goals, levers, and methodology
├── benchmark_results.json            # Empirical benchmark dataset
├── generator.js                      # Subgraph SDL & Rover supergraph composer
├── process-manager.js                # Lifecycle manager for Router & Subgraphs
├── benchmark-client.js               # Precision HTTP load generator & metrics
├── run-benchmarks.js                 # Complete multi-suite benchmark runner
├── server-node.js                    # Node.js dynamic subgraph & monograph server
├── server-bun.ts                     # Bun dynamic subgraph & monograph server
├── server_rust/                      # Rust Axum dynamic subgraph & monograph server
├── bin/                              # Precompiled Router, Rover, and Bun binaries
└── composed/                         # Composed supergraph SDLs (n_1 .. n_250)
```
