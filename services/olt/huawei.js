const BaseOLTService = require('./base');
const { runPythonOperation } = require('./oltPythonBridge');
const { findNextFreeOnuId } = require('../../utils/oltParser');

/**
 * Huawei OLT Service — Python/Netmiko bridge transport
 */
class HuaweiOLTService extends BaseOLTService {
  constructor() {
    super();
  }

  _resolvePort(olt, ponPort) {
    const frame = 0;
    const slot = Math.floor(ponPort / olt.ponPorts);
    const port = ponPort % olt.ponPorts;
    return { frame, slot, port, frameSlot: `${frame}/${slot}` };
  }


  /**
   * Authorize a newly discovered ONU using the SKYLINK Profile Architecture.
   *
   * Validated command sequence (see huawei-olt-onboarding-runbook.md, Part 3):
   *   ont add ... omci ont-lineprofile-id <X> ont-srvprofile-id <Y> desc "..."
   *   ont ipconfig <port> <ontid> dhcp vlan <mgmtVlan> priority 0
   *   ont tr069-server-config <port> <ontid> profile-id <Z>
   *   service-port vlan <mgmtVlan> gpon <fsp> ont <ontid> gemport <N> multi-service user-vlan <mgmtVlan>
   *
   * NOTE: no `iphost-config` (not a real command on this firmware) and no
   * `internet-config`/`wan-config` (that's for customer WAN routing, not
   * management IP — see runbook 1.9). Service-port index is left for the OLT
   * to auto-assign rather than manually tracked/retried, since specifying an
   * explicit index was the source of the old self-healing-loop complexity and
   * isn't necessary.
   */
  async authorizeNewOnuSkylink(olt, params) {
    const { 
      ponPort,          // Passed as an integer index from your UI or database structure
      sn,               // e.g. "58504F4E022334D0"
      desc,             // Customer description or Account ID
      mgmtVlan,         // e.g. 41
      lineProfileId = 2,     // SkyLink baseline line profile — TR-069 enabled, declares GEM index below
      serviceProfileId = 1,  // Adaptive profile (pots/eth adaptive) — matches any ONT model, avoids
                              // the "Match state: mismatch" class of failure fixed-count profiles hit
      gemPortIndex = 1,      // Must match the GEM index lineProfileId actually declares via `gem add`
      tr069ProfileId = 1     // OLT-wide ACS binding profile — see runbook 1.9b (ont tr069-server-profile)
    } = params;

    try {
      this._validateOltConfig(olt);

      // Leverage your existing resolution method to parse Frame, Slot, and Port values
      const { frame, slot, port, frameSlot } = this._resolvePort(olt, ponPort);
      const fullPortPath = `${frame}/${slot}/${port}`;

      this._log('info', `[Skylink Auth] Fetching live port state for ${fullPortPath} to find next free ONU ID...`);

      // STEP 1: Live fetch the current ONT IDs on this port to prevent real-time collisions.
      // Must enter interface gpon context first — "display ont info" at root config level
      // is not valid syntax on this device (confirmed against real MA5683T CLI); it only
      // accepts <port> <all|id> once inside `interface gpon <frame>/<slot>`.
      const portStateDump = await runPythonOperation({
        operation: 'run_commands',
        host: olt.ip,
        username: olt.username,
        password: olt.password,
        port: olt.port || 23,
        commands: [
          `interface gpon ${frameSlot}`,
          `display ont info ${port} all`,
          `quit`
        ]
      });

      if (!portStateDump.success) {
        return { success: false, error: `Failed to query port info: ${portStateDump.error}` };
      }

      const assignedOnuId = findNextFreeOnuId((portStateDump.data?.outputs || []).join('\n'));
      this._log('info', `[Skylink Auth] Found available ONU ID: ${assignedOnuId} on port ${fullPortPath}`);

      // STEP 2: ont add + ont ipconfig + ACS binding in one batch — the validated
      // management-IP + TR-069 sequence. No internet-config/wan-config here (not
      // needed for management IP, see runbook 1.9).
      const provisioningCommands = [
        `interface gpon ${frameSlot}`,
        `ont add ${port} ${assignedOnuId} sn-auth ${sn} omci ont-lineprofile-id ${lineProfileId} ont-srvprofile-id ${serviceProfileId} desc "${desc}"`,
        `ont ipconfig ${port} ${assignedOnuId} dhcp vlan ${mgmtVlan} priority 0`,
        `ont tr069-server-config ${port} ${assignedOnuId} profile-id ${tr069ProfileId}`,
        `quit`
      ];

      this._log('info', `[Skylink Auth] Registering serial number ${sn} to OLT profiles...`);
      const provisionResult = await runPythonOperation({
        operation: 'run_commands',
        host: olt.ip,
        username: olt.username,
        password: olt.password,
        port: olt.port || 23,
        cmd_timeout: 15, // ont add / sn-auth registration takes longer than the 5s default meant for display commands
        commands: provisioningCommands
      });

      const provOutput = (provisionResult.data?.outputs || []).join('\n');
      if (!provisionResult.success || provOutput.includes("Failure") || provOutput.includes("Error") || provOutput.includes("Unknown command")) {
        return { success: false, error: `OLT Hardware Registration Failed: ${provOutput || provisionResult.error}` };
      }

      // STEP 3: Service-port creation. Index is auto-assigned by the OLT — no manual
      // index tracking/self-healing retry loop needed (that was only required by the
      // old approach of specifying an explicit index up front).
      const servicePortCmd = `service-port vlan ${mgmtVlan} gpon ${fullPortPath} ont ${assignedOnuId} gemport ${gemPortIndex} multi-service user-vlan ${mgmtVlan}`;

      const flowResult = await runPythonOperation({
        operation: 'run_commands',
        host: olt.ip,
        username: olt.username,
        password: olt.password,
        port: olt.port || 23,
        cmd_timeout: 10,
        commands: [servicePortCmd]
      });

      const flowOutput = (flowResult.data?.outputs || []).join('\n');
      if (!flowResult.success || flowOutput.includes("Failure") || flowOutput.includes("Error") || flowOutput.includes("Unknown command")) {
        return { success: false, error: `Service-Port assignment failed: ${flowOutput || flowResult.error}` };
      }

      this._log('info', `[Skylink Auth] Service-port created for ONT ${assignedOnuId}. Verifying provisioning state...`);

      // Best-effort: look up the index the OLT auto-assigned, for record-keeping/
      // troubleshooting later. Not critical to the authorization succeeding —
      // wrapped so a parse miss here never fails the overall flow.
      let servicePortIndex = null;
      try {
        const spListResult = await runPythonOperation({
          operation: 'run_commands',
          host: olt.ip,
          username: olt.username,
          password: olt.password,
          port: olt.port || 23,
          commands: [`display service-port vlan ${mgmtVlan}`]
        });
        const spOutput = (spListResult.data?.outputs || []).join('\n');
        for (const line of spOutput.split('\n')) {
          const m = line.trim().match(/^(\d+)\s+\d+\s+\S+\s+gpon\s+(\d+)\/\s*(\d+)\s*\/\s*(\d+)\s+(\d+)\s+(\d+)/);
          if (m && parseInt(m[3], 10) === slot && parseInt(m[4], 10) === port && parseInt(m[5], 10) === assignedOnuId) {
            servicePortIndex = parseInt(m[1], 10);
            break;
          }
        }
      } catch (_) { /* non-critical, ignore */ }

      // STEP 4: Verify — don't just trust a clean exit code. Pull real ONT state and
      // poll briefly for the management IP, since we've seen the OLT report "success"
      // on commands that didn't actually take effect. Bounded to ~9s so the request
      // doesn't hang waiting on DHCP indefinitely.
      const infoResult = await runPythonOperation({
        operation: 'run_commands',
        host: olt.ip,
        username: olt.username,
        password: olt.password,
        port: olt.port || 23,
        commands: [`interface gpon ${frameSlot}`, `display ont info ${port} all`, `quit`]
      });
      const infoOutput = (infoResult.data?.outputs || []).join('\n');
      const stateLine = infoOutput.split('\n').find(l => l.trim().startsWith(`${frame}/ ${slot}/${port}`) || l.trim().startsWith(`${frame}/${slot}/${port}`));
      const matchState = /\bmismatch\b/i.test(stateLine || '') ? 'mismatch' : (/\bmatch\b/i.test(stateLine || '') ? 'match' : 'unknown');
      const configState = /\bfailed\b/i.test(stateLine || '') ? 'failed' : (/\bnormal\b/i.test(stateLine || '') ? 'normal' : 'unknown');

      let managementIp = null;
      for (let attempt = 0; attempt < 3 && !managementIp; attempt++) {
        if (attempt > 0) await new Promise(r => setTimeout(r, 3000));
        const ipResult = await runPythonOperation({
          operation: 'run_commands',
          host: olt.ip,
          username: olt.username,
          password: olt.password,
          port: olt.port || 23,
          commands: [`interface gpon ${frameSlot}`, `display ont ipconfig ${port} ${assignedOnuId}`, `quit`]
        });
        const ipOutput = (ipResult.data?.outputs || []).join('\n');
        const ipMatch = ipOutput.match(/ONT IP\s*:\s*(\S+)/);
        if (ipMatch && ipMatch[1] !== '-') {
          managementIp = ipMatch[1];
        }
      }

      if (matchState === 'mismatch') {
        return {
          success: false,
          error: `ONT registered but service profile ${serviceProfileId} does not match this ONT model's hardware capabilities (Match state: mismatch). Use the adaptive profile or a profile built for this exact ONT model.`
        };
      }

      if (configState === 'failed') {
        return {
          success: false,
          error: `ONT registered but OMCI config push failed (Config state: failed). Try 'ont reset ${port} ${assignedOnuId}' and re-check, or re-authorize.`
        };
      }

      // Return variables to the controller layer
      return {
        success: true,
        onuId: assignedOnuId,
        servicePortIndex,
        managementIp, // null if DHCP hadn't completed within the poll window — not necessarily a failure
        matchState,
        configState,
        message: managementIp
          ? `ONU authorized successfully and received management IP ${managementIp}`
          : 'ONU authorized successfully; management IP not yet assigned (DHCP may still be in progress — check again shortly)'
      };

    } catch (err) {
      this._log('error', `Exception caught during Skylink authorization: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  async testConnection(olt) {
    this._validateOltConfig(olt);
    
    this._log('info', `Testing connection to Huawei OLT at ${olt.ip}`);
    
    const result = await runPythonOperation({
      operation: 'test_connection',
      host: olt.ip,
      username: olt.username,
      password: olt.password,
      port: olt.port || 23
    });

    if (!result.success) {
      return { success: false, error: result.error, message: 'Connection failed' };
    }

    return {
      success: true,
      version: result.data.version || 'Unknown Huawei OLT',
      message: 'Successfully connected and authenticated via Telnet'
    };
  }

  async getSystemInfo(olt) {
    const result = await runPythonOperation({
      operation: 'run_commands',
      host: olt.ip,
      username: olt.username,
      password: olt.password,
      port: olt.port || 23,
      commands: ['display device', 'display version']
    });

    if (!result.success) return result;
    return { success: true, data: result.data };
  }

  async getPonPorts(olt) {
    this._log('info', `Discovering GPON boards for ${olt.name}`);
    
    const result = await runPythonOperation({
      operation: 'run_commands',
      host: olt.ip,
      username: olt.username,
      password: olt.password,
      port: olt.port || 23,
      commands: ['display device']
    });

    if (!result.success) {
      return { success: false, error: result.error, ports: [] };
    }

    const output = result.data.outputs[0] || '';
    const boards = this._parseHuaweiBoards(output);
    const gponBoards = boards.filter(b => b.isGponBoard && b.status.toLowerCase() === 'normal');

    this._log('info', `Found ${gponBoards.length} active GPON boards on ${olt.name}`, { boards: gponBoards });

    const ports = [];
    const maxPortsPerBoard = olt.ponPorts || 16;

    for (const board of gponBoards) {
      for (let p = 0; p < maxPortsPerBoard; p++) {
        const flatPortIndex = board.slot * maxPortsPerBoard + p;
        ports.push({
          portNumber: flatPortIndex,
          name: `GPON 0/${board.slot}/${p}`,
          status: 'active',
          description: `Slot ${board.slot}, Port ${p}`
        });
      }
    }

    return { success: true, ports, discoveredSlots: gponBoards.map(b => b.slot) };
  }

  async getAllOnus(olt) {
    if (!olt.gponSlots || olt.gponSlots.length === 0) {
      this._log('warn', `getAllOnus refused: olt.gponSlots not set for ${olt.name}`);
      return { success: false, error: 'Run Test Connection first to discover boards.', onus: [] };
    }

    const allOnus = [];
    const commands = [];
    const portMapping = [];
    const maxPorts = olt.ponPorts || 16;

    for (const slot of olt.gponSlots) {
      const frameSlot = `0/${slot}`;
      
      commands.push(`interface gpon ${frameSlot}`);
      
      for (let port = 0; port < maxPorts; port++) {
        commands.push(`display ont info ${port} all`);
        
        const flatPonPort = slot * maxPorts + port;
        portMapping.push({ flatPonPort, cmdIndex: commands.length - 1 });
      }
      
      commands.push('quit');
    }

    this._log('info', `Batching ${commands.length} commands over ONE connection for ${olt.name}`);

    const result = await runPythonOperation({
      operation: 'run_commands',
      host: olt.ip,
      username: olt.username,
      password: olt.password,
      port: olt.port || 23,
      timeout: 60,
      cmd_timeout: 5,
      timeoutMs: 70000,
      commands: commands
    });

    if (!result.success) {
      this._log('error', `Failed bulk ONU status retrieval: ${result.error}`);
      return { success: false, error: result.error, onus: [] };
    }

    // Log raw output for debugging
    this._log('info', `Raw ONU list outputs: ${JSON.stringify(result.data.outputs, null, 2)}`);

    for (const mapping of portMapping) {
      const output = result.data.outputs[mapping.cmdIndex] || '';
      allOnus.push(...this._parseHuaweiOnuList(output, mapping.flatPonPort));
    }

    return { success: true, onus: allOnus };
  }

  async getUnconfiguredOnus(olt) {
    if (!olt.gponSlots || olt.gponSlots.length === 0) {
      this._log('warn', `getUnconfiguredOnus refused: olt.gponSlots not set for ${olt.name}`);
      return { success: false, error: 'olt.gponSlots is not configured.', onus: [] };
    }

    const allOnus = [];
    const commands = [];
    const portMapping = [];
    const maxPorts = olt.ponPorts || 16;

    for (const slot of olt.gponSlots) {
      const frameSlot = `0/${slot}`;
      
      commands.push(`interface gpon ${frameSlot}`);
      
      for (let port = 0; port < maxPorts; port++) {
        commands.push(`display ont autofind ${port}`);
        
        const flatPonPort = slot * maxPorts + port;
        portMapping.push({ flatPonPort, cmdIndex: commands.length - 1 });
      }
      
      commands.push('quit');
    }

    this._log('info', `Batching autofind queries over ONE connection for ${olt.name}`);

    const result = await runPythonOperation({
      operation: 'run_commands',
      host: olt.ip,
      username: olt.username,
      password: olt.password,
      port: olt.port || 23,
      timeout: 60,
      cmd_timeout: 5,
      timeoutMs: 70000,
      commands: commands
    });

    if (!result.success) {
      this._log('error', `Failed bulk autofind retrieval: ${result.error}`);
      return { success: false, error: result.error, onus: [] };
    }

    // Log raw output for debugging
    const rawOutputs = result.data.outputs || [];
  this._log('info', `Raw autofind outputs (${rawOutputs.length}):`, rawOutputs);

    for (const mapping of portMapping) {
      const output = result.data.outputs[mapping.cmdIndex] || '';
      allOnus.push(...this._parseHuaweiAutofind(output, mapping.flatPonPort));
    }

    return { success: true, onus: allOnus };
  }

  async getOnusOnPort(olt, ponPort) {
    const { frameSlot, port } = this._resolvePort(olt, ponPort);

    const result = await runPythonOperation({
      operation: 'run_commands',
      host: olt.ip,
      username: olt.username,
      password: olt.password,
      port: olt.port || 23,
      timeout: 60,
      timeoutMs: 40000,
      commands: [`interface gpon ${frameSlot}`, `display ont info ${port} all`]
    });

    if (!result.success) {
      this._log('error', `Failed to get ONUs on port ${ponPort}: ${result.error}`);
      return { success: false, error: result.error, onus: [] };
    }

    const onus = this._parseHuaweiOnuList(result.data.outputs[1] || '', ponPort);
    return { success: true, onus };
  }

  async getOnuDetails(olt, ponPort, onuId) {
    const { frameSlot, port } = this._resolvePort(olt, ponPort);

    const result = await runPythonOperation({
      operation: 'run_commands',
      host: olt.ip,
      username: olt.username,
      password: olt.password,
      port: olt.port || 23,
      commands: [
        `interface gpon ${frameSlot}`,
        `display ont info ${port} ${onuId}`,
        `display ont optical-info ${port} ${onuId}`
      ]
    });

    if (!result.success) return result;
    return {
      success: true,
      data: this._parseHuaweiOnuDetails(result.data.outputs[1] + '\n' + result.data.outputs[2])
    };
  }

  async authorizeOnu(olt, ponPort, onuData) {
    const { frameSlot, port } = this._resolvePort(olt, ponPort);
    const { onuId, sn, lineProfile, serviceProfile, desc } = onuData;

    const commands = [
      `interface gpon ${frameSlot}`,
      `ont add ${port} ${onuId} sn-auth ${sn} line-profile-id ${lineProfile || 10} service-profile-id ${serviceProfile || 10} desc "${desc || 'Managed_ONU'}"`
    ];

    const result = await runPythonOperation({
      operation: 'run_commands',
      host: olt.ip,
      username: olt.username,
      password: olt.password,
      port: olt.port || 23,
      cmd_timeout: 15, // ont add / sn-auth registration takes longer than the 5s default meant for display commands
      commands
    });

    if (!result.success) return result;
    return { success: true, message: `ONU ${sn} authorized successfully on port ${ponPort} with ID ${onuId}` };
  }

  async deleteOnu(olt, ponPort, onuId) {
    const { frameSlot, port } = this._resolvePort(olt, ponPort);

    const result = await runPythonOperation({
      operation: 'run_commands',
      host: olt.ip,
      username: olt.username,
      password: olt.password,
      port: olt.port || 23,
      commands: [`interface gpon ${frameSlot}`, `ont delete ${port} ${onuId}`]
    });

    if (!result.success) return result;
    return { success: true, message: `ONU ${onuId} deleted successfully from port ${ponPort}` };
  }

  async rebootOnu(olt, ponPort, onuId) {
    const { frameSlot, port } = this._resolvePort(olt, ponPort);

    const result = await runPythonOperation({
      operation: 'run_commands',
      host: olt.ip,
      username: olt.username,
      password: olt.password,
      port: olt.port || 23,
      commands: [`interface gpon ${frameSlot}`, `ont reboot ${port} ${onuId}`]
    });

    if (!result.success) return result;
    return { success: true, message: `Reboot command sent to ONU ${onuId} on port ${ponPort}` };
  }

  async getOnuOpticalPower(olt, ponPort, onuId) {
    const { frameSlot, port } = this._resolvePort(olt, ponPort);

    const result = await runPythonOperation({
      operation: 'run_commands',
      host: olt.ip,
      username: olt.username,
      password: olt.password,
      port: olt.port || 23,
      commands: [`interface gpon ${frameSlot}`, `display ont optical-info ${port} ${onuId}`]
    });

    if (!result.success) return { success: false, error: result.error };

    const output = result.data.outputs[1] || '';
    const rxMatch = output.match(/Rx optical power\s*:\s*([-\d.]+)\s*dBm/i);
    const txMatch = output.match(/Tx optical power\s*:\s*([-\d.]+)\s*dBm/i);

    return {
      success: true,
      data: {
        rxPower: rxMatch ? parseFloat(rxMatch[1]) : null,
        txPower: txMatch ? parseFloat(txMatch[1]) : null
      }
    };
  }

  // ============================================================
  // NEW / IMPROVED PARSERS WITH LOGGING
  // ============================================================

  _parseHuaweiOnuList(output, ponPort) {
    const onus = [];
    if (!output || output.trim() === '') return onus;
  
    const lines = output.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
  
      // Skip headers and separators
      if (
        trimmed.startsWith('-') ||
        trimmed.includes('ONT-') ||
        trimmed.includes('F/S/P') ||
        trimmed.includes('State') ||
        trimmed.includes('Control') ||
        trimmed.includes('SN')
      ) {
        continue;
      }
  
      // Expected format (real device, right-padded slot digit): "0/ 1/0    0  58504F4E022334D0  active      offline"
      // Column order is F/S/P, ONT-ID, SN, control-flag, run-state
      const match = trimmed.match(/^(\d+\/\s*\d+\/\d+)\s+(\d+)\s+([A-F0-9]{8,16})\s+(\S+)\s+(\S+)/);
      if (!match) continue;
  
      const fsp = match[1].replace(/\s+/g, '');
      const onuId = parseInt(match[2], 10);
      const sn = match[3];
      const controlState = match[4];
      const runState = match[5];
  
      // Skip obvious garbage
      if (sn === 'SOFTWAREVERSION' || sn === 'AUTOMATICALLY' || sn === 'THE') continue;
  
      onus.push({
        onuId,
        fsp,
        sn,
        controlState,
        runState,
        ponPort,
      });
    }
  
    return onus;
  }
/**
 * Parse `display ont autofind` output for Huawei OLTs.
 * Handles the structured output format seen in real devices.
 */
_parseHuaweiAutofind(output, ponPort) {
  const onus = [];
  if (!output || output.trim() === '') {
    this._log('debug', `Empty autofind output for port ${ponPort}`);
    return onus;
  }

  // Split into sections by "---" separators (each ONU is one section)
  const sections = output.split(/-{3,}/).filter(s => s.trim());

  this._log('debug', `Parsing ${sections.length} autofind sections for port ${ponPort}`);

  for (const section of sections) {
    // Skip "Failure" sections (no ONU found)
    if (section.toLowerCase().includes('failure:') || section.toLowerCase().includes('do not exist')) {
      this._log('debug', `Skipping failure section for port ${ponPort}`);
      continue;
    }

    // Extract fields using regex
    const numberMatch = section.match(/Number\s*:\s*(\d+)/i);
    const fspMatch = section.match(/F\/S\/P\s*:\s*([\d/]+)/i);
    const snMatch = section.match(/Ont SN\s*:\s*([A-F0-9]+)/i);
    const vendorMatch = section.match(/VendorID\s*:\s*(\w+)/i);
    const versionMatch = section.match(/Ont SoftwareVersion\s*:\s*([\w.]+)/i);
    const equipmentMatch = section.match(/Ont EquipmentID\s*:\s*(\w+)/i);

    if (numberMatch && snMatch) {
      const sn = snMatch[1];
      const onuId = parseInt(numberMatch[1], 10);
      const fsp = fspMatch ? fspMatch[1] : `0/1/${ponPort}`;

      this._log('debug', `Found autofind ONU: SN=${sn}, ONU ID=${onuId}, FSP=${fsp}`);

      onus.push({
        sn,
        onuId,
        fsp,
        ponPort, // flat port index from the command context
        vendor: vendorMatch ? vendorMatch[1] : null,
        version: versionMatch ? versionMatch[1] : null,
        equipment: equipmentMatch ? equipmentMatch[1] : null,
        runState: 'autofind',
        existsInDatabase: false,
      });
    } else {
      this._log('debug', `Skipping section (no SN/Number): ${section.slice(0, 100)}...`);
    }
  }

  return onus;
}

  _parseHuaweiBoards(output) {
    const boards = [];
    const lines = output.split('\n');
    const KNOWN_GPON_BOARD_PATTERNS = [/GPON/i, /GPHF/i, /GPSF/i, /GPBD/i, /GPBH/i];

    let startParsing = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (/Slot\s+Name\s+Status/i.test(trimmed)) {
        startParsing = true;
        continue;
      }
      if (startParsing && trimmed.startsWith('---')) {
        continue;
      }
      if (startParsing && !trimmed) {
        continue;
      }

      if (startParsing) {
        const slotMatch = trimmed.match(/^(\d+)\s*(.*)$/);
        if (!slotMatch) continue;

        const slot = parseInt(slotMatch[1], 10);
        const rest = slotMatch[2].trim();

        if (!rest) continue;

        const parts = rest.split(/\s+/);
        const boardName = parts[0] || '';
        const status = parts[1] || 'unknown';

        const isGponBoard = KNOWN_GPON_BOARD_PATTERNS.some((pat) => pat.test(boardName));
        boards.push({ slot, boardName, status, isGponBoard });
      }
    }

    return boards;
  }

  _parseHuaweiOnuDetails(output) {
    return { raw: output, parsed: {} };
  }
}

module.exports = HuaweiOLTService;