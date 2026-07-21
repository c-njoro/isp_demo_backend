# SkyLink Networks — Huawei GPON OLT Onboarding Runbook

This is the one-time setup checklist for bringing a **new Huawei MA5683T-family OLT**
into service with SkyLink's Skylink authorization flow. Everything here is done
**once per OLT**, before the app's "Authorize" button is used on any ONU.

Once this runbook is complete, the automated `authorize-skylink` flow only needs to
do per-ONU work: `ont add` → `ont ipconfig` → `service-port ... gemport`. It does
**not** need to touch VLANs, uplink ports, or profiles — those are OLT-wide and
already in place after this runbook.

---

## 0. Prerequisites

- OLT is powered on and reachable via its **MGMT port** (SSH/Telnet) for initial config.
- You know: the OLT's management VLAN ID for ONU management IPs (SkyLink standard: **VLAN 41**),
  and the subnet/DHCP pool that will hand out management IPs (SkyLink standard: `172.18.0.0/16`,
  MikroTik-side — see Part 2).
- You have physical access to the OLT to identify and cable the correct uplink port.

---

## Part 1: OLT-Side Setup

### 1.1 Identify your boards

```
display board 0
```

Note which slot holds which board type. Typical SkyLink layout:
- A GPON service board (e.g. `H805GPFD`) — where ONTs physically connect
- A control board (e.g. `H802SCUN`) — **often has its own built-in GE uplink ports**
- Optionally a dedicated uplink card (e.g. `H801X2CS`, a **2-port 10GE SFP+ ONLY** card
  — it does not accept copper/electrical SFPs, fiber optics only)

**Lesson learned:** don't assume the dedicated uplink card is where you should patch in.
The control board's own GE ports are often the simplest, already-cabled path (see 1.2).

### 1.2 Find a working, physically-connected uplink port

Check every candidate board:

```
display board 0/<slotid>
```

Look at the per-port table:
```
Port  Port Optic   Native  ...  Active   Link
      Type Status  VLAN                State
   0  GE   normal       1  ...  active   online
```

- `Link State: online` + `Optic Status: normal` = a real, working physical link.
- `Optic Status: absence` = no transceiver detected in that port (reseat / check cabling).
- `Optic Status: mismatch` = wrong transceiver type for that port (e.g. a copper SFP
  in a fiber-only 10GE SFP+ card — this will never come up, use the correct card/module type).

**You do not need a second/dedicated uplink cable.** A single physical port carries
untagged native VLAN 1 (OLT's own reachability) *and* tagged VLAN 41 (ONU management)
simultaneously over 802.1Q — reuse whatever port is already cabled and online if it's on
a board that supports tagged VLANs being added (control board GE ports, e.g. `0/6/0`, work fine).

Record the F/S/P of your chosen uplink port — referred to below as `<uplink-fsp>`
(e.g. `0/6/0`), and as `<uplink-frame>/<uplink-slot> <uplink-port>` for the `port vlan` command.

### 1.3 Create the management VLAN (if not already present)

```
vlan 41 smart
```

(SkyLink convention creates 40–41 together: `vlan 40 to 41 smart` — adjust range as needed.)

### 1.4 Permit the management VLAN on the uplink port

```
port vlan 41 <uplink-frame>/<uplink-slot> <uplink-port>
```

Example: `port vlan 41 0/6 0`

Verify:
```
display port vlan <uplink-fsp>
```
Should list both `1` (native) and `41`.

**Recommended:** also apply this to any other candidate uplink ports on the same
board (e.g. ports 0–3) so future physical re-cabling doesn't require revisiting this step.

### 1.5 Enable OMCI-based Home Gateway configuration (global, one time)

This is required for the OLT to be allowed to push WAN/IP config to ONTs via OMCI at all.
Without this, `ont ipconfig` / `ont internet-config` / `ont wan-config` fail with:
`Failure: The current HG configuration method of the ONT does not support this operation`

```
gpon ont home-gateway config-method omci
```

Run once, globally, in `config` mode. Not per-port, not per-ONT.

### 1.6 Confirm/create DBA (bandwidth) profiles

Usually already present from SmartOLT-era setup. Verify:
```
display dba-profile all
```

If you need a new one:
```
dba-profile add profile-id <id> profile-name "<name>" type4 max <kbps>
```

### 1.7 Confirm/create a line profile (GEM ports + TR-069)

The line profile declares which GEM index maps to which VLAN, and whether TR-069
management is enabled. SkyLink's existing working template (profile 2,
`SMARTOLT_FLEXIBLE_GPON`) already does this correctly:

```
ont-lineprofile gpon profile-id 2 profile-name "SMARTOLT_FLEXIBLE_GPON"
  tr069-management enable
  tcont 1 dba-profile-id 10
  gem add 1 eth tcont 1
  gem mapping 1 1 priority 0
  commit
  quit
```

**Key point:** whatever GEM index this profile declares (here, `1`) is the index you
must reference in the per-ONU `service-port ... gemport <index>` command later —
they have to match, or you'll hit `Failure: GEM configuration exists` (wrong index
already claimed) or a service-port that never comes up.

Reuse this existing profile (ID 2) for new ONUs unless you have a specific reason
to create a new one.

### 1.8 Service profile — use an ADAPTIVE profile, not a fixed one

**This is the step that caused the majority of our debugging pain.** A service
profile declares fixed port counts (POTS/ETH/etc.) that must exactly match what
each ONT model reports over OMCI, or the ONT's `Match state` shows `mismatch` and
config pushes silently fail later. Since SkyLink deploys multiple ONT models,
**do not build a new fixed-count profile per model.**

Use an **adaptive** profile instead — SkyLink already has one:

```
ont-srvprofile gpon profile-id 1 profile-name "GPON_FTTH"
  ont-port pots adaptive 32 eth adaptive 8
  commit
```

`adaptive` auto-matches whatever the connected ONT actually reports, eliminating
the POTS-count mismatch class of failure entirely. **Use `ont-srvprofile-id 1` for
all new ONU authorizations** unless a specific deployment needs a fixed-profile
override (rare — only for advanced per-port QoS/VLAN policy that adaptive can't express).

> Historical note: profile 2 (`UN220G`, POTS=0) and profile 3 (`HGU-WAN`, POTS=1)
> are fixed-count profiles built for specific ONT models during earlier testing.
> They still work for exactly-matching hardware, but are a maintenance trap for
> a multi-model fleet. New authorizations should prefer profile 1.

### 1.9 WAN profile — NOT required for management IP

We initially assumed `ont wan-profile` + `ont internet-config` + `ont wan-config`
were required to get an ONT its management IP. **They are not.** That chain is for
provisioning a *customer-facing* routed WAN service on the ONT itself (NAT/route
mode internet access) — a different feature.

**For management IP only, `ont ipconfig` is sufficient** (see Part 3, step 2).
Do not run `ont internet-config`/`ont wan-config` as part of the authorize flow
unless you are specifically also provisioning customer WAN routing on the ONT —
if you do need that later, the profile/command chain is documented in
Appendix B.

### 1.9b TR-069/ACS server profile (one-time, OLT-wide)

Create once per OLT — every ONU shares the same ACS, so this is not per-ONU config:

```
ont tr069-server-profile add profile-id 1 profile-name "SkylinkACS" url "http://<acs-user>:<acs-password>@<acs-host>:<acs-port>" user user-name "<acs-user>"
```

**Important finding:** on this firmware (`MA5600V800R018`), the interactive `?`
command tree for `ont tr069-server-profile add`/`modify` only exposes `url`,
`user user-name <name>`, and `auth-realm` — **there is no separate password
keyword anywhere in the CLI**, despite several online references showing a
`user USERNAME PASSWORD` two-token syntax (that appears to be a different
firmware/R-version — don't trust it blindly, verify against your own device's
`?` output first).

Since GenieACS (or any ACS enforcing `CWMP_AUTH_PASSWORD`) needs real
credentials, the working approach is to **embed the username:password directly
in the URL** using standard HTTP Basic Auth syntax:
`http://username:password@host:port`. Confirmed working — the ONT successfully
authenticates and sends periodic Informs using this method.

Verify the profile:
```
display ont tr069-server-profile all
```

### 1.10 Verification checklist for a newly onboarded OLT

- [ ] `display board 0` — boards recognized correctly
- [ ] Chosen uplink port shows `Link State: online`, correct `Optic Status`
- [ ] `display port vlan <uplink-fsp>` — shows VLAN 41 permitted
- [ ] `display dba-profile all` — required bandwidth profiles present
- [ ] `display ont-lineprofile gpon profile-id 2` (or equivalent) — TR-069 enabled, GEM mapped
- [ ] `display ont-srvprofile gpon profile-id 1` — adaptive profile present
- [ ] `gpon ont home-gateway config-method omci` has been run (no direct "display" to verify this — re-running it is harmless/idempotent, safe to always include in setup)
- [ ] `display ont tr069-server-profile all` — ACS profile present with correct URL

---

## Part 2: MikroTik-Side Setup (per OLT's upstream router)

This mirrors the OLT-side VLAN so ONT management IPs are actually reachable.

```
/interface vlan
add interface=<bridge> name=vlan<id>MNGMNT vlan-id=<vlan-id>

/interface bridge port
add bridge=<bridge> interface=<physical-port-toward-olt>

/ip pool
add name=<pool-name> ranges=<mgmt-subnet-first>-<mgmt-subnet-last>

/ip address
add address=<router-host-ip>/<prefix> interface=vlan<id>MNGMNT

/ip dhcp-server
add address-pool=<pool-name> interface=vlan<id>MNGMNT name=<dhcp-name>

/ip dhcp-server network
add address=<mgmt-subnet>/<prefix> gateway=<router-host-ip>
```

**Critical gotcha we hit:** the `gateway=` value in `/ip dhcp-server network` and
the `/ip address` on the VLAN interface **must be a real host address**
(e.g. `172.18.0.1`), never the bare network address (`172.18.0.0`). A bare network
address as gateway means ONTs get an IP but can never route anywhere beyond direct
L2 reachability.

**Physical connectivity check before troubleshooting VLANs:**
```
/interface monitor-traffic vlan<id>MNGMNT once
```
If `rx-packets-per-second` stays at 0 even after OLT-side config is correct, the
issue is physical (wrong port/cable/SFP type), not VLAN config. Confirm the OLT's
uplink port truly shows `Link State: online` before chasing anything else.

---

## Part 3: Per-ONU Authorization Sequence (what the app automates)

Once Parts 1 and 2 are done for an OLT, this is the exact validated command
sequence the automated `authorize-skylink` flow should run per ONU:

```
interface gpon <ont-frame>/<ont-slot>
ont add <port> <ontid> sn-auth <sn> omci ont-lineprofile-id 2 ont-srvprofile-id 1 desc "<desc>"
ont ipconfig <port> <ontid> dhcp vlan 41 priority 0
ont tr069-server-config <port> <ontid> profile-id 1
service-port vlan 41 gpon <ont-fsp> ont <ontid> gemport 1 multi-service user-vlan 41
```

Notes:
- `ont-lineprofile-id 2` and `gemport 1` must match (line profile 2 declares GEM index 1).
- `ont-srvprofile-id 1` is the adaptive profile from step 1.8 — safe across ONT models.
- `ont tr069-server-config ... profile-id 1` binds the ONT to the shared ACS profile
  created once in 1.9b — the ONT should begin sending periodic Informs within ~60s.
- The `service-port` command as shown lets the OLT auto-assign the service-port
  index — no manual index tracking/self-healing-retry-loop needed, since we're not
  specifying an explicit index. This is simpler and more robust than the earlier
  approach of guessing/incrementing an index counter.
- No `internet-config`/`wan-config` needed for management purposes (see 1.9).

---

## Appendix A: Errors We Hit & What They Actually Meant

| Error text | Real cause |
|---|---|
| `Pattern not detected: '<command>' in output` | Netmiko's cmd_verify echo-check failing on long commands the OLT line-wraps at terminal width. Fix: `cmd_verify=False`. |
| `% Unknown command, the error locates at '^'` with garbled/spaceless command text | The command syntax itself was wrong (missing a required keyword) — **not** a paste/space-drop issue. The OLT strips/garbles input around a syntax error. Always suspect wrong syntax first; drill with `?` before assuming a transport bug. |
| `Failure: Service virtual port has existed already` | A service-port already bound to that exact physical GPON-port/ONT-ID/gemport/VLAN combination — usually a stale entry from a deleted ONT that was never cleaned up. Check `display service-port vlan <id>` and `undo service-port <index>`. |
| `Failure: The ONT does not exist` (on service-port creation) | The preceding `ont add` never actually succeeded — always confirm with `display ont info <fsp> all` before assuming success. |
| `Match state: mismatch` in `display ont info` | The bound service profile's declared port counts (POTS/ETH/etc.) don't match what the ONT actually reports. Fix: use an adaptive profile (1.8), or build a profile matching that exact model. |
| `Config state: failed` + alarm "The GPON ONT configuration recovery fails" | OMCI config push rejected, commonly right after a profile change on an already-registered ONT. Fix: `ont reset <port> <ontid>` to force full re-registration against the corrected profile. |
| `Failure: The current HG configuration method of the ONT does not support this operation` | Global OMCI home-gateway config method not enabled. Run `gpon ont home-gateway config-method omci` (1.5). |
| `Failure: GEM configuration exists` | Attempting to create a service-port GEM binding (e.g. via `iphost`) at an index already declared by the ONT's line profile for a different port type. Use `gemport <index>` matching what the line profile already declared instead of `iphost`. |
| `Optic Status: mismatch` on an uplink port | Wrong transceiver type for that port/card (e.g. copper SFP in a fiber-only 10GE SFP+ card). Check the card's actual spec — some Huawei uplink cards are fiber-only. |
| `Optic Status: absence` | No transceiver detected — reseat the module, check it's fully clicked in. |
| No password field in `ont tr069-server-profile add`/`modify` CLI tree | This firmware only exposes `url`, `user user-name`, `auth-realm` — no password keyword despite some online docs showing `user USERNAME PASSWORD`. Fix: embed credentials in the URL itself — `http://username:password@host:port` (standard HTTP Basic Auth syntax). Confirmed working against GenieACS. |

## Appendix B: Optional — Customer WAN/Internet Provisioning (NOT part of management IP flow)

Only needed if provisioning the ONT itself as a routed customer gateway (separate
from management access):

```
ont wan-profile profile-id <id> profile-name "<name>"
  connection-type route
  nat switch disable
  quit
ont internet-config <port> <ontid> ip-index 0
ont wan-config <port> <ontid> ip-index 0 profile-id <wan-profile-id>
```