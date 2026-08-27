export default function handler(req, res) {
  res.status(200).json({
    ok: true,
    service: "listing-intelligence-api",
    timestamp: new Date().toISOString()
  });
}
