import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import fs from "fs";

const app = express();
app.use(bodyParser.json());

// 1. Setup variables
const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;

// Key check
if (!GEMINI_API_KEY || !SLACK_BOT_TOKEN) {
  console.error("❌ ERROR: Missing GEMINI_API_KEY or SLACK_BOT_TOKEN in Railway.");
}

// 2. Load Brand Guidelines
let designSpecs = "Follow high-converting, modern minimalist design principles.";
try {
  if (fs.existsSync("./DESIGN.md")) {
    designSpecs = fs.readFileSync("./DESIGN.md", "utf8");
    console.log("🎨 DESIGN.md rules applied.");
  }
} catch (err) {
  console.log("⚠️ No DESIGN.md found, using default strategy.");
}

// 3. Web Health Check
app.get("/", (req, res) => {
  res.send("BraveNoise AI (Gemini Edition) is officially online 🚀");
});

// 4. Slack Events Handler
app.post("/slack/events", async (req, res) => {
  const body = req.body;

  // URL Verification for initial setup
  if (body.type === "url_verification") {
    return res.send({ challenge: body.challenge });
  }

  try {
    const event = body.event;

    // Process only user messages
    if (event && event.text && !event.bot_id && event.type === "message") {
      const userMessage = event.text;
      const channelId = event.channel;

      console.log(`📩 Processing: "${userMessage}"`);

      // Call Gemini API
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
      
      const response = await axios.post(geminiUrl, {
        system_instruction: {
          parts: [{ text: `You are BraveNoise AI. Your mission: Maximize revenue via Etsy and Printify. Brand Rules: ${designSpecs}. Always provide SEO titles and actionable product niches.` }]
        },
        contents: [{ parts: [{ text: userMessage }] }]
      });

      const aiReply = response.data.candidates[0].content.parts[0].text;

      // Post back to Slack
      await axios.post(
        "https://slack.com/api/chat.postMessage",
        { channel: channelId, text: aiReply },
        {
          headers: {
            Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
            "Content-Type": "application/json; charset=utf-8"
          }
        }
      );
    }
    res.sendStatus(200);
  } catch (error) {
    console.error("❌ System Error:", error.response ? JSON.stringify(error.response.data) : error.message);
    res.sendStatus(200);
  }
});

// 5. Ignition
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 BraveNoise AI listening on port ${PORT}`);
});
