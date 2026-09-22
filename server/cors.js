/**
 * CORS with an allow list. Only origins in CORS_ORIGINS may call the API from a separate frontend.
 * "*" is never used because the API accepts credentials.
 */
function cors(allowed) {
  const set = new Set(allowed);
  return (req, res, next) => {
    const origin = req.get('origin');
    if (origin && set.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      res.setHeader('Access-Control-Max-Age', '600');
      if (req.method === 'OPTIONS') return res.sendStatus(204);
    }
    next();
  };
}
module.exports = { cors };
