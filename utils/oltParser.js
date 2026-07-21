/**
 * Parses the raw terminal output of "display ont info X Y all"
 * to find the first available free ONT ID (0-127).
 * 
 * @param {string} cliOutput - Raw text from the OLT terminal
 * @returns {number} The next free ONT ID
 */
function findNextFreeOnuId(cliOutput) {
    const usedIds = new Set();
    
    // Regex to look for rows starting with Frame/Slot/Port sequences like "0/ 1/0"
    // Captures the ONT ID integer right after it.
    const rowRegex = /^\s*\d+\/\s*\d+\/\s*\d+\s+(\d+)/gm;
    let match;
    
    while ((match = rowRegex.exec(cliOutput)) !== null) {
      usedIds.add(parseInt(match[1], 10));
    }
    
    // Find the first hole in the sequence from 0 to 127
    for (let id = 0; id <= 127; id++) {
      if (!usedIds.has(id)) {
        return id;
      }
    }
    
    throw new Error("Target PON port is completely full (all 128 slots taken).");
  }


  module.exports = {findNextFreeOnuId}