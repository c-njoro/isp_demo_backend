const fs = require('fs');
const path = require('path');

const LARGE_FILE = path.join(__dirname, 'skn-customers-converted.json');
const CHUNK_SIZE = 500; // Safe batch size to bypass 1MB limits

function chunkMigrationData() {
  if (!fs.existsSync(LARGE_FILE)) {
    console.error("Converted file not found!");
    return;
  }

  const customers = JSON.parse(fs.readFileSync(LARGE_FILE, 'utf8'));
  console.log(`📦 Slicing ${customers.length} customers into batches of ${CHUNK_SIZE}...`);

  for (let i = 0; i < customers.length; i += CHUNK_SIZE) {
    const chunk = customers.slice(i, i + CHUNK_SIZE);
    const batchNumber = Math.floor(i / CHUNK_SIZE) + 1;
    const chunkFileName = path.join(__dirname, `skn-customers-batch-${batchNumber}.json`);
    
    fs.writeFileSync(chunkFileName, JSON.stringify(chunk, null, 2));
    console.log(`✅ Generated: ${chunkFileName} (${chunk.length} records)`);
  }
}

chunkMigrationData();