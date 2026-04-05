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

// 2. The ID Finder Route
app.get("/latest-image", async (req, res) => {
  try {
    const response = await axios.get("https://api.printify.com/v1/uploads.json?limit=1", {
      headers: { Authorization: `Bearer ${PRINTIFY_TOKEN}` }
    });
    res.json({ Image_ID: response.data.data[0].id });
  } catch (error) { res.send("❌ Error fetching image. Check Printify API Key."); }
});

app.post("/slack/events", async (req, res) => {
  const { body } = req;
  if (body.type === "url_verification") return res.send({ challenge: body.challenge });
  const event = body.event;
  if (event?.text && !event.bot_id && (event.type === "message" || event.type === "app_mention")) {
    
    // 🔥 THE LIVE EXECUTION ENGINE 🔥
    if (event.text.trim().toUpperCase() === "APPROVED") {
      try {
        // 🎨 The "Fallback Roulette" - Valid IDs for Black, Dark Grey, Navy, Asphalt (Size M)
        const safeVariants = [43058, 43075, 43059, 43072];
        const chosenVariantId = safeVariants[Math.floor(Math.random() * safeVariants.length)];

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
              // 👇 ANGLE ADDED HERE. PASTE YOUR EXACT IMAGE ID BACK IN 👇
              images: [{ id: "69d1da8bc40ef87fe98b317e", x: 0.5, y: 0.5, scale: 0.2, angle: 0 }] 
            }]
          }]
        };

        // 🚀 LIVE LAUNCH TO PRINTIFY/ETSY
        await axios.post(
          `https://api.printify.com/v1/shops/${PRINTIFY_SHOP_ID}/products.json`,
          printifyPayload,
          { headers: { Authorization: `Bearer ${PRINTIFY_TOKEN}` } }
        );

        await axios.post("https://slack.com/api/chat.postMessage", {
          channel: event.channel,
          text: `✅ **LIVE LAUNCH SUCCESS!** The AMOR FATI tee (Variant ID: ${chosenVariantId}) is now in your Etsy drafts.`
        }, { headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` } });

      } catch (error) {
        // 🔥 ENHANCED ERROR LOGGING 🔥
        console.error("❌ PRINTIFY ERROR DETAILS:", JSON.stringify(error.response?.data, null, 2));
        await axios.post("https://slack.com/api/chat.postMessage", {
          channel: event.channel,
          text: "❌ **Launch Failed.** Printify rejected the data. Check Railway logs for the exact error!"
        }, { headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` } });
      }
      return res.sendStatus(200);
    }

    // 🧠 Normal Strategy Brain (With Quota Protection)
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${GEMINI_API_KEY}`;
      const response = await axios.post(url, {
        systemInstruction: { parts: [{ text: `You are Ben, a revenue strategist. Target: $3k/mo for a Mac Studio. Rules: ${designSpecs}. End with: 'Reply APPROVED to launch.'` }] },
        contents: [{ role: "user", parts: [{ text: event.text }] }],
        generationConfig: {
          maxOutputTokens: 1500,
          temperature: 0.7 
        }
      });
      await axios.post("https://slack.com/api/chat.postMessage", { channel: event.channel, text: response.data.candidates[0].content.parts[0].text }, { headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` } });
    } catch (error) {}
  }
  res.sendStatus(200);
});

app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Ben is LIVE and protected`));
