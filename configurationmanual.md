# ============================================
# ISP PPPoE SETUP SCRIPT
# ============================================

:log info "Starting PPPoE setup..."


:if ([:len [/interface bridge find name="bridge-pppoe"]] = 0) do={
    /interface bridge add name=bridge-pppoe comment="PPPoE Bridge - ISP System"
    :log info "Bridge bridge-pppoe created"
} else={
    :log info "Bridge bridge-pppoe already exists"
}


:local activeCidr "10.10.0.0/16"
:local bridgeName "bridge-pppoe"

# Parse CIDR
:local ip [:pick $activeCidr 0 [:find $activeCidr "/"]]
:local prefix [:tonum [:pick $activeCidr ([:find $activeCidr "/"] + 1) [:len $activeCidr]]]
:local mask (0xFFFFFFFF << (32 - $prefix))
:local ipInt (([:tonum [:pick $ip 0 [:find $ip "."]]] << 24) + (([:tonum [:pick $ip ([:find $ip "."] + 1) [:find $ip "." [:find $ip "."] + 1]]] << 16)) + (([:tonum [:pick $ip ([:find $ip "." [:find $ip "."] + 1] + 1) [:find $ip "." [:find $ip "." [:find $ip "."] + 1] + 1]]] << 8)) + [:tonum [:pick $ip ([:find $ip "." [:find $ip "." [:find $ip "."] + 1] + 1] + 1) [:len $ip]]])
:local networkInt ($ipInt & $mask)
:local gatewayInt ($networkInt + 1)
:local poolStartInt ($gatewayInt + 1)
:local poolEndInt (($networkInt | (~$mask & 0xFFFFFFFF)) - 1)

:local intToIp do={ :return ((($1 >> 24) & 0xFF) . "." . (($1 >> 16) & 0xFF) . "." . (($1 >> 8) & 0xFF) . "." . ($1 & 0xFF)) }
:local gatewayIp [$intToIp $gatewayInt]
:local poolStart [$intToIp $poolStartInt]
:local poolEnd [$intToIp $poolEndInt]

# Gateway IP
:if ([:len [/ip address find address=($gatewayIp . "/" . $prefix)]] = 0) do={
    /ip address add address=($gatewayIp . "/" . $prefix) interface=$bridgeName comment="PPPoE Gateway"
    :log info ("Gateway " . $gatewayIp . " added")
}

# Active pool
:if ([:len [/ip pool find name="active-pool"]] = 0) do={
    /ip pool add name=active-pool ranges=($poolStart . "-" . $poolEnd) comment="Active PPPoE users"
    :log info "Pool active-pool created"
}

# Error pools
:local errorPools {
    { name="expired-pool"; cidr="10.254.254.0/24"; gw="10.254.254.1"; range="10.254.254.2-10.254.254.254"; comment="Expired users" };
    { name="credential-pool"; cidr="20.20.0.0/16"; gw="20.20.0.1"; range="20.20.0.2-20.20.255.254"; comment="Wrong password" };
    { name="non-existent"; cidr="30.30.0.0/16"; gw="30.30.0.1"; range="30.30.0.2-30.30.255.254"; comment="Non-existent user" };
    { name="mac-difference"; cidr="40.40.0.0/16"; gw="40.40.0.1"; range="40.40.0.2-40.40.255.254"; comment="MAC mismatch" }
}

:foreach pool in=$errorPools do={
    :if ([:len [/ip address find address=($pool->"gw" . "/" . [:pick ($pool->"cidr") ([:find ($pool->"cidr") "/"] + 1) [:len ($pool->"cidr")]])]] = 0) do={
        /ip address add address=($pool->"gw" . "/24") interface=$bridgeName comment=($pool->"comment" . " gateway")
    }
    :if ([:len [/ip pool find name=($pool->"name")]] = 0) do={
        /ip pool add name=($pool->"name") ranges=($pool->"range") comment=($pool->"comment")
        :log info ("Pool " . ($pool->"name") . " created")
    }
}

# NAT masquerade
:if ([:len [/ip firewall nat find comment="Masquerade for active-pool"]] = 0) do={
    /ip firewall nat add chain=srcnat src-address=$activeCidr action=masquerade comment="Masquerade for active-pool"
}


:local serviceName "pppoe-server"
:local profileName "radius-profile"

# Get gateway for profile
:local gwAddress [/ip address get [find comment="PPPoE Gateway"] address]
:local localAddress [:pick $gwAddress 0 [:find $gwAddress "/"]]

# Create profile
:if ([:len [/ppp profile find name=$profileName]] = 0) do={
    /ppp profile add name=$profileName \
        local-address=$localAddress \
        remote-address=active-pool \
        dns-server=8.8.8.8,8.8.4.4 \
        only-one=yes \
        use-encryption=no \
        comment="Auto-created by ISP system"
    :log info ("Profile " . $profileName . " created")
}

# Create PPPoE server
:if ([:len [/interface pppoe-server server find interface=$bridgeName]] = 0) do={
    /interface pppoe-server server add \
        interface=$bridgeName \
        service-name=$serviceName \
        default-profile=$profileName \
        authentication=pap \
        max-mtu=1480 \
        max-mru=1480 \
        mrru=1600 \
        disabled=no \
        comment="PPPoE Server"
    :log info "PPPoE server created"
} else={
    :log info "PPPoE server already exists"
}

:log info "PPPoE setup complete!"