import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import fs from "fs";

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;

// 1. Load your Brand/Design Specs
let designSpecs = "Use high-converting, minimalist design principles.";
try {
  if (fs.existsSync("./DESIGN.md")) {
    designSpecs = fs.readFileSync("./DESIGN.md", "utf8");
    console.log("🎨 DESIGN.md specs loaded into memory.");
  }
} catch (err) {
  console.log("⚠️ No DESIGN.md found, using default vibe.");
}

// 2. Health check
app.get("/", (req, res) => res.send("BraveNoise AI: Brain Restored. 🚀"));

// 3. The Main Event
app.post("/slack/events", async (req, res) => {
  const { body } = req;
  if (body.type === "url_verification") return res.send({ challenge: body.challenge });

  const event = body.event;
  if (event?.text && !event.bot_id && (event.type === "message" || event.type === "app_mention")) {
    try {
      console.log(`📩 Analyzing request: "${event.text}"`);

      // 🔥 YOUR RESTORED INITIAL INDEX (The Brain)
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

      // Gemini 1.5 Flash Call
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
      
      const response = await axios.post(url, {
        system_instruction: {
          parts: [{ text: systemPrompt }]
        },
        contents: [{
          parts: [{ text: event.text }]
        }]
      });

      const aiReply = response.data.candidates[0].content.parts[0].text;

      // Post back to Slack
      await axios.post("https://slack.com/api/chat.postMessage", 
        { channel: event.channel, text: aiReply },
        { headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` }}
      );

    } catch (error) {
      console.error("❌ Error:", error.response ? JSON.stringify(error.response.data) : error.message);
    }
  }
  res.sendStatus(200);
});

app.listen(PORT, "0.0.0.0", () => console.log(`🚀 BraveNoise AI (Full Brain) listening on ${PORT}`));
