# OLT Onboarding Guide — Full Findings & Step-by-Step

This document exists because the first OLT we connected (the "boardroom"
site) took a long debugging session to get working. The problem was spread
across FOUR different systems, each one looking fine on its own but
breaking the chain when combined. This file explains what we found, in
plain English, so the next OLT takes 10 minutes instead of 2 hours.

---

## The big picture — what "reaching an OLT" actually involves

Your VPS is far away from the OLT. To reach it, traffic has to pass through
several hops, and EVERY hop has to know what to do with that traffic:

```
[VPS]  --(OpenVPN tunnel)-->  [MikroTik]  --(LAN cable)-->  [OLT]
```

It's not enough for the tunnel to be "connected." Four separate things all
have to be configured correctly, and we found problems in two of them
the first time:

1. The OpenVPN **server** (on the VPS) needs to know the OLT's subnet exists at all.
2. The OpenVPN **client config** (CCD file, one per MikroTik) needs to know
   WHICH MikroTik that subnet lives behind.
3. The MikroTik needs to actually forward traffic from the tunnel to the
   OLT's LAN port — this usually just works automatically, but should be checked.
4. **The OLT itself** needs to know how to send REPLIES back — this means
   its own default gateway must point at the MikroTik, not anywhere else.

We found a real bug in #1 (the server config had no route at all) and in
#4 (the OLT's gateway was pointing at the wrong address) on the first OLT.
Both are explained below in detail, since they're the ones most likely to
bite you again.

---

## CRITICAL RULE — every OLT subnet must be unique across your whole network

A common temptation is to reuse the same numbers everywhere (e.g. every
site uses `10.82.0.x` for its OLT). **This will not work and cannot work.**

Here's why: the OpenVPN server's job, when it gets a packet addressed to
`10.82.0.2`, is to figure out WHICH of your 15 MikroTik tunnels to send
that packet down. It does this by checking each MikroTik's `iroute` line
— basically asking "which router claims to own this subnet?" If two
different MikroTik's CCD files both say "I own `10.82.0.0/24`," the server
has no way to know which one you actually meant. It'll either pick the
wrong one or fail.

**So: every site needs its own distinct subnet number.** A clean way to do
this, since you have ~15 sites:

```
Site 1 (boardroom): 10.82.0.0/24    <- already in use, this is what we set up
Site 2:             10.83.0.0/24
Site 3:             10.84.0.0/24
...and so on, one distinct /24 per site
```

You don't have to use 10.82/10.83/10.84 specifically — any scheme works,
as long as no two sites ever share a subnet. Write down each site's subnet
in the table at the bottom of this file as you add them, so you never
accidentally reuse one.

(Side note: if a single site ever has MULTIPLE OLTs, they can usually
share that site's one subnet — e.g. OLT #1 at `10.82.0.2`, OLT #2 at
`10.82.0.3`, both behind the same MikroTik. It's only across DIFFERENT
MikroTik routers that subnets must never repeat.)

A related mix-up worth heading off: the `10.8.0.x` range is a totally
different, separate address space from `10.82.0.x` — `10.8.0.x` is the
**tunnel range** (every MikroTik gets one fixed address there, e.g.
`10.8.0.30` for boardroom), while `10.82.0.x` is the **OLT's own LAN range**
at that one site. You cannot write an `iroute` line using a `10.8.0.x`
address to "label" which OLT it is — `iroute` only ever names a real LAN
subnet that sits behind a router, never a tunnel address. Tunnel addresses
are handled automatically by OpenVPN itself.

---

## STEP 1 — Physical connection and addressing (done on-site, by hand)

- Patch the OLT's management port into a free LAN port on the MikroTik
  (e.g. `ether2`, `ether4` — whichever is free).
- Pick this site's subnet (see the uniqueness rule above) and give the
  MikroTik's LAN port an IP in it:
  ```
  /ip address add address=10.82.0.4/24 interface=ether2
  ```
- Give the OLT itself a static IP in that same subnet, and — this is the
  part that caused our actual bug — **set its gateway to the MikroTik's
  IP on that LAN** (`10.82.0.4` in our example), not anything else. This
  is normally done by telnetting into the OLT once it has any IP at all,
  or via a console/serial cable on first boot.

**Check it works locally first, before touching the VPS at all:**
From the MikroTik terminal:
```
ping 10.82.0.2
```
If this doesn't work, nothing past this point will either — fix the local
cabling/IP first.

---

## STEP 2 — Confirm (or fix) the OLT's own default route

**This is the bug we actually hit on OLT #1, so check this carefully every time.**

Telnet into the OLT and run:
```
enable
config
display ip routing-table
```

Look at the line that starts with `0.0.0.0/0` — this is the OLT's default
route, i.e. "where do I send anything that isn't on my own local network."
Check the `NextHop` column.

**What we found the first time:** the NextHop was set to `10.82.0.1` —
which is actually our VPS's tunnel address, not anything that exists on
the OLT's own LAN. The OLT tried to ARP (basically, "shout on the LAN
asking who has this address") for `10.82.0.1`, but nothing ever answered,
because that address isn't actually on this LAN segment — it's across the
VPN tunnel, several hops away. So every reply the OLT tried to send back
just silently died. From the outside, this looked like a routing problem
on the VPS or MikroTik side, when really the OLT itself had the wrong
gateway the whole time.

**The fix**, if NextHop is wrong:
```
undo ip route-static 0.0.0.0 0 <the-wrong-nexthop>
ip route-static 0.0.0.0 0 10.82.0.4
```
(replace `10.82.0.4` with this site's actual MikroTik LAN IP)

Then confirm:
```
display ip routing-table
```
The `0.0.0.0/0` line should now show the MikroTik's IP as NextHop.

---

## STEP 3 — OpenVPN server config: tell the VPS this subnet exists

**Only needed ONCE per new subnet** — if you're adding a second OLT at a
site whose subnet is already declared here, skip this step.

On the VPS:
```
sudo nano /etc/openvpn/server/skylink-vpn.conf
```
Add a line like this, near the existing `server 10.8.0.0 255.255.255.0` line:
```
route 10.82.0.0 255.255.255.0
```

**What this actually does:** without this line, the VPS's own operating
system has no idea `10.82.0.0/24` is reachable through the VPN at all. Any
packet addressed there just falls through to the VPS's normal internet
gateway and gets sent out to the public internet, where it bounces around
lost until it expires (you'll see "Time to live exceeded" if this is the
problem — that's exactly the error we saw before this fix). Adding `route`
here tells the VPS kernel: "this subnet is real, hand anything addressed
there to the OpenVPN process."

**This requires restarting OpenVPN itself — and that briefly disconnects
ALL 15 MikroTik tunnels, not just the one you're working on.** Only do
this when that's acceptable (not while troubleshooting something urgent
elsewhere):
```
sudo systemctl restart openvpn-server@skylink-vpn
```

After restarting, confirm the tunnel itself came back up before going
further:
```
ping <this-router's-tunnel-ip>
```

---

## STEP 4 — OpenVPN client config (CCD): tell the server WHICH router owns this subnet

**Needed every time** you add a new subnet, even if step 3 was already done
for an earlier OLT at a different site.

On the VPS:
```
sudo nano /etc/openvpn/ccd/client-<this-router-name>
```
Add:
```
iroute 10.82.0.0 255.255.255.0
```

**What this actually does:** step 3 told the VPS "this subnet exists,
send it into the VPN system." But the VPN system manages 15 different
tunnels — it still needs to know WHICH of those 15 tunnels leads to this
particular subnet. The `iroute` line answers that, scoped to one specific
router's CCD file. Remember: both step 3's `route` line AND this step's
`iroute` line are required together — neither one alone is enough, and
they do genuinely different jobs (server-wide awareness vs. per-tunnel
ownership).

This only needs that one router's tunnel to reconnect — not a full server
restart. From the MikroTik:
```
/interface ovpn-client disable skylink-vpn
/interface ovpn-client enable skylink-vpn
```

Confirm the tunnel reconnected:
```
ping <this-router's-tunnel-ip>
```
(from the VPS)

---

## STEP 5 — The real end-to-end test

From the VPS:
```bash
ping 10.82.0.2
```
(replace with the actual OLT IP)

This is the only test that actually proves the whole chain works. Here's
how to read the result:

- **Real replies (`64 bytes from ...`)** → everything works, you're done with networking.
- **"Time to live exceeded"** → step 3 is missing or wrong (the VPS doesn't
  know the subnet exists, so the packet escaped to the public internet).
  This is exactly what we saw on our first attempt.
- **Plain timeout, no errors at all** → could be step 4 missing (server
  doesn't know which tunnel to use), OR the MikroTik's firewall is
  blocking forward traffic between the tunnel and the OLT's LAN port.
  To tell these apart, sniff traffic on the MikroTik (see below).
- **Still times out even after steps 3+4 are confirmed correct** → this is
  the trickiest one, and it's what we actually hit after fixing the route.
  To diagnose it, sniff the MikroTik's OLT-facing port WHILE pinging from
  the VPS:
  ```
  /tool sniffer quick interface=ether2
  ```
  If you see the ping ARRIVE, but then see the OLT sending out
  `who has <vps-tunnel-ip>?` ARP requests that never get answered — that's
  exactly our bug. It means the packet got all the way to the OLT, but the
  OLT doesn't know how to send the reply back, because its own gateway
  (step 2) is set wrong. Go fix step 2.

**The order we actually debugged this in, for reference:** we hit "Time to
live exceeded" first (step 3 was missing entirely), fixed that, then hit a
plain timeout with no errors, which turned out to be the ARP loop visible
only via the sniffer — meaning step 2 (the OLT's own gateway) was the
final, real culprit. Both problems existed at the same time; fixing one
revealed the other.

---

## STEP 6 — Once ping works, confirm telnet access

```bash
telnet 10.82.0.2
```
or run the Node test script (`test-connection.js`) against this OLT's IP,
to confirm we can also reach it at the application level, not just ping.

---

## Subnet allocation log — keep this updated every time you add a site

| Site / router name | OLT subnet      | MikroTik LAN IP | OLT IP   | OLT gateway set correctly? |
|---------------------|-----------------|------------------|----------|------------------------------|
| boardroom            | 10.82.0.0/24    | 10.82.0.4        | 10.82.0.2 | ✅ Yes (10.82.0.4) |
|                       |                 |                  |           |                              |
|                       |                 |                  |           |                              |