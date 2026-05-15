const RouterOSClient = require('node-routeros').RouterOSAPI;
const net = require('net');

const TEST_CONFIG = {
  host: '102.210.42.46',
  port: 8729,  // ← Test plain API first
  user: 'api_ssl',
  password: 'ssl1234'
};

// Test 1: Check if port is reachable
async function testPortConnectivity() {
  console.log('\n🔍 Test 1: Checking Port Connectivity...');
  console.log(`Testing: ${TEST_CONFIG.host}:${TEST_CONFIG.port}`);
  
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const timeout = setTimeout(() => {
      socket.destroy();
      console.log('❌ Connection timeout - Port is not reachable');
      console.log('\nPossible issues:');
      console.log('- Router is offline');
      console.log('- Firewall blocking connection');
      console.log('- Wrong IP address');
      console.log('- Router not listening on this port');
      resolve(false);
    }, 5000);

    socket.on('connect', () => {
      clearTimeout(timeout);
      console.log('✅ Port is reachable!');
      socket.destroy();
      resolve(true);
    });

    socket.on('error', (err) => {
      clearTimeout(timeout);
      console.log(`❌ Connection error: ${err.message}`);
      resolve(false);
    });

    socket.connect(TEST_CONFIG.port, TEST_CONFIG.host);
  });
}

// Test 2: Try plain API port 8728
async function testPlainAPI() {
  console.log('\n🔍 Test 2: Trying Plain API (port 8728)...');
  
  const client = new RouterOSClient({
    host: TEST_CONFIG.host,
    user: TEST_CONFIG.user,
    password: TEST_CONFIG.password,
    port: 8728,
    timeout: 10000
  });
  
  try {
    await client.connect();
    console.log('✅ Plain API (8728) works!');
    console.log('❗ You should enable API-SSL for security');
    const resources = await client.write('/system/resource/print');
    console.log('Version:', resources[0].version);
    await client.close();
    return true;
  } catch (error) {
    console.log(`❌ Plain API failed: ${error.message || 'Unknown error'}`);
    return false;
  }
}

// Test 3: Try API-SSL with verbose logging
async function testAPISSL() {
  console.log('\n🔍 Test 3: Testing API-SSL (port 8729)...');
  
  const client = new RouterOSClient({
    host: TEST_CONFIG.host,
    user: TEST_CONFIG.user,
    password: TEST_CONFIG.password,
    port: TEST_CONFIG.port,
    timeout: 10000
  });
  
  // Add event listeners for debugging
  client.on('error', (err) => {
    console.log('❌ Client error:', err.message);
  });
  
  client.on('close', () => {
    console.log('🔌 Connection closed');
  });
  
  try {
    console.log('⏳ Connecting to API-SSL...');
    await client.connect();
    console.log('✅ API-SSL connected!');
    
    const resources = await client.write('/system/resource/print');
    console.log('✅ Command executed successfully');
    console.log('Version:', resources[0].version);
    
    await client.close();
    return true;
  } catch (error) {
    console.log(`❌ API-SSL failed: ${error.message || 'Unknown error'}`);
    console.log('\nFull error:', error);
    return false;
  }
}

// Main diagnostic function
async function runDiagnostics() {
  console.log('='.repeat(60));
  console.log('     MikroTik Connection Diagnostics');
  console.log('='.repeat(60));
  console.log('\nTarget:');
  console.log(`  Host: ${TEST_CONFIG.host}`);
  console.log(`  Port: ${TEST_CONFIG.port}`);
  console.log(`  User: ${TEST_CONFIG.user}`);
  
  // Test port connectivity
  const portReachable = await testPortConnectivity();
  
  if (!portReachable) {
    console.log('\n' + '='.repeat(60));
    console.log('❌ DIAGNOSIS: Cannot reach the router');
    console.log('='.repeat(60));
    console.log('\n📋 Actions to take:');
    console.log('1. Verify router IP is correct');
    console.log('2. Check if router is online (ping it)');
    console.log('3. On MikroTik, run: /ip service print');
    console.log('   - Verify api-ssl is enabled');
    console.log('   - Verify it\'s on port 8729');
    console.log('4. Check firewall on MikroTik');
    console.log('5. Check if your public IP is whitelisted');
    console.log('\nTo check your public IP, run:');
    console.log('  curl ifconfig.me');
    process.exit(1);
  }
  
  // Try plain API
  const plainAPIWorks = await testPlainAPI();
  
  // Try API-SSL
  const apiSSLWorks = await testAPISSL();
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('     DIAGNOSIS SUMMARY');
  console.log('='.repeat(60));
  console.log(`Port ${TEST_CONFIG.port} reachable: ${portReachable ? '✅' : '❌'}`);
  console.log(`Plain API (8728) works: ${plainAPIWorks ? '✅' : '❌'}`);
  console.log(`API-SSL (8729) works: ${apiSSLWorks ? '✅' : '❌'}`);
  
  if (apiSSLWorks) {
    console.log('\n✅ Everything is working!');
  } else if (plainAPIWorks) {
    console.log('\n⚠️ Plain API works but API-SSL doesn\'t');
    console.log('\n📋 On your MikroTik router, run these commands:');
    console.log('');
    console.log('/ip service enable api-ssl');
    console.log('/ip service set api-ssl port=8729');
    console.log('/certificate add name=api-ssl common-name=router.local days-valid=3650');
    console.log('/certificate sign api-ssl');
    console.log(':delay 10s');
    console.log('/ip service set api-ssl certificate=api-ssl');
    console.log('/ip service disable api-ssl');
    console.log('/ip service enable api-ssl');
  } else {
    console.log('\n❌ Both API and API-SSL failed');
    console.log('\n📋 On your MikroTik router, check:');
    console.log('');
    console.log('1. Check services:');
    console.log('   /ip service print');
    console.log('');
    console.log('2. Verify user exists:');
    console.log('   /user print');
    console.log('');
    console.log('3. Check firewall rules:');
    console.log('   /ip firewall filter print');
    console.log('');
    console.log('4. Get your public IP:');
    console.log('   Run on your machine: curl ifconfig.me');
    console.log('   Then add firewall rule on MikroTik:');
    console.log('   /ip firewall filter add chain=input protocol=tcp dst-port=8729 src-address=YOUR_PUBLIC_IP action=accept place-before=0');
  }
  
  console.log('\n' + '='.repeat(60));
}

runDiagnostics().catch(console.error);