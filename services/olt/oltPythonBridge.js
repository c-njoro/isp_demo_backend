const { spawn } = require('child_process');
const path = require('path');

const PYTHON_SCRIPT_PATH = path.join(__dirname, 'python', 'huawei_olt_helper.py');
const PYTHON_BIN = process.env.PYTHON_BIN || 'python3';

/**
 * Run an operation against the Python helper and return its parsed result.
 *
 * @param {Object} request - matches what huawei_olt_helper.py expects:
 * { operation, host, username, password, port?, timeout?, timeoutMs?, ...opData }
 */
function runPythonOperation(request) {
  return new Promise((resolve) => {
    // Read timeoutMs straight out of the single request payload object, default to 30000ms
    const timeoutMs = request.timeoutMs || 30000; 
    let settled = false;
    let stdout = '';
    let stderr = '';

    const proc = spawn(PYTHON_BIN, [PYTHON_SCRIPT_PATH, JSON.stringify(request)]);

    const killTimer = setTimeout(() => {
      if (!settled) {
        proc.kill('SIGKILL');
        resolve({
          success: false,
          error: `Python helper timed out after ${timeoutMs}ms`
        });
      }
    }, timeoutMs);

    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    proc.on('close', (code) => {
      settled = true;
      clearTimeout(killTimer);

      if (stderr) {
        console.log(`[oltPythonBridge] stderr output (diagnostic only):\n${stderr}`);
      }

      const trimmed = stdout.trim();
      if (!trimmed) {
        return resolve({
          success: false,
          error: `Python helper produced no output (exit code ${code}). stderr: ${stderr.slice(0, 500)}`
        });
      }

      try {
        const lines = trimmed.split('\n').filter((l) => l.trim());
        const lastLine = lines[lines.length - 1];
        const parsed = JSON.parse(lastLine);
        resolve(parsed);
      } catch (err) {
        resolve({
          success: false,
          error: `Failed to parse Python helper output as JSON: ${err.message}. Raw stdout: ${trimmed.slice(0, 500)}`
        });
      }
    });

    proc.on('error', (err) => {
      settled = true;
      clearTimeout(killTimer);
      resolve({
        success: false,
        error: `Failed to spawn Python helper (is python3 + netmiko installed?): ${err.message}`
      });
    });
  });
}

module.exports = { runPythonOperation };