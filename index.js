import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import fs from "fs";

const app = express();
app.use(bodyParser.json());

// ⚡️ APRIL 2026 STABLE CONFIG ⚡️
const MODEL_NAME = "gemini-3-flash-preview"; 
const PORT = process.env.PORT || 8080;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;

// 1. Personality & Design Rules Loading
let designSpecs = "Follow high-converting, modern minimalist design principles.";
try {
  if (fs.existsSync("./DESIGN.md")) {
    designSpecs = fs.readFileSync("./DESIGN.md", "utf8");
    console.log("🎨 BraveNoise personality rules loaded.");
  }
} catch (err) {
  console.log("⚠️ No DESIGN.md found, using default strategist mode.");
}

app.get("/", (req, res) => {
  res.send("BraveNoise AI (Gemini 3) is tactical and online! 🚀");
});

app.post("/slack/events", async (req, res) => {
  const { body } = req;
  if (body.type === "url_verification") return res.send({ challenge: body.challenge });

  const event = body.event;
  if (event?.text && !event.bot_id && (event.type === "message" || event.type === "app_mention")) {
    try {
      console.log(`📩 Processing strategic request: "${event.text}"`);

      // 🔥 YOUR FULL STRATEGIST PERSONA
      const systemPrompt = `
        You are BraveNoise AI, a revenue-focused strategist. 
        CORE OBJECTIVE: Help the user generate income via Etsy, Printify, and Digital Products. 
        DESIGN RULES (from DESIGN.md): ${designSpecs} 
        WORKFLOW: 
        1. ANALYZE: If a user asks for a product idea, first identify a trending niche. 
        2. OPTIMIZE: Provide SEO-optimized titles and tags. 
        3. VISUALIZE: Describe the visual look based on the DESIGN RULES above. 
        4. ACTION: Give clear, numbered steps to launch. 
        Always be concise, professional, and obsessed with conversion rate.
      `;

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${GEMINI_API_KEY}`;
      
      const response = await axios.post(url, {
        system_instruction: {
          parts: [{ text: systemPrompt }]
        },
        contents: [{
          role: "user",
          parts: [{ text: event.text }]
        }],
        // 🔥 FIXED: Thinking configuration for Gemini 3
        thinking_config: {
          include_thoughts: false,
          thinking_level: "high"
        }
      });

      const aiReply = response.data.candidates[0].content.parts[0].text;

      // Send the strategic reply back to Slack
      await axios.post("https://slack.com/api/chat.postMessage", 
        { channel: event.channel, text: aiReply },
        { headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` }}
      );

    } catch (error) {
      const errorMsg = error.response ? JSON.stringify(error.response.data) : error.message;
      console.error("❌ API Error Detail:", errorMsg);
    }
  }
  res.sendStatus(200);
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 BraveNoise AI listening on port ${PORT}`);
});
