const crypto = require("crypto");

// const payload = {
//   timestamp: Date.now(),
//   action: "get_all_leads",
// };


// const payload = {
//   timestamp: Date.now(),
//   action: "get_all_reports",
// };


const payload = {
  action: "resolve_customer_payment",
  timestamp: Date.now(),
  receiptNumber: "TEST1774878929564",
  customerId: "NKOOO2",
  customerType: 'pppoe'
};



// const payload = {
//   action: "get_unprocessed_payment",
//   timestamp: Date.now(),
//   receipt: "TEST1774878929564"
// };

// const payload = {
//   action: "get_customers",
//   timestamp: Date.now(),
//   page: 1,
//   limit: 13,
// };

// const payload = {
//     action: "get_customer",
//     timestamp: Date.now(),
//     accountId: "NXT0009", // replace with a real accountId
//   };

const secret = '6a29ad2284141319376d7191239154a11e756cd215457fb976c7cbdb8d4f5b5bd173360704bfa18a1edc9e917485a712efdb34046b7308758aa84c41d3cf7268';
const sig = crypto.createHmac("sha256", secret).update(JSON.stringify(payload)).digest("hex");

console.log("Signature:", sig);
console.log("Timestamp:", payload.timestamp);