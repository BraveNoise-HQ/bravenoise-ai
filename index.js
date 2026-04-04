import express from "express";
import bodyParser from "body-parser";
import axios from "axios";

const app = express();
app.use(bodyParser.json());

// ⚡️ UPDATED FOR APRIL 2026 GEMINI 3 SERIES ⚡️
const MODEL_ID = "gemini-3-flash-preview"; 

const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;

app.get("/", (req, res) => res.send("BraveNoise AI (Gemini 3) is online! 🚀"));

app.post("/slack/events", async (req, res) => {
  const { body } = req;
  if (body.type === "url_verification") return res.send({ challenge: body.challenge });

  const event = body.event;
  if (event?.text && !event.bot_id && (event.type === "message" || event.type === "app_mention")) {
    try {
      console.log(`📩 Message received: "${event.text}"`);

      // 🧠 Restoring your Revenue Strategist Persona
      const systemPrompt = `You are BraveNoise AI, a revenue-focused strategist. 
      Objective: Maximize income via Etsy and Printify. 
      Workflow: 1. Analyze 2. Optimize 3. Visualize 4. Action. 
      Apply deep thinking for high-margin results.`;

      // Gemini 3 Preview Endpoint
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_ID}:generateContent?key=${GEMINI_API_KEY}`;
      
      const response = await axios.post(url, {
        system_instruction: {
          parts: [{ text: systemPrompt }]
        },
        contents: [{
          role: "user",
          parts: [{ text: event.text }]
        }],
        generationConfig: {
          // 🔥 Enables the high-reasoning "Thinking" mode for strategy
          thinking_level: "high" 
        }
      });

      const aiReply = response.data.candidates[0].content.parts[0].text;

      // Send the reply back to Slack
      await axios.post("https://slack.com/api/chat.postMessage", 
        { channel: event.channel, text: aiReply },
        { headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` }}
      );

    } catch (error) {
      // This will log the specific error if it still fails
      console.error("❌ Error Detail:", error.response ? JSON.stringify(error.response.data) : error.message);
    }
  }
  res.sendStatus(200);
});

app.listen(PORT, "0.0.0.0", () => console.log(`🚀 BraveNoise AI (Gemini 3) listening on port ${PORT}`));
