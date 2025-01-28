/********************************************************************
 * server.js - WhatsApp Store Chatbot with:
 *   1) First-Time vs Returning Welcome Flows
 *   2) Language Selection (English / Arabic)
 *   3) Main Menu: Make New Order, Check Order Status, Support
 *   4) Make New Order -> (Men/Women -> Category -> Product -> Quantity -> Checkout)
 *   5) Check Order Status -> Looks up by phone
 *   6) Support -> FAQs or Live Agent (placeholder)
 *   7) Single handleTextMessage function
 *   8) Button transitions for each step
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
  GRAPH_API_TOKEN = "",
  BUSINESS_PHONE_NUMBER_ID = "",
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
/*
   sessions[phone] = {
     state: "MAIN_MENU" or "ASK_QUANTITY" or etc.
     isFirstTime: true/false
     language: null / "en" / "ar"
     gender: null or "men"/"women"
     category: null or "perfumes"/"deodorants"/"body sprays"
     cart: []
     name: ...
     address: ...
     currentProduct: ...
   }

   orders[phone] = {
     orderId, status, cart, name, address
   }
*/
const sessions = {};
const orders = {};

function generateOrderId() {
  const rand = Math.floor(Math.random() * 1e8)
    .toString()
    .padStart(8, "0");
  return "P" + rand; // e.g. P12345678
}

function getSession(phone) {
  if (!sessions[phone]) {
    sessions[phone] = {
      // For a brand-new user:
      isFirstTime: true,
      language: null,
      state: "WELCOME", // start them in "WELCOME" state
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
    isFirstTime: false, // they've used the bot before
    language: null, // or we keep their language? up to you
    state: "WELCOME",
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

      if (msgType === "text") {
        const textBody = msg.text.body;
        await handleTextMessage(from, textBody);
      } else if (msgType === "interactive") {
        const interactiveObj = msg.interactive;
        // Check 'button_reply' or 'list_reply'
        if (interactiveObj.type === "button_reply") {
          const buttonId = interactiveObj.button_reply.id;
          const buttonTitle = interactiveObj.button_reply.title;
          await handleButtonReply(from, buttonId, buttonTitle);
        } else if (interactiveObj.type === "list_reply") {
          const listId = interactiveObj.list_reply.id;
          const listTitle = interactiveObj.list_reply.title;
          console.log(`List reply: ${listId} / ${listTitle}`);
          // Possibly handleListReply(...)
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

  // 1) If user types "language" or "لغة", reset language
  if (lowerText === "language" || lowerText === "لغة") {
    session.isFirstTime = true;
    session.language = null;
    session.state = "WELCOME";
    await sendFirstTimeLanguageMenu(userPhone);
    return;
  }

  // 1) If they're brand new (WELCOME state) and haven't picked a language yet
  if (session.state === "WELCOME") {
    // We can interpret typed text or just tell them "Use the language buttons"
    await sendFirstTimeLanguageMenu(userPhone);
    return;
  }

  // 2) If user typed "menu", "hi", or "hello" => show main or returning flow
  if (["menu", "hi", "hello"].includes(lowerText)) {
    // If they never selected a language, still do the WELCOME flow
    if (session.isFirstTime && !session.language) {
      session.state = "WELCOME";
      await sendFirstTimeLanguageMenu(userPhone);
      return;
    }

    // Otherwise, they're returning
    session.state = "MAIN_MENU";
    await sendReturningWelcome(userPhone);
    return;
  }

  // 3) If user is in ASK_QUANTITY
  if (session.state === "ASK_QUANTITY") {
    const qty = parseInt(textBody, 10);
    if (isNaN(qty) || qty <= 0) {
      await sendTextMessage(
        userPhone,
        "Please enter a valid numeric quantity or type 'menu' to reset."
      );
      return;
    }
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
      { id: "CONTINUE", title: localize("Continue", session.language) },
      { id: "CHECKOUT", title: localize("Checkout", session.language) },
    ];
    await sendInteractiveButtons(userPhone, bodyText, buttons);
    return;
  }

  // 4) If user is in CHECKOUT_NAME
  if (session.state === "CHECKOUT_NAME") {
    session.name = textBody;
    session.state = "CHECKOUT_ADDRESS";
    await sendTextMessage(
      userPhone,
      localize(
        `Thanks, ${session.name}. Please type your delivery address now.`,
        session.language
      )
    );
    return;
  }

  // 5) If user is in CHECKOUT_ADDRESS
  if (session.state === "CHECKOUT_ADDRESS") {
    session.address = textBody;
    session.state = "CHECKOUT_CONFIRM";
    const cartSummary = session.cart
      .map((c) => `${c.quantity} x ${c.name}`)
      .join("\n");
    const confirmMsg = localize(
      `Your order:\n${cartSummary}\nAddress: ${session.address}\nConfirm or cancel?`,
      session.language
    );
    const confirmButtons = [
      { id: "CONFIRM", title: localize("Confirm", session.language) },
      { id: "CANCEL", title: localize("Cancel", session.language) },
    ];
    await sendInteractiveButtons(userPhone, confirmMsg, confirmButtons);
    return;
  }

  // 6) Otherwise fallback
  await sendTextMessage(
    userPhone,
    localize(
      "Please use the buttons. Type 'menu' if you got lost.",
      session.language
    )
  );
}

// ------------------- handleButtonReply (Interactive Buttons) -------------------
async function handleButtonReply(userPhone, buttonId, buttonTitle) {
  console.log(
    `User ${userPhone} tapped button: id=${buttonId}, title=${buttonTitle}`
  );
  const session = getSession(userPhone);

  // 1) If state === "WELCOME" => user is picking a language
  if (session.state === "WELCOME") {
    if (buttonId === "LANG_EN") {
      session.language = "en";
      session.isFirstTime = false;
      session.state = "MAIN_MENU";
      await sendTextMessage(
        userPhone,
        "Hello there! Welcome to Confetti London LY! We’re so excited to have you here..."
      );
      await sendTextMessage(
        userPhone,
        "Let’s make this a delightful shopping experience together!"
      );
      // Next, show main menu in English
      await sendMainMenu(userPhone);
    } else if (buttonId === "LANG_AR") {
      session.language = "ar";
      session.isFirstTime = false;
      session.state = "MAIN_MENU";
      await sendTextMessage(
        userPhone,
        "مرحباً بك! أهلاً وسهلاً في متجر كونفتي لندن! نحن سعداء جداً بوجودك معنا..."
      );
      await sendTextMessage(userPhone, "دعنا نجعل تجربتك معنا ممتعة وفريدة!");
      // Next, show main menu in Arabic
      await sendMainMenu(userPhone);
    } else {
      await sendTextMessage(userPhone, "Please select a language.");
    }
    return;
  }

  switch (session.state) {
    // 2) MAIN_MENU
    case "MAIN_MENU":
      if (buttonId === "ORDER") {
        session.state = "SELECT_GENDER";
        await sendGenderMenu(userPhone);
      } else if (buttonId === "STATUS") {
        session.state = "CHECK_ORDER_STATUS";
        await checkOrderStatus(userPhone);
      } else if (buttonId === "SUPPORT") {
        session.state = "SUPPORT_MENU";
        await sendSupportMenu(userPhone);
      } else {
        await sendTextMessage(
          userPhone,
          localize(
            "Unknown main menu button. Type 'menu' to reset.",
            session.language
          )
        );
      }
      break;

    case "SELECT_GENDER":
      if (buttonId === "MEN" || buttonId === "WOMEN") {
        session.gender = buttonId.toLowerCase(); // "men" or "women"
        session.state = "SELECT_CATEGORY";
        await sendCategoryMenu(userPhone, session.gender);
      } else {
        await sendTextMessage(
          userPhone,
          localize("Pick Men or Women.", session.language)
        );
      }
      break;

    case "SELECT_CATEGORY":
      await handleCategorySelection(userPhone, buttonId, session);
      break;

    case "SHOW_PRODUCTS":
      await handleProductQuickReply(userPhone, buttonId, session);
      break;

    case "CART_DECISION":
      if (buttonId === "CONTINUE") {
        session.state = "SELECT_CATEGORY";
        await sendCategoryMenu(userPhone, session.gender);
      } else if (buttonId === "CHECKOUT") {
        session.state = "CHECKOUT_NAME";
        await sendTextMessage(
          userPhone,
          localize("Please type your full name.", session.language)
        );
      } else {
        await sendTextMessage(
          userPhone,
          localize("Please pick Continue or Checkout.", session.language)
        );
      }
      break;

    case "SUPPORT_MENU":
      if (buttonId === "FAQS") {
        if (session.language === "ar") {
          await sendTextMessage(
            userPhone,
            "FAQs:\n- التوصيل: من 2 إلى 5 أيام\n- الدفع: عند الاستلام\n- الاسترجاع: خلال 7 أيام إذا لم يُفتح المنتج"
          );
        } else {
          await sendTextMessage(
            userPhone,
            "FAQs:\n- Delivery: 2-5 days\n- Payment: Cash on Delivery\n- Refund: 7 days if unopened"
          );
        }
        session.state = "MAIN_MENU";
        await sendMainMenu(userPhone);
      } else if (buttonId === "LIVE_AGENT") {
        if (session.language === "ar") {
          await sendTextMessage(
            userPhone,
            "سيتم تحويلك إلى عميل حي قريباً. (نموذج)"
          );
        } else {
          await sendTextMessage(
            userPhone,
            "A live agent will connect soon. (Placeholder)"
          );
        }
        session.state = "MAIN_MENU";
        await sendMainMenu(userPhone);
      } else {
        await sendTextMessage(
          userPhone,
          localize(
            "Unknown support option. Type 'menu' to reset.",
            session.language
          )
        );
      }
      break;

    case "CHECK_ORDER_STATUS":
      // after checkOrderStatus we set them back to MAIN_MENU inside that function
      break;

    case "CHECKOUT_CONFIRM":
      if (buttonId === "CONFIRM") {
        await finalizeOrder(userPhone);
      } else if (buttonId === "CANCEL") {
        resetSession(userPhone);
        await sendTextMessage(
          userPhone,
          localize(
            "Order canceled. Type 'menu' to start again.",
            session.language
          )
        );
      } else {
        await sendTextMessage(
          userPhone,
          localize("Please confirm or cancel.", session.language)
        );
      }
      break;

    default:
      await sendTextMessage(
        userPhone,
        localize(
          "Not sure how to handle this button. Type 'menu' to reset.",
          session.language
        )
      );
  }
}

// ------------------- WELCOME FLOWS -------------------
async function sendFirstTimeLanguageMenu(userPhone) {
  // Show big greeting with both English + Arabic lines in one text
  let greeting = `Hello there! Welcome to Confetti London LY! We’re so excited to have you here.
Whether you’re looking for your next signature scent or a gift for someone special, we’re here to help you every step of the way.
Please choose your preferred language:
\nمرحباً بك! أهلاً وسهلاً في متجر كونفتي لندن! نحن سعداء جداً بوجودك معنا.
سواء كنت تبحث عن عطرك المميز الجديد أو هدية لشخص مميز، نحن هنا لمساعدتك في كل خطوة.
يرجى اختيار اللغة التي تفضلها:`;

  const buttons = [
    { id: "LANG_EN", title: "English" },
    { id: "LANG_AR", title: "العربية" },
  ];

  await sendInteractiveButtons(userPhone, greeting, buttons);
}

// For returning customers, greet them in the chosen language
async function sendReturningWelcome(userPhone) {
  const session = getSession(userPhone);
  if (session.language === "ar") {
    await sendTextMessage(
      userPhone,
      "مرحباً بعودتك إلى متجر كونفتي لندن! يسعدنا رؤيتك مجدداً. كيف يمكننا مساعدتك اليوم؟"
    );
  } else {
    await sendTextMessage(
      userPhone,
      "Welcome back to Confetti London LY! It’s great to see you again. How can we assist you today?"
    );
  }
  // Then show main menu in the chosen language
  await sendMainMenu(userPhone);
}

// ------------------- MAIN MENU: localize the text -------------------
async function sendMainMenu(userPhone) {
  const session = getSession(userPhone);

  // If they never chose a language, do first-time flow
  if (session.isFirstTime && !session.language) {
    session.state = "WELCOME";
    await sendFirstTimeLanguageMenu(userPhone);
    return;
  }

  // Otherwise we adapt the main menu lines to the chosen language
  let bodyText = "";
  if (session.language === "ar") {
    bodyText = "كيف يمكننا مساعدتك اليوم؟ يرجى اختيار إحدى الخيارات التالية:";
  } else {
    bodyText =
      "How can we assist you today? Please choose one of the following options:";
  }

  // We'll localize button titles
  const buttons = [
    {
      id: "ORDER",
      title: session.language === "ar" ? "إنشاء طلب جديد" : "Make a New Order",
    },
    {
      id: "STATUS",
      title:
        session.language === "ar"
          ? "التحقق من حالة الطلب"
          : "Check Order Status",
    },
    {
      id: "SUPPORT",
      title: session.language === "ar" ? "الدعم الفني" : "Support",
    },
  ];
  await sendInteractiveButtons(userPhone, bodyText, buttons);
  // We stay in MAIN_MENU state
  session.state = "MAIN_MENU";
}

// ------------------- FLOW HELPERS -------------------
async function handleCategorySelection(userPhone, category, session) {
  const validCats = ["perfumes", "deodorants", "body sprays"];
  if (!validCats.includes(category)) {
    await sendTextMessage(
      userPhone,
      localize(
        "Please pick 'perfumes', 'deodorants', or 'body sprays'.",
        session.language
      )
    );
    return;
  }
  session.category = category;
  session.state = "SHOW_PRODUCTS";

  const products = PRODUCT_DATA[session.gender][category];
  let textMsg = `${category}:\n`;
  products.forEach((p) => {
    textMsg += `ID ${p.id}: ${p.name} ($${p.price})\n`;
  });
  textMsg +=
    session.language === "ar"
      ? "اختر منتجاً من الأزرار أدناه أو اكتب رقم المنتج."
      : "Pick a product from the first 3 below or type the ID if not there.";

  // Up to 3 quick replies
  const firstThree = products.slice(0, 3).map((p) => ({
    id: String(p.id),
    title: p.name,
  }));

  await sendTextMessage(userPhone, textMsg);
  await sendInteractiveButtons(
    userPhone,
    localize("Choose a product:", session.language),
    firstThree
  );
}

async function handleProductQuickReply(userPhone, buttonId, session) {
  const productId = parseInt(buttonId, 10);
  if (isNaN(productId)) {
    await sendTextMessage(
      userPhone,
      localize("Invalid product ID from button.", session.language)
    );
    return;
  }
  const product = findProductById(session.gender, session.category, productId);
  if (!product) {
    await sendTextMessage(
      userPhone,
      localize(
        "Product not found. Try again or type 'menu' to reset.",
        session.language
      )
    );
    return;
  }
  // ask quantity
  session.currentProduct = product;
  session.state = "ASK_QUANTITY";
  const askQty =
    session.language === "ar"
      ? `كمية ${product.name} التي تريد طلبها؟ (أدخل رقماً)`
      : `How many of ${product.name} would you like? (Type a number)`;
  await sendTextMessage(userPhone, askQty);
}

async function checkOrderStatus(userPhone) {
  const session = getSession(userPhone);
  const existing = orders[userPhone];
  if (!existing) {
    if (session.language === "ar") {
      await sendTextMessage(
        userPhone,
        "لم يتم العثور على أي طلب لهذا الرقم. اكتب 'menu' لعمل طلب جديد."
      );
    } else {
      await sendTextMessage(
        userPhone,
        "No order found for your number. Type 'menu' to order."
      );
    }
    session.state = "MAIN_MENU";
    await sendMainMenu(userPhone);
  } else {
    if (session.language === "ar") {
      await sendTextMessage(
        userPhone,
        `طلبك (${existing.orderId}) حالياً في حالة: ${existing.status}.\nاكتب 'menu' للعودة.`
      );
    } else {
      await sendTextMessage(
        userPhone,
        `Your order (${existing.orderId}) status is: ${existing.status}.\nType 'menu' to go back.`
      );
    }
    session.state = "MAIN_MENU";
    await sendMainMenu(userPhone);
  }
}

async function sendGenderMenu(userPhone) {
  const session = getSession(userPhone);
  let bodyText = "";
  if (session.language === "ar") {
    bodyText = "هل تريد منتجات رجالية أم نسائية؟";
  } else {
    bodyText = "Men or Women products?";
  }
  const buttons = [
    { id: "MEN", title: session.language === "ar" ? "رجالية" : "Men" },
    { id: "WOMEN", title: session.language === "ar" ? "نسائية" : "Women" },
  ];
  await sendInteractiveButtons(userPhone, bodyText, buttons);
}

async function sendSupportMenu(userPhone) {
  const session = getSession(userPhone);
  if (session.language === "ar") {
    const bodyText = "كيف نساعدك؟ اختر إحدى الخيارات:";
    const buttons = [
      { id: "FAQS", title: "الأسئلة الشائعة" },
      { id: "LIVE_AGENT", title: "التواصل مع موظف" },
    ];
    await sendInteractiveButtons(userPhone, bodyText, buttons);
  } else {
    const bodyText = "Need help? Pick an option:";
    const buttons = [
      { id: "FAQS", title: "FAQs" },
      { id: "LIVE_AGENT", title: "Live Agent" },
    ];
    await sendInteractiveButtons(userPhone, bodyText, buttons);
  }
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

  if (session.language === "ar") {
    await sendTextMessage(
      userPhone,
      `شكراً لك! تم إنشاء طلبك (${orderId}). سنتواصل معك قريباً.`
    );
  } else {
    await sendTextMessage(
      userPhone,
      `Thank you! Your order (${orderId}) is placed.\nWe will contact you soon.`
    );
  }
  resetSession(userPhone);
}

// ------------------- UTILS -------------------
function localize(textEn, lang) {
  // If you want more advanced translations, expand this logic
  if (!lang || lang === "en") return textEn;
  // fallback: english for partial texts
  return textEn;
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
    "WhatsApp Interactive Chatbot with Welcome & Language Flow is running. Use /webhook for inbound calls."
  );
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
