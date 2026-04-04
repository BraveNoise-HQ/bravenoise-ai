import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import fs from "fs";

const app = express();
app.use(bodyParser.json());

// ⚡️ GEMINI 3 FLASH PREVIEW (Confirmed from your screenshot)
const MODEL_NAME = "gemini-3-flash-preview"; 

const PORT = process.env.PORT || 8080;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;

// 1. Restore the Strategist Personality
let designSpecs = "Follow high-converting, modern minimalist design principles.";
try {
  if (fs.existsSync("./DESIGN.md")) {
    designSpecs = fs.readFileSync("./DESIGN.md", "utf8");
    console.log("🎨 BraveNoise AI Brand Rules Loaded.");
  }
} catch (err) {
  console.log("⚠️ No DESIGN.md found, using default revenue strategy.");
}

app.get("/", (req, res) => res.send("BraveNoise AI (Gemini 3) is tactical and ready. 🚀"));

app.post("/slack/events", async (req, res) => {
  const { body } = req;
  if (body.type === "url_verification") return res.send({ challenge: body.challenge });

  const event = body.event;
  if (event?.text && !event.bot_id && (event.type === "message" || event.type === "app_mention")) {
    try {
      console.log(`📩 Processing Strategic Request: "${event.text}"`);

      // 🔥 YOUR FULL STRATEGIST BRAIN (DO NOT MODIFY)
      const systemPrompt = `
        You are BraveNoise AI, a revenue-focused strategist. 
        CORE OBJECTIVE: Help the user generate income via Etsy, Printify, and Digital Products. 
        DESIGN RULES: ${designSpecs} 
        WORKFLOW: 
        1. ANALYZE: Identify a high-margin, trending niche. 
        2. OPTIMIZE: Provide SEO-optimized titles and high-conversion tags. 
        3. VISUALIZE: Describe the visual design based on Brand Rules. 
        4. ACTION: List 3 numbered steps to launch. 
        Tone: Professional, concise, and obsessed with conversion.
      `;

      // 2026 Stable REST Endpoint
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${GEMINI_API_KEY}`;
      
      const response = await axios.post(url, {
        systemInstruction: {
          parts: [{ text: systemPrompt }]
        },
        contents: [{
          role: "user",
          parts: [{ text: event.text }]
        }],
        // ⚡️ FIXED: New Gemini 3 JSON Structure ⚡️
        generationConfig: {
          maxOutputTokens: 1500,  
          temperature: 0.7,
          thinkingConfig: {
            includeThoughts: false, // Keeps the response clean for Slack
            thinkingLevel: "HIGH"    // Activates the strategic reasoning you wanted
          }
        }
      });

      const aiReply = response.data.candidates[0].content.parts[0].text;

      // Post back to Slack
      await axios.post("https://slack.com/api/chat.postMessage", 
        { channel: event.channel, text: aiReply },
        { headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` }}
      );

    } catch (error) {
      const errorDetail = error.response ? JSON.stringify(error.response.data) : error.message;
      console.error("❌ API Error Detail:", errorDetail);
    }
  }
  res.sendStatus(200);
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 BraveNoise AI (Strategic Mode) listening on port ${PORT}`);
});
