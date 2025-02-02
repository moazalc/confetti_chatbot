/*************************************************************
 * server.js
 *
 * This single-file version contains the entire chatbot logic:
 *  1) First/Returning user welcome & language selection
 *  2) Main menu (New Order, Check Status, Support)
 *  3) Ordering flow -> men/women -> category -> product -> checkout
 *  4) Check Order Status (in-memory)
 *  5) Support flow -> FAQs (list message), Submit Ticket, Live Agent
 *  6) Multi-step typed flow for the ticket (Name, Order number, Topic, Desc)
 *
 * This is the "original" large single-file approach,
 * retaining all functionality in one place.
 *************************************************************/

import express from "express";
import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

/** Environment variables */
const PORT = process.env.PORT || 3000;
const WEBHOOK_VERIFY_TOKEN =
  process.env.WEBHOOK_VERIFY_TOKEN || "my_secret_token";
const GRAPH_API_TOKEN = process.env.GRAPH_API_TOKEN || "";
const BUSINESS_PHONE_NUMBER_ID = process.env.BUSINESS_PHONE_NUMBER_ID || "";

/** Express setup */
const app = express();
app.use(express.json());

// OPTIONAL: basic signature verification if you want
// import crypto from "crypto";
// function verifySignature(req, res, buf) {
//   const appSecret = process.env.APP_SECRET || "";
//   const signature = req.headers["x-hub-signature-256"];
//   if (!signature || !appSecret) {
//     return;
//   }
//   const elements = signature.split("=");
//   const signatureHash = elements[1];

//   const expectedHash = crypto
//     .createHmac("sha256", appSecret)
//     .update(buf)
//     .digest("hex");

//   if (signatureHash !== expectedHash) {
//     throw new Error("Invalid signature");
//   }
// }
// app.use(
//   express.json({
//     verify: (req, res, buf) => {
//       verifySignature(req, res, buf);
//     },
//   })
// );

/** In-memory store for user sessions & orders */
const sessions = {};
const orders = {};

/** GET or create session for a phone */
function getSession(phone) {
  if (!sessions[phone]) {
    sessions[phone] = {
      isFirstTime: true,
      language: null,
      state: "WELCOME",
      gender: null,
      category: null,
      cart: [],
      name: null,
      address: null,
      currentProduct: null,
      // ticket fields
      ticketName: null,
      ticketOrderNum: null,
      ticketTopic: null,
      ticketDesc: null,
    };
  }
  return sessions[phone];
}

function resetSession(phone) {
  sessions[phone] = {
    isFirstTime: false,
    language: null,
    state: "WELCOME",
    gender: null,
    category: null,
    cart: [],
    name: null,
    address: null,
    currentProduct: null,
    ticketName: null,
    ticketOrderNum: null,
    ticketTopic: null,
    ticketDesc: null,
  };
}

/** Helper: localize fallback */
function localize(textEn, lang) {
  if (lang !== "ar") return textEn;
  // For brevity, return the English. Real code could do Arabic.
  return textEn;
}

/** Simple random order ID or use a library for UUID */
import { v4 as uuidv4 } from "uuid";
function generateOrderId() {
  return "P" + uuidv4().slice(0, 8).toUpperCase();
}

/** WhatsApp senders: text, button, list */
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
  try {
    const url = `https://graph.facebook.com/v16.0/${BUSINESS_PHONE_NUMBER_ID}/messages`;
    const payload = {
      messaging_product: "whatsapp",
      to,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: bodyText },
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

async function sendListMessage(
  to,
  headerText,
  bodyText,
  footerText,
  buttonText,
  rows
) {
  // for more than 3 items, we must use a list
  try {
    const url = `https://graph.facebook.com/v16.0/${BUSINESS_PHONE_NUMBER_ID}/messages`;
    const payload = {
      messaging_product: "whatsapp",
      to,
      type: "interactive",
      interactive: {
        type: "list",
        header: {
          type: "text",
          text: headerText,
        },
        body: {
          text: bodyText,
        },
        footer: {
          text: footerText,
        },
        action: {
          button: buttonText,
          sections: [
            {
              title: "Categories",
              rows,
            },
          ],
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
    console.error("sendListMessage error:", err?.response?.data || err);
  }
}

/** FAQ text in English or Arabic, store in dictionaries */
const FAQS_EN = {
  faq_general: `General Questions:\n
1.	What types of perfumes do you sell?
We offer a wide range of perfumes, deodorants, body sprays, and exclusive collections for men and women.
\n
2.	Are your products authentic?
Yes, all our products are 100% authentic and sourced directly from trusted suppliers.
\n
3.	Do you offer tester perfumes?
No, we do not provide testers for select fragrances.
\n
(If you need further assistance, type 'Support')`,
  faq_payments: `Payment Questions: \n
  1.	What payment methods do you accept?
We only accept cash on delivery (COD). You will pay the delivery agent when you receive your order.
\n
2.	Can I pay online?
At the moment, we only accept cash payments upon delivery. Online payment options are not available.
\n
3.	Are there any additional charges for cash on delivery?
No, there are no extra charges for using cash on delivery unless specified otherwise for your region.
\n
(If you need further assistance, type 'Support')`,
  faq_shipping: `Shipping & Delivery Questions: \n
  1.	Where do you deliver?
We currently deliver within Libya. Check our delivery policy for more details.
\n
2.	How long does delivery take?
Delivery typically takes 3 days depending on your location. We will update you with tracking details once your order is shipped.
\n
3.	Can I choose a specific delivery time?
We’ll try our best to accommodate your preferred delivery time. Please mention it when placing your order.
\n
4.	What happens if I’m not available to receive my order?
If you’re unavailable, the delivery agent will contact you to reschedule the delivery.
\n
(If you need further assistance, type 'Support')`,
  faq_orders: `Ordering Questions: \n
  1.	How do I place an order?
You can place an order through our WhatsApp Chatbot.
\n
2.	Can I cancel or modify my order after placing it?
Yes, you can cancel or modify your order before it is shipped. Contact us immediately if you need assistance.
\n
3.	Is there a minimum order value?
No, there is no minimum order value. You can purchase any item regardless of the price.
\n

(If you need further assistance, type 'Support')`,
  faq_products: `Products & Returns: \n
  1.	Do you offer returns or exchanges?
Returns or exchanges are accepted for damaged or incorrect items only. Please contact us within 2 days of receiving your order.
\n
2.	What should I do if I receive a damaged item?
If your order arrives damaged, contact us immediately with photos of the item and packaging for a resolution.
\n
3.	Can I request a gift wrap for my order?
Yes, we offer gift-wrapping services for an additional fee. Let us know when you place your order.
\n
4.	Do you have seasonal or special offers?
Yes, we frequently offer discounts and promotions. Keep an eye on our website or subscribe to our newsletter for updates.
\n

(If you need further assistance, type 'Support')`,
};
const FAQS_AR = {
  faq_general: `الأسئلة العامة:\n
  1.	ما هي أنواع العطور التي تبيعونها؟
نحن نقدم مجموعة واسعة من العطور، ومزيلات العرق، ورشاشات الجسم، والمجموعات الحصرية للرجال والنساء.
\n
2.	هل منتجاتكم أصلية؟
نعم، جميع منتجاتنا أصلية 100% ويتم الحصول عليها مباشرة من الموردين الموثوق بهم.
\n
3.	هل توفرون عطوراً تجريبية؟
لا، لا نوفر عينات تجريبية لبعض العطور.
\n

إذا كنت بحاجة إلى مزيد من المساعدة، يرجى كتابة 'الدعم'`,
  faq_payments: `الدفع: \n
  1.	ما هي طرق الدفع التي تقبلونها؟
نحن نقبل الدفع النقدي عند التسليم فقط. ستقوم بالدفع لمندوب التوصيل عند استلام الطلب.
\n
2.	هل يمكنني الدفع عبر الإنترنت؟
في الوقت الحالي، نقبل الدفع النقدي فقط عند التسليم. خيارات الدفع عبر الإنترنت غير متوفرة.
\n
3.	هل توجد رسوم إضافية للدفع النقدي عند التسليم؟
لا، لا توجد رسوم إضافية على الدفع النقدي عند التسليم ما لم يتم تحديد خلاف ذلك لمنطقتك.
\n

إذا كنت بحاجة إلى مزيد من المساعدة، يرجى كتابة 'الدعم'`,
  faq_shipping: `الشحن والتوصيل: \n
  1.	أين يتم التوصيل؟
نقوم حالياً بالتوصيل داخل ليبيا. تحقق من سياسة التوصيل لدينا للحصول على مزيد من التفاصيل.
\n
2.	كم يستغرق التوصيل؟
يستغرق التوصيل عادةً 3 أيام حسب موقعك. سنقوم بتحديثك بتفاصيل التتبع بمجرد شحن طلبك.
\n
3.	هل يمكنني اختيار وقت توصيل محدد؟
سنحاول قصارى جهدنا لتلبية وقت التوصيل المفضل لديك. يرجى ذكر ذلك عند تقديم الطلب.
\n
4.	ماذا يحدث إذا لم أكن متوفراً لاستلام طلبي؟
إذا لم تكن متوفراً، سيتواصل معك مندوب التوصيل لإعادة جدولة التسليم.
\n
إذا كنت بحاجة إلى مزيد من المساعدة، يرجى كتابة 'الدعم'`,

  faq_orders: `الطلبات: \n
  1.	كيف يمكنني تقديم طلب؟
يمكنك تقديم طلبك من خلال روبوت الدردشة الخاص بنا على واتساب.
\n
2.	هل يمكنني إلغاء أو تعديل طلبي بعد تقديمه؟
نعم، يمكنك إلغاء أو تعديل طلبك قبل شحنه. تواصل معنا فوراً إذا كنت بحاجة إلى مساعدة.
\n
3.	هل هناك حد أدنى لقيمة الطلب؟
لا، لا يوجد حد أدنى لقيمة الطلب. يمكنك شراء أي منتج بغض النظر عن السعر.
\n

إذا كنت بحاجة إلى مزيد من المساعدة، يرجى كتابة 'الدعم'`,
  faq_products: `المنتجات والإرجاع: \n
  1.	هل توفرون خدمات إرجاع أو استبدال؟
نقبل الإرجاع أو الاستبدال فقط للمنتجات التالفة أو الخاطئة. يرجى التواصل معنا خلال يومين من استلام الطلب.
\n
2.	ماذا أفعل إذا استلمت منتجاً تالفاً؟
إذا وصل طلبك تالفاً، تواصل معنا فوراً مع صور للمنتج والتغليف لحل المشكلة.
\n
3.	هل يمكنني طلب تغليف هدية لطلبي؟
نعم، نوفر خدمات تغليف الهدايا مقابل رسوم إضافية. يرجى إبلاغنا عند تقديم الطلب.
\n
4.	هل لديكم عروض أو تخفيضات موسمية؟
نعم، نقدم عروضاً وخصومات بشكل متكرر. تابع موقعنا أو اشترك في النشرة البريدية للحصول على التحديثات.
\n

إذا كنت بحاجة إلى مزيد من المساعدة، يرجى كتابة 'الدعم'`,
};

/** Provide the text for the selected FAQ category. */
function getFaqContent(categoryId, lang) {
  if (lang === "ar") {
    return FAQS_AR[categoryId] || "لا توجد معلومات.";
  } else {
    return FAQS_EN[categoryId] || "No info found for this category.";
  }
}

/**
 * GET /webhook => verification
 */
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === WEBHOOK_VERIFY_TOKEN) {
    console.log("Webhook verified successfully!");
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

/**
 * POST /webhook => incoming messages
 */
app.post("/webhook", async (req, res) => {
  console.log("Incoming webhook data:", JSON.stringify(req.body, null, 2));

  const changes = req.body.entry?.[0]?.changes?.[0];
  if (!changes) {
    return res.sendStatus(200);
  }

  const messages = changes.value?.messages;
  if (messages) {
    for (const msg of messages) {
      const from = msg.from;
      const session = getSession(from);

      if (msg.type === "text") {
        await handleTextMessage(session, from, msg.text.body);
      } else if (msg.type === "interactive") {
        const interactiveObj = msg.interactive;
        if (interactiveObj.type === "button_reply") {
          const buttonId = interactiveObj.button_reply.id;
          await handleButtonReply(session, from, buttonId);
        } else if (interactiveObj.type === "list_reply") {
          const listId = interactiveObj.list_reply.id;
          await handleListReply(session, from, listId);
        } else {
          console.log(
            "Received interactive of another type:",
            interactiveObj.type
          );
        }
      } else {
        console.log("Unsupported message type:", msg.type);
      }
    }
  }

  return res.sendStatus(200);
});

/** handle text messages (like typed "menu", or in the ticket flow, etc.) */
async function handleTextMessage(session, userPhone, textBody) {
  const lowerText = textBody.trim().toLowerCase();

  if (lowerText === "language" || lowerText === "لغة") {
    session.isFirstTime = true;
    session.language = null;
    session.state = "WELCOME";
    await sendFirstTimeLanguageMenu(userPhone);
    return;
  }

  if (session.state === "WELCOME") {
    await sendFirstTimeLanguageMenu(userPhone);
    return;
  }

  if (["menu", "hi", "hello", "القائمة الرئيسية"].includes(lowerText)) {
    if (session.isFirstTime && !session.language) {
      session.state = "WELCOME";
      await sendFirstTimeLanguageMenu(userPhone);
    } else {
      session.state = "MAIN_MENU";
      await sendReturningWelcome(userPhone);
    }
    return;
  }

  // TICKET flow
  if (session.state === "TICKET_NAME") {
    session.ticketName = textBody;
    session.state = "TICKET_ORDERNUM";
    if (session.language === "ar") {
      await sendTextMessage(
        userPhone,
        "يرجى إدخال رقم الطلب الخاص بك للمتابعة."
      );
    } else {
      await sendTextMessage(
        userPhone,
        "Please enter your order number to proceed or type 'none' if you do not have an order.."
      );
    }
    return;
  }
  if (session.state === "TICKET_ORDERNUM") {
    if (lowerText !== "none") {
      session.ticketOrderNum = textBody;
    }
    session.state = "TICKET_TOPIC";
    // show 4 topics as a list or quick replies
    await sendTicketTopicsList(userPhone, session.language);
    return;
  }
  if (session.state === "TICKET_DESC") {
    session.ticketDesc = textBody;
    // finalize
    await finalizeTicket(userPhone, session);
    return;
  }

  // ORDER: if state === "ASK_QUANTITY"
  if (session.state === "ASK_QUANTITY") {
    const qty = parseInt(textBody, 10);
    if (isNaN(qty) || qty <= 0) {
      await sendTextMessage(
        userPhone,
        "Please enter a valid numeric quantity or type 'menu'."
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

  // If in CHECKOUT_NAME or CHECKOUT_ADDRESS
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

  // fallback
  await sendTextMessage(
    userPhone,
    localize(
      "Please use the buttons. Type 'menu' if you got lost.",
      session.language
    )
  );
}

/** handle button replies */
async function handleButtonReply(session, userPhone, buttonId) {
  console.log(`Button pressed: ${buttonId}, state=${session.state}`);

  if (session.state === "WELCOME") {
    if (buttonId === "LANG_EN") {
      session.language = "en";
      session.isFirstTime = false;
      session.state = "MAIN_MENU";
      await sendTextMessage(
        userPhone,
        "Hello there! Welcome to Confetti London LY!"
      );
      await sendTextMessage(
        userPhone,
        "Let’s make this a delightful shopping experience together!"
      );
      await sendMainMenu(userPhone);
    } else if (buttonId === "LANG_AR") {
      session.language = "ar";
      session.isFirstTime = false;
      session.state = "MAIN_MENU";
      await sendTextMessage(userPhone, "مرحباً بك في متجر كونفتي لندن!");
      await sendTextMessage(userPhone, "دعنا نجعل تجربتك معنا ممتعة!");
      await sendMainMenu(userPhone);
    } else {
      await sendTextMessage(userPhone, "Please select a language.");
    }
    return;
  }

  switch (session.state) {
    case "MAIN_MENU":
      if (buttonId === "ORDER") {
        session.state = "SELECT_GENDER";
        await sendGenderMenu(userPhone);
      } else if (buttonId === "STATUS") {
        session.state = "CHECK_ORDER_STATUS";
        await checkOrderStatus(userPhone, session);
      } else if (buttonId === "SUPPORT") {
        session.state = "SUPPORT_MENU";
        await sendSupportMainMenu(userPhone, session.language);
      } else {
        await sendTextMessage(
          userPhone,
          localize("Unknown main menu button. Type 'menu'.", session.language)
        );
      }
      break;

    case "SUPPORT_MENU":
      if (buttonId === "FAQS") {
        session.state = "FAQ_LIST";
        await sendFAQList(userPhone, session.language);
      } else if (buttonId === "SUBMIT_TICKET") {
        session.state = "TICKET_NAME";
        if (session.language === "ar") {
          await sendTextMessage(userPhone, "يرجى كتابة اسمك الكامل للمتابعة.");
        } else {
          await sendTextMessage(userPhone, "Please provide your full name.");
        }
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
          localize("Unknown support option. Type 'menu'.", session.language)
        );
      }
      break;

    case "SELECT_GENDER":
      if (buttonId === "MEN" || buttonId === "WOMEN") {
        session.gender = buttonId.toLowerCase();
        session.state = "SELECT_CATEGORY";
        await sendCategoryMenu(userPhone, session.gender, session.language);
      } else {
        await sendTextMessage(
          userPhone,
          localize("Pick Men or Women.", session.language)
        );
      }
      break;

    case "SHOW_PRODUCTS":
      // user tapped a product ID
      await handleProductQuickReply(session, userPhone, buttonId);
      break;

    case "CART_DECISION":
      if (buttonId === "CONTINUE") {
        session.state = "SELECT_CATEGORY";
        await sendCategoryMenu(userPhone, session.gender, session.language);
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

    case "CHECKOUT_CONFIRM":
      if (buttonId === "CONFIRM") {
        await finalizeOrder(userPhone, session);
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
      // If state is TICKET flow, e.g. topic
      // or fallback
      console.log("default in button handler, state:", session.state);
  }
}

/** handle list replies => FAQ categories or ticket topics */
async function handleListReply(session, userPhone, listId) {
  console.log(`List selected: ${listId}, state=${session.state}`);

  // If user is picking FAQ category
  if (session.state === "FAQ_LIST") {
    const text = getFaqContent(listId, session.language);
    await sendTextMessage(userPhone, text);
    session.state = "MAIN_MENU";
    await sendMainMenu(userPhone);
  } else if (session.state === "TICKET_TOPIC") {
    // user picking ticket topic
    session.ticketTopic = listId;
    session.state = "TICKET_DESC";
    if (session.language === "ar") {
      await sendTextMessage(userPhone, "يرجى كتابة وصف موجز لطلبك للمتابعة.");
    } else {
      await sendTextMessage(
        userPhone,
        "Please provide a brief description of your request."
      );
    }
  } else {
    await sendTextMessage(
      userPhone,
      localize(
        "Not sure how to handle this list choice. Type 'menu' to reset.",
        session.language
      )
    );
  }
}

/** ============ Flow & UI Functions ============ */

/** For first-time user: show language buttons */
async function sendFirstTimeLanguageMenu(userPhone) {
  let greeting = `Hello there! Welcome to Confetti London LY! We’re so excited to have you here.
Whether you’re looking for your next signature scent or a gift for someone special, 
we’re here to help you every step of the way.
Please choose your preferred language:

مرحباً بك! أهلاً وسهلاً في متجر كونفتي لندن! نحن سعداء جداً بوجودك معنا.
سواء كنت تبحث عن عطرك المميز الجديد أو هدية لشخص مميز، نحن هنا لمساعدتك في كل خطوة.
يرجى اختيار اللغة التي تفضلها:`;

  const buttons = [
    { id: "LANG_EN", title: "English" },
    { id: "LANG_AR", title: "العربية" },
  ];

  await sendInteractiveButtons(userPhone, greeting, buttons);
}

/** for returning user */
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
  await sendMainMenu(userPhone);
}

/** main menu: 3 buttons => ORDER, STATUS, SUPPORT */
async function sendMainMenu(userPhone) {
  const session = getSession(userPhone);
  if (session.isFirstTime && !session.language) {
    session.state = "WELCOME";
    await sendFirstTimeLanguageMenu(userPhone);
    return;
  }
  let bodyText =
    session.language === "ar"
      ? "كيف يمكننا مساعدتك اليوم؟ يرجى اختيار إحدى الخيارات التالية:"
      : "How can we assist you today? Please choose one of the following options:";

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
  session.state = "MAIN_MENU";
}

/** after user picks men/women => show categories as 3 quick replies or typed ID */
async function sendCategoryMenu(userPhone, gender, lang) {
  const categories = ["perfumes", "deodorants", "body sprays"];
  let bodyText =
    lang === "ar"
      ? `اختر تصنيف للمنتجات ${gender === "men" ? "رجالية" : "نسائية"}:`
      : `Choose a category for ${gender}:`;

  const buttons = categories.map((cat) => ({ id: cat, title: cat }));
  await sendInteractiveButtons(userPhone, bodyText, buttons);
}

/** user picks category => we show up to 3 items as quick replies, or typed ID for more.
 * Then user picks item => we ask quantity.
 */

/** support main menu => 3 buttons (FAQS, SUBMIT_TICKET, LIVE_AGENT) */
async function sendSupportMainMenu(userPhone, lang) {
  let text =
    lang === "ar"
      ? "مرحباً بك في قسم الدعم الخاص بـ متجر كونفتي لندن! كيف يمكننا مساعدتك اليوم؟ يرجى اختيار إحدى الخيارات التالية:"
      : "Welcome to the support section of Confetti London LY! How can we assist you today? Please choose one of the following options:";
  const buttons = [
    { id: "FAQS", title: lang === "ar" ? "الأسئلة الشائعة" : "FAQs" },
    {
      id: "SUBMIT_TICKET",
      title: lang === "ar" ? "إرسال تذكرة" : "Submit a Ticket",
    },
    {
      id: "LIVE_AGENT",
      title: lang === "ar" ? "التحدث مع ممثل" : "Live Agent",
    },
  ];
  await sendInteractiveButtons(userPhone, text, buttons);
}

/** show a list of 5 FAQ categories */
async function sendFAQList(userPhone, lang) {
  let header =
    lang === "ar"
      ? "إليك بعض الأسئلة الشائعة"
      : "Here are some frequently asked questions";
  let body =
    lang === "ar" ? "يرجى اختيار فئة" : "Please select a category below";
  let footer = lang === "ar" ? "انقر للعرض" : "Tap to view";
  let button = lang === "ar" ? "عرض" : "View";

  const rows = [
    {
      id: "faq_general",
      title: lang === "ar" ? "الأسئلة العامة" : "General Questions",
    },
    { id: "faq_payments", title: lang === "ar" ? "الدفع" : "Payments" },
    {
      id: "faq_shipping",
      title: lang === "ar" ? "الشحن والتوصيل" : "Shipping & Delivery",
    },
    { id: "faq_orders", title: lang === "ar" ? "الطلبات" : "Orders" },
    {
      id: "faq_products",
      title: lang === "ar" ? "المنتجات والإرجاع" : "Products & Returns",
    },
  ];

  await sendListMessage(userPhone, header, body, footer, button, rows);
}

/** user picks from that list => see handleListReply => we show the relevant text from getFaqContent(...) */

/** handleListReply => if state=FAQ_LIST => show FAQ text. Then go back to main menu */
async function finalizeOrder(userPhone, session) {
  const orderId = generateOrderId();
  orders[userPhone] = {
    orderId,
    status: "Placed",
    cart: session.cart,
    name: session.name,
    address: session.address,
  };
  if (session.language === "ar") {
    await sendTextMessage(userPhone, `شكراً! تم إنشاء طلبك (${orderId}).`);
  } else {
    await sendTextMessage(
      userPhone,
      `Thank you! Your order (${orderId}) is placed.`
    );
  }
  resetSession(userPhone);
}

/** check order status => if there's an order in memory */
async function checkOrderStatus(userPhone, session) {
  const existing = orders[userPhone];
  if (!existing) {
    if (session.language === "ar") {
      await sendTextMessage(
        userPhone,
        "لم يتم العثور على طلب لهذا الرقم. اكتب 'menu' للعودة."
      );
    } else {
      await sendTextMessage(
        userPhone,
        "No order found for your phone. Type 'menu' to return."
      );
    }
    session.state = "MAIN_MENU";
    return;
  } else {
    if (session.language === "ar") {
      await sendTextMessage(
        userPhone,
        `طلبك (${existing.orderId}) حالياً في حالة: ${existing.status}. اكتب 'menu' للعودة.`
      );
    } else {
      await sendTextMessage(
        userPhone,
        `Your order (${existing.orderId}) is: ${existing.status}. Type 'menu' to return.`
      );
    }
    session.state = "MAIN_MENU";
  }
}

/** TICKET flow: after we get name, order #, topic => we do final step */
async function sendTicketTopicsList(userPhone, lang) {
  let header = lang === "ar" ? "اختر موضوعاً" : "Choose a topic";
  let body =
    lang === "ar" ? "يرجى اختيار أحد المواضيع" : "Please select a topic below";
  let footer = lang === "ar" ? "انقر للعرض" : "Tap to view";
  let button = lang === "ar" ? "عرض" : "View";

  const rows = [
    {
      id: "0_Orders_and_payments",
      title: lang === "ar" ? "الطلبات والدفع" : "Orders and payments",
    },
    { id: "1_Delivery", title: lang === "ar" ? "التوصيل" : "Delivery" },
    { id: "2_Returns", title: lang === "ar" ? "الإرجاع" : "Returns" },
    { id: "3_Other", title: lang === "ar" ? "أخرى" : "Other" },
  ];

  await sendListMessage(userPhone, header, body, footer, button, rows);
}

async function finalizeTicket(userPhone, session) {
  const ticketData = {
    name: session.ticketName,
    orderNumber: session.ticketOrderNum,
    topic: session.ticketTopic,
    description: session.ticketDesc,
  };
  console.log("Ticket from user:", userPhone, ticketData);

  if (session.language === "ar") {
    await sendTextMessage(
      userPhone,
      "شكرًا! تم إرسال التذكرة بنجاح. سنرد قريبًا. اكتب 'القائمة الرئيسية' للعودة."
    );
  } else {
    await sendTextMessage(
      userPhone,
      "Thank you! Your ticket is submitted. We'll respond soon. Type 'menu' to go back to the main menu."
    );
  }

  session.ticketName = null;
  session.ticketOrderNum = null;
  session.ticketTopic = null;
  session.ticketDesc = null;
  session.state = "MAIN_MENU";
}

/** Start the server */
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
