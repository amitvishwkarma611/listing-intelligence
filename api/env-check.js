export default function handler(req, res) {
  res.status(200).json({
    geminiApiKeyConfigured: Boolean(process.env.GEMINI_API_KEY),
    geminiModelConfigured: Boolean(process.env.GEMINI_MODEL),
    nodeEnvironment: process.env.NODE_ENV || null
  });
}
