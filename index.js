import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import fs from "fs";

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;

// 1. Safety Check for Keys
if (!OPENAI_API_KEY || !SLACK_BOT_TOKEN) {
  console.error("❌ ERROR: Missing environment variables.");
}

// 2. Load DESIGN.md if it exists
let designSpecs = "Use clean, high-converting design principles.";
try {
  if (fs.existsSync("./DESIGN.md")) {
    designSpecs = fs.readFileSync("./DESIGN.md", "utf8");
    console.log("🎨 DESIGN.md rules applied.");
  }
} catch (err) {
  console.log("⚠️ No DESIGN.md found, using default vibe.");
}

// 3. Health check for Railway
app.get("/", (req, res) => {
  res.send("BraveNoise AI is officially online 🚀");
});

// 4. Slack Events Endpoint
app.post("/slack/events", async (req, res) => {
  const body = req.body;

  // URL Verification for Slack setup
  if (body.type === "url_verification") {
    return res.send({ challenge: body.challenge });
  }

  try {
    const event = body.event;

    // Check if it's a message from a real person
    if (event && event.text && !event.bot_id && event.type === "message") {
      const userMessage = event.text;
      const channelId = event.channel;

      // Call OpenAI
      const response = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: `You are BraveNoise AI. Priority: Revenue from Etsy/Printify. 
              Brand Guidelines: ${designSpecs}. 
              Always give actionable SEO titles and product ideas.`
            },
            { role: "user", content: userMessage }
          ]
        },
        {
          headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            "Content-Type": "application/json"
          }
        }
      );

      const aiReply = response.data.choices[0].message.content;

      // Send reply to Slack
      await axios.post(
        "https://slack.com/api/chat.postMessage",
        {
          channel: channelId,
          text: aiReply
        },
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
    console.error("❌ Detailed Error:", error.response ? error.response.data : error.message);
    res.sendStatus(200);
  }
});

// 5. Start the engine
app.listen(PORT, () => {
  console.log(`🚀 BraveNoise AI listening on port ${PORT}`);
});
