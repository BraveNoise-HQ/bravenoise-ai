import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import fs from "fs";

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;

// 1. Environment Check
if (!GEMINI_API_KEY || !SLACK_BOT_TOKEN) {
  console.error("❌ ERROR: Missing GEMINI_API_KEY or SLACK_BOT_TOKEN.");
}

// 2. Load DESIGN.md
let designSpecs = "Follow high-converting, modern minimalist design principles.";
try {
  if (fs.existsSync("./DESIGN.md")) {
    designSpecs = fs.readFileSync("./DESIGN.md", "utf8");
    console.log("🎨 DESIGN.md rules loaded.");
  }
} catch (err) {
  console.log("⚠️ No DESIGN.md found, using defaults.");
}

// 3. Health check for Railway
app.get("/", (req, res) => {
  res.send("BraveNoise AI (Gemini Edition) is online 🚀");
});

// 4. Slack Events Endpoint
app.post("/slack/events", async (req, res) => {
  const body = req.body;

  // Handle the Slack URL verification challenge
  if (body.type === "url_verification") {
    return res.send({ challenge: body.challenge });
  }

  try {
    const event = body.event;

    // Only respond to messages from users, not bots
    if (event && event.text && !event.bot_id && event.type === "message") {
      const userMessage = event.text;
      const channelId = event.channel;

      // Call Gemini API
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
      
      const response = await axios.post(geminiUrl, {
        system_instruction: {
          parts: [{ text: `You are BraveNoise AI. Priority: Revenue via Etsy/Printify. Brand Rules: ${designSpecs}. Always provide actionable SEO titles and niche ideas.` }]
        },
        contents: [
          { parts: [{ text: userMessage }] }
        ]
      });

      const aiReply = response.data.candidates[0].content.parts[0].text;

      // Send the reply back to Slack
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
    console.error("❌ Error:", error.response ? JSON.stringify(error.response.data) : error.message);
    res.sendStatus(200);
  }
});

// 5. Start Server
app.listen(PORT, () => {
  console.log(`🚀 BraveNoise AI listening on port ${PORT}`);
});  try {
    const event = body.event;
    if (event && event.text && !event.bot_id && event.type === "message") {
      const userMessage = event.text;
      const channelId = event.channel;

      // 🔥 3. Gemini API Call (REST format)
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
      
      const response = await axios.post(geminiUrl, {
        system_instruction: {
          parts: [{ text: `You are BraveNoise AI. Priority: Revenue via Etsy/Printify. Brand Rules: ${designSpecs}. Always provide actionable SEO titles and niche ideas.` }]
        },
        contents: [
          { parts: [{ text: userMessage }] }
        ]
      });

      // Gemini's specific response structure
      const aiReply = response.data.candidates[0].content.parts[0].text;

      // 4. Reply to Slack
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
    console.error("❌ Gemini/Slack Error:", error.response ? JSON.stringify(error.response.data) : error.message);
    res.sendStatus(200);
  }
});

app.listen(PORT, () => {
  console.log(`🚀 BraveNoise AI (Gemini) listening on port ${PORT}`);
});
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
