/********************************************************************
 * app.js - WhatsApp Store Chatbot with Interactive Buttons & Unified Logic
 *
 * Features:
 *   1) Main Menu: Make New Order, Check Order Status, Support
 *   2) Make New Order -> Men/Women -> Category -> Product -> Quantity -> Checkout
 *   3) Check Order Status -> Looks up by phone number
 *   4) Support -> FAQs or Connect to Agent (placeholder)
 *   5) Single handleTextMessage function
 *   6) Button transitions actually move to the next step
 ********************************************************************/

import express from "express";
import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

/* ENV VARIABLES:
   - PORT=3000
   - WEBHOOK_VERIFY_TOKEN=my_verify_token
   - GRAPH_API_TOKEN=<YOUR_WHATSAPP_CLOUD_API_TOKEN>
   - BUSINESS_PHONE_NUMBER_ID=<YOUR_PHONE_NUMBER_ID>
*/
const {
  PORT = 3000,
  WEBHOOK_VERIFY_TOKEN = "my_secret_token", // user-chosen verify token
  GRAPH_API_TOKEN = "EAAQUfr07NTABO4m6R5WUa7znC8OqXcQfB7z1ta4ZCUGQYWXNQytUVyH9OZCNazYkBP26OZAk3fCdNcq3v9x8MzNV11DgcE2O95HXseeOFC637Uoc29plHUCMvKfjWIjz7UHufJv1ZBOD9sKZCsqeNw4F70VzOejXfsV5cYZAouNXVlz54At3yt2sjPFwOZALA8PpbLCjy5iO90DfbvoxtPqQl36OQRqxf7JZCZBwt4jZAGHMUZD", // from Meta
  BUSINESS_PHONE_NUMBER_ID = "561948593666104", // e.g. "123456789"
} = process.env;

const app = express();
app.use(express.json());

// ------------------- SAMPLE STORE DATA -------------------
const PRODUCT_DATA = {
  men: {
    perfumes: [
      { id: 1, name: "XYZ Cologne", price: 50 },
      { id: 2, name: "Sporty Fresh", price: 45 },
      { id: 3, name: "Classic Wood", price: 55 },
    ],
    deodorants: [
      { id: 4, name: "Cool Breeze Deo", price: 20 },
      { id: 5, name: "FreshSport Deo", price: 25 },
      { id: 6, name: "Musk Shield Deo", price: 30 },
    ],
    "body sprays": [
      { id: 7, name: "Ocean Body Spray", price: 18 },
      { id: 8, name: "Citrus Mist", price: 22 },
      { id: 9, name: "Rock Solid", price: 25 },
    ],
  },
  women: {
    perfumes: [
      { id: 10, name: "Floral Dream", price: 60 },
      { id: 11, name: "Citrus Bloom", price: 55 },
      { id: 12, name: "Vanilla Essence", price: 65 },
    ],
    deodorants: [
      { id: 13, name: "Gentle Rose Deo", price: 28 },
      { id: 14, name: "Lavender Fresh Deo", price: 27 },
      { id: 15, name: "Pure Blossom Deo", price: 30 },
    ],
    "body sprays": [
      { id: 16, name: "Summer Splash", price: 20 },
      { id: 17, name: "Sweet Magnolia", price: 24 },
      { id: 18, name: "Soft Cloud", price: 26 },
    ],
  },
};

function findProductById(gender, category, productId) {
  const items = PRODUCT_DATA[gender]?.[category];
  if (!items) return null;
  return items.find((p) => p.id === productId);
}

// ------------------- IN-MEMORY STATES -------------------
const sessions = {}; // { phone: { state, gender, category, cart, etc. } }
const orders = {}; // { phone: { orderId, status, cart, name, address } } (by phone for simplicity)

function generateOrderId() {
  const rand = Math.floor(Math.random() * 1e8)
    .toString()
    .padStart(8, "0");
  return "P" + rand; // e.g. P12345678
}

function getSession(phone) {
  if (!sessions[phone]) {
    sessions[phone] = {
      state: "MAIN_MENU",
      gender: null,
      category: null,
      cart: [],
      name: null,
      address: null,
      currentProduct: null,
    };
  }
  return sessions[phone];
}

function resetSession(phone) {
  sessions[phone] = {
    state: "MAIN_MENU",
    gender: null,
    category: null,
    cart: [],
    name: null,
    address: null,
    currentProduct: null,
  };
}

// ------------------- WEBHOOK VERIFICATION (GET) -------------------
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === WEBHOOK_VERIFY_TOKEN) {
    console.log("Webhook verified!");
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// ------------------- INCOMING MESSAGES (POST) -------------------
app.post("/webhook", async (req, res) => {
  console.log("Incoming webhook data:", JSON.stringify(req.body, null, 2));

  const changes = req.body.entry?.[0]?.changes?.[0];
  if (!changes) {
    return res.sendStatus(200);
  }

  const messages = changes.value?.messages;
  if (messages) {
    for (const msg of messages) {
      const from = msg.from; // user phone
      const msgType = msg.type;

      // 1) TEXT messages
      if (msgType === "text") {
        const textBody = msg.text.body;
        await handleTextMessage(from, textBody);
      }

      // 2) INTERACTIVE (button) messages
      else if (msgType === "interactive") {
        const interactiveObj = msg.interactive;
        if (interactiveObj.type === "button") {
          // Quick reply button
          const buttonId = interactiveObj.button_reply.id;
          const buttonTitle = interactiveObj.button_reply.title;
          await handleButtonReply(from, buttonId, buttonTitle);
        } else {
          console.log(
            "Received interactive of another type:",
            interactiveObj.type
          );
        }
      } else {
        console.log("Unsupported message type:", msgType);
      }
    }
  }

  return res.sendStatus(200);
});

// ------------------- UNIFIED handleTextMessage -------------------
async function handleTextMessage(userPhone, textBody) {
  const session = getSession(userPhone);
  const lowerText = textBody.trim().toLowerCase();

  // If user typed "menu", "hi", or "hello" => show main menu
  if (["menu", "hi", "hello"].includes(lowerText)) {
    session.state = "MAIN_MENU";
    await sendMainMenu(userPhone);
    return;
  }

  // If user is in ASK_QUANTITY and typed a number
  if (session.state === "ASK_QUANTITY") {
    const qty = parseInt(textBody, 10);
    if (isNaN(qty) || qty <= 0) {
      await sendTextMessage(
        userPhone,
        "Please enter a valid numeric quantity or type 'menu' to reset."
      );
      return;
    }
    // Add to cart, then ask if continue or checkout
    session.cart.push({
      id: session.currentProduct.id,
      name: session.currentProduct.name,
      price: session.currentProduct.price,
      quantity: qty,
    });
    session.currentProduct = null;

    session.state = "CART_DECISION";
    const bodyText = `Added ${qty} x ${
      session.cart[session.cart.length - 1].name
    }.\nContinue or checkout?`;
    const buttons = [
      { id: "CONTINUE", title: "Continue" },
      { id: "CHECKOUT", title: "Checkout" },
    ];
    await sendInteractiveButtons(userPhone, bodyText, buttons);
    return;
  }

  // If user is in CHECKOUT_NAME => user typed their name
  if (session.state === "CHECKOUT_NAME") {
    session.name = textBody;
    session.state = "CHECKOUT_ADDRESS";
    await sendTextMessage(
      userPhone,
      `Thanks, ${session.name}. Please type your delivery address now.`
    );
    return;
  }

  // If user is in CHECKOUT_ADDRESS => user typed their address => confirm
  if (session.state === "CHECKOUT_ADDRESS") {
    session.address = textBody;
    session.state = "CHECKOUT_CONFIRM";
    const cartSummary = session.cart
      .map((c) => `${c.quantity} x ${c.name}`)
      .join("\n");
    const confirmMsg = `Your order:\n${cartSummary}\nAddress: ${session.address}\nConfirm or cancel?`;
    const confirmButtons = [
      { id: "CONFIRM", title: "Confirm" },
      { id: "CANCEL", title: "Cancel" },
    ];
    await sendInteractiveButtons(userPhone, confirmMsg, confirmButtons);
    return;
  }

  // Otherwise fallback
  await sendTextMessage(
    userPhone,
    "Please use the buttons. Type 'menu' if you got lost."
  );
}

// ------------------- handleButtonReply (Interactive Buttons) -------------------
async function handleButtonReply(userPhone, buttonId, buttonTitle) {
  console.log(
    `User ${userPhone} tapped button: id=${buttonId}, title=${buttonTitle}`
  );
  const session = getSession(userPhone);

  switch (session.state) {
    case "MAIN_MENU":
      if (buttonId === "ORDER") {
        session.state = "SELECT_GENDER";
        await sendGenderMenu(userPhone);
      } else if (buttonId === "STATUS") {
        // check order for this phone
        session.state = "CHECK_ORDER_STATUS";
        await checkOrderStatus(userPhone);
      } else if (buttonId === "SUPPORT") {
        session.state = "SUPPORT_MENU";
        await sendSupportMenu(userPhone);
      } else {
        await sendTextMessage(
          userPhone,
          "Unknown main menu button. Type 'menu' to reset."
        );
      }
      break;

    case "SELECT_GENDER":
      if (buttonId === "MEN" || buttonId === "WOMEN") {
        session.gender = buttonId.toLowerCase(); // "men" or "women"
        session.state = "SELECT_CATEGORY";
        await sendCategoryMenu(userPhone, session.gender);
      } else {
        await sendTextMessage(userPhone, "Pick Men or Women.");
      }
      break;

    case "SELECT_CATEGORY":
      // expect "perfumes", "deodorants", "body sprays"
      await handleCategorySelection(userPhone, buttonId, session);
      break;

    case "SHOW_PRODUCTS":
      // user tapped a product ID button
      await handleProductQuickReply(userPhone, buttonId, session);
      break;

    case "CART_DECISION":
      if (buttonId === "CONTINUE") {
        session.state = "SELECT_CATEGORY";
        await sendCategoryMenu(userPhone, session.gender);
      } else if (buttonId === "CHECKOUT") {
        session.state = "CHECKOUT_NAME";
        await sendTextMessage(userPhone, "Please type your full name.");
      } else {
        await sendTextMessage(userPhone, "Please pick Continue or Checkout.");
      }
      break;

    case "SUPPORT_MENU":
      if (buttonId === "FAQS") {
        await sendTextMessage(
          userPhone,
          "FAQs:\n- Delivery: 2-5 days\n- Payment: Cash on Delivery\n- Refund: 7 days if unopened"
        );
        session.state = "MAIN_MENU";
        await sendMainMenu(userPhone);
      } else if (buttonId === "LIVE_AGENT") {
        await sendTextMessage(
          userPhone,
          "Live agent will connect soon. (Placeholder)"
        );
        session.state = "MAIN_MENU";
        await sendMainMenu(userPhone);
      } else {
        await sendTextMessage(
          userPhone,
          "Unknown support option. Type 'menu' to reset."
        );
      }
      break;

    case "CHECKOUT_CONFIRM":
      if (buttonId === "CONFIRM") {
        await finalizeOrder(userPhone);
      } else if (buttonId === "CANCEL") {
        resetSession(userPhone);
        await sendTextMessage(
          userPhone,
          "Order canceled. Type 'menu' to start again."
        );
      } else {
        await sendTextMessage(userPhone, "Please confirm or cancel.");
      }
      break;

    default:
      await sendTextMessage(
        userPhone,
        "Not sure how to handle this button. Type 'menu' to reset."
      );
  }
}

// ------------------- FLOW HELPERS -------------------
async function sendMainMenu(userPhone) {
  const bodyText = "Welcome! Choose an option:";
  const buttons = [
    { id: "ORDER", title: "Make New Order" },
    { id: "STATUS", title: "Check Order Status" },
    { id: "SUPPORT", title: "Support" },
  ];
  await sendInteractiveButtons(userPhone, bodyText, buttons);
}

async function sendGenderMenu(userPhone) {
  const bodyText = "Men or Women products?";
  const buttons = [
    { id: "MEN", title: "Men" },
    { id: "WOMEN", title: "Women" },
  ];
  await sendInteractiveButtons(userPhone, bodyText, buttons);
}

async function sendCategoryMenu(userPhone, gender) {
  const bodyText = `Choose a category for ${gender}:`;
  const buttons = [
    { id: "perfumes", title: "Perfumes" },
    { id: "deodorants", title: "Deodorants" },
    { id: "body sprays", title: "Body Sprays" },
  ];
  await sendInteractiveButtons(userPhone, bodyText, buttons);
}

async function handleCategorySelection(userPhone, category, session) {
  const validCats = ["perfumes", "deodorants", "body sprays"];
  if (!validCats.includes(category)) {
    await sendTextMessage(
      userPhone,
      "Please pick 'perfumes', 'deodorants', or 'body sprays'."
    );
    return;
  }
  session.category = category;
  session.state = "SHOW_PRODUCTS";

  // show up to 3 items as quick replies
  const products = PRODUCT_DATA[session.gender][category];
  let textMsg = `${category}:\n`;
  products.forEach((p) => {
    textMsg += `ID ${p.id}: ${p.name} ($${p.price})\n`;
  });
  textMsg +=
    "Pick a product from the first 3 below or type the ID if not there.";

  const firstThree = products.slice(0, 3).map((p) => ({
    id: String(p.id),
    title: p.name,
  }));

  await sendTextMessage(userPhone, textMsg);
  await sendInteractiveButtons(userPhone, "Choose a product:", firstThree);
}

async function handleProductQuickReply(userPhone, buttonId, session) {
  const productId = parseInt(buttonId, 10);
  if (isNaN(productId)) {
    await sendTextMessage(userPhone, "Invalid product ID from button.");
    return;
  }
  const product = findProductById(session.gender, session.category, productId);
  if (!product) {
    await sendTextMessage(
      userPhone,
      "Product not found. Try again or type 'menu' to reset."
    );
    return;
  }
  // ask quantity
  session.currentProduct = product;
  session.state = "ASK_QUANTITY";
  await sendTextMessage(
    userPhone,
    `How many of ${product.name} would you like? (Type a number)`
  );
}

async function checkOrderStatus(userPhone) {
  const existing = orders[userPhone];
  if (!existing) {
    await sendTextMessage(
      userPhone,
      "No order found for your number. Type 'menu' to order."
    );
    getSession(userPhone).state = "MAIN_MENU";
    await sendMainMenu(userPhone);
  } else {
    await sendTextMessage(
      userPhone,
      `Your order (${existing.orderId}) status is: ${existing.status}.\nType 'menu' to go back.`
    );
    getSession(userPhone).state = "MAIN_MENU";
    await sendMainMenu(userPhone);
  }
}

async function sendSupportMenu(userPhone) {
  const bodyText = "Need help? Pick an option:";
  const buttons = [
    { id: "FAQS", title: "FAQs" },
    { id: "LIVE_AGENT", title: "Live Agent" },
  ];
  await sendInteractiveButtons(userPhone, bodyText, buttons);
}

async function finalizeOrder(userPhone) {
  const session = getSession(userPhone);
  const orderId = generateOrderId();
  orders[userPhone] = {
    orderId,
    status: "Placed",
    cart: session.cart,
    name: session.name,
    address: session.address,
  };

  await sendTextMessage(
    userPhone,
    `Thank you! Your order (${orderId}) is placed.\nWe will contact you soon.`
  );
  resetSession(userPhone);
}

// ------------------- WHATSAPP SENDERS (TEXT, BUTTONS) -------------------
async function sendTextMessage(to, bodyText) {
  try {
    const url = `https://graph.facebook.com/v16.0/${BUSINESS_PHONE_NUMBER_ID}/messages`;
    await axios.post(
      url,
      {
        messaging_product: "whatsapp",
        to,
        text: { body: bodyText },
      },
      {
        headers: {
          Authorization: `Bearer ${GRAPH_API_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (err) {
    console.error("sendTextMessage error:", err?.response?.data || err);
  }
}

async function sendInteractiveButtons(to, bodyText, buttons) {
  // Up to 3 quick reply buttons
  // format: { id, title } => {type: 'reply', reply: {id, title}}
  try {
    const url = `https://graph.facebook.com/v16.0/${BUSINESS_PHONE_NUMBER_ID}/messages`;
    const payload = {
      messaging_product: "whatsapp",
      to,
      type: "interactive",
      interactive: {
        type: "button",
        body: {
          text: bodyText,
        },
        action: {
          buttons: buttons.map((b) => ({
            type: "reply",
            reply: {
              id: b.id,
              title: b.title,
            },
          })),
        },
      },
    };

    await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${GRAPH_API_TOKEN}`,
        "Content-Type": "application/json",
      },
    });
  } catch (err) {
    console.error("sendInteractiveButtons error:", err?.response?.data || err);
  }
}

// ------------------- SERVER SETUP -------------------
app.get("/", (req, res) => {
  res.send(
    "WhatsApp Interactive Chatbot is running. Use /webhook for inbound calls."
  );
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
