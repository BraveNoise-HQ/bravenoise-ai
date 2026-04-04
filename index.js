import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import fs from "fs"; // Added to potentially read DESIGN.md

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN; // Switch to Bot Token for more flexibility

// ✅ 1. Environment Variable Safety Check
if (!OPENAI_API_KEY || !SLACK_BOT_TOKEN) {
  console.error("❌ MISSING CONFIG: Ensure OPENAI_API_KEY and SLACK_BOT_TOKEN are set in Railway.");
}

// ✅ 2. Optional: Load Design Guidelines
let designSpecs = "Follow general minimalist and modern design principles.";
try {
  if (fs.existsSync("./DESIGN.md")) {
    designSpecs = fs.readFileSync("./DESIGN.md", "utf8");
    console.log("🎨 DESIGN.md loaded successfully.");
  }
} catch (err) {
  console.log("⚠️ No DESIGN.md found, using default specs.");
}

// ✅ Health check
app.get("/", (req, res) => {
  res.send("BraveNoise AI is running 🚀");
});

// ✅ Slack Events Endpoint
app.post("/slack/events", async (req, res) => {
  const body = req.body;

  // Slack URL verification (Crucial for first-time setup)
  if (body.type === "url_verification") {
    return res.send({ challenge: body.challenge });
  }

  try {
    const event = body.event;

    // Only respond to messages from humans (ignore bot's own messages)
    if (event && event.text && !event.bot_id && event.type === "message") {
      const userMessage = event.text;
      const channelId = event.channel;

      console.log(`📩 Received message: "${userMessage}" from channel ${channelId}`);

      // 🔥 3. Improved OpenAI API call with "Chain of Thought" instructions
      const response = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: `
You are BraveNoise AI, a revenue-focused strategist. 

CORE OBJECTIVE: Help the user generate income via Etsy, Printify, and Digital Products.

DESIGN RULES (from DESIGN.md):
${designSpecs}

WORKFLOW:
1. ANALYZE: If a user asks for a product idea, first identify a trending niche.
2. OPTIMIZE: Provide SEO-optimized titles and tags.
3. VISUALIZE: Describe the visual look based on the DESIGN RULES above.
4. ACTION: Give clear, numbered steps to launch.

Always be concise, professional, and obsessed with conversion rates.`
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

      const reply = response.data.choices[0].message.content;

      // 🔥 4. Send back to Slack using Web API (More robust than Webhooks)
      await axios.post(
        "https://slack.com/api/chat.postMessage",
        {
          channel: channelId,
          text: reply
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
    // ✅ 5. Advanced Error Logging
    console.error("❌ ERROR DETECTED:");
    if (error.response) {
      console.error("Status:", error.response.status);
      console.error("Data:", JSON.stringify(error.response.data, null, 2));
    } else {
      console.error("Message:", error.message);
    }
    res.sendStatus(200); // Still send 200 to Slack to prevent infinite retries
  }
});

// ✅ Start server
app.listen(PORT, () => {
  console.log(`🚀 BraveNoise Server running on port ${PORT}`);
});          messages: [
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
