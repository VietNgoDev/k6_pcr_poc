import http from 'k6/http';
import { Trend, Counter } from 'k6/metrics';
import { SharedArray } from 'k6/data';
import { ApiRoute } from './types';

// 1. Load APIs Config at Init
const apis = new SharedArray('apis', function () {
  return JSON.parse(open('../apis_config.json')) as ApiRoute[];
});

// 2. Dynamically Initialize custom metrics
const trends: { [name: string]: Trend } = {};
const requests: { [name: string]: Counter } = {};
const errors: { [name: string]: Counter } = {};

apis.forEach(api => {
  const safeName = api.Name.replace(/[^a-zA-Z0-9_]/g, '_');
  trends[api.Name] = new Trend(`api_duration_${safeName}`);
  requests[api.Name] = new Counter(`api_requests_${safeName}`);
  errors[api.Name] = new Counter(`api_errors_${safeName}`);
});

// 3. Define k6 Execution Options
export const options = {
  scenarios: {
    default: {
      executor: 'per-vu-iterations',
      vus: __ENV.CONCURRENT_USERS ? parseInt(__ENV.CONCURRENT_USERS, 10) : 5,
      iterations: __ENV.REQUESTS_PER_USER ? parseInt(__ENV.REQUESTS_PER_USER, 10) : 30,
      maxDuration: '30m',
    },
  },
};

// 4. Default VU Runner Loop
export default function () {
  const baseUrl = __ENV.TARGET_URL || 'http://localhost:8080';

  for (const api of apis) {
    const headers: { [key: string]: string } = { 'Content-Type': 'application/json' };

    // Authentication Lifecycle: On-the-fly login per protected call
    if (api.Auth !== 'NONE') {
      try {
        const loginRes = http.post(`${baseUrl}/login`, JSON.stringify({ role: api.Auth }), {
          headers: { 'Content-Type': 'application/json' }
        });

        if (loginRes.status !== 200) {
          errors[api.Name].add(1);
          requests[api.Name].add(1);
          continue;
        }

        const loginData = JSON.parse(loginRes.body as string);
        headers['Authorization'] = `Bearer ${loginData.token}`;
      } catch (err) {
        errors[api.Name].add(1);
        requests[api.Name].add(1);
        continue;
      }
    }

    // Execute the Target HTTP request
    const url = `${baseUrl}${api.URI}`;
    const payload = api.Body && api.Method !== 'GET' ? JSON.stringify(api.Body) : null;

    const startTime = Date.now();
    let res;
    try {
      // Request method handling
      if (api.Method === 'POST') {
        res = http.post(url, payload, { headers });
      } else if (api.Method === 'PUT') {
        res = http.put(url, payload, { headers });
      } else if (api.Method === 'PATCH') {
        res = http.patch(url, payload, { headers });
      } else if (api.Method === 'DELETE') {
        res = http.delete(url, { headers });
      } else {
        // Default to GET for other methods
        res = http.get(url, { headers });
      }
      const duration = Date.now() - startTime;

      // Log success and latency metrics
      requests[api.Name].add(1);
      trends[api.Name].add(duration);

      if (res.status !== 200) {
        errors[api.Name].add(1);
      }
    } catch (err) {
      errors[api.Name].add(1);
      requests[api.Name].add(1);
    }
  }
}
