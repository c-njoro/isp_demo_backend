const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// =========================================================================
// 1. INSERT YOUR NEW PACKAGES JSON HERE
// =========================================================================
// Paste your array of packages here when running the script.
const NEW_SYSTEM_PACKAGES = [
  {
      "speed": {
          "download": 6,
          "upload": 6,
          "burstSpeed": 100,
          "burstThreshold": 100,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480b4",
      "packageName": "Unlimited for 14 days Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 800,
      "period": 14,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 5,
          "upload": 5,
          "burstSpeed": 100,
          "burstThreshold": 100,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480b0",
      "packageName": "5Mbps_1K Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 1000,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 10,
          "upload": 10,
          "burstSpeed": 100,
          "burstThreshold": 100,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c448100",
      "packageName": "10Mbps Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 1300,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 6,
          "upload": 6,
          "burstSpeed": 100,
          "burstThreshold": 100,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480b5",
      "packageName": "Unlimited for a Month Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 1499,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 5,
          "upload": 5,
          "burstSpeed": 0,
          "burstThreshold": 0,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480ab",
      "packageName": "5Mbps_1500 Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 1500,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 20,
          "upload": 20,
          "burstSpeed": 100,
          "burstThreshold": 100,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480e3",
      "packageName": "Nam_Package Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 1500,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 12,
          "upload": 12,
          "burstSpeed": 100,
          "burstThreshold": 100,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480fc",
      "packageName": "12Mbps@1500 Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 1500,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 10,
          "upload": 10,
          "burstSpeed": 100,
          "burstThreshold": 100,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480fe",
      "packageName": "10Mbps@1500 Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 1500,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 18,
          "upload": 18,
          "burstSpeed": 100,
          "burstThreshold": 100,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c448101",
      "packageName": "18Mbps Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 1500,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 7,
          "upload": 7,
          "burstSpeed": 100,
          "burstThreshold": 100,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480fb",
      "packageName": "7Mbps Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 1650,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 4,
          "upload": 4,
          "burstSpeed": 100,
          "burstThreshold": 100,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480b7",
      "packageName": "4Mbps Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 1750,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 8,
          "upload": 8,
          "burstSpeed": 0,
          "burstThreshold": 0,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480d0",
      "packageName": "8Mbps Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 1800,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 8,
          "upload": 8,
          "burstSpeed": 100,
          "burstThreshold": 100,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480e5",
      "packageName": "8Mbps Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 1800,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 6,
          "upload": 6,
          "burstSpeed": 100,
          "burstThreshold": 100,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480d7",
      "packageName": "6Mbps Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 1850,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 14,
          "upload": 14,
          "burstSpeed": 0,
          "burstThreshold": 0,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480a0",
      "packageName": "12Mbps Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 2000,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 12,
          "upload": 12,
          "burstSpeed": 100,
          "burstThreshold": 100,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480c7",
      "packageName": "10Mbps_2k Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 2000,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 12,
          "upload": 12,
          "burstSpeed": 100,
          "burstThreshold": 100,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480d1",
      "packageName": "12Mbps Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 2000,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 7,
          "upload": 7,
          "burstSpeed": 100,
          "burstThreshold": 100,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480dc",
      "packageName": "7mbps Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 2000,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 24,
          "upload": 24,
          "burstSpeed": 100,
          "burstThreshold": 100,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c448102",
      "packageName": "24Mbps Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 2000,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 20,
          "upload": 20,
          "burstSpeed": 0,
          "burstThreshold": 0,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480a1",
      "packageName": "20Mbps Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 2500,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 5,
          "upload": 5,
          "burstSpeed": 0,
          "burstThreshold": 0,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480a6",
      "packageName": "5Mbps_Wireless Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 2500,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 9,
          "upload": 9,
          "burstSpeed": 100,
          "burstThreshold": 100,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480ad",
      "packageName": "8Mbps_Wireless Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 2500,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 20,
          "upload": 20,
          "burstSpeed": 100,
          "burstThreshold": 100,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480d2",
      "packageName": "20Mbps Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 2500,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 15,
          "upload": 15,
          "burstSpeed": 100,
          "burstThreshold": 100,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480d6",
      "packageName": "15Mbps@2500 Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 2500,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 10,
          "upload": 10,
          "burstSpeed": 100,
          "burstThreshold": 100,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480e9",
      "packageName": "10Mbps_Business Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 2500,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 10,
          "upload": 10,
          "burstSpeed": 100,
          "burstThreshold": 100,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480ea",
      "packageName": "10Mbps Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 2500,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 15,
          "upload": 15,
          "burstSpeed": 100,
          "burstThreshold": 100,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480f4",
      "packageName": "15Mbps Business Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 2500,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 32,
          "upload": 32,
          "burstSpeed": 100,
          "burstThreshold": 100,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480ff",
      "packageName": "32Mbps Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 2599,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 8,
          "upload": 8,
          "burstSpeed": 0,
          "burstThreshold": 0,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480cb",
      "packageName": "MobileWorld@2800 Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 2800,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 30,
          "upload": 30,
          "burstSpeed": 0,
          "burstThreshold": 0,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480a2",
      "packageName": "30Mbps Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 3000,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 8,
          "upload": 8,
          "burstSpeed": 0,
          "burstThreshold": 0,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480a7",
      "packageName": "8Mbps_Wireless Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 3000,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 5,
          "upload": 5,
          "burstSpeed": 0,
          "burstThreshold": 0,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480b6",
      "packageName": "George_Amol_3k Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 3000,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 15,
          "upload": 15,
          "burstSpeed": 100,
          "burstThreshold": 100,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480be",
      "packageName": "Janet_Mogire Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 3000,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 12,
          "upload": 12,
          "burstSpeed": 0,
          "burstThreshold": 0,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480c9",
      "packageName": "Davtech@3k Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 3000,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 30,
          "upload": 30,
          "burstSpeed": 100,
          "burstThreshold": 100,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480d3",
      "packageName": "30Mbps Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 3000,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 20,
          "upload": 20,
          "burstSpeed": 100,
          "burstThreshold": 100,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480d8",
      "packageName": "20Mbps@3k Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 3000,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 15,
          "upload": 15,
          "burstSpeed": 100,
          "burstThreshold": 100,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480e2",
      "packageName": "15Mbps_Business Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 3000,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 5,
          "upload": 5,
          "burstSpeed": 100,
          "burstThreshold": 100,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480ec",
      "packageName": "Chalo@3k Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 3000,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 10,
          "upload": 10,
          "burstSpeed": 100,
          "burstThreshold": 100,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480f1",
      "packageName": "Maryanne@3k Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 3000,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 10,
          "upload": 10,
          "burstSpeed": 0,
          "burstThreshold": 0,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480aa",
      "packageName": "10Mbps_Wireless Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 3500,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 10,
          "upload": 10,
          "burstSpeed": 100,
          "burstThreshold": 100,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480ac",
      "packageName": "10Mbps_Wireless Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 3500,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 5,
          "upload": 5,
          "burstSpeed": 100,
          "burstThreshold": 100,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480b9",
      "packageName": "Stephen_Kiragu Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 3500,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 15,
          "upload": 15,
          "burstSpeed": 0,
          "burstThreshold": 0,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480bd",
      "packageName": "Brian_Okoth@3500/= Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 3500,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 5,
          "upload": 5,
          "burstSpeed": 100,
          "burstThreshold": 100,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480c0",
      "packageName": "Benson_Mwaura Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 3500,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 20,
          "upload": 20,
          "burstSpeed": 100,
          "burstThreshold": 100,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480c2",
      "packageName": "Entry_Package Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 3500,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 15,
          "upload": 15,
          "burstSpeed": 100,
          "burstThreshold": 100,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480c8",
      "packageName": "15Mbps@3500/= Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 3500,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 30,
          "upload": 30,
          "burstSpeed": 100,
          "burstThreshold": 100,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480da",
      "packageName": "30Mbps_3500 Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 3500,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 35,
          "upload": 35,
          "burstSpeed": 100,
          "burstThreshold": 100,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480e7",
      "packageName": "35Mbps Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 3500,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 30,
          "upload": 30,
          "burstSpeed": 100,
          "burstThreshold": 100,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480eb",
      "packageName": "County@3500/= Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 3500,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 10,
          "upload": 10,
          "burstSpeed": 100,
          "burstThreshold": 100,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480df",
      "packageName": "Ruth@3850 Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 3850,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 40,
          "upload": 40,
          "burstSpeed": 0,
          "burstThreshold": 0,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480a4",
      "packageName": "40Mbps Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 4000,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 12,
          "upload": 12,
          "burstSpeed": 0,
          "burstThreshold": 0,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480a8",
      "packageName": "12Mbps_Wireless Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 4000,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 20,
          "upload": 20,
          "burstSpeed": 0,
          "burstThreshold": 0,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480ae",
      "packageName": "20Mbps_4K Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 4000,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 5,
          "upload": 5,
          "burstSpeed": 100,
          "burstThreshold": 100,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480ba",
      "packageName": "Dakims_Package Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 4000,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 10,
          "upload": 10,
          "burstSpeed": 100,
          "burstThreshold": 100,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480c5",
      "packageName": "Homegates_4k Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 4000,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 5,
          "upload": 5,
          "burstSpeed": 0,
          "burstThreshold": 0,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480c6",
      "packageName": "Tiktok_4k Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 4000,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 25,
          "upload": 25,
          "burstSpeed": 100,
          "burstThreshold": 100,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480cc",
      "packageName": "25Mbps Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 4000,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 5,
          "upload": 5,
          "burstSpeed": 100,
          "burstThreshold": 100,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480cd",
      "packageName": "Monica_Njuguna4k Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 4000,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 40,
          "upload": 40,
          "burstSpeed": 100,
          "burstThreshold": 100,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480d4",
      "packageName": "40Mbps Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 4000,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 30,
          "upload": 30,
          "burstSpeed": 100,
          "burstThreshold": 100,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480ee",
      "packageName": "30Mbps_4k Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 4000,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 30,
          "upload": 30,
          "burstSpeed": 100,
          "burstThreshold": 100,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480a3",
      "packageName": "30Mbps Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 4500,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 30,
          "upload": 30,
          "burstSpeed": 100,
          "burstThreshold": 100,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480c4",
      "packageName": "Seas_Motors_4500 Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 4500,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 12,
          "upload": 12,
          "burstSpeed": 0,
          "burstThreshold": 0,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480db",
      "packageName": "Aldai_pri_W_4500 Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 4500,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 45,
          "upload": 45,
          "burstSpeed": 100,
          "burstThreshold": 100,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480fa",
      "packageName": "45Mbps Plan Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 4500,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 15,
          "upload": 15,
          "burstSpeed": 0,
          "burstThreshold": 0,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480a5",
      "packageName": "15Mbps_Wireless Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 5000,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 20,
          "upload": 20,
          "burstSpeed": 100,
          "burstThreshold": 100,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480b2",
      "packageName": "20Mbps_Business Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 5000,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 13,
          "upload": 13,
          "burstSpeed": 100,
          "burstThreshold": 100,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480bf",
      "packageName": "Farelian_Osoro Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 5000,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 55,
          "upload": 55,
          "burstSpeed": 0,
          "burstThreshold": 0,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480ca",
      "packageName": "50Mbps Business Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 5000,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 60,
          "upload": 60,
          "burstSpeed": 100,
          "burstThreshold": 100,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480d5",
      "packageName": "60Mbps Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 5000,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 25,
          "upload": 25,
          "burstSpeed": 0,
          "burstThreshold": 0,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480de",
      "packageName": "Twincat@5k Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 5000,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 50,
          "upload": 50,
          "burstSpeed": 100,
          "burstThreshold": 100,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480e1",
      "packageName": "Grebe_Package@5k Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 5000,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 40,
          "upload": 40,
          "burstSpeed": 100,
          "burstThreshold": 100,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480ef",
      "packageName": "40Mbps_5k Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 5000,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 25,
          "upload": 25,
          "burstSpeed": 100,
          "burstThreshold": 100,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480f0",
      "packageName": "25Mbps_Business Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 5000,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 10,
          "upload": 10,
          "burstSpeed": 100,
          "burstThreshold": 100,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480f6",
      "packageName": "Maritim@5k Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 5000,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 30,
          "upload": 30,
          "burstSpeed": 0,
          "burstThreshold": 0,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480f9",
      "packageName": "Thananga_Plan Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 5000,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 25,
          "upload": 25,
          "burstSpeed": 0,
          "burstThreshold": 0,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480fd",
      "packageName": "Flame Safety Plan Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 5000,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 65,
          "upload": 65,
          "burstSpeed": 100,
          "burstThreshold": 100,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c448103",
      "packageName": "65Mbps Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 5000,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 30,
          "upload": 30,
          "burstSpeed": 100,
          "burstThreshold": 100,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480ed",
      "packageName": "ILRI_Package Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 5172,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 15,
          "upload": 15,
          "burstSpeed": 100,
          "burstThreshold": 100,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480bc",
      "packageName": "15Mbps_W_6k Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 6000,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 30,
          "upload": 30,
          "burstSpeed": 100,
          "burstThreshold": 100,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480e0",
      "packageName": "30Mbps_Business Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 6000,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 60,
          "upload": 60,
          "burstSpeed": 100,
          "burstThreshold": 100,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480e6",
      "packageName": "60Mbps Business Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 6000,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 15,
          "upload": 15,
          "burstSpeed": 0,
          "burstThreshold": 0,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480e8",
      "packageName": "Little_Friends@6k Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 6000,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 12,
          "upload": 12,
          "burstSpeed": 0,
          "burstThreshold": 0,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c448105",
      "packageName": "Winnie_Package@6k Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 6000,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 100,
          "upload": 100,
          "burstSpeed": 100,
          "burstThreshold": 100,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c448104",
      "packageName": "100Mbps Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 6900,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 10,
          "upload": 10,
          "burstSpeed": 100,
          "burstThreshold": 100,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480af",
      "packageName": "10Mbps_Wireless Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 7000,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 15,
          "upload": 15,
          "burstSpeed": 100,
          "burstThreshold": 100,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480b1",
      "packageName": "15Mbps_W_7k Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 7000,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 40,
          "upload": 40,
          "burstSpeed": 0,
          "burstThreshold": 0,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480b8",
      "packageName": "Utugi_Package Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 7000,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 80,
          "upload": 80,
          "burstSpeed": 0,
          "burstThreshold": 0,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480e4",
      "packageName": "80Mbps Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 7000,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 40,
          "upload": 40,
          "burstSpeed": 100,
          "burstThreshold": 100,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480f8",
      "packageName": "35Mbps Reseller Package Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 7000,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 20,
          "upload": 20,
          "burstSpeed": 100,
          "burstThreshold": 100,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480c1",
      "packageName": "Rafiki_Mwema Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 7500,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 85,
          "upload": 85,
          "burstSpeed": 0,
          "burstThreshold": 0,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480c3",
      "packageName": "Sergoek_80Mbps_8000 Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 8000,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 20,
          "upload": 20,
          "burstSpeed": 100,
          "burstThreshold": 100,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480d9",
      "packageName": "Aldai_Girls Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 8000,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 100,
          "upload": 100,
          "burstSpeed": 100,
          "burstThreshold": 100,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480f2",
      "packageName": "100Mbps Business Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 8000,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 45,
          "upload": 45,
          "burstSpeed": 0,
          "burstThreshold": 0,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480f7",
      "packageName": "40Mbps Reseller Package Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 8000,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 35,
          "upload": 35,
          "burstSpeed": 100,
          "burstThreshold": 100,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480b3",
      "packageName": "30Mbps_9k Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 9000,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 20,
          "upload": 20,
          "burstSpeed": 0,
          "burstThreshold": 0,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480cf",
      "packageName": "George_Rono@9500/= Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 9500,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 30,
          "upload": 30,
          "burstSpeed": 100,
          "burstThreshold": 100,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480bb",
      "packageName": "30Mbps_HT Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 10000,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 50,
          "upload": 50,
          "burstSpeed": 100,
          "burstThreshold": 100,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480f5",
      "packageName": "50Mbps Business Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 10000,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 80,
          "upload": 80,
          "burstSpeed": 0,
          "burstThreshold": 0,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480f3",
      "packageName": "Generation_K Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 11793,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 60,
          "upload": 60,
          "burstSpeed": 100,
          "burstThreshold": 100,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480dd",
      "packageName": "Robert_K_60Mbps Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 12000,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 30,
          "upload": 30,
          "burstSpeed": 0,
          "burstThreshold": 0,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480a9",
      "packageName": "30Mbps_Wireless Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 15000,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  },
  {
      "speed": {
          "download": 62,
          "upload": 62,
          "burstSpeed": 100,
          "burstThreshold": 100,
          "burstTime": 0,
          "burstEnabled": false
      },
      "fup": {
          "enabled": false,
          "dataThresholdGB": 0,
          "throttleDownloadMbps": 1,
          "throttleUploadMbps": 1,
          "resetPeriod": "billingCycle"
      },
      "radiusAttributes": {
          "framedProtocol": "PPP"
      },
      "_id": "6a0e0ae8ab7871ff9c4480ce",
      "packageName": "60Mbps_Wireless Rift",
      "packageType": "ppp",
      "regionCode": "SKN",
      "siteId": {
          "_id": "6a0dc10237e5028eb51eac02",
          "name": "RIFT REGION",
          "regionCode": "SKN"
      },
      "price": 20000,
      "period": 30,
      "periodUnit": "d",
      "dataLimit": 0,
      "description": "",
      "isActive": true,
      "priority": 1
  }
]

const customerBalances = [
    {
        "ID": "2hapVMSNlvOSVtbdQeIu0s6yfk6",
        "UserName": "SKN0013",
        "FirstName": "Christine",
        "LastName": "Mathias",
        "Bal": 2000
    },
    {
        "ID": "2huXvadTxCREkd2KfjOAODaXBDC",
        "UserName": "SKN0079",
        "FirstName": "Caroline",
        "LastName": "Chepkwony",
        "Bal": 2500
    },
    {
        "ID": "2huXwAU3KDsvXjcYR7Ivw1RioqA",
        "UserName": "SKN0120",
        "FirstName": "Edward",
        "LastName": "Wanjala",
        "Bal": 2000
    },
    {
        "ID": "2huXwIpTmVw1EbvGSSW1OdayLwH",
        "UserName": "SKN0129",
        "FirstName": "Enock",
        "LastName": "Ogao",
        "Bal": 500
    },
    {
        "ID": "2huXxFMe6yBu1prQeag2YFBcTxs",
        "UserName": "SKN0207",
        "FirstName": "Jane",
        "LastName": "Njeri",
        "Bal": 2000
    },
    {
        "ID": "2huXxqOAHQnffP3TZeDYxZNUOpz",
        "UserName": "SKN0241",
        "FirstName": "Joyce",
        "LastName": "Wairimu",
        "Bal": 1000
    },
    {
        "ID": "2huXzIJfMoimpB7nsp6hNHdpDVv",
        "UserName": "SKN0335",
        "FirstName": "Patrick",
        "LastName": "Mwangi",
        "Bal": 200
    },
    {
        "ID": "2huXzIMe2e45F0UJKW6VIffPEJD",
        "UserName": "SKN0336",
        "FirstName": "Patrick",
        "LastName": "Moshanju",
        "Bal": 100
    },
    {
        "ID": "2huY041lqQrRu1oT5B24Nv19oJS",
        "UserName": "SKN0400",
        "FirstName": "ELVIS",
        "LastName": "KIMANI",
        "Bal": 3000
    },
    {
        "ID": "2huY0Hf7OzNP8vB0bfw7yLoIUvY",
        "UserName": "SKN0417",
        "FirstName": "Daniel",
        "LastName": "Rugwe",
        "Bal": 500
    },
    {
        "ID": "2huY1F4KYuAWJBXzgd2PKqCw1sW",
        "UserName": "SKN0488",
        "FirstName": "Victor",
        "LastName": "Wabwile",
        "Bal": 2000
    },
    {
        "ID": "2huY46OHKQq26k1B64oyiP8vgCj",
        "UserName": "SKN0695",
        "FirstName": "Anne",
        "LastName": "Kaime",
        "Bal": 1000
    },
    {
        "ID": "2huY4iCClM0VTjQOwv0CrXw04ay",
        "UserName": "SKN0736",
        "FirstName": "Daniel",
        "LastName": "Wanyama",
        "Bal": 4
    },
    {
        "ID": "2huY4WGQ6RTkdoQCtDE4kbdf1mM",
        "UserName": "SKN0726",
        "FirstName": "Charles",
        "LastName": "Maina",
        "Bal": 2000
    },
    {
        "ID": "2huY5trWJweJx1oBrvabcdaYbK2",
        "UserName": "SKN0809",
        "FirstName": "Victor",
        "LastName": "Wasike",
        "Bal": 2
    },
    {
        "ID": "2huY5yGzoF3ZDIF857Ygh3dKEkB",
        "UserName": "SKN0812",
        "FirstName": "Christine",
        "LastName": "Muthoni",
        "Bal": 2000
    },
    {
        "ID": "2huY6EiW6vzmuGgsJJYO0dmh9gY",
        "UserName": "SKN0828",
        "FirstName": "John",
        "LastName": "Mungai",
        "Bal": 10
    },
    {
        "ID": "2huY6YAePmlIeyjK0V7DuqogKaQ",
        "UserName": "SKN0851",
        "FirstName": "Kennedy",
        "LastName": "Malel",
        "Bal": 657
    },
    {
        "ID": "2huY73wbBpDiWCUKA8YO4iL5bI7",
        "UserName": "SKN0895",
        "FirstName": "Dennis",
        "LastName": "Girenge",
        "Bal": 1
    },
    {
        "ID": "2huY7bKbfkSg7cHeivux7FTtXyD",
        "UserName": "SKN0923",
        "FirstName": "Monica",
        "LastName": "Wayua",
        "Bal": 2000
    },
    {
        "ID": "2huY7qm3aQMJDwK2wC1F4HbV9ho",
        "UserName": "SKN0945",
        "FirstName": "Justus",
        "LastName": "Luyiakkha",
        "Bal": 500
    },
    {
        "ID": "2huY7UyXg0frCwwy54wU5rgxgQo",
        "UserName": "SKN0916",
        "FirstName": "Faith",
        "LastName": "Njoroge",
        "Bal": 2500
    },
    {
        "ID": "2huY8aI2sGiM3WNG3nl8ffzhm6I",
        "UserName": "SKN0994",
        "FirstName": "Tumaini",
        "LastName": "School",
        "Bal": 30000
    },
    {
        "ID": "2huY8QAXlKJxJvrxteNj3OvDSfV",
        "UserName": "SKN0990",
        "FirstName": "Terresia",
        "LastName": "Njonge",
        "Bal": 2500
    },
    {
        "ID": "2iK2w1e11m6r2QfPM6Y5GJaCfxP",
        "UserName": "SKN1037",
        "FirstName": "Joseph",
        "LastName": "Njenga",
        "Bal": 2500
    },
    {
        "ID": "2imAbozumB7jCj31mW3cVrszGFl",
        "UserName": "SKN1081",
        "FirstName": "Kenneth",
        "LastName": "Koech",
        "Bal": 10
    },
    {
        "ID": "2imha1WETwugJnhLeQMQpAfyMGA",
        "UserName": "SKN1105",
        "FirstName": "Esther",
        "LastName": "Koech",
        "Bal": 2500
    },
    {
        "ID": "2immSkiXACXbAFg6FC8wKmStDxx",
        "UserName": "SKN1116",
        "FirstName": "Sarah",
        "LastName": "Metto",
        "Bal": 500
    },
    {
        "ID": "2jHs2amkodLuqcCwJgfwIKuM0Ya",
        "UserName": "SKN1246",
        "FirstName": "Jacqualine",
        "LastName": "Jerotich",
        "Bal": 9
    },
    {
        "ID": "2jKFS9sMHJLM4VIEe28uqUXCFWn",
        "UserName": "SKN1251",
        "FirstName": "Edwin",
        "LastName": "Makori",
        "Bal": 20
    },
    {
        "ID": "2jMfjvDWLQ1b24NEVNcXEM62pcw",
        "UserName": "SKN1260",
        "FirstName": "KPAWU",
        "LastName": "NandiHills",
        "Bal": 1000
    },
    {
        "ID": "2kmIcT53U9nOT9y7ePO0N5IG1DW",
        "UserName": "SKN1357",
        "FirstName": "Linah",
        "LastName": "Sang",
        "Bal": 2500
    },
    {
        "ID": "2ksMt8NK8w2ZOgo3oN9ZJOM7TxH",
        "UserName": "SKN1363",
        "FirstName": "Moses",
        "LastName": "Kiragu",
        "Bal": 2000
    },
    {
        "ID": "2kxjx4aY7YAAwP31eW5lQCEMibf",
        "UserName": "SKN1369",
        "FirstName": "Alice",
        "LastName": "Wanjiru",
        "Bal": 500
    },
    {
        "ID": "2lLGCczBO9a1lEU4mqxxzYOaaKq",
        "UserName": "SKN1400",
        "FirstName": "Hillary",
        "LastName": "Yano",
        "Bal": 400
    },
    {
        "ID": "2lpzPgGIGOP9YtH3heQiw0dCa9n",
        "UserName": "SKN1481",
        "FirstName": "Simon",
        "LastName": "Loth Kipsaiya",
        "Bal": 50
    },
    {
        "ID": "2lqI2JAR7huSnkwRobztxDG0l1k",
        "UserName": "SKN1487",
        "FirstName": "Jeremiah",
        "LastName": "Kibiwot Chirchir",
        "Bal": 2000
    },
    {
        "ID": "2lZHbncSDR542bS3vD4GDYOmB7H",
        "UserName": "SKN1431",
        "FirstName": "Felix",
        "LastName": "Kiplagat",
        "Bal": 4
    },
    {
        "ID": "2mbxlQER4phDyXXA44doU7Hvihi",
        "UserName": "SKN1601",
        "FirstName": "Mobile",
        "LastName": "World",
        "Bal": 50
    },
    {
        "ID": "2mMsnXawehYA9wAhJuY18H0A7of",
        "UserName": "SKN1577",
        "FirstName": "Intepro",
        "LastName": "Ltd",
        "Bal": 2000
    },
    {
        "ID": "2mpDmXtZb0wNLA5Iraar1RqUoJ9",
        "UserName": "SKN1620",
        "FirstName": "Wilson",
        "LastName": "Sirwongot",
        "Bal": 50
    },
    {
        "ID": "2mqAed5TSizB4f3gGnAmdclxaws",
        "UserName": "SKN1622",
        "FirstName": "Hillary",
        "LastName": "Mutai",
        "Bal": 360
    },
    {
        "ID": "2mT4DcUlbeS9zWSLGZwCiWIJmZO",
        "UserName": "SKN1586",
        "FirstName": "Elphas",
        "LastName": "Rutto",
        "Bal": 200
    },
    {
        "ID": "2mTOVzCAdtyHIqkEp42n1vllQvB",
        "UserName": "SKN1589",
        "FirstName": "Brian",
        "LastName": "Too",
        "Bal": 700
    },
    {
        "ID": "2njkZLlNOMFZFkojJ2bqsB4A6Ob",
        "UserName": "SKN1694",
        "FirstName": "Nicholas ",
        "LastName": "Koech",
        "Bal": 1
    },
    {
        "ID": "2npFq2jeK8JzKP3TO9MlS6MDZN4",
        "UserName": "SKN1704",
        "FirstName": "Neema ",
        "LastName": "Koross",
        "Bal": 50
    },
    {
        "ID": "2nstETy2APyYSDFzCvmSBXCCLtt",
        "UserName": "SKN1711",
        "FirstName": "Moses",
        "LastName": "Kurui Toroitich",
        "Bal": 500
    },
    {
        "ID": "2oC5Qut0U4IrWQC6NOdaBL0Yi1B",
        "UserName": "SKN1731",
        "FirstName": "Emmah",
        "LastName": "Kibathi",
        "Bal": 2500
    },
    {
        "ID": "2pyqjFwF2SLkwHm0PhKNLHH3hC3",
        "UserName": "SKN1921",
        "FirstName": "Kipkorir",
        "LastName": "Titus",
        "Bal": 50
    },
    {
        "ID": "2rhiNftTSVvj1pCgdfQXpvhwIZe",
        "UserName": "SKN2041",
        "FirstName": "MugugaTest",
        "LastName": "kk",
        "Bal": 1
    },
    {
        "ID": "2rRmIUlt2Q87vwvQY5uqCoYc5CL",
        "UserName": "SKN2013",
        "FirstName": "Beryl",
        "LastName": "Berei",
        "Bal": 200
    },
    {
        "ID": "2rshOhWJVhjnWFeEJUSFKaLKx1L",
        "UserName": "SKN2055",
        "FirstName": "Patrick",
        "LastName": "Malova",
        "Bal": 50
    },
    {
        "ID": "2rTkfddUx2E9tzdOyhYzUIrfMDA",
        "UserName": "SKN2016",
        "FirstName": "Cosmas",
        "LastName": "Kemboi",
        "Bal": 4000
    },
    {
        "ID": "2rtsJDNilVimDISd93ngrX18iOp",
        "UserName": "SKN2063",
        "FirstName": "Maxwell",
        "LastName": "Kenga",
        "Bal": 50
    },
    {
        "ID": "2rU7pwZrtHCqothPtxlk75efkHa",
        "UserName": "SKN2018",
        "FirstName": "Natasha",
        "LastName": "Mageto",
        "Bal": 10
    },
    {
        "ID": "2rwAfiZHqSW12Cr0PfU86VOgY3r",
        "UserName": "SKN2070",
        "FirstName": "Joseph",
        "LastName": "Njuguna",
        "Bal": 19200
    },
    {
        "ID": "2rZpBJY9VNSs4xCDh0JD2F921jI",
        "UserName": "SKN2027",
        "FirstName": "Josiah",
        "LastName": "Kinja",
        "Bal": 750
    },
    {
        "ID": "2s4ds74gUQo6AeIKPnMvbus5e8T",
        "UserName": "SKN2106",
        "FirstName": "Peter K",
        "LastName": "Torongey",
        "Bal": 2000
    },
    {
        "ID": "2sD8du2JXEvsb0pjN569C8pid15",
        "UserName": "SKN2130",
        "FirstName": "Wareng ",
        "LastName": "Hardware ",
        "Bal": 2000
    },
    {
        "ID": "2sqqzz4PoaLzSXxMjaHZSFSbjDg",
        "UserName": "SKN2232",
        "FirstName": "Dennis Kiprotich ",
        "LastName": "Kirui",
        "Bal": 2000
    },
    {
        "ID": "2tLVzPzy9v0JPTWtVyi8nmINAvC",
        "UserName": "SKN2277",
        "FirstName": "Rodney ",
        "LastName": "Kimutai",
        "Bal": 613
    },
    {
        "ID": "2ua0mB3KbXxvYDWt0jeVB4Ekw9w",
        "UserName": "SKN2443",
        "FirstName": "Paul",
        "LastName": "Muraguri",
        "Bal": 2500
    },
    {
        "ID": "2utLCCwhxzpiydpsZVJG74ts8X4",
        "UserName": "SKN2467",
        "FirstName": "Concecilus ",
        "LastName": "Kipkemei",
        "Bal": 580
    },
    {
        "ID": "2vaSA9Vc5f3BmcWVQbenmqBtknr",
        "UserName": "SKN2544",
        "FirstName": "Cyrus",
        "LastName": "Kamau ",
        "Bal": 1000
    },
    {
        "ID": "2vqe0MHjsE8ysK1V6DaxeuwIxAd",
        "UserName": "SKN2570",
        "FirstName": "Norbert ",
        "LastName": "Tanui",
        "Bal": 20
    },
    {
        "ID": "2vrBX0FaAZaJrA32Arw7SZbGWP5",
        "UserName": "SKN2572",
        "FirstName": "Walter",
        "LastName": "Kibet ILRI",
        "Bal": 10346
    },
    {
        "ID": "2vXMf7X2qOkaeryzq10emCMRXIX",
        "UserName": "SKN2535",
        "FirstName": "Mercy",
        "LastName": "Jeptoo",
        "Bal": 40
    },
    {
        "ID": "2waUjVBfMa7fLMy9OfXAEnZWKSq",
        "UserName": "SKN2653",
        "FirstName": "Nehema",
        "LastName": "Obiero",
        "Bal": 1000
    },
    {
        "ID": "2wGWR72lxMj5Q152W1Jvs1oFgpa",
        "UserName": "SKN2606",
        "FirstName": "Asbel ",
        "LastName": "Mutai",
        "Bal": 1000
    },
    {
        "ID": "2wieNMwbZTZCkSeMaRQSsGmuwbL",
        "UserName": "SKN2670",
        "FirstName": "Haron",
        "LastName": "Cheruiyot",
        "Bal": 1000
    },
    {
        "ID": "2woOl0Rkn9jDXXHqI0pmSXUvSqg",
        "UserName": "SKN2682",
        "FirstName": "Janet Koima",
        "LastName": "Kipkeibon Sec",
        "Bal": 5000
    },
    {
        "ID": "2wrn0R08JqTUf2OR6WoMK8WprhB",
        "UserName": "SKN2698",
        "FirstName": "Brian",
        "LastName": "Muchiri",
        "Bal": 3000
    },
    {
        "ID": "2wuGHGa1kQERRZquUSockjzLa1T",
        "UserName": "SKN2704",
        "FirstName": "Chebet",
        "LastName": "Mercy",
        "Bal": 500
    },
    {
        "ID": "2wV0TxXv0ppwWJ1Qc4g1GTSZiMA",
        "UserName": "SKN2638",
        "FirstName": "Mohamed",
        "LastName": "Ibrahim ",
        "Bal": 300
    },
    {
        "ID": "2xAlqWp3k6YPPIjIymPYGYG97U5",
        "UserName": "SKN2741",
        "FirstName": "Albert",
        "LastName": "Rop",
        "Bal": 1000
    },
    {
        "ID": "2xE7dJHvLqlg4CLrDVSQW1o0KfO",
        "UserName": "SKN2748",
        "FirstName": "Truphosa ",
        "LastName": "Chepkwony",
        "Bal": 85
    },
    {
        "ID": "2xJr0sLt3qcCH6xNBXUxkxtgFfv",
        "UserName": "SKN2751",
        "FirstName": "Collins",
        "LastName": "Kemei",
        "Bal": 52
    },
    {
        "ID": "2xSFw55CdnPQLlCeN7xmhZqcOI8",
        "UserName": "SKN2776",
        "FirstName": "Beatrice ",
        "LastName": "Muhanji",
        "Bal": 519
    },
    {
        "ID": "2yhdJ7lZW91sUrpqb2SGcXNSnGK",
        "UserName": "SKN2918",
        "FirstName": "Sailas",
        "LastName": "Kichwen",
        "Bal": 56000
    },
    {
        "ID": "2yihQWVBe8er8ok6fcvpVoYH4RM",
        "UserName": "SKN2919",
        "FirstName": "Ramadhan Mohammed ",
        "LastName": "Kipchirchir",
        "Bal": 500
    },
    {
        "ID": "2yoRX4RC6HwkiPChzD57wpuGrJh",
        "UserName": "SKN2928",
        "FirstName": "County",
        "LastName": "Commander",
        "Bal": 500
    },
    {
        "ID": "2ySUu9jhyjVbGmKEiqqPcgiDZoc",
        "UserName": "SKN2884",
        "FirstName": "Precious",
        "LastName": "Mensa",
        "Bal": 2000
    },
    {
        "ID": "2z2GhHyabY32Vb7n4yfWmru3Bpo",
        "UserName": "SKN2966",
        "FirstName": "Griffin ",
        "LastName": "Maiyo",
        "Bal": 3
    },
    {
        "ID": "2z391bK8xQJvyxlByu5k4BesRVT",
        "UserName": "SKN2968",
        "FirstName": "Timothy",
        "LastName": "Kipkemboi Lagat",
        "Bal": 2000
    },
    {
        "ID": "2z8GqPJGGuw94n9W3sJcW2ns5PF",
        "UserName": "SKN2983",
        "FirstName": "Grace",
        "LastName": "Mogire",
        "Bal": 500
    },
    {
        "ID": "2zBAMKgPFH7BKTZJQ9cRo9lsG5s",
        "UserName": "SKN2992",
        "FirstName": "William ",
        "LastName": "Simba",
        "Bal": 2000
    },
    {
        "ID": "2zlJUYDHKRfeg3zpatkBMfzoIro",
        "UserName": "SKN3082",
        "FirstName": "Anorine ",
        "LastName": "Jerono",
        "Bal": 2000
    },
    {
        "ID": "2zu4O5GIVIJ02b7A30THB59Yjcs",
        "UserName": "SKN3104",
        "FirstName": "Hosea",
        "LastName": "Murkomen",
        "Bal": 20
    },
    {
        "ID": "2zuGDSRQx45xVAfDR1maFYLjptH",
        "UserName": "SKN3106",
        "FirstName": "Joyce ",
        "LastName": "Robinson",
        "Bal": 1000
    },
    {
        "ID": "300AGjSBVnbUko2gyeiWr1g2Cax",
        "UserName": "SKN3130",
        "FirstName": "Sarah ",
        "LastName": "Muchiri",
        "Bal": 100
    },
    {
        "ID": "30inS0Tnlw3v059AaRbWxFS3jmg",
        "UserName": "SKN3281",
        "FirstName": "Reuben ",
        "LastName": "Kibet Too",
        "Bal": 2000
    },
    {
        "ID": "30Jld4asrYgtUoJDNDeWkWvsRZg",
        "UserName": "SKN3180",
        "FirstName": "Theophilus ",
        "LastName": "Okano",
        "Bal": 2000
    },
    {
        "ID": "30rBHZ9cFNd0qdxdpcCtVL0saNL",
        "UserName": "SKN3308",
        "FirstName": "Francis  ",
        "LastName": "Waithaka",
        "Bal": 1000
    },
    {
        "ID": "30UwuxEwUcgphqSI90OAuNVf8T2",
        "UserName": "SKN3223",
        "FirstName": "Joseph Mwangi ",
        "LastName": "Gitahi",
        "Bal": 97
    },
    {
        "ID": "30vYX9rqKUhLIO4yPHlRDKMkovO",
        "UserName": "SKN3331",
        "FirstName": "Mandara",
        "LastName": "Kalimbo",
        "Bal": 350
    },
    {
        "ID": "310JumDIZu9D4YVvlLWuPf8dckI",
        "UserName": "SKN3342",
        "FirstName": "Bernard ",
        "LastName": "Kimaiyo Tanui",
        "Bal": 200
    },
    {
        "ID": "31fm7q1MkfnqvyPeVqlsiGlxzP4",
        "UserName": "SKN3436",
        "FirstName": "Joseph ",
        "LastName": "Muthoga Gitau",
        "Bal": 1000
    },
    {
        "ID": "32xDQAYxrsTq5wgOYd7w5Rw3n6k",
        "UserName": "SKN3643",
        "FirstName": "James Karanja ",
        "LastName": "Chege",
        "Bal": 233
    },
    {
        "ID": "333TheU4QSEgssfRieg20e8rJIV",
        "UserName": "SKN3657",
        "FirstName": "Antony ",
        "LastName": "Wanyi",
        "Bal": 2500
    },
    {
        "ID": "3360e1WiSq82gkKFbCPuk6fDJp6",
        "UserName": "SKN3663",
        "FirstName": "Emmanuel ",
        "LastName": "Omenge",
        "Bal": 7300
    },
    {
        "ID": "338wKtZd7IrGu7195xjyGStYBra",
        "UserName": "SKN3674",
        "FirstName": "Moreen",
        "LastName": "Nyambura",
        "Bal": 1000
    },
    {
        "ID": "33PsqI7kGoZm2JqrZCrQ1HSo1nQ",
        "UserName": "SKN3715",
        "FirstName": "Elsie ",
        "LastName": "Chebet",
        "Bal": 2000
    },
    {
        "ID": "33xFrD5WFhUuhAbvFXCZlIfk0my",
        "UserName": "SKN3160-01",
        "FirstName": "SKN3160-01",
        "LastName": "",
        "Bal": 2000
    },
    {
        "ID": "33yEiKE5EkdsCXiTZ5R2ZQXO5Fl",
        "UserName": "SKN3810",
        "FirstName": "Christopher Kiragu ",
        "LastName": "Mutara",
        "Bal": 1000
    },
    {
        "ID": "340R2gXoTLYMlDEdUMNirSWZjqq",
        "UserName": "SKN3815",
        "FirstName": "Ferdinand ",
        "LastName": "munyasia",
        "Bal": 1000
    },
    {
        "ID": "34bu3gd4VcOyIjiLhq2M7r0fSRr",
        "UserName": "SKN3924",
        "FirstName": "Shadrack ",
        "LastName": "Kiprono",
        "Bal": 1000
    },
    {
        "ID": "34e2XrkNW1qD7C7PQEzHyHkDxSi",
        "UserName": "SKN3929",
        "FirstName": "Duncan Kamau",
        "LastName": "Mwangi Tuktuk",
        "Bal": 500
    },
    {
        "ID": "34eP3Je8ta7VLYnFsGOIVFbebYo",
        "UserName": "SKN3936",
        "FirstName": "Samuel Kipkemboi",
        "LastName": "Seroney",
        "Bal": 4000
    },
    {
        "ID": "34sGNALtJIhqJa2kSBR5BpMzL4X",
        "UserName": "SKN3983",
        "FirstName": "Miruka",
        "LastName": " Festus ",
        "Bal": 1000
    },
    {
        "ID": "34Y0S0o6xvbfgjrkMM07Vtpx8OZ",
        "UserName": "SKN3914",
        "FirstName": "Yvonne ",
        "LastName": "Omolo",
        "Bal": 3000
    },
    {
        "ID": "353ilIv4ykYTnWoj4BFPjMTftjc",
        "UserName": "SKN4020",
        "FirstName": "Reyes ",
        "LastName": "Martinez",
        "Bal": 500
    },
    {
        "ID": "35CFdMBS07KQOfDdNvDlWKYJbON",
        "UserName": "SKN4046",
        "FirstName": "Moses Maina  ",
        "LastName": "Kariuki",
        "Bal": 1000
    },
    {
        "ID": "35NPN4hNruqGgP0bX5LtuCD6qE2",
        "UserName": "SKN3897-01",
        "FirstName": "Kipchimatt",
        "LastName": "Supermarket",
        "Bal": 8000
    },
    {
        "ID": "35xVL0KwyOMh3dRZSu27mbqnDIl",
        "UserName": "SKN4157",
        "FirstName": "Paul",
        "LastName": "Simiyu",
        "Bal": 2000
    },
    {
        "ID": "35xxPLuwFN0DVTKzby3jZtJce73",
        "UserName": "SKN4158",
        "FirstName": "Urban Aura",
        "LastName": " Spa",
        "Bal": 200
    },
    {
        "ID": "360QuUGukLseHl7hp6cPGheVGA8",
        "UserName": "SKN4165",
        "FirstName": "Ziporah ",
        "LastName": "Kwangu",
        "Bal": 2000
    },
    {
        "ID": "36CjYp6WeVQUNbEyo4NY6CZPqCP",
        "UserName": "SKN4200",
        "FirstName": "Margaret",
        "LastName": " Nyambura",
        "Bal": 2000
    },
    {
        "ID": "36I7pYJxsJg7p4CgZm0YR5WMh2Q",
        "UserName": "SKN4214",
        "FirstName": "Bonface ",
        "LastName": "Muuo Wambua",
        "Bal": 2000
    },
    {
        "ID": "36KH8WUXIJWeWdk4A9xn6xGRt6b",
        "UserName": "SKN4217",
        "FirstName": "Martin",
        "LastName": " Nyongo",
        "Bal": 2000
    },
    {
        "ID": "36LDAzU0dgl3R7lajzyOOB4DFBg",
        "UserName": "SKN4221",
        "FirstName": "Teresia ",
        "LastName": "Muigai",
        "Bal": 2000
    },
    {
        "ID": "36Nayos5cJWxci7KGcwo8T6rQty",
        "UserName": "SKN4230",
        "FirstName": "Zipporah",
        "LastName": "Mwangi",
        "Bal": 2500
    },
    {
        "ID": "36ND7wNhyMds9RoqpEtsUH5mL7B",
        "UserName": "SKN4228",
        "FirstName": "Dorothy",
        "LastName": " Jelagat Chepchieng",
        "Bal": 2000
    },
    {
        "ID": "36OnNhQJIFP6IR3vHUHSBrrFo7c",
        "UserName": "SKN4233",
        "FirstName": "John ",
        "LastName": "Kibunei Taragon",
        "Bal": 10
    },
    {
        "ID": "36sPoSq4tENZrRrq3LZxkqPp5Zz",
        "UserName": "SKN4303",
        "FirstName": "Reuben",
        "LastName": "Muiruri",
        "Bal": 2000
    },
    {
        "ID": "36tBLidOyfmgmnVoqwRfoamX7pH",
        "UserName": "SKN4306",
        "FirstName": "Ivonne",
        "LastName": "Koskei",
        "Bal": 1000
    },
    {
        "ID": "36TWxZO3HwIP54PgVLN2weKuurU",
        "UserName": "SKN4241",
        "FirstName": "Henry",
        "LastName": "Wambogo",
        "Bal": 1500
    },
    {
        "ID": "36YRBSb7g0ohr6BZrtibMKDLbv0",
        "UserName": "SKN4248",
        "FirstName": "Clemencia",
        "LastName": "Orina",
        "Bal": 2000
    },
    {
        "ID": "36yX3Ipl9EyZSzVWfmeTnATXyqA",
        "UserName": "SKN4312",
        "FirstName": "Hillary",
        "LastName": "Tarus",
        "Bal": 500
    },
    {
        "ID": "36ZXNjDC5bcwCpR1u58l9TPQGEG",
        "UserName": "4E:E3:35:88:0C:66",
        "FirstName": "",
        "LastName": "",
        "Bal": 50
    },
    {
        "ID": "370idju1w2tKJ8ed4rZuDhfEYju",
        "UserName": "SKN4315",
        "FirstName": "Ruth",
        "LastName": "Chebet",
        "Bal": 2000
    },
    {
        "ID": "37bbkZxzWJsTbuzlSG5hef0o7KI",
        "UserName": "SKN4346",
        "FirstName": "Nancy",
        "LastName": "Rasungu",
        "Bal": 2000
    },
    {
        "ID": "37IEeiXbsaShfksptHzyRsVipz6",
        "UserName": "SKN4331",
        "FirstName": "Soiyet",
        "LastName": "ACK",
        "Bal": 500
    },
    {
        "ID": "37iLRHdATADKK9ZHXXKkq2F5X7D",
        "UserName": "SKN4351",
        "FirstName": "Wycliff",
        "LastName": "Kiprop",
        "Bal": 200
    },
    {
        "ID": "37kHYiRzphV0kMGtQ740nGZGOe2",
        "UserName": "SKN4356",
        "FirstName": "Josephine",
        "LastName": "Macharia",
        "Bal": 2000
    },
    {
        "ID": "37vdVx9kgJA9UeixXQQhKTOR6JR",
        "UserName": "SKN4370",
        "FirstName": "Shadrack",
        "LastName": "Maisiba",
        "Bal": 3500
    },
    {
        "ID": "37xgPAiBNNeNn0TGNx0WZ7U6hqf",
        "UserName": "SKN4374",
        "FirstName": "Denis",
        "LastName": "Sanare",
        "Bal": 200
    },
    {
        "ID": "383YkNzFR8lGKGMoVohr5A6ZwW7",
        "UserName": "SKN4389",
        "FirstName": "Jackline",
        "LastName": "Wanjiru ",
        "Bal": 2000
    },
    {
        "ID": "384Ew14Oxlc7zXmQ4QVLeMWb7Wh",
        "UserName": "SKN4396",
        "FirstName": "Vivian",
        "LastName": "Limo",
        "Bal": 2000
    },
    {
        "ID": "389Gzt2wrliGoHu6CVNFit8nQu9",
        "UserName": "SKN4405",
        "FirstName": "John",
        "LastName": "kage ",
        "Bal": 2000
    },
    {
        "ID": "389O29GumgM7TISpcBIcYRGbO01",
        "UserName": "SKN4407",
        "FirstName": "Stephen",
        "LastName": "kariuki ",
        "Bal": 2000
    },
    {
        "ID": "38hmXYUzNNoqVqFwlmKVrSFEIqc",
        "UserName": "SKN4496",
        "FirstName": "Samwel",
        "LastName": "Shikoli",
        "Bal": 2000
    },
    {
        "ID": "38oCsej2xexbtEK3g4L9ldq1bFa",
        "UserName": "SKN4515",
        "FirstName": "Vincent",
        "LastName": "Maina Mwangi",
        "Bal": 2000
    },
    {
        "ID": "38Si8eDM5LOgIxXhkCK9F6BGIWu",
        "UserName": "SKN4456",
        "FirstName": "Elijah",
        "LastName": "Kahunya",
        "Bal": 2000
    },
    {
        "ID": "38sR0SJ1jWodlpvd2zQnyxfSKPN",
        "UserName": "SKN4523",
        "FirstName": "Rose ",
        "LastName": "Kamau ",
        "Bal": 2000
    },
    {
        "ID": "38sZBN7cD4lpDZ0dVRCr16KDUgp",
        "UserName": "SKN4524",
        "FirstName": "James",
        "LastName": "Mwangi ",
        "Bal": 2500
    },
    {
        "ID": "38yqnXi1ux0uZ8KL7ZrNWX4ihS7",
        "UserName": "SKN4539",
        "FirstName": "Mary Anyango ",
        "LastName": "Omolo",
        "Bal": 1000
    },
    {
        "ID": "38zN97190eAmpEnDxI2EzmqUbYP",
        "UserName": "SKN4543",
        "FirstName": "Lena",
        "LastName": " Nkatha",
        "Bal": 2000
    },
    {
        "ID": "396TNhnJc2ChoqB0MNXzzotLy3N",
        "UserName": "SKN4555",
        "FirstName": "Lydia",
        "LastName": "Wanjiku",
        "Bal": 2000
    },
    {
        "ID": "39GNnjkc2Mzk7iToZYaVmFzjsGO",
        "UserName": "SKN4583",
        "FirstName": "Hannah",
        "LastName": "Njeri Kamau",
        "Bal": 3000
    },
    {
        "ID": "39IWKrq7bgYFyWO4iTZlBaXYWhq",
        "UserName": "SKN4590",
        "FirstName": "Dennis ",
        "LastName": "Kipsang",
        "Bal": 2000
    },
    {
        "ID": "39TTgcaooGcN7SXQplJS23MFFfu",
        "UserName": "SKN4612",
        "FirstName": "Aketch",
        "LastName": "Dual",
        "Bal": 2000
    },
    {
        "ID": "39vPRSuAa3rvRsUtp3UXcqS9Kng",
        "UserName": "SKN4656",
        "FirstName": "Mercy Njeri",
        "LastName": "Gituma",
        "Bal": 1000
    },
    {
        "ID": "39w860D7QA8vCfn1hNxbbION9hP",
        "UserName": "SKN4668",
        "FirstName": "William",
        "LastName": "muriithi",
        "Bal": 2000
    },
    {
        "ID": "3AsI5xxfLAXHqPev65SmbwMXXyN",
        "UserName": "SKN4774",
        "FirstName": "Abigael",
        "LastName": "Chepkoech",
        "Bal": 2000
    },
    {
        "ID": "3B0tE7Y8P404D8hw1ijmObV4c6Y",
        "UserName": "SKN4784",
        "FirstName": "George",
        "LastName": "Wanyoike",
        "Bal": 2000
    },
    {
        "ID": "3B6pTIjlIedur7nyN5xcatgPhnl",
        "UserName": "SKN4802",
        "FirstName": "Eunice  ",
        "LastName": "Wanjiru ",
        "Bal": 2000
    },
    {
        "ID": "3BCfWpeNlwAnk8VCN6MrHABemp5",
        "UserName": "SKN4815",
        "FirstName": "Nicholas",
        "LastName": "Kiprotich",
        "Bal": 50
    },
    {
        "ID": "3BEi5puyH2E3TYA0NKv84wQMZnZ",
        "UserName": "SKN4819",
        "FirstName": "Gilbert",
        "LastName": "Kipsanai",
        "Bal": 2000
    },
    {
        "ID": "3BIktpy0kH7tx5v0FyyrIiZU8z5",
        "UserName": "SKN4824",
        "FirstName": "Collins",
        "LastName": "kiprono",
        "Bal": 3000
    },
    {
        "ID": "3BIL34tBz8Ut1gLzu2GJ4srhmSb",
        "UserName": "SKN4823",
        "FirstName": "Paul",
        "LastName": "Mwihia",
        "Bal": 2000
    },
    {
        "ID": "3BoPCpodn4BlUo17jGHyd4STCOq",
        "UserName": "SKN4880",
        "FirstName": "Kelvin",
        "LastName": "Kamonde",
        "Bal": 2000
    },
    {
        "ID": "3BQoRBeOrHixy7fZZrPTXjJm6AG",
        "UserName": "SKN4837",
        "FirstName": "Jacob",
        "LastName": "Hassan",
        "Bal": 2000
    },
    {
        "ID": "3Bz78oiROMXkqER1zGBHRsZW7zM",
        "UserName": "SKN4898",
        "FirstName": "Vincent",
        "LastName": "Kemboi",
        "Bal": 100
    },
    {
        "ID": "3BzBRdIjl1RYP4XVSwCotWgdJS5",
        "UserName": "SKN4900",
        "FirstName": "Tang Reat",
        "LastName": "Biel",
        "Bal": 2000
    },
    {
        "ID": "3C5R5EAKfQ1MrUJz8V7xquVam54",
        "UserName": "SKN4923",
        "FirstName": "Josphine Mwihaki ",
        "LastName": "Chege",
        "Bal": 2000
    },
    {
        "ID": "3C7ESU1Fts3hulVT5f3L1nE6K8j",
        "UserName": "SKN4926",
        "FirstName": "James",
        "LastName": "Wagura ",
        "Bal": 2000
    },
    {
        "ID": "3C7FMv1ebV8x1piz2Luna3zmWMt",
        "UserName": "SKN4927",
        "FirstName": " Salome",
        "LastName": "Njoroge ",
        "Bal": 2000
    },
    {
        "ID": "3CBrQs03CNE7XemhN0JX2D8RTq9",
        "UserName": "SKN4936",
        "FirstName": "Montana ",
        "LastName": "feeds ltd, Marura",
        "Bal": 2500
    },
    {
        "ID": "3Cc24uK7MucHbCipA2I1vaE3vAI",
        "UserName": "SKN4975",
        "FirstName": "Mike",
        "LastName": "Kalale",
        "Bal": 2000
    },
    {
        "ID": "3CCWo4oXOWRwj61zu0DAePYhTtw",
        "UserName": "SKN4938",
        "FirstName": "Nephat",
        "LastName": "Njeru",
        "Bal": 3500
    },
    {
        "ID": "3CD6CwLHn0MPSG0BxqJmzcrZ8wL",
        "UserName": "SKN4940",
        "FirstName": "David Kanyora ",
        "LastName": "Kamau",
        "Bal": 2000
    },
    {
        "ID": "3CfqxIGoyW26biyaVAuLJymaDmY",
        "UserName": "SKN4981",
        "FirstName": "Joseph ",
        "LastName": "Wambugu",
        "Bal": 1299
    },
    {
        "ID": "3Ci7GYZz0Ue0yGBegk0zUb7Rn0i",
        "UserName": "SKN4985",
        "FirstName": "Jackmart",
        "LastName": "Rooms",
        "Bal": 3500
    },
    {
        "ID": "3CIYj2eRsmw6zpjAYiLZDFw1fdF",
        "UserName": "SKN4947",
        "FirstName": "Kevin",
        "LastName": "Ronoh ",
        "Bal": 4000
    },
    {
        "ID": "3CNspqwR18RUJFiVBBUV76KUAoo",
        "UserName": "SKN4954",
        "FirstName": "Joseph",
        "LastName": "Kamau",
        "Bal": 2000
    },
    {
        "ID": "3CQrxmVL1Xrqnh0I6jnueXl54iJ",
        "UserName": "SKN4960",
        "FirstName": "Lucy ",
        "LastName": "Njoroge ",
        "Bal": 2000
    },
    {
        "ID": "3CZJ99wN6X8oCSMnAqlOBSSqEKx",
        "UserName": "SKN4973",
        "FirstName": "Emmanuel",
        "LastName": "Samoei",
        "Bal": 2000
    },
    {
        "ID": "3DohUWwRiylzi0iKQlsMMfPACI3",
        "UserName": "SKN5051",
        "FirstName": "Briton",
        "LastName": "Kabala",
        "Bal": 3000
    },
    {
        "ID": "3DRJLCd6txGtgZhrlw2qwdlPXDF",
        "UserName": "SKN5027",
        "FirstName": "Grace",
        "LastName": "Radero",
        "Bal": 2000
    },
    {
        "ID": "3DwA35zIswNnemwH0tdZIyAUfEE",
        "UserName": "SKN5056",
        "FirstName": "Benta ",
        "LastName": "Ouru",
        "Bal": 2000
    },
    {
        "ID": "3DzYSuf7GguEhXWWkrTL0PZeWWH",
        "UserName": "SKN5062",
        "FirstName": "Hezron ",
        "LastName": "Mutua",
        "Bal": 2000
    },
    {
        "ID": "3E2qLuiBp6FU6nRbuU6zLdOcd9h",
        "UserName": "SKN5067",
        "FirstName": "Sarah",
        "LastName": "Koech",
        "Bal": 2000
    },
    {
        "ID": "3E4UPEu0qUhv89DDv584tPXHchp",
        "UserName": "SKN5068",
        "FirstName": "Florence",
        "LastName": "Mumbi",
        "Bal": 2000
    },
        {
            "ID": "2huijGr2DvksyQoJ4lcBuvrprnu",
            "UserName": "SKN1014",
            "FirstName": "Kibe",
            "LastName": "Wainaina",
            "Bal": -3000
        },
        {
            "ID": "2huXz5aTn3Q3dWbk3pjP4Kz55F4",
            "UserName": "SKN0319",
            "FirstName": "NCIC",
            "LastName": "Interpeace",
            "Bal": -4000
        },
        {
            "ID": "2huY58NTaVIjxvZCsivGSDbvWf7",
            "UserName": "SKN0762",
            "FirstName": "Hesbon",
            "LastName": "Maisa",
            "Bal": -1000
        },
        {
            "ID": "2imaZK7qBLJn2m6t4l69fGC7Vem",
            "UserName": "SKN1095",
            "FirstName": "Edwin",
            "LastName": "Soimo",
            "Bal": -8980
        },
        {
            "ID": "2imkxbr21Yfmd1ijBRPM17Ww24r",
            "UserName": "SKN1113",
            "FirstName": "Gilbert",
            "LastName": "Maiyo",
            "Bal": -7500
        },
        {
            "ID": "2imXUyUscIgy7up9KT7HDgW3sc4",
            "UserName": "SKN1093",
            "FirstName": "Upcafe",
            "LastName": "Hotel",
            "Bal": -8000
        },
        {
            "ID": "2iokbfzNhrGEztPz0Jta1XHcZRq",
            "UserName": "SKN1124",
            "FirstName": "Mike",
            "LastName": "Tenai",
            "Bal": -7500
        },
        {
            "ID": "2ipVaOsbqLDlDDACuKuFIAOxF5v",
            "UserName": "SKN1132",
            "FirstName": "Seger",
            "LastName": "Technologies",
            "Bal": -5000
        },
        {
            "ID": "2ipYpRvJTuQIHujFihKOTexfeqf",
            "UserName": "SKN1136",
            "FirstName": "Abraham",
            "LastName": "Segut",
            "Bal": -5000
        },
        {
            "ID": "2kQCv5BsE38xhvC2XiSbOJz1uXT",
            "UserName": "SKN1320",
            "FirstName": "Abraham",
            "LastName": "Kiptoo",
            "Bal": -5000
        },
        {
            "ID": "2kQEboOmZboV39cvgLzOICOSmKC",
            "UserName": "SKN1321",
            "FirstName": "Anne",
            "LastName": "Choky",
            "Bal": -2500
        },
        {
            "ID": "2kQFN0dFJ56wACD6Rwq7F0LxNRF",
            "UserName": "SKN1322",
            "FirstName": "Boniface",
            "LastName": "Tebeson",
            "Bal": -5000
        },
        {
            "ID": "2kQORAdeSGZzIPl0GMxakKAiTXZ",
            "UserName": "SKN1330",
            "FirstName": "Neta",
            "LastName": "Cyber",
            "Bal": -5000
        },
        {
            "ID": "2kQOujf7Ly3dX0ewFg7sBlPjB0F",
            "UserName": "SKN1331",
            "FirstName": "Reuben",
            "LastName": "Suge",
            "Bal": -5000
        },
        {
            "ID": "2m6RIGK7NhsnYJXSZhg7ZRtvInU",
            "UserName": "SKN1536",
            "FirstName": "Nazarius",
            "LastName": "Kiplagat",
            "Bal": -500
        },
        {
            "ID": "2mmxr9LxqeebSb9B6DEHZIOXHLV",
            "UserName": "SKN1615",
            "FirstName": "Margaret",
            "LastName": "Nyambura",
            "Bal": -700
        },
        {
            "ID": "2mN8qVuw7rOCPQQdFv9PdiPP3Dv",
            "UserName": "SKN1578",
            "FirstName": "Pamela",
            "LastName": "Scott",
            "Bal": -15000
        },
        {
            "ID": "2obcPkR3DPo7dkazt7AcBurkLuU",
            "UserName": "SKN1793",
            "FirstName": "Gladys ",
            "LastName": "Ronoh",
            "Bal": -1000
        },
        {
            "ID": "2sFZPDDKf7FELqzpLNoU8eJ40Nm",
            "UserName": "SKN2138",
            "FirstName": "Caren ",
            "LastName": "Rotich",
            "Bal": -1000
        },
        {
            "ID": "2ytmfIP5yt8Gl63XIzPyPhI5ZCz",
            "UserName": "SKN2940",
            "FirstName": "Isabel",
            "LastName": "Jeptoo",
            "Bal": -2000
        },
        {
            "ID": "2zX6hZgHREOcoqFAtbxDSbuG7PX",
            "UserName": "SKN3040",
            "FirstName": "Mary",
            "LastName": "Wanjiru ",
            "Bal": -1000
        },
        {
            "ID": "32sDKu3wNnq5VBe4V3SuPPISNPb",
            "UserName": "SKN3630",
            "FirstName": "Samwel",
            "LastName": "Muigai",
            "Bal": -500
        },
        {
            "ID": "34V37YLxs1WjvAgK8GtaHESzPpu",
            "UserName": "SKN3901",
            "FirstName": " Kevin",
            "LastName": "Thananga",
            "Bal": -35000
        },
        {
            "ID": "35etBtazjWcYcc8BEckO5yBIMOB",
            "UserName": "SKN4123",
            "FirstName": "Njoro",
            "LastName": "Beer",
            "Bal": -3000
        },
        {
            "ID": "39ymdrDbSaNP2LHV8R2srpd9soO",
            "UserName": "SKN4676",
            "FirstName": "Hillary ",
            "LastName": "Kirwa",
            "Bal": -1999
        },
        {
            "ID": "3AhT1wTlkPgXrBS2VVHiSV9WMOw",
            "UserName": "SKN4748",
            "FirstName": "Denis",
            "LastName": "Naibei",
            "Bal": -1000
        },
        {
            "ID": "3AU7ne0YjJnntM2tvl1NiHbHyTe",
            "UserName": "SKN4720",
            "FirstName": "Havilah",
            "LastName": "Oyaro",
            "Bal": -1000
        }
    
]


// =========================================================================
// FILES & CONSTANTS
// =========================================================================
const INPUT_FILE = path.join(__dirname, 'skncustomers.json');
const OUTPUT_FILE = path.join(__dirname, 'skn-customers-converted.json');
const CHILDREN_OUTPUT_FILE = path.join(__dirname, 'skn-customers-children.json');
const SKIPPED_FILE = path.join(__dirname, 'skn-customers-skipped.json');

const SITE_ID = '6a0dc10237e5028eb51eac02'; // SKN Site ID
const REGION_CODE = 'SKN';
const CREATED_BY = '69e61137b86babe155e23322';
const DEFAULT_PACKAGE_ID = '6a0ece7af64420767b72d211'; // Fallback if no match found

// Track duplicates globally
const usedPhones = new Set();
const usedUsernames = new Set();
const usedPppoeUsernames = new Set();

// =========================================================================
// HELPERS & PARSERS
// =========================================================================

function getSknPackageId(oldPackageName = '') {
  if (!oldPackageName) return DEFAULT_PACKAGE_ID;
  
  const normalizedOld = oldPackageName.toLowerCase().trim();

  for (const pkg of NEW_SYSTEM_PACKAGES) {
    let cleanNewName = pkg.packageName.toLowerCase();
    if (cleanNewName.endsWith('rift')) {
      cleanNewName = cleanNewName.slice(0, -4).trim();
    }

    if (normalizedOld === cleanNewName) {
      return pkg._id;
    }
  }

  return DEFAULT_PACKAGE_ID;
}

function getBalance(username) {
    return customerBalances.find(
        cust => cust.UserName === username
    )?.Bal ?? 0;
}

function normalizePhone(phone) {
  if (!phone) return null;
  phone = String(phone).replace(/\D/g, '');
  if (phone.startsWith('0')) return '254' + phone.slice(1);
  if (phone.startsWith('254')) return phone;
  return phone;
}

function generatePassword(length = 10) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let password = '';
  for (let i = 0; i < length; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

function splitName(firstName = '', lastName = '') {
  const fullName = `${firstName} ${lastName}`.trim();
  if (!fullName) return { firstName: 'Unknown', lastName: 'Unknown' };
  const parts = fullName.split(/\s+/);
  return {
    firstName: parts[0] || 'Unknown',
    lastName: parts.slice(1).join(' ') || 'Unknown'
  };
}

function getActivatedAt(expiresAt) {
  const date = new Date(expiresAt);
  if (isNaN(date.getTime())) {
    const now = new Date();
    now.setDate(now.getDate() - 30);
    return now.toISOString();
  }
  date.setDate(date.getDate() - 30);
  return date.toISOString();
}

function isExpired(expiresAt) {
  if (!expiresAt) return true;
  const expiryDate = new Date(expiresAt);
  return isNaN(expiryDate.getTime()) ? true : expiryDate < new Date();
}

// =========================================================================
// CORE CUSTOMER TRANSFORM ENGINE
// =========================================================================
function createCustomer(oldCustomer) {
  const accountId = oldCustomer.UserName?.trim();

  // 1. Filter out Hotspot / Non-PPPoE accounts
  const isMacAddress = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/.test(accountId || '');
  const isSknPrefix = accountId?.toUpperCase().startsWith('SKN');

  if (!accountId || isMacAddress || !isSknPrefix) {
    return {
      skipped: true,
      reason: 'Hotspot/Non-PPPoE account skipped (Username is missing, a MAC address, or lacks SKN prefix)'
    };
  }

  // 2. Routing logic for old usernames
  const oldUsernameRaw = oldCustomer.OldUserName || oldCustomer.oldUserName;
  const oldUsername = oldUsernameRaw?.trim();
  const pppoeUsername = (oldUsername && oldUsername.length > 0) ? oldUsername : accountId;

  const normalizedPhone = normalizePhone(oldCustomer.PhoneNumber);

  if (!normalizedPhone) {
    return { skipped: true, reason: 'Missing or invalid phone number' };
  }

  // Duplicate constraints
  if (usedPhones.has(normalizedPhone)) {
    return { skipped: true, reason: 'Duplicate phone number mapping conflict' };
  }
  if (usedUsernames.has(accountId)) {
    return { skipped: true, reason: 'Duplicate Account ID (UserName) conflict' };
  }
  if (usedPppoeUsernames.has(pppoeUsername)) {
    return { skipped: true, reason: 'Duplicate PPPoE Router Username conflict' };
  }

  usedPhones.add(normalizedPhone);
  usedUsernames.add(accountId);
  usedPppoeUsernames.add(pppoeUsername);

  const names = splitName(oldCustomer.FirstName || '', oldCustomer.LastName || '');
  const expiresAt = oldCustomer.Expiry ? new Date(oldCustomer.Expiry).toISOString() : new Date().toISOString();
  const activatedAt = getActivatedAt(expiresAt);
  const expired = isExpired(expiresAt);
  
  const packageId = getSknPackageId(oldCustomer.PackageName || '');
  const pppoePassword = oldCustomer.Value?.trim() || generatePassword();

  const accountBalance = getBalance(oldCustomer.UserName)

  // Location Parsing
  const city = oldCustomer.City?.trim() || 'Rift Region'; 
  const subLocation = oldCustomer.Location.trim() || oldCustomer.Apartment.trim() || 'SKN Zone';
  const localArea =subLocation;

  // Identify Child Accounts dynamically by checking for ParentID existence
  const isChildAccount = accountId.includes('-');

  const customer = {
    accountId: accountId,
    regionCode: REGION_CODE,
    city: city,
    subLocation: subLocation,
    localArea: localArea,
    location: {
      mainCity: city,
      subLocation: subLocation,
      area: localArea,
      houseNumber: oldCustomer.HouseNumber || '',
      apartment: oldCustomer.Apartment || ''
    },
    siteId: SITE_ID,
    isChild: isChildAccount, // True if a Child Account, False if Parent
    parentId: isChildAccount ? oldCustomer.ParentID.trim() : null, // Store parent reference
    firstName: names.firstName,
    lastName: names.lastName,
    email: oldCustomer.Email || '',
    phoneNumber: normalizedPhone,
    hashedPhone: oldCustomer.PhoneNumberHash || crypto.createHash('sha256').update(normalizedPhone).digest('hex'),
    pppoe: {
      username: pppoeUsername,
      password: pppoePassword,
      siteIp:  null,
      staticIp:  null,
      macAddress: null // Kept null per manual configuration update
    },
    nasIp: null, // Kept null per manual configuration update
    cpe: {
      serialNumber: oldCustomer.CpeSerialNumber || '123456789',
      macAddress: '00:00:00:00:00:00',
      model:  'Xerox',
      wifiName: oldCustomer.CpeWifiName || pppoeUsername,
      wifiPassword: oldCustomer.CpeWifiPassword || '12345678'
    },
    subscription: {
      packageId,
      status: expired ? 'expired' : 'active',
      activatedAt,
      expiresAt,
      autoRenew: typeof oldCustomer.AutoRenew === 'boolean' ? oldCustomer.AutoRenew : true,
      pausedAt: oldCustomer.PausedAt || null,
      pausedPeriod: oldCustomer.PausedPeriod || 0
    },
    suspensionSource: null,
    fupEnabled: false,
    burst: { enabled: false },
    freeExtensionDays: oldCustomer.ExtensionDuration || 0,
    maxFreeExtensionDays: 3,
    billing: {
      balance: accountBalance,
      discountEnabled: oldCustomer.EnableDiscount || false,
      discountAmount: oldCustomer.DiscountedAmount || 0
    },
    connectionStatus: {
      status: oldCustomer.Online ? 'online' : 'offline',
      currentIp: oldCustomer.Ip || null,
      currentMac: oldCustomer.Mac || null,
      lastChecked: null,
      lastOnline: oldCustomer.Online ? new Date().toISOString() : null,
      lastOffline: !oldCustomer.Online ? new Date().toISOString() : null
    },
    isActive: !oldCustomer.DisabledAt,
    paymentCounter: 0,
    renewals: [],
    notes: [],
    createdBy: CREATED_BY,
    createdAt: oldCustomer.CreatedAt || new Date().toISOString(),
    updatedAt: oldCustomer.UpdatedAt || new Date().toISOString()
  };

  return { skipped: false, customer, isChild: isChildAccount };
}

// =========================================================================
// ORCHESTRATION PIPELINE
// =========================================================================
function main() {
  try {
    if (!fs.existsSync(INPUT_FILE)) {
      console.error(`❌ File not found: ${INPUT_FILE}`);
      process.exit(1);
    }

    console.log('🚀 Initializing SKN Data Migration Pipeline...');
    const rawData = fs.readFileSync(INPUT_FILE, 'utf8');
    const customers = JSON.parse(rawData);

    if (!Array.isArray(customers)) {
      console.error('❌ Input JSON must contain an array of objects.');
      process.exit(1);
    }

    const parentCustomers = [];
    const childCustomers = [];
    const skippedCustomers = [];

    for (const customer of customers) {
      const result = createCustomer(customer);

      if (result.skipped) {
        skippedCustomers.push({
          username: customer.UserName || null,
          oldUsername: customer.oldUsername || customer.oldUserName || null,
          phoneNumber: customer.PhoneNumber || null,
          reason: result.reason
        });
        continue;
      }

      if (result.isChild) {
        childCustomers.push(result.customer);
      } else {
        parentCustomers.push(result.customer);
      }
    }

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(parentCustomers, null, 2));
    fs.writeFileSync(CHILDREN_OUTPUT_FILE, JSON.stringify(childCustomers, null, 2));
    fs.writeFileSync(SKIPPED_FILE, JSON.stringify(skippedCustomers, null, 2));

    console.log('\n==============================================');
    console.log('✅ Migration Processing Complete (SKN Target)');
    console.log('==============================================\n');
    console.log(`📥 Total Raw Input Records : ${customers.length}`);
    console.log(`👤 Parent Accounts Built   : ${parentCustomers.length}`);
    console.log(`👶 Child Accounts Built    : ${childCustomers.length}`);
    console.log(`⚠️ Excluded / Skipped Logs : ${skippedCustomers.length}`);
    console.log('\n📄 Execution Output Targets:');
    console.log(`- Parent Output : ${OUTPUT_FILE}`);
    console.log(`- Children Output: ${CHILDREN_OUTPUT_FILE}`);
    console.log(`- Skips/Audits  : ${SKIPPED_FILE}\n`);

  } catch (error) {
    console.error('\n❌ System Migration Exception Encountered\n');
    console.error(error);
  }
}

main();