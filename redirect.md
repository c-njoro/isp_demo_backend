[admin@BARNABAS MikroTik] > export
# 2026-05-18 16:59:49 by RouterOS 7.18.2
# software id = X6ZA-0976
#
# model = CCR2116-12G-4S+
# serial number = HJR0AVMS3TY
/interface bridge
add name=Br_PPPoE
add name=OI_BRIDGE
add name=bridge1
/interface ethernet
set [ find default-name=sfp-sfpplus1 ] l2mtu=1514 mac-address=04:F4:1C:1A:99:5A
set [ find default-name=sfp-sfpplus2 ] l2mtu=1514 mac-address=04:F4:1C:1A:99:57
set [ find default-name=sfp-sfpplus3 ] l2mtu=1514 mac-address=04:F4:1C:1A:99:59
set [ find default-name=sfp-sfpplus4 ] auto-negotiation=no l2mtu=1514 mac-address=04:F4:1C:1A:99:58 speed=1G-baseT-full
/interface vlan
add interface=OI_BRIDGE name=HUAWEI_MANAGEMENT_VLAN vlan-id=1550
add interface=OI_BRIDGE name=HUAWEI_SERVICE_VLAN vlan-id=1555
add interface=OI_BRIDGE name=HW_MGMT2 vlan-id=1600
add interface=OI_BRIDGE name=ONU_MANAGEMENT_VLAN vlan-id=1505
add interface=OI_BRIDGE name=ONU_SERVICE_VLAN vlan-id=1500
add interface=OI_BRIDGE name=vlan_Hotspot vlan-id=101
/ip hotspot profile
add dns-name=login.hs hotspot-address=10.251.0.1 login-by=mac,http-chap,http-pap mac-auth-mode=mac-as-username-and-password \
    name=one-isp use-radius=yes
/ip pool
add name=EXPIRED_POOL ranges=10.255.0.10-10.255.255.255
add name=pppoe-pool ranges=10.254.0.10-10.254.255.255
add name=dhcp_pool4 ranges=172.24.0.2-172.24.255.254
add name=vpn_pool ranges=192.168.89.2-192.168.89.6
add name=dhcp_pool7 ranges=192.168.64.2-192.168.79.254
add name=dhcp_pool8 ranges=192.168.23.2-192.168.23.254
add name=hotspot-pool ranges=10.251.0.2-10.251.255.254
/ip dhcp-server
add address-pool=dhcp_pool4 interface=ONU_MANAGEMENT_VLAN name=dhcp1
add address-pool=dhcp_pool7 interface=HUAWEI_MANAGEMENT_VLAN name=dhcp2
add address-pool=dhcp_pool8 interface=ether12 name=dhcp3
add add-arp=yes address-pool=hotspot-pool conflict-detection=no interface=vlan_Hotspot lease-time=1h name=HOTSPOT_DHCP
/ip hotspot
add address-pool=hotspot-pool disabled=no interface=vlan_Hotspot name=hotspot profile=one-isp
/port
set 0 name=serial0
/ppp profile
set *0 dns-server=8.8.8.8 local-address=192.168.89.1 remote-address=vpn_pool
add change-tcp-mss=yes name=ovpn use-encryption=yes
add dns-server=8.8.8.8,8.8.4.4 local-address=10.254.0.1 name=ppp remote-address=pppoe-pool
add local-address=pppoe-pool name=profile1 rate-limit=100M/100M remote-address=pppoe-pool
add change-tcp-mss=yes name=OVPN-SmartOLT only-one=yes use-encryption=required use-mpls=no
/interface ovpn-client
add certificate=172.19.5.52 cipher=aes256-cbc connect-to=vpn.one-isp.net mac-address=FE:74:19:A6:3C:F4 name="One ISP OVPN" \
    profile=ovpn use-peer-dns=no user=172.19.5.52
add certificate=SmartOLT-Client-tunnel8 cipher=aes256-cbc connect-to=skylinknetworks.smartolt.com mac-address=\
    FE:2A:F3:14:FA:FF name=SmartOLT-VPN port=16037 profile=OVPN-SmartOLT user=tunnel8@skylinknetworks.smartolt.com \
    verify-server-certificate=yes
/system logging action
set 0 memory-lines=10000
/interface bridge port
add bridge=OI_BRIDGE interface=sfp-sfpplus2
add bridge=bridge1 interface=ether3
add bridge=bridge1 interface=ether2
add bridge=OI_BRIDGE interface=sfp-sfpplus3
/ip neighbor discovery-settings
set discover-interface-list=!dynamic
/interface l2tp-server server
set default-profile=default enabled=yes use-ipsec=yes
/interface ovpn-server server
add mac-address=FE:7C:AA:06:03:CC name=ovpn-server1
/interface pppoe-server server
add authentication=pap default-profile=ppp disabled=no interface=ONU_SERVICE_VLAN keepalive-timeout=60 max-mru=1492 \
    max-mtu=1492 mrru=1600 one-session-per-host=yes service-name=service1
/interface pptp-server server
# PPTP connections are considered unsafe, it is suggested to use a more modern VPN protocol instead
set authentication=pap,chap,mschap1,mschap2 enabled=yes keepalive-timeout=disabled max-mru=1500 max-mtu=1500
/ip address
add address=102.210.42.30/30 interface=sfp-sfpplus1 network=102.210.42.28
add address=192.168.23.1/24 interface=ether12 network=192.168.23.0
add address=10.34.0.1/24 interface=bridge1 network=10.34.0.0
add address=172.24.0.1/16 interface=ONU_MANAGEMENT_VLAN network=172.24.0.0
add address=10.20.59.133/18 interface=sfp-sfpplus1 network=10.20.0.0
add address=192.168.64.1/20 interface=HUAWEI_MANAGEMENT_VLAN network=192.168.64.0
add address=10.20.0.1/22 interface=HW_MGMT2 network=10.20.0.0
add address=192.168.45.1/24 interface=OI_BRIDGE network=192.168.45.0
add address=10.251.0.1/16 comment="hotspot network" interface=vlan_Hotspot network=10.251.0.0
/ip dhcp-server network
add address=10.251.0.0/16 comment="hotspot network" gateway=10.251.0.1
add address=172.24.0.0/16 gateway=172.24.0.1
add address=192.168.23.0/24 gateway=192.168.23.1
add address=192.168.64.0/20 gateway=192.168.64.1
/ip dns
set allow-remote-requests=yes servers=8.8.8.8,8.8.4.4
/ip firewall address-list
add address=10.254.0.0/16 list=ALLOWED_USERS
add address=10.255.0.0/16 list=DISABLED_USERS
add address=redirect.one-isp.net comment="-- DON'T REMOVE ::: OI EXPIRED USERS --" list=OI_REDIRECT_IP
add address=10.251.0.0/16 list=ALLOWED_USERS
/ip firewall filter
add action=passthrough chain=unused-hs-chain comment="place hotspot rules here" disabled=yes
add action=reject chain=forward comment="-- DON'T REMOVE ::: OI EXPIRED USERS --" disabled=yes dst-port=!80,3346 protocol=\
    tcp reject-with=icmp-network-unreachable src-address-list=DISABLED_USERS
add action=accept chain=forward comment="-- DON'T REMOVE ::: OI EXPIRED USERS --" disabled=yes dst-port=53 protocol=tcp \
    src-address-list=DISABLED_USERS
add action=accept chain=forward comment="-- DON'T REMOVE ::: OI EXPIRED USERS --" disabled=yes dst-port=53 protocol=udp \
    src-address-list=DISABLED_USERS
add action=drop chain=forward comment="-- DON'T REMOVE ::: OI EXPIRED USERS --" disabled=yes src-address-list=\
    DISABLED_USERS
add action=reject chain=forward comment="-- DON'T REMOVE ::: OI EXPIRED USERS --" dst-port=!80,3346 protocol=tcp \
    reject-with=icmp-network-unreachable src-address-list=DISABLED_USERS
add action=accept chain=forward comment="-- DON'T REMOVE ::: OI EXPIRED USERS --" dst-port=53 protocol=tcp \
    src-address-list=DISABLED_USERS
add action=accept chain=forward comment="-- DON'T REMOVE ::: OI EXPIRED USERS --" dst-port=53 protocol=udp \
    src-address-list=DISABLED_USERS
add action=drop chain=forward comment="-- DON'T REMOVE ::: OI EXPIRED USERS --" src-address-list=DISABLED_USERS
/ip firewall nat
add action=accept chain=srcnat comment="SmartOLT-VPN traffic excluded from NAT" out-interface=SmartOLT-VPN
add action=passthrough chain=unused-hs-chain comment="place hotspot rules here" disabled=yes
add action=masquerade chain=srcnat src-address-list=ALLOWED_USERS
add action=masquerade chain=srcnat comment="-- DON'T REMOVE ::: OI EXPIRED USERS --" dst-address=8.8.8.8 src-address-list=\
    DISABLED_USERS
add action=masquerade chain=srcnat comment="-- DON'T REMOVE ::: OI EXPIRED USERS --" dst-address=8.8.4.4 src-address-list=\
    DISABLED_USERS
add action=redirect chain=dstnat comment="-- DON'T REMOVE ::: OI EXPIRED USERS --" dst-port=80 protocol=tcp \
    src-address-list=DISABLED_USERS to-ports=3346
add action=dst-nat chain=dstnat comment="-- DON'T REMOVE ::: OI EXPIRED USERS --" disabled=yes dst-port=80 protocol=tcp \
    src-address-list=DISABLED_USERS to-addresses=13.245.222.41
add action=masquerade chain=srcnat comment="-- DON'T REMOVE ::: OI EXPIRED USERS --" disabled=yes dst-address-list=\
    OI_REDIRECT_IP src-address-list=DISABLED_USERS
add action=masquerade chain=srcnat src-address-list=ALLOWED_USERS
add action=masquerade chain=srcnat comment="WITEK AP" src-address=192.168.23.2
add action=masquerade chain=srcnat src-address=192.168.45.10
add action=masquerade chain=srcnat comment="Caretaker Barnabas Apt" src-address=192.168.45.11
add action=masquerade chain=srcnat src-address=192.168.89.0/24
add action=masquerade chain=srcnat disabled=yes src-address=10.34.0.0/24
add action=masquerade chain=srcnat src-address-list=ALLOWED_USERS
add action=masquerade chain=srcnat comment="-- DON'T REMOVE ::: OI EXPIRED USERS --" dst-address=8.8.8.8 src-address-list=\
    DISABLED_USERS
add action=masquerade chain=srcnat comment="-- DON'T REMOVE ::: OI EXPIRED USERS --" dst-address=8.8.4.4 src-address-list=\
    DISABLED_USERS
add action=redirect chain=dstnat comment="-- DON'T REMOVE ::: OI EXPIRED USERS --" dst-port=80 protocol=tcp \
    src-address-list=DISABLED_USERS to-ports=3346
add action=dst-nat chain=dstnat comment="-- DON'T REMOVE ::: OI EXPIRED USERS --" disabled=yes dst-port=80 protocol=tcp \
    src-address-list=DISABLED_USERS to-addresses=13.245.222.41
add action=masquerade chain=srcnat comment="-- DON'T REMOVE ::: OI EXPIRED USERS --" disabled=yes dst-address-list=\
    OI_REDIRECT_IP src-address-list=DISABLED_USERS
add action=masquerade chain=srcnat src-address-list=ALLOWED_USERS
add action=masquerade chain=srcnat src-address-list=ALLOWED_USERS
add action=masquerade chain=srcnat src-address-list=ALLOWED_USERS
add action=masquerade chain=srcnat src-address-list=ALLOWED_USERS
/ip hotspot ip-binding
add address=10.251.0.0/16 server=hotspot
add address=0.0.0.0/0 server=hotspot type=blocked
/ip hotspot walled-garden
add dst-host=*.one-isp.net
/ip proxy
set enabled=yes max-cache-size=none parent-proxy=0.0.0.0 port=3346 src-address=0.0.0.0
/ip proxy access
add action=redirect action-data=redirect.one-isp.net/skn/expired/172.19.5.52 dst-host=!*.one-isp.net
add action=redirect action-data=redirect.one-isp.net/skn/expired/172.19.5.52 dst-host=!*.one-isp.net
/ip route
add disabled=no distance=1 dst-address=0.0.0.0/0 gateway=102.210.42.29 routing-table=main scope=30 suppress-hw-offload=no \
    target-scope=10
/ip service
set telnet disabled=yes
set ftp disabled=yes
set ssh disabled=yes port=2222
set api address=10.5.5.1/32,10.66.122.1/32,10.66.111.0/24,146.190.64.164/32 disabled=yes
set api-ssl disabled=yes
/ppp aaa
set use-radius=yes
/ppp secret
add name=test profile=profile1 service=pppoe
add name=test2 profile=profile1 service=pppoe
add name=vpn
add name=ezron profile=profile1 service=pptp
/radius
add address=172.19.0.1 require-message-auth=no service=ppp,hotspot timeout=3s
add address=172.19.0.1 service=ppp,hotspot timeout=3s
add address=172.19.0.1 require-message-auth=no service=ppp,hotspot src-address=172.19.5.52 timeout=3s
add address=172.19.0.1 service=ppp,hotspot src-address=172.19.5.52 timeout=3s
add address=172.19.0.1 require-message-auth=no service=ppp,hotspot src-address=172.19.5.52 timeout=3s
add address=172.19.0.1 service=ppp,hotspot src-address=172.19.5.52 timeout=3s
/radius incoming
set accept=yes
/system clock
set time-zone-name=Africa/Nairobi
/system identity
set name="BARNABAS MikroTik"
/system leds
set 0 leds="" type=interface-activity
/system note
set show-at-login=no
/system resource irq rps
set *2 disabled=yes
set *7 disabled=yes
set *8 disabled=yes
set *9 disabled=yes
set *A disabled=yes
/system routerboard settings
set enter-setup-on=delete-key
/tool romon
set enabled=yes
[admin@BARNABAS MikroTik] > [admin@BARNABAS MikroTik] > export
# 2026-05-18 16:59:49 by RouterOS 7.18.2
# software id = X6ZA-0976
#
# model = CCR2116-12G-4S+
# serial number = HJR0AVMS3TY
/interface bridge
add name=Br_PPPoE
add name=OI_BRIDGE
add name=bridge1
/interface ethernet
set [ find default-name=sfp-sfpplus1 ] l2mtu=1514 mac-address=04:F4:1C:1A:99:5A
set [ find default-name=sfp-sfpplus2 ] l2mtu=1514 mac-address=04:F4:1C:1A:99:57
set [ find default-name=sfp-sfpplus3 ] l2mtu=1514 mac-address=04:F4:1C:1A:99:59
set [ find default-name=sfp-sfpplus4 ] auto-negotiation=no l2mtu=1514 mac-address=04:F4:1C:1A:99:58 speed=1G-baseT-full
/interface vlan
add interface=OI_BRIDGE name=HUAWEI_MANAGEMENT_VLAN vlan-id=1550
add interface=OI_BRIDGE name=HUAWEI_SERVICE_VLAN vlan-id=1555
add interface=OI_BRIDGE name=HW_MGMT2 vlan-id=1600
add interface=OI_BRIDGE name=ONU_MANAGEMENT_VLAN vlan-id=1505
add interface=OI_BRIDGE name=ONU_SERVICE_VLAN vlan-id=1500
add interface=OI_BRIDGE name=vlan_Hotspot vlan-id=101
/ip hotspot profile
add dns-name=login.hs hotspot-address=10.251.0.1 login-by=mac,http-chap,http-pap mac-auth-mode=mac-as-username-and-password \
    name=one-isp use-radius=yes
/ip pool
add name=EXPIRED_POOL ranges=10.255.0.10-10.255.255.255
add name=pppoe-pool ranges=10.254.0.10-10.254.255.255
add name=dhcp_pool4 ranges=172.24.0.2-172.24.255.254
add name=vpn_pool ranges=192.168.89.2-192.168.89.6
add name=dhcp_pool7 ranges=192.168.64.2-192.168.79.254
add name=dhcp_pool8 ranges=192.168.23.2-192.168.23.254
add name=hotspot-pool ranges=10.251.0.2-10.251.255.254
/ip dhcp-server
add address-pool=dhcp_pool4 interface=ONU_MANAGEMENT_VLAN name=dhcp1
add address-pool=dhcp_pool7 interface=HUAWEI_MANAGEMENT_VLAN name=dhcp2
add address-pool=dhcp_pool8 interface=ether12 name=dhcp3
add add-arp=yes address-pool=hotspot-pool conflict-detection=no interface=vlan_Hotspot lease-time=1h name=HOTSPOT_DHCP
/ip hotspot
add address-pool=hotspot-pool disabled=no interface=vlan_Hotspot name=hotspot profile=one-isp
/port
set 0 name=serial0
/ppp profile
set *0 dns-server=8.8.8.8 local-address=192.168.89.1 remote-address=vpn_pool
add change-tcp-mss=yes name=ovpn use-encryption=yes
add dns-server=8.8.8.8,8.8.4.4 local-address=10.254.0.1 name=ppp remote-address=pppoe-pool
add local-address=pppoe-pool name=profile1 rate-limit=100M/100M remote-address=pppoe-pool
add change-tcp-mss=yes name=OVPN-SmartOLT only-one=yes use-encryption=required use-mpls=no
/interface ovpn-client
add certificate=172.19.5.52 cipher=aes256-cbc connect-to=vpn.one-isp.net mac-address=FE:74:19:A6:3C:F4 name="One ISP OVPN" \
    profile=ovpn use-peer-dns=no user=172.19.5.52
add certificate=SmartOLT-Client-tunnel8 cipher=aes256-cbc connect-to=skylinknetworks.smartolt.com mac-address=\
    FE:2A:F3:14:FA:FF name=SmartOLT-VPN port=16037 profile=OVPN-SmartOLT user=tunnel8@skylinknetworks.smartolt.com \
    verify-server-certificate=yes
/system logging action
set 0 memory-lines=10000
/interface bridge port
add bridge=OI_BRIDGE interface=sfp-sfpplus2
add bridge=bridge1 interface=ether3
add bridge=bridge1 interface=ether2
add bridge=OI_BRIDGE interface=sfp-sfpplus3
/ip neighbor discovery-settings
set discover-interface-list=!dynamic
/interface l2tp-server server
set default-profile=default enabled=yes use-ipsec=yes
/interface ovpn-server server
add mac-address=FE:7C:AA:06:03:CC name=ovpn-server1
/interface pppoe-server server
add authentication=pap default-profile=ppp disabled=no interface=ONU_SERVICE_VLAN keepalive-timeout=60 max-mru=1492 \
    max-mtu=1492 mrru=1600 one-session-per-host=yes service-name=service1
/interface pptp-server server
# PPTP connections are considered unsafe, it is suggested to use a more modern VPN protocol instead
set authentication=pap,chap,mschap1,mschap2 enabled=yes keepalive-timeout=disabled max-mru=1500 max-mtu=1500
/ip address
add address=102.210.42.30/30 interface=sfp-sfpplus1 network=102.210.42.28
add address=192.168.23.1/24 interface=ether12 network=192.168.23.0
add address=10.34.0.1/24 interface=bridge1 network=10.34.0.0
add address=172.24.0.1/16 interface=ONU_MANAGEMENT_VLAN network=172.24.0.0
add address=10.20.59.133/18 interface=sfp-sfpplus1 network=10.20.0.0
add address=192.168.64.1/20 interface=HUAWEI_MANAGEMENT_VLAN network=192.168.64.0
add address=10.20.0.1/22 interface=HW_MGMT2 network=10.20.0.0
add address=192.168.45.1/24 interface=OI_BRIDGE network=192.168.45.0
add address=10.251.0.1/16 comment="hotspot network" interface=vlan_Hotspot network=10.251.0.0
/ip dhcp-server network
add address=10.251.0.0/16 comment="hotspot network" gateway=10.251.0.1
add address=172.24.0.0/16 gateway=172.24.0.1
add address=192.168.23.0/24 gateway=192.168.23.1
add address=192.168.64.0/20 gateway=192.168.64.1
/ip dns
set allow-remote-requests=yes servers=8.8.8.8,8.8.4.4
/ip firewall address-list
add address=10.254.0.0/16 list=ALLOWED_USERS
add address=10.255.0.0/16 list=DISABLED_USERS
add address=redirect.one-isp.net comment="-- DON'T REMOVE ::: OI EXPIRED USERS --" list=OI_REDIRECT_IP
add address=10.251.0.0/16 list=ALLOWED_USERS
/ip firewall filter
add action=passthrough chain=unused-hs-chain comment="place hotspot rules here" disabled=yes
add action=reject chain=forward comment="-- DON'T REMOVE ::: OI EXPIRED USERS --" disabled=yes dst-port=!80,3346 protocol=\
    tcp reject-with=icmp-network-unreachable src-address-list=DISABLED_USERS
add action=accept chain=forward comment="-- DON'T REMOVE ::: OI EXPIRED USERS --" disabled=yes dst-port=53 protocol=tcp \
    src-address-list=DISABLED_USERS
add action=accept chain=forward comment="-- DON'T REMOVE ::: OI EXPIRED USERS --" disabled=yes dst-port=53 protocol=udp \
    src-address-list=DISABLED_USERS
add action=drop chain=forward comment="-- DON'T REMOVE ::: OI EXPIRED USERS --" disabled=yes src-address-list=\
    DISABLED_USERS
add action=reject chain=forward comment="-- DON'T REMOVE ::: OI EXPIRED USERS --" dst-port=!80,3346 protocol=tcp \
    reject-with=icmp-network-unreachable src-address-list=DISABLED_USERS
add action=accept chain=forward comment="-- DON'T REMOVE ::: OI EXPIRED USERS --" dst-port=53 protocol=tcp \
    src-address-list=DISABLED_USERS
add action=accept chain=forward comment="-- DON'T REMOVE ::: OI EXPIRED USERS --" dst-port=53 protocol=udp \
    src-address-list=DISABLED_USERS
add action=drop chain=forward comment="-- DON'T REMOVE ::: OI EXPIRED USERS --" src-address-list=DISABLED_USERS
/ip firewall nat
add action=accept chain=srcnat comment="SmartOLT-VPN traffic excluded from NAT" out-interface=SmartOLT-VPN
add action=passthrough chain=unused-hs-chain comment="place hotspot rules here" disabled=yes
add action=masquerade chain=srcnat src-address-list=ALLOWED_USERS
add action=masquerade chain=srcnat comment="-- DON'T REMOVE ::: OI EXPIRED USERS --" dst-address=8.8.8.8 src-address-list=\
    DISABLED_USERS
add action=masquerade chain=srcnat comment="-- DON'T REMOVE ::: OI EXPIRED USERS --" dst-address=8.8.4.4 src-address-list=\
    DISABLED_USERS
add action=redirect chain=dstnat comment="-- DON'T REMOVE ::: OI EXPIRED USERS --" dst-port=80 protocol=tcp \
    src-address-list=DISABLED_USERS to-ports=3346
add action=dst-nat chain=dstnat comment="-- DON'T REMOVE ::: OI EXPIRED USERS --" disabled=yes dst-port=80 protocol=tcp \
    src-address-list=DISABLED_USERS to-addresses=13.245.222.41
add action=masquerade chain=srcnat comment="-- DON'T REMOVE ::: OI EXPIRED USERS --" disabled=yes dst-address-list=\
    OI_REDIRECT_IP src-address-list=DISABLED_USERS
add action=masquerade chain=srcnat src-address-list=ALLOWED_USERS
add action=masquerade chain=srcnat comment="WITEK AP" src-address=192.168.23.2
add action=masquerade chain=srcnat src-address=192.168.45.10
add action=masquerade chain=srcnat comment="Caretaker Barnabas Apt" src-address=192.168.45.11
add action=masquerade chain=srcnat src-address=192.168.89.0/24
add action=masquerade chain=srcnat disabled=yes src-address=10.34.0.0/24
add action=masquerade chain=srcnat src-address-list=ALLOWED_USERS
add action=masquerade chain=srcnat comment="-- DON'T REMOVE ::: OI EXPIRED USERS --" dst-address=8.8.8.8 src-address-list=\
    DISABLED_USERS
add action=masquerade chain=srcnat comment="-- DON'T REMOVE ::: OI EXPIRED USERS --" dst-address=8.8.4.4 src-address-list=\
    DISABLED_USERS
add action=redirect chain=dstnat comment="-- DON'T REMOVE ::: OI EXPIRED USERS --" dst-port=80 protocol=tcp \
    src-address-list=DISABLED_USERS to-ports=3346
add action=dst-nat chain=dstnat comment="-- DON'T REMOVE ::: OI EXPIRED USERS --" disabled=yes dst-port=80 protocol=tcp \
    src-address-list=DISABLED_USERS to-addresses=13.245.222.41
add action=masquerade chain=srcnat comment="-- DON'T REMOVE ::: OI EXPIRED USERS --" disabled=yes dst-address-list=\
    OI_REDIRECT_IP src-address-list=DISABLED_USERS
add action=masquerade chain=srcnat src-address-list=ALLOWED_USERS
add action=masquerade chain=srcnat src-address-list=ALLOWED_USERS
add action=masquerade chain=srcnat src-address-list=ALLOWED_USERS
add action=masquerade chain=srcnat src-address-list=ALLOWED_USERS
/ip hotspot ip-binding
add address=10.251.0.0/16 server=hotspot
add address=0.0.0.0/0 server=hotspot type=blocked
/ip hotspot walled-garden
add dst-host=*.one-isp.net
/ip proxy
set enabled=yes max-cache-size=none parent-proxy=0.0.0.0 port=3346 src-address=0.0.0.0
/ip proxy access
add action=redirect action-data=redirect.one-isp.net/skn/expired/172.19.5.52 dst-host=!*.one-isp.net
add action=redirect action-data=redirect.one-isp.net/skn/expired/172.19.5.52 dst-host=!*.one-isp.net
/ip route
add disabled=no distance=1 dst-address=0.0.0.0/0 gateway=102.210.42.29 routing-table=main scope=30 suppress-hw-offload=no \
    target-scope=10
/ip service
set telnet disabled=yes
set ftp disabled=yes
set ssh disabled=yes port=2222
set api address=10.5.5.1/32,10.66.122.1/32,10.66.111.0/24,146.190.64.164/32 disabled=yes
set api-ssl disabled=yes
/ppp aaa
set use-radius=yes
/ppp secret
add name=test profile=profile1 service=pppoe
add name=test2 profile=profile1 service=pppoe
add name=vpn
add name=ezron profile=profile1 service=pptp
/radius
add address=172.19.0.1 require-message-auth=no service=ppp,hotspot timeout=3s
add address=172.19.0.1 service=ppp,hotspot timeout=3s
add address=172.19.0.1 require-message-auth=no service=ppp,hotspot src-address=172.19.5.52 timeout=3s
add address=172.19.0.1 service=ppp,hotspot src-address=172.19.5.52 timeout=3s
add address=172.19.0.1 require-message-auth=no service=ppp,hotspot src-address=172.19.5.52 timeout=3s
add address=172.19.0.1 service=ppp,hotspot src-address=172.19.5.52 timeout=3s
/radius incoming
set accept=yes
/system clock
set time-zone-name=Africa/Nairobi
/system identity
set name="BARNABAS MikroTik"
/system leds
set 0 leds="" type=interface-activity
/system note
set show-at-login=no
/system resource irq rps
set *2 disabled=yes
set *7 disabled=yes
set *8 disabled=yes
set *9 disabled=yes
set *A disabled=yes
/system routerboard settings
set enter-setup-on=delete-key
/tool romon
set enabled=yes
[admin@BARNABAS MikroTik] > 






INSERT INTO radius.radcheck (username, attribute, op, value)
VALUES
('MDU122', 'Cleartext-Password', ':=', 'mKindu@#'),


INSERT INTO radius.radusergroup (username, groupname, priority)
VALUES
('MDU122', '20MBPS_HOME', 1),







#Mikrotik Non-payment page (Dont change anything here)
/ip firewall address-list
add address=redirect.skylinknetworks.co.ke list="OI_REDIRECT_IP" comment="-- DON'T REMOVE ::: OI EXPIRED USERS --"
/ip firewall filter
add action=reject chain=forward dst-port=!80,3346 protocol=tcp reject-with=\
    icmp-network-unreachable src-address-list=DISABLED_USERS comment="-- DON'T REMOVE ::: OI EXPIRED USERS --"
add action=accept chain=forward dst-port=53 \
    protocol=tcp src-address-list=DISABLED_USERS comment="-- DON'T REMOVE ::: OI EXPIRED USERS --"
add action=accept chain=forward dst-port=53 protocol=udp src-address-list=DISABLED_USERS \
    comment="-- DON'T REMOVE ::: OI EXPIRED USERS --"
add action=drop chain=forward src-address-list=DISABLED_USERS comment="-- DON'T REMOVE ::: OI EXPIRED USERS --"
/ip firewall nat
add action=masquerade chain=srcnat dst-address=8.8.8.8 \
    src-address-list=DISABLED_USERS comment="-- DON'T REMOVE ::: OI EXPIRED USERS --"
add action=masquerade chain=srcnat dst-address=8.8.4.4 \
    src-address-list=DISABLED_USERS comment="-- DON'T REMOVE ::: OI EXPIRED USERS --"
add action=redirect chain=dstnat dst-port=80 protocol=tcp \
    src-address-list=DISABLED_USERS to-ports=3346 comment="-- DON'T REMOVE ::: OI EXPIRED USERS --"
add action=dst-nat chain=dstnat dst-port=80 protocol=tcp \
    src-address-list=DISABLED_USERS to-addresses=13.245.222.41 comment="-- DON'T REMOVE ::: OI EXPIRED USERS --" disabled=yes
add action=masquerade chain=srcnat dst-address-list=OI_REDIRECT_IP \
    src-address-list=DISABLED_USERS comment="-- DON'T REMOVE ::: OI EXPIRED USERS --" disabled=yes
/ip proxy
set enabled=yes max-cache-size=none parent-proxy=0.0.0.0 port=3346 src-address=0.0.0.0
/ip proxy access
add action=deny dst-host=!*.one-isp.net redirect-to=\
    redirect.one-isp.net/skylink/expired/172.19.6.33
####v7.X
add action=redirect dst-host=!*.one-isp.net action-data=\
    redirect.one-isp.net/skylink/expired/172.19.6.33 
    ####





