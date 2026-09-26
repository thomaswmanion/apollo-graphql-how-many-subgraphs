# Project Goal: How Many Subgraphs Is Too Many Subgraphs for Apollo?

## 1. Executive Summary & Core Question
The primary question this project investigates and answers is:
> **"How many subgraphs is too many subgraphs for Apollo Federation?"**

In the GraphQL community, micro-frontends and microservice-oriented architectures frequently push Apollo Federation to its limits. Teams wonder:
- When does query planning overhead eclipse query execution time?
- What are the physical and architectural inflection points where adding more subgraphs degrades performance or operational viability?
- How do different backend runtimes (Node.js, Bun, Rust) and network/resolver dynamics change that equation?

This project builds a reproducible benchmark harness and conducts empirical experiments comparing:
1. **Monograph baseline** (direct single-process GraphQL service executing the full schema).
2. **Federated Apollo Router** managing 1, 2, 5, 10, 25, 50, 100, and up to $N$ subgraphs.

The final deliverable is an in-depth, publication-ready markdown article detailing the findings, inflection points, bottlenecks, and recommendations.

---

## 2. Experimental Levers & Variables
To provide a complete architectural analysis, the testbed benchmarks multiple dimensions:

1. **Subgraph Runtime Implementations:**
   - **Node.js** (e.g. `@apollo/subgraph` / `graphql-yoga` / `express` or `fastify`)
   - **Bun** (high-performance JavaScript/TypeScript runtime with native HTTP and GraphQL)
   - **Rust** (high-performance compiled backend using `async-graphql` or `axum`)

2. **Query Resolver Latency:**
   - Synthetic resolver delay (simulating database / downstream service execution: 0ms, 5ms, 20ms, 50ms).

3. **Time to Subgraph (Network / Dispatch Latency):**
   - Simulated transport / transit latency from Apollo Router to subgraphs (e.g., local 0ms vs 2ms intra-cluster vs 15ms cross-zone).

4. **Query Topology & Fan-out:**
   - **Narrow queries**: Targeting 1 or 2 subgraphs out of $N$.
   - **Wide queries**: Distributed fan-out queries stitching entities across all $N$ subgraphs simultaneously.
   - **Entity batching & representation lookups**: Measuring `_entities` resolution efficiency across subgraphs.

5. **Scaling $N$ (Number of Subgraphs):**
   - Progressive scaling from 1 to $N$ ($1, 2, 5, 10, 25, 50, 100, \dots$) until inflection points or bottlenecks emerge.

---

## 3. Architecture & Safety Design: Single-Process Multiplexed Subgraph Server
To avoid overwhelming the host PC with hundreds of distinct operating system processes:
- **Single Process for $N$ Subgraphs**: A single backend process multiplexes requests for all $N$ subgraphs.
- **Dynamic Routing**: Subgraph identity is determined dynamically at runtime via URL path (e.g. `/subgraph/:id`) or header (`x-subgraph-id`).
- **Federation Supergraph Composition**: Automated generation of valid Apollo Federation v2 supergraph schemas composed of $N$ dynamically mounted subgraphs.
- **Resource Protections**: Guardrails on memory, thread count, and request timeouts so the test harness never starves or freezes the host machine.

---

## 4. Execution Phases & Milestones

- [ ] **Phase 1: Environment & Tooling Verification**
  - Verify installed runtimes: Node.js, Bun, Rust (`cargo`), Apollo Router (`router`), and Rover CLI (`rover`).
  - Install or provide binaries where needed.
- [ ] **Phase 2: Benchmark Architecture & Subgraph Generators**
  - Design unified schema model (Entities, `@key`, `@shareable`, relationships across subgraphs).
  - Implement the single-process dynamic subgraph server for Node.js, Bun, and Rust.
  - Implement the Monograph baseline server for direct comparison.
- [ ] **Phase 3: Automated Supergraph Composition & Federation Pipeline**
  - Tooling to automatically generate subgraph schemas and compose valid `supergraph.graphql` files for any arbitrary $N$.
  - Automated Apollo Router configuration (`router.yaml`).
- [ ] **Phase 4: Benchmarking Suite & Metrics Collection**
  - Implement load/benchmark driver (measuring RPS, p50, p95, p99, router planning time, CPU/memory).
  - Execute test matrix across runtimes, resolver latencies, network latencies, and $N$ subgraph values.
- [ ] **Phase 5: Data Analysis & Inflection Point Identification**
  - Locate the exact tipping point where $N$ becomes problematic (Query Planning overhead, connection overhead, memory footprint, composition limits).
- [ ] **Phase 6: Final Publication Article**
  - Write `how-many-subgraphs-is-too-many.md` containing rich explanations, benchmarks, charts/diagrams, architectural insights, and clear guidelines.
