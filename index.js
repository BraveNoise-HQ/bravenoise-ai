import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import fs from "fs";

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;

if (!GEMINI_API_KEY || !SLACK_BOT_TOKEN) {
  console.error("❌ ERROR: Missing GEMINI_API_KEY or SLACK_BOT_TOKEN.");
}

let designSpecs = "Follow high-converting, modern minimalist design principles.";
try {
  if (fs.existsSync("./DESIGN.md")) {
    designSpecs = fs.readFileSync("./DESIGN.md", "utf8");
  }
} catch (err) {
  console.log("⚠️ No DESIGN.md found.");
}

app.get("/", (req, res) => {
  res.send("BraveNoise AI is online and listening! 🚀");
});

app.post("/slack/events", async (req, res) => {
  const body = req.body;
  if (body.type === "url_verification") {
    return res.send({ challenge: body.challenge });
  }

  try {
    const event = body.event;
    if (event && event.text && !event.bot_id && event.type === "message") {
      const userMessage = event.text;
      const channelId = event.channel;

      console.log(`📩 Message from Slack: "${userMessage}"`);

      // 🔥 UPDATED URL: Changed v1beta to v1
      const geminiUrl = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
      
      const response = await axios.post(geminiUrl, {
        contents: [{
          parts: [{
            text: `System Instruction: You are BraveNoise AI. Priority: Etsy/Printify revenue. Brand: ${designSpecs}. User Message: ${userMessage}`
          }]
        }]
      });

      const aiReply = response.data.candidates[0].content.parts[0].text;

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
    // Log the full error to help us debug if it fails again
    console.error("❌ API Error:", error.response ? JSON.stringify(error.response.data) : error.message);
    res.sendStatus(200);
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 BraveNoise AI listening on port ${PORT}`);
});
