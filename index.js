import express from "express";
import bodyParser from "body-parser";
import axios from "axios";

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ✅ Health check
app.get("/", (req, res) => {
  res.send("BraveNoise AI is running 🚀");
});

// ✅ Slack Events Endpoint
app.post("/slack/events", async (req, res) => {
  const body = req.body;

  // Slack URL verification
  if (body.type === "url_verification") {
    return res.send({ challenge: body.challenge });
  }

  try {
    const event = body.event;

    if (event && event.text && !event.bot_id) {
      const userMessage = event.text;

      // 🔥 OpenAI API call
      const response = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: `
You are BraveNoise AI, a revenue-focused assistant.

Your priorities:

1. Generate income via Etsy + Printify:
- Suggest product ideas
- Write SEO titles, descriptions, and tags
- Identify trending niches

2. Create digital products:
- Suggest ideas
- Generate content
- Suggest pricing and positioning

3. Secondary: content creation for social media

Always give actionable, structured outputs.
              `
            },
            {
              role: "user",
              content: userMessage
            }
          ]
        },
        {
          headers: {
            Authorization: \`Bearer \${OPENAI_API_KEY}\`,
            "Content-Type": "application/json"
          }
        }
      );

      const reply = response.data.choices[0].message.content;

      // 🔥 Send back to Slack
      await axios.post(process.env.SLACK_WEBHOOK_URL, {
        text: reply
      });
    }

    res.sendStatus(200);
  } catch (error) {
    console.error("Error:", error.message);
    res.sendStatus(200);
  }
});

// ✅ Start server
app.listen(PORT, () => {
  console.log(\`Server running on port \${PORT}\`);
});
