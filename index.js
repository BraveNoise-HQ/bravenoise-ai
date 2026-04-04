import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import fs from "fs";

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;

let designSpecs = "Follow high-converting, modern minimalist design principles.";
try {
  if (fs.existsSync("./DESIGN.md")) {
    designSpecs = fs.readFileSync("./DESIGN.md", "utf8");
  }
} catch (err) {
  console.log("⚠️ No DESIGN.md found.");
}

app.get("/", (req, res) => {
  res.send("BraveNoise AI is alive and ready for revenue! 🚀");
});

app.post("/slack/events", async (req, res) => {
  const body = req.body;
  if (body.type === "url_verification") return res.send({ challenge: body.challenge });

  try {
    const event = body.event;
    if (event && event.text && !event.bot_id && event.type === "message") {
      const userMessage = event.text;
      const channelId = event.channel;

      console.log(`📩 Processing message: "${userMessage}"`);

      // 🔥 FIX: Changed model to 'gemini-1.5-flash-latest' and used v1beta endpoint
      // This alias is more resilient to model retirements.
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`;
      
      const response = await axios.post(geminiUrl, {
        contents: [{
          parts: [{
            text: `System: You are BraveNoise AI. Mission: Etsy/Printify revenue. Guidelines: ${designSpecs}. User: ${userMessage}`
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
    console.error("❌ API Error:", error.response ? JSON.stringify(error.response.data) : error.message);
    res.sendStatus(200);
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 BraveNoise AI listening on port ${PORT}`);
});
