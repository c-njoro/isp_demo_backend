// test-mikrotik.js – Enhanced debugging
const mikrotikService = require('../services/mikroticService'); // adjust path if needed

const site = {
  router: {
    ip: '192.168.88.1',
    username: 'api_user',
    password: 'api1234',    // <-- replace with actual password
    apiType: 'api'
  }
};

const username = process.argv[2] || `TEST${Math.floor(Math.random() * 10000)}`;
const password = process.argv[3] || 'test1234';

const customer = {
  firstName: 'Test',
  lastName: 'User',
  accountId: username,
  pppoe: { username, password }
};

async function runTest() {
  console.log('=== Starting Mikrotik PPPoE Secret Test ===');
  console.log(`Target router: ${site.router.ip} (${site.router.username})`);
  console.log(`Testing with username: "${username}"`);

  try {
    // Get a connection (the service will cache it)
    const client = await mikrotikService.getConnection(
      site.router.ip,
      site.router.username,
      site.router.password,
      site.router.apiType
    );

    // Fetch ALL PPPoE secrets
    console.log('\nFetching all PPPoE secrets...');
    const allSecrets = await client.write('/ppp/secret/print');
    console.log(`Total secrets found: ${allSecrets.length}`);

    // Print each secret's name and ID
    if (allSecrets.length === 0) {
      console.log('No secrets found.');
    } else {
      allSecrets.forEach((s, i) => {
        console.log(`  ${i+1}. ID: ${s['.id']}, Name: "${s.name}"`);
      });
    }

    // Exact match
    const exactMatches = allSecrets.filter(s => s.name === username);
    console.log(`\nExact matches for "${username}": ${exactMatches.length}`);

    // Case-insensitive match
    const lowerUsername = username.toLowerCase();
    const caseInsensitiveMatches = allSecrets.filter(s => s.name.toLowerCase() === lowerUsername);
    console.log(`Case-insensitive matches: ${caseInsensitiveMatches.length}`);
    if (caseInsensitiveMatches.length > 0) {
      console.log('Case-insensitive match details:');
      caseInsensitiveMatches.forEach(s => {
        console.log(`  ID: ${s['.id']}, Name: "${s.name}"`);
      });
    }

    // Now call the service method to see its behavior
    console.log('\n--- Calling addPPPoESecret ---');
    const result = await mikrotikService.addPPPoESecret(site, customer, {});
    console.log('\n=== Result ===');
    console.log('Success:', result.success);
    console.log('Action:', result.action);
    console.log('Message:', result.message || result.error);

  } catch (err) {
    console.error('Unexpected error:', err);
  } finally {
    await mikrotikService.closeConnection(site.router.ip, site.router.username);
    console.log('\nConnection closed.');
  }
}

runTest();