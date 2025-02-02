/***************************************************
 * chatbotService.js
 * Service that handles the core chatbot logic, processing incoming messages
 * (text, button replies, list replies) and managing state transitions.
 ***************************************************/

import {
  sendTextMessage,
  sendInteractiveButtons,
  sendListMessage,
} from "./messageService.js";
import { getSession, resetSession, orders } from "./sessionService.js";
import { localize } from "../utils/localize.js";
import { generateOrderId } from "../utils/generateOrderId.js";
import { sendTicketTopicsList, finalizeTicket } from "./supportService.js";
import {
  sendMainMenu,
  sendFirstTimeLanguageMenu,
  sendReturningWelcome,
  sendCategoryMenu,
  sendSupportMainMenu,
  sendFAQList,
} from "./menuService.js";
import { getFaqContent } from "../utils/faq.js";

/**
 * Main entry point to handle an incoming message.
 * Delegates processing based on message type.
 * @param {object} msg - The incoming message object.
 */
export const handleIncomingMessage = async (msg) => {
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
      console.log("Received interactive of another type:", interactiveObj.type);
    }
  } else {
    console.log("Unsupported message type:", msg.type);
  }
};

/**
 * Processes text messages based on the current session state.
 * @param {object} session - The current user session.
 * @param {string} userPhone - The user's phone number.
 * @param {string} textBody - The text of the message.
 */
const handleTextMessage = async (session, userPhone, textBody) => {
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
    await sendTicketTopicsList(userPhone, session.language);
    return;
  }
  if (session.state === "TICKET_DESC") {
    session.ticketDesc = textBody;
    await finalizeTicket(userPhone, session);
    return;
  }

  // ORDER flow: Handling quantity input
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

  // Checkout flow: Asking for name and address
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

  // Fallback: prompt user to use buttons
  await sendTextMessage(
    userPhone,
    localize(
      "Please use the buttons. Type 'menu' if you got lost.",
      session.language
    )
  );
};

/**
 * Processes button reply messages.
 * @param {object} session - The current user session.
 * @param {string} userPhone - The user's phone number.
 * @param {string} buttonId - The identifier of the button pressed.
 */
const handleButtonReply = async (session, userPhone, buttonId) => {
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
        await sendGenderMenu(userPhone, session);
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
        await sendCategoryMenu(userPhone, session);
      } else {
        await sendTextMessage(
          userPhone,
          localize("Pick Men or Women.", session.language)
        );
      }
      break;

    case "SHOW_PRODUCTS":
      // User tapped a product ID
      await handleProductQuickReply(session, userPhone, buttonId);
      break;

    case "CART_DECISION":
      if (buttonId === "CONTINUE") {
        session.state = "SELECT_CATEGORY";
        await sendCategoryMenu(userPhone, session);
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
      console.log("default in button handler, state:", session.state);
  }
};

/**
 * Processes list reply messages.
 * @param {object} session - The current user session.
 * @param {string} userPhone - The user's phone number.
 * @param {string} listId - The identifier of the selected list item.
 */
const handleListReply = async (session, userPhone, listId) => {
  console.log(`List selected: ${listId}, state=${session.state}`);

  if (session.state === "FAQ_LIST") {
    const text = getFaqContent(listId, session.language);
    await sendTextMessage(userPhone, text);
    session.state = "MAIN_MENU";
    await sendMainMenu(userPhone);
  } else if (session.state === "TICKET_TOPIC") {
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
};

/**
 * Finalizes the order by generating an order ID, saving the order, and sending a confirmation.
 * @param {string} userPhone - The user's phone number.
 * @param {object} session - The current user session.
 */
const finalizeOrder = async (userPhone, session) => {
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
};

/**
 * Placeholder: Sends a gender selection menu.
 * @param {string} userPhone - The user's phone number.
 * @param {object} session - The current user session.
 */
const sendGenderMenu = async (userPhone, session) => {
  const bodyText = session.language === "ar" ? "اختر نوع:" : "Select gender:";
  const buttons = [
    { id: "MEN", title: session.language === "ar" ? "رجالي" : "Men" },
    { id: "WOMEN", title: session.language === "ar" ? "نسائي" : "Women" },
  ];
  await sendInteractiveButtons(userPhone, bodyText, buttons);
};

/**
 * Placeholder: Handles product quick reply.
 * @param {object} session - The current user session.
 * @param {string} userPhone - The user's phone number.
 * @param {string} buttonId - The identifier of the selected product.
 */
const handleProductQuickReply = async (session, userPhone, buttonId) => {
  await sendTextMessage(userPhone, `You selected product ${buttonId}.`);
};

/**
 * Placeholder: Checks and sends the current order status.
 * @param {string} userPhone - The user's phone number.
 * @param {object} session - The current user session.
 */
const checkOrderStatus = async (userPhone, session) => {
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
};

export { handleTextMessage, handleButtonReply, handleListReply };
