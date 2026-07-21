const crypto = require("crypto");

/**
 * Middleware: verifies HMAC-signed requests from trusted internal systems.
 * Rejects requests with missing/invalid signatures or timestamps older than 5 minutes.
 */
const verifyInterSystemSignature = (req, res, next) => {
  const signature = req.headers["x-signature"];

  if (!signature) {
    return res.status(401).json({
      success: false,
      statusCode: 401,
      message: "Missing inter-system signature",
    });
  }

  const expected = crypto
    .createHmac("sha256", process.env.INTER_SYSTEM_SECRET)
    .update(JSON.stringify(req.body))
    .digest("hex");

  // Timing-safe comparison to prevent timing attacks
  let signaturesMatch = false;
  try {
    signaturesMatch = crypto.timingSafeEqual(
      Buffer.from(signature, "hex"),
      Buffer.from(expected, "hex")
    );
  } catch {
    // Buffer length mismatch = invalid signature
    return res.status(401).json({
      success: false,
      statusCode: 401,
      message: "Invalid signature.",
    });
  }

  if (!signaturesMatch) {
    return res.status(401).json({
      success: false,
      statusCode: 401,
      message: "Invalid signature",
    });
  }

  // Reject requests older than 5 minutes (replay attack protection)
  if (!req.body.timestamp || Math.abs(Date.now() - req.body.timestamp) > 300_000) {
    return res.status(401).json({
      success: false,
      statusCode: 401,
      message: "Request expired or missing timestamp",
    });
  }

  next();
};

module.exports = { verifyInterSystemSignature };