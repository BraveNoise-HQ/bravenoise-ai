import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import fs from "fs"; 

const app = express();
app.use(bodyParser.json());

const MODEL_NAME = "gemini-3-flash-preview"; 
const PORT = process.env.PORT || 8080;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const PRINTIFY_TOKEN = process.env.PRINTIFY_API_TOKEN;
const PRINTIFY_SHOP_ID = process.env.PRINTIFY_SHOP_ID;

// 1. Load Rules
let designSpecs = "Modern minimalist, centered text, clean sans-serif.";
try { if (fs.existsSync("./DESIGN.md")) designSpecs = fs.readFileSync("./DESIGN.md", "utf8"); } catch (err) {}

app.get("/latest-image", async (req, res) => {
  try {
    const response = await axios.get("https://api.printify.com/v1/uploads.json?limit=1", {
      headers: { Authorization: `Bearer ${PRINTIFY_TOKEN}` }
    });
    res.json({ Image_ID: response.data.data[0].id });
  } catch (error) { res.send("❌ Error fetching image."); }
});

app.post("/slack/events", async (req, res) => {
  // 🛑 THE ECHO FIX: Ignore automatic retries from Slack
  if (req.headers['x-slack-retry-num']) {
    return res.status(200).send("OK");
  }

  const { body } = req;
  if (body.type === "url_verification") return res.send({ challenge: body.challenge });

  // 🛑 Send an immediate receipt to Slack so it doesn't trigger the 3-second timeout
  res.status(200).send("OK");

  const event = body.event;
  if (event?.text && !event.bot_id && (event.type === "message" || event.type === "app_mention")) {
    
    // ⚙️ THE EXECUTION ENGINE
    if (event.text.trim().toUpperCase() === "APPROVED") {
      try {
        const catalogResponse = await axios.get(
          "https://api.printify.com/v1/catalog/blueprints/12/print_providers/29/variants.json",
          { headers: { Authorization: `Bearer ${PRINTIFY_TOKEN}` } }
        );
        
        let chosenVariantId = catalogResponse.data.variants[0].id;
        const blackMedium = catalogResponse.data.variants.find(v => v.title.includes("Black") && v.title.includes("M"));
        if (blackMedium) chosenVariantId = blackMedium.id;

        const printifyPayload = {
          title: "AMOR FATI - Minimalist Essential Tee",
          description: "Love of Fate. A high-quality minimalist design.",
          tags: ["minimalist", "dahlia", "streetwear", "philosophy"],
          blueprint_id: 12, 
          print_provider_id: 29, 
          variants: [{ id: chosenVariantId, price: 2800, is_enabled: true }], 
          print_areas: [{
            variant_ids: [chosenVariantId],
            placeholders: [{
              position: "front",
              // 👇 PASTE YOUR EXACT IMAGE ID BACK IN HERE 👇
              images: [{ id: "69d1da8bc40ef87fe98b317e", x: 0.5, y: 0.5, scale: 0.2, angle: 0 }] 
            }]
          }]
        };

        await axios.post(
          `https://api.printify.com/v1/shops/${PRINTIFY_SHOP_ID}/products.json`,
          printifyPayload,
          { headers: { Authorization: `Bearer ${PRINTIFY_TOKEN}` } }
        );

        await axios.post("https://slack.com/api/chat.postMessage", {
          channel: event.channel,
          text: `🚀 **Nice choice, Eric.** That's a clean design. It's live in your Etsy drafts now. Back to the edits!`
        }, { headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` } });

      } catch (error) {
        console.error("❌ ERROR:", JSON.stringify(error.response?.data || error.message, null, 2));
        await axios.post("https://slack.com/api/chat.postMessage", {
          channel: event.channel,
          text: "❌ **Ah, slight snag.** I hit a wall with the Printify API. I'll keep an eye on the logs."
        }, { headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` } });
      }
      return; 
    }

    // 🧠 THE NATURAL PERSONALITY PATCH & QUOTA PROTECTION
    try {
      const naturalPersona = `You are Ben, Eric's authentic, adaptive AI creative partner. 
      You help manage his band DAHLIA and his Etsy shop while he's busy editing videos and photos for clients.
      TONE: Be grounded, supportive, and slightly witty—like a fellow creative. Don't be a generic bot. 
      GOAL: We're aiming for $3k/month to get you that Mac Studio setup. 
      RULES: ${designSpecs}. 
      Always end a pitch with: 'Reply APPROVED to launch.'`;

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${GEMINI_API_KEY}`;
      const response = await axios.post(url, {
        systemInstruction: { parts: [{ text: naturalPersona }] },
        contents: [{ role: "user", parts: [{ text: event.text }] }],
        generationConfig: { 
          maxOutputTokens: 1000,
          temperature: 0.8 
        }
      });
      await axios.post("https://slack.com/api/chat.postMessage", { 
        channel: event.channel, 
        text: response.data.candidates[0].content.parts[0].text 
      }, { headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` } });
    } catch (error) {}
  }
});

app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Ben is LIVE, human, and quota-protected`));
