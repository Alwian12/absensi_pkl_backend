/**
 * TEST API CONNECTIVITY
 * Jalankan: node test_api_connectivity.js
 */

const http = require('http');

const tests = [
  { name: 'Server Root', path: '/' },
  { name: 'Static Uploads', path: '/uploads' },
  { name: 'Admin Attendance Photos', path: '/api/admin/attendance-photos' },
  { name: 'Check Auth', path: '/api/admin/check' }
];

console.log('========================================');
console.log('TEST API CONNECTIVITY');
console.log('========================================\n');

const testEndpoint = (test) => {
  return new Promise((resolve) => {
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: test.path,
      method: 'GET',
      timeout: 3000
    };

    const req = http.request(options, (res) => {
      console.log(`✅ ${test.name}`);
      console.log(`   Path: ${test.path}`);
      console.log(`   Status: ${res.statusCode}`);
      console.log('');
      resolve(true);
    });

    req.on('error', (err) => {
      console.log(`❌ ${test.name}`);
      console.log(`   Path: ${test.path}`);
      console.log(`   Error: ${err.message}`);
      console.log('');
      resolve(false);
    });

    req.on('timeout', () => {
      console.log(`⏱️ ${test.name} - Timeout`);
      req.destroy();
      resolve(false);
    });

    req.end();
  });
};

const runTests = async () => {
  console.log('Testing endpoints...\n');
  
  for (const test of tests) {
    await testEndpoint(test);
  }
  
  console.log('========================================');
  console.log('Test selesai!');
  console.log('========================================');
};

runTests();
