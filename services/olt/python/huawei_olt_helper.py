#!/usr/bin/env python3
"""
huawei_olt_helper.py

Netmiko-based helper for talking to Huawei OLTs (MA5683T and similar
SmartAX/OLT-family devices) over Telnet.

WHY THIS EXISTS: pure-Node telnet automation (telnet-client) repeatedly
hit a real, confirmed device quirk — Huawei OLT/SmartAX devices show an
interactive "{ <cr>|...}:" confirmation prompt after certain commands,
and telnet-client's single-shot exec()/prompt-matching model raced against
this unpredictably (see project history: enable/display version sometimes
returned empty, config mode desynced, sessions got logged out mid-test).

Netmiko's huawei_olt_telnet device type (HuaweiSmartAXSSH class) has a
real, working fix for exactly this: it runs `undo smart` once at session
setup to permanently disable that prompt for the whole session, and has
a polling read loop (not single-shot pattern match) that's far more
robust against this device family's quirks. Rather than reimplement that
from scratch in Node, this script delegates to the already-proven tool.

USAGE (called as a subprocess from Node, see oltPythonBridge.js):
    python3 huawei_olt_helper.py '<json-encoded request>'

Always prints exactly ONE line of JSON to stdout, regardless of success
or failure, so the Node side has a single, simple parsing contract:
    {"success": true,  "data": {...}}
    {"success": false, "error": "human readable message"}

Anything printed to stderr is diagnostic/log noise and should be ignored
by the Node parser, not parsed as the result.
"""

import sys
import json
import traceback

from netmiko import ConnectHandler
from netmiko.exceptions import (
    NetmikoTimeoutException,
    NetmikoAuthenticationException,
)


def build_connection_params(req):
    """
    Build the netmiko ConnectHandler kwargs from the request payload.
    device_type is hardcoded to huawei_olt_telnet — this script is
    Huawei-OLT-specific on purpose, not a generic multi-vendor bridge.
    """
    return {
        "device_type": "huawei_olt_telnet",
        "host": req["host"],
        "username": req["username"],
        "password": req["password"],
        "port": req.get("port", 23),
        "timeout": req.get("timeout", 20),
        "session_timeout": req.get("timeout", 20),
        "fast_cli": False,  # safer default against a device we've seen behave unpredictably
    }


def op_test_connection(conn, req):
    """
    Connect, enter enable+config, run display version and display board 0,
    return raw text for both. Parsing into structured fields stays on the
    Node side (huawei.js already has _parseVersion/_parseBoardTable that
    work against this exact real output — no need to duplicate that logic
    in Python).
    """
    conn.enable()
    conn.config_mode()

    version_output = conn.send_command("display version", read_timeout=req.get("timeout", 20))
    board_output = conn.send_command("display board 0", read_timeout=req.get("timeout", 20))

    return {
        "rawVersionOutput": version_output,
        "rawBoardOutput": board_output,
    }


def op_run_commands(conn, req):
    """
    Generic operation: run an arbitrary ordered list of MML commands in
    one session (after enable+config), return each command's raw output
    in order.

    IMPORTANT: 'quit' mid-batch exits the current sub-mode (e.g. interface
    gpon -> config) but does NOT exit config mode entirely. After a quit,
    the prompt returns to MA5683T(config)# — the next command runs fine
    from there without needing another 'config'. We handle this by checking
    if a command is 'quit' and using send_command_timing instead of
    send_command, since quit doesn't produce a real output we need, and
    send_command would wrongly wait for a prompt pattern that may not match
    cleanly after a mode transition.

    Per-command timeout is deliberately short (5s) for display commands
    against a local-LAN OLT — these return in <1s normally. The default
    20s timeout multiplied by 16 ports is 320s, which is why the nginx
    504 was firing. 5s × 16 = 80s worst case, well within limits.
    """
    conn.enable()
    conn.config_mode()

    # Use a short per-command timeout — OLT is on local LAN so commands
    # complete in <1s normally. Caller can override with cmd_timeout in request.
    cmd_timeout = req.get("cmd_timeout", 5)

    outputs = []
    for cmd in req["commands"]:
        cmd_stripped = cmd.strip()
        if cmd_stripped.lower() == 'quit':
            # quit changes prompt level — use timing-based read instead of
            # pattern-matching, since we don't need its output anyway.
            conn.send_command_timing(cmd_stripped, last_read=1)
            outputs.append('')
        else:
            out = conn.send_command(
                cmd_stripped,
                read_timeout=cmd_timeout,
                expect_string=r'[>#\$]\s*$',
                cmd_verify=False  # skip echo-verification; long commands (e.g. "ont add ... desc")
                                  # get wrapped by the OLT's terminal width, so re.escape(cmd)
                                  # never matches the (line-wrapped) echoed output as one string
            )
            outputs.append(out)

    return {"outputs": outputs}


OPERATIONS = {
    "test_connection": op_test_connection,
    "run_commands": op_run_commands,
}


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "No request payload provided"}))
        sys.exit(1)

    try:
        req = json.loads(sys.argv[1])
    except json.JSONDecodeError as e:
        print(json.dumps({"success": False, "error": f"Invalid JSON request: {e}"}))
        sys.exit(1)

    operation = req.get("operation")
    if operation not in OPERATIONS:
        print(json.dumps({
            "success": False,
            "error": f"Unknown operation '{operation}'. Valid: {list(OPERATIONS.keys())}"
        }))
        sys.exit(1)

    conn = None
    try:
        conn_params = build_connection_params(req)
        conn = ConnectHandler(**conn_params)

        result_data = OPERATIONS[operation](conn, req)

        print(json.dumps({"success": True, "data": result_data}))

    except NetmikoAuthenticationException as e:
        print(json.dumps({"success": False, "error": f"Authentication failed: {e}"}))
        sys.exit(0)  # exit 0 — this is an expected/handled failure mode, not a crash

    except NetmikoTimeoutException as e:
        print(json.dumps({"success": False, "error": f"Connection timed out: {e}"}))
        sys.exit(0)

    except Exception as e:
        # Catch-all: print the real error AND a traceback to stderr (for
        # debugging) but keep stdout to exactly one clean JSON line.
        print(f"Unexpected error: {e}\n{traceback.format_exc()}", file=sys.stderr)
        print(json.dumps({"success": False, "error": f"Unexpected error: {e}"}))
        sys.exit(0)

    finally:
        if conn is not None:
            try:
                conn.disconnect()
            except Exception:
                # Cleanup failing isn't itself a reportable error — the
                # main result was already printed above either way.
                pass


if __name__ == "__main__":
    main()