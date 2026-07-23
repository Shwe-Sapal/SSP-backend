import rateLimit from "express-rate-limit";

const aiChatRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  handler: (req, res) => {
    return res.status(429).json({
      code: 429,
      status: "failed",
      message: "Too many AI chat requests, please try again later.",
    });
  },
  standardHeaders: true,
  legacyHeaders: false,
});

export default aiChatRateLimiter;
