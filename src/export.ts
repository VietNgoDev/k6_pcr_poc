import fs from 'fs';
import path from 'path';
import { ApiRoute } from './types';

/**
 * Parse k6 JSON report and generate text/HTML reports
 */
export function parseAndReport(reportPath: string): void {
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

  // Read environment variables (with defaults)
  const concurrentUsers = process.env.CONCURRENT_USERS || '5';
  const requestsPerUser = process.env.REQUESTS_PER_USER || '30';
  const targetUrl = process.env.TARGET_URL || 'http://localhost:8080';

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

  // Generate HTML Report
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
      Generated automatically by Grafana k6 Load-Testing Application.
    </div>
  </div>
</body>
</html>`;

  fs.writeFileSync(htmlReportPath, htmlContent, 'utf8');
  console.log(`Saved HTML report to: ${htmlReportPath}`);
}

// CLI entry point
if (require.main === module) {
  const reportPath = process.argv[2] || 'report.json';
  parseAndReport(reportPath);
}
