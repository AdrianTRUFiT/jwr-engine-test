import express from "express";
import fs from "fs";
import path from "path";
import Stripe from "stripe";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

// Initialize Express
const app = express();
app.use(express.json());

// -------------------------------------------
// CORS — allow Vercel + local development
// -------------------------------------------
app.use(
  cors({
    origin: [
      "http://127.0.0.1:3000",
      "http://localhost:3000",
      "https://jamaica-we-rise.vercel.app",
      "https://jamaica-we-rise-1.onrender.com"
    ],
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
  })
);

// -------------------------------------------
// STATIC FRONTEND FILES (local dev only)
// -------------------------------------------
const __dirname = path.resolve();
app.use(express.static(path.join(__dirname, "public")));

// -------------------------------------------
// STRIPE SETUP
// -------------------------------------------
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// -------------------------------------------
// PERSISTENT REGISTRY (Render disk)
// -------------------------------------------
const dataDir = "/data";
const registryFile = "/data/registry.json";

try {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(registryFile)) {
    fs.writeFileSync(registryFile, JSON.stringify({ donations: [] }, null, 2));
  }
} catch (err) {
  console.error("DISK INIT ERROR:", err);
}

// -------------------------------------------
// 1. CREATE CHECKOUT SESSION
// -------------------------------------------
app.post("/create-checkout-session", async (req, res) => {
  try {
    const { amount, email } = req.body;

    if (!amount || !email) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: email,
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: { name: "Jamaica We Rise Donation" },
            unit_amount: Math.round(amount * 100),
          },
          quantity: 1,
        },
      ],
      success_url: `${process.env.FRONTEND_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/cancel.html`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("STRIPE ERROR:", err);
    res.status(500).json({ error: "Stripe session failed" });
  }
});

// -------------------------------------------
// 2. SAVE DONATION ENTRY (SoulMark)
// -------------------------------------------
app.post("/verify-soulmark", (req, res) => {
  try {
    const entry = req.body;

    const current = JSON.parse(fs.readFileSync(registryFile, "utf8"));
    current.donations.push(entry);
    fs.writeFileSync(registryFile, JSON.stringify(current, null, 2));

    res.json({ verified: true, entry });
  } catch (err) {
    console.error("VERIFY ERROR:", err);
    res.status(500).json({ error: "Verification failed" });
  }
});

// -------------------------------------------
// 3. VERIFY DONATION (success.html)
// -------------------------------------------
app.get("/verify-donation/:sessionId", async (req, res) => {
  const { sessionId } = req.params;

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (!session || session.payment_status !== "paid") {
      return res.status(400).json({ error: "Payment not verified" });
    }

    const registry = JSON.parse(fs.readFileSync(registryFile, "utf8"));

    const match = registry.donations.find(
      (d) =>
        d.email === session.customer_email &&
        Math.round(d.amount * 100) === session.amount_total
    );

    res.json({
      email: session.customer_email,
      amount: session.amount_total / 100,
      soulmark: match ? match.soulmark : "unverified",
    });
  } catch (err) {
    console.error("VERIFICATION ERROR:", err);
    res.status(500).json({ error: "Verification failed" });
  }
});

// -------------------------------------------
// 4. DIAGNOSTIC TEST ROUTE
// -------------------------------------------
app.get("/test", (req, res) => {
  res.json({ working: true, time: Date.now() });
});

// -------------------------------------------
// 5. START SERVER (local 3000 / Render dynamic)
// -------------------------------------------
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});
