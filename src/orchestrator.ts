import { buildSync } from 'esbuild';
import { execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

// 1. Parse .env file manually (zero-dependency)
function loadEnv() {
  try {
    const envPath = path.resolve(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      content.split(/\r?\n/).forEach(line => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx !== -1) {
            const key = trimmed.substring(0, eqIdx).trim();
            const val = trimmed.substring(eqIdx + 1).trim();
            process.env[key] = val;
          }
        }
      });
    }
  } catch (err) {
    console.warn('Warning: Could not read .env file:', err);
  }
}

loadEnv();

const mockPort = process.env.PORT ? parseInt(process.env.PORT) : 8080;
const targetUrl = process.env.TARGET_URL || `http://localhost:${mockPort}`;
const concurrentUsers = process.env.CONCURRENT_USERS || '5';
const requestsPerUser = process.env.REQUESTS_PER_USER || '30';

// Helper to ensure clean dist directory
function ensureDir(dirPath: string) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

// 2. Perform TypeScript Transpilation via esbuild
function transpileCodebase() {
  console.log('--- Transpiling TypeScript Codebase ---');
  ensureDir('dist');

  // Bundle mock server (Node environment, CommonJS)
  buildSync({
    entryPoints: [path.resolve(process.cwd(), 'src/mock-server.ts')],
    outfile: path.resolve(process.cwd(), 'dist/mock-server.js'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node16',
    logLevel: 'info',
  });

  // Bundle k6 test script (ESM, neutral environment with external k6 typings)
  buildSync({
    entryPoints: [path.resolve(process.cwd(), 'src/load-test.ts')],
    outfile: path.resolve(process.cwd(), 'dist/load-test.js'),
    bundle: true,
    platform: 'neutral',
    format: 'esm',
    target: 'es2020',
    external: ['k6', 'k6/http', 'k6/metrics', 'k6/data'],
    logLevel: 'info',
  });

  console.log('Transpilation complete.\n');
}

// 3. Main runner flow
async function run() {
  // Check build-only flag
  if (process.argv.includes('--build-only')) {
    transpileCodebase();
    return;
  }

  // Check parse-only flag
  if (process.argv.includes('--parse-only')) {
    const parseIdx = process.argv.indexOf('--parse-only');
    const reportPath = process.argv[parseIdx + 1] || 'report.json';
    parseAndReport(reportPath);
    return;
  }

  transpileCodebase();

  console.log('--- Spinning Up Mock API Server ---');
  const mockServerProcess = spawn('node', [path.resolve(process.cwd(), 'dist/mock-server.js')], {
    env: { ...process.env, PORT: mockPort.toString() },
    stdio: 'inherit'
  });

  // Small delay to ensure mock server is fully listening
  await new Promise(resolve => setTimeout(resolve, 2000));

  console.log('\n--- Initiating k6 Load Test Run ---');
  const summaryReportPath = path.resolve(process.cwd(), 'report.json');
  
  try {
    const k6Cmd = `k6 run --summary-export="${summaryReportPath}" dist/load-test.js`;
    console.log(`Executing: ${k6Cmd}`);
    
    // Inject environmental overrides for k6 runtime
    execSync(k6Cmd, {
      env: {
        ...process.env,
        TARGET_URL: targetUrl,
        CONCURRENT_USERS: concurrentUsers,
        REQUESTS_PER_USER: requestsPerUser
      },
      stdio: 'inherit'
    });
    
    console.log('\nk6 execution finished successfully.\n');
    parseAndReport(summaryReportPath);
  } catch (err) {
    console.error('\nError executing k6 load test:', err);
  } finally {
    console.log('--- Terminating Mock API Server ---');
    mockServerProcess.kill();
  }
}

// 4. Report parser and generator (JSON -> text/HTML reports)
interface ApiRoute {
  Name: string;
  URI: string;
  Method: string;
  Auth: 'ADMIN' | 'CONTRACT_HOLDER' | 'NONE';
  Body?: any;
}

function parseAndReport(reportPath: string) {
  if (!fs.existsSync(reportPath)) {
    console.error(`Error: report.json not found at ${reportPath}`);
    return;
  }

  console.log('--- Parsing Results & Generating Reports ---');
  const reportData = JSON.parse(fs.readFileSync(reportPath, 'utf8'));

  // Read the source configurations
  const configPath = path.resolve(process.cwd(), 'apis_config.json');
  let apiRoutes: ApiRoute[] = [];
  try {
    apiRoutes = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) {
    console.error('Failed to load apis_config.json for reporting:', err);
    return;
  }

  // Aggregate results per route
  const results = apiRoutes.map(api => {
    const safeName = api.Name.replace(/[^a-zA-Z0-9_]/g, '_');
    
    const durationMetric = reportData.metrics[`api_duration_${safeName}`];
    const requestsMetric = reportData.metrics[`api_requests_${safeName}`];
    const errorsMetric = reportData.metrics[`api_errors_${safeName}`];

    const totalRequests = requestsMetric ? requestsMetric.count : 0;
    const totalErrors = errorsMetric ? errorsMetric.count : 0;
    const avgResponseTime = durationMetric ? durationMetric.avg : 0;
    const p90Latency = durationMetric ? durationMetric['p(90)'] : 0;
    const errorPercentage = totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0;

    return {
      name: api.Name,
      method: api.Method,
      totalRequests,
      avgResponseTime,
      p90Latency,
      errorPercentage
    };
  });

  // Generate ASCII Report
  let textReport = '';
  textReport += '=========================================================================================\n';
  textReport += '                               PCR LOAD TESTING REPORT SUMMARY                           \n';
  textReport += '=========================================================================================\n';
  textReport += `${'API Endpoint Name'.padEnd(28)} | ${'Method'.padEnd(6)} | ${'Requests'.padEnd(8)} | ${'Avg Latency'.padEnd(12)} | ${'p90 Latency'.padEnd(12)} | ${'Error Rate'.padEnd(10)}\n`;
  textReport += '-----------------------------------------------------------------------------------------\n';
  
  results.forEach(r => {
    textReport += `${r.name.padEnd(28)} | ${r.method.padEnd(6)} | ${r.totalRequests.toString().padEnd(8)} | ${(r.avgResponseTime.toFixed(2) + ' ms').padEnd(12)} | ${(r.p90Latency.toFixed(2) + ' ms').padEnd(12)} | ${(r.errorPercentage.toFixed(2) + '%').padEnd(10)}\n`;
  });
  textReport += '=========================================================================================\n';
  textReport += `Execution Parameters: VUs=${concurrentUsers}, Iterations/VU=${requestsPerUser}, Target=${targetUrl}\n`;
  textReport += `Report Generated: ${new Date().toISOString()}\n`;

  // Output to terminal
  console.log(textReport);

  // Save to file
  const summaryTxtPath = path.resolve(process.cwd(), 'performance_summary.txt');
  fs.writeFileSync(summaryTxtPath, textReport, 'utf8');
  console.log(`Saved text report to: ${summaryTxtPath}`);

  // Generate Simple, Classic Light-Mode HTML Report
  const htmlReportPath = path.resolve(process.cwd(), 'report.html');
  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>k6 Load Testing Performance Summary</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #333333;
      background-color: #fcfcfc;
      margin: 0;
      padding: 40px 20px;
    }
    .container {
      max-width: 900px;
      margin: 0 auto;
      background: #ffffff;
      border: 1px solid #e1e4e6;
      border-radius: 6px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.05);
      padding: 30px;
    }
    h1 {
      font-size: 24px;
      margin-top: 0;
      margin-bottom: 8px;
      color: #111111;
      border-bottom: 2px solid #eaeaea;
      padding-bottom: 12px;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 15px;
      margin: 20px 0 30px 0;
      background-color: #f8f9fa;
      border-radius: 4px;
      padding: 15px;
      border: 1px solid #e9ecef;
    }
    .meta-item {
      font-size: 14px;
    }
    .meta-item strong {
      color: #555;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 20px;
    }
    th, td {
      padding: 12px 15px;
      text-align: left;
      border-bottom: 1px solid #e9ecef;
      font-size: 14px;
    }
    th {
      background-color: #f8f9fa;
      color: #495057;
      font-weight: 600;
      text-transform: uppercase;
      font-size: 11px;
      letter-spacing: 0.5px;
      border-top: 1px solid #e9ecef;
    }
    tr:hover {
      background-color: #fafbfc;
    }
    .badge {
      display: inline-block;
      padding: 3px 8px;
      font-size: 11px;
      font-weight: 600;
      border-radius: 3px;
    }
    .badge-none {
      background-color: #e9ecef;
      color: #495057;
    }
    .badge-success {
      background-color: #d4edda;
      color: #155724;
    }
    .badge-danger {
      background-color: #f8d7da;
      color: #721c24;
    }
    .footer {
      font-size: 12px;
      color: #868e96;
      text-align: center;
      margin-top: 30px;
      border-top: 1px solid #eaeaea;
      padding-top: 15px;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Performance Test Summary</h1>
    
    <div class="meta-grid">
      <div class="meta-item"><strong>Target URL:</strong> ${targetUrl}</div>
      <div class="meta-item"><strong>Concurrent Users (VUs):</strong> ${concurrentUsers}</div>
      <div class="meta-item"><strong>Requests / User:</strong> ${requestsPerUser}</div>
      <div class="meta-item"><strong>Execution Time:</strong> ${new Date().toLocaleString()}</div>
    </div>

    <table>
      <thead>
        <tr>
          <th>API Endpoint Name</th>
          <th>Method</th>
          <th>Total Requests</th>
          <th>Avg Response Time</th>
          <th>p90 Latency</th>
          <th>Error Percentage</th>
        </tr>
      </thead>
      <tbody>
        ${results.map(r => `
          <tr>
            <td><strong>${r.name}</strong></td>
            <td><code>${r.method}</code></td>
            <td>${r.totalRequests}</td>
            <td>${r.avgResponseTime.toFixed(2)} ms</td>
            <td>${r.p90Latency.toFixed(2)} ms</td>
            <td>
              <span class="badge ${r.errorPercentage === 0 ? 'badge-success' : 'badge-danger'}">
                ${r.errorPercentage.toFixed(2)}%
              </span>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    <div class="footer">
      Generated automatically by Grafana k6 PoC Load-Testing Application.
    </div>
  </div>
</body>
</html>`;

  fs.writeFileSync(htmlReportPath, htmlContent, 'utf8');
  console.log(`Saved HTML report to: ${htmlReportPath}`);
}

// Check if run directly
if (require.main === module) {
  run();
}
