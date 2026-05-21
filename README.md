# PCR Load‑Testing PoC

A lightweight proof‑of‑concept for API load‑testing using **TypeScript**, **k6**, and **Docker**.

## Overview
- **Load test script** (`src/load-test.ts`) – k6 script written in TypeScript, supports GET, POST, **PUT**, **PATCH**, **DELETE**.
- **Report exporter** (`src/export.ts`) – parses k6 JSON reports and generates text and HTML performance summaries.
- **Mock API server** (`src/mock-server.ts`) – optional zero‑dependency Node server for local testing.
- **Shared types** (`src/types.ts`) – single source of truth for the `ApiRoute` interface.

## Prerequisites
- **Docker Desktop** (for running the full test suite)
- **Node.js ≥ 16** (for local development and report generation)
- **k6** (installed globally or via Docker)
- `npm`

## Quickstart (Docker – Recommended)
```bash
# Build and run the full test suite in Docker
docker compose up --build
```

The Docker Compose setup:
1. Runs a k6 container that executes the load test against the mock server
2. Generates `report.json` with test metrics
3. Automatically parses and generates `performance_summary.txt` and `report.html`

## Local Development

### Setup
```bash
# Install dependencies
npm install

# Verify TypeScript compilation
npm run build

# Copy a sample config if needed
cp apis_config.json.sample apis_config.json
```

### Running the Load Test Manually
```bash
# Option 1: Run k6 directly (requires k6 installed)
k6 run --summary-export=report.json src/load-test.ts

# Option 2: Run k6 from Docker
docker run --rm -v $PWD:/workspace -w /workspace grafana/k6 run --summary-export=report.json src/load-test.ts
```

### Generating Reports
After k6 generates a `report.json`, parse it:

```bash
npm run build  # Build export.ts to dist/export.js
node dist/export.js report.json
```

This generates:
- `performance_summary.txt` – ASCII table with results
- `report.html` – styled HTML report
- Console output with summary

## Project Structure
```
├─ src/                     # TypeScript source files
│   ├─ export.ts            # Parse and report test results
│   ├─ mock-server.ts       # Mock API implementation
│   ├─ load-test.ts         # k6 script
│   └─ types.ts             # Shared ApiRoute interface
├─ apis_config.json         # API route definitions (real config)
├─ apis_config.json.sample  # Template for new users
├─ .env.sample              # Example environment file
├─ docker-compose.yml       # Docker services
├─ Dockerfile.mock          # Build image for mock server (used by compose)
├─ package.json             # npm scripts & dependencies
└─ tsconfig.json            # TypeScript compiler options
```

## Contributing
1. Fork the repo.
2. Create a feature branch.
3. Make changes and ensure `npm run build` succeeds.
4. Open a Pull Request.

## License
MIT – feel free to use, modify, and distribute.

│   ├─ load-test.ts         # k6 load test script (TypeScript)
│   ├─ export.ts            # Report generation utility
│   ├─ mock-server.ts       # Optional mock API server
│   └─ types.ts             # Shared interfaces (ApiRoute)
├─ .github/workflows/
│   └─ load-test.yml        # CI/CD pipeline
├─ apis_config.json         # API configuration (production)
├─ apis_config.json.sample  # Configuration template
├─ docker-compose.yml       # Docker services definition
├─ Dockerfile               # Mock server Docker image
├─ package.json             # npm scripts & dependencies
└─ tsconfig.json            # TypeScript configuration
```

## Environment Variables
Set via `.env` file or environment:

```bash
# k6 execution
CONCURRENT_USERS=5              # Number of virtual users
REQUESTS_PER_USER=30            # Iterations per VU
TARGET_URL=http://localhost:8080  # Target API (optional, used in export.ts)

# Mock server (if running locally)
PORT=8080
```