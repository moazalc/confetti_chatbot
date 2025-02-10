/***************************************************
 * chatbotService.js
 * Service that handles the core chatbot logic, processing incoming messages
 * (text, button replies, list replies) and managing state transitions.
 ***************************************************/
/***************************************************
 * chatbotService.js
 * Service that handles the core chatbot logic, processing incoming messages
 * (text, button replies, list replies) and managing state transitions.
 ***************************************************/

import pool from "../db.js";
import {
  sendTextMessage,
  sendInteractiveButtons,
  sendListMessage,
  sendMediaMessage,
  uploadMedia,
} from "./messageService.js";
import { getSession, resetSession } from "./sessionService.js";
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
import { generateInvoice } from "./invoiceService.js";
import { products } from "../utils/products.js";

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
        session.language === "ar"
          ? "الرجاء إدخال كمية رقمية صالحة أو كتابة 'menu'."
          : "Please enter a valid numeric quantity or type 'menu'."
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
    const addedMsg =
      session.language === "ar"
        ? `تمت إضافة ${qty} × ${
            session.cart[session.cart.length - 1].name
          }.\nاستمر أم إنهاء الطلب؟`
        : `Added ${qty} x ${
            session.cart[session.cart.length - 1].name
          }.\nContinue or Checkout?`;
    const buttons = [
      {
        id: "CONTINUE",
        title: session.language === "ar" ? "استمر" : "Continue",
      },
      {
        id: "CHECKOUT",
        title: session.language === "ar" ? "إنهاء الطلب" : "Checkout",
      },
    ];
    await sendInteractiveButtons(userPhone, addedMsg, buttons);
    return;
  }

  // Checkout flow:
  if (session.state === "CHECKOUT_NAME") {
    // Automatically, the user's phone number is captured, so we only need their name.
    session.name = textBody;
    session.state = "CHECKOUT_ADDRESS";
    await sendTextMessage(
      userPhone,
      session.language === "ar"
        ? `يرجى كتابة عنوان التوصيل الكامل الآن يا ${session.name}.`
        : `Thanks, ${session.name}. Please type your full delivery address now.`
    );
    return;
  }
  if (session.state === "CHECKOUT_ADDRESS") {
    // Save delivery address and prompt for delivery location (Google Maps link or shared location)
    session.delivery_address = textBody;
    session.state = "CHECKOUT_DELIVERY_LOCATION";
    await sendTextMessage(
      userPhone,
      session.language === "ar"
        ? "يرجى إرسال موقع التوصيل (شارك موقعك عبر واتساب أو قدم رابط خرائط جوجل)."
        : "Please send your delivery location (share your location via WhatsApp or provide a Google Maps link)."
    );
    return;
  }
  if (session.state === "CHECKOUT_DELIVERY_LOCATION") {
    // Save the delivery location data
    session.delivery_location = textBody;
    session.state = "CHECKOUT_BILLING_PROMPT";
    await sendTextMessage(
      userPhone,
      session.language === "ar"
        ? "هل عنوان الفواتير هو نفسه عنوان التوصيل؟ اكتب 'نعم' أو 'لا'."
        : "Is your billing address the same as your delivery address? Type 'yes' or 'no'."
    );
    return;
  }

  // Checkout: Billing Address Prompt
  if (session.state === "CHECKOUT_BILLING_PROMPT") {
    if (lowerText === "yes" || lowerText === "نعم") {
      session.billing_address = session.delivery_address;
      session.state = "CHECKOUT_CONFIRM";
    } else if (lowerText === "no" || lowerText === "لا") {
      session.state = "CHECKOUT_BILLING_ADDRESS";
      await sendTextMessage(
        userPhone,
        session.language === "ar"
          ? "يرجى إدخال عنوان الفواتير."
          : "Please enter your billing address."
      );
      return;
    } else {
      await sendTextMessage(
        userPhone,
        session.language === "ar"
          ? "يرجى الرد بـ 'نعم' أو 'لا'."
          : "Please respond with 'yes' or 'no'."
      );
      return;
    }
    // Build confirmation message with individual prices and total.
    const itemsSummary = session.cart
      .map((c) => `${c.quantity} x ${c.name} @ ${c.price} each`)
      .join("\n");
    const total = session.cart.reduce(
      (sum, c) => sum + c.quantity * c.price,
      0
    );
    const confirmMsg =
      session.language === "ar"
        ? `طلبك:\n${itemsSummary}\nالمجموع: ${total}\nعنوان التوصيل: ${session.delivery_address}\nموقع التوصيل: ${session.delivery_location}\nعنوان الفواتير: ${session.billing_address}\nتأكيد أم إلغاء؟`
        : `Your order:\n${itemsSummary}\nTotal: ${total}\nDelivery Address: ${session.delivery_address}\nDelivery Location: ${session.delivery_location}\nBilling Address: ${session.billing_address}\nConfirm or cancel?`;
    const confirmButtons = [
      { id: "CONFIRM", title: session.language === "ar" ? "تأكيد" : "Confirm" },
      { id: "CANCEL", title: session.language === "ar" ? "إلغاء" : "Cancel" },
    ];
    await sendInteractiveButtons(userPhone, confirmMsg, confirmButtons);
    return;
  }

  // Checkout: Billing Address Input (if different)
  if (session.state === "CHECKOUT_BILLING_ADDRESS") {
    session.billing_address = textBody;
    session.state = "CHECKOUT_CONFIRM";
    const itemsSummary = session.cart
      .map((c) => `${c.quantity} x ${c.name} @ ${c.price} each`)
      .join("\n");
    const total = session.cart.reduce(
      (sum, c) => sum + c.quantity * c.price,
      0
    );
    const confirmMsg =
      session.language === "ar"
        ? `طلبك:\n${itemsSummary}\nالمجموع: ${total}\nعنوان التوصيل: ${session.delivery_address}\nموقع التوصيل: ${session.delivery_location}\nعنوان الفواتير: ${session.billing_address}\nتأكيد أم إلغاء؟`
        : `Your order:\n${itemsSummary}\nTotal: ${total}\nDelivery Address: ${session.delivery_address}\nDelivery Location: ${session.delivery_location}\nBilling Address: ${session.billing_address}\nConfirm or cancel?`;
    const confirmButtons = [
      { id: "CONFIRM", title: session.language === "ar" ? "تأكيد" : "Confirm" },
      { id: "CANCEL", title: session.language === "ar" ? "إلغاء" : "Cancel" },
    ];
    await sendInteractiveButtons(userPhone, confirmMsg, confirmButtons);
    return;
  }

  // Checkout: Confirmation (fallback text if user types at this stage)
  if (session.state === "CHECKOUT_CONFIRM") {
    await sendTextMessage(
      userPhone,
      session.language === "ar"
        ? "يرجى استخدام الأزرار لتأكيد أو إلغاء طلبك."
        : "Please use the provided buttons to confirm or cancel your order."
    );
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

    case "SELECT_CATEGORY":
      {
        // The buttonId here represents the selected category (e.g., "perfumes", "deodorants", "body sprays")
        const selectedCategory = buttonId.toLowerCase();
        // Filter the products from the hard-coded list by category
        const filteredProducts = products.filter(
          (product) => product.category.toLowerCase() === selectedCategory
        );
        if (filteredProducts.length === 0) {
          await sendTextMessage(
            userPhone,
            localize(
              "No products available in this category.",
              session.language
            )
          );
          // Optionally, you can send the category menu again:
          await sendCategoryMenu(userPhone, session);
        } else {
          const categoryTranslations = {
            perfumes: "العطور",
            deodorants: "مزيلات العرق",
            "body sprays": "رشاشات الجسم",
          };
          const bodyText =
            session.language === "ar"
              ? `يرجى اختيار منتج من ${
                  categoryTranslations[selectedCategory] || selectedCategory
                }`
              : `Please choose a product from ${selectedCategory}`;
          const productButtons = filteredProducts.map((product) => ({
            id: product.id,
            title: product.name + " ($" + product.price.toFixed(2) + ")",
          }));
          session.state = "SHOW_PRODUCTS";
          await sendInteractiveButtons(userPhone, bodyText, productButtons);
        }
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
          session.language === "ar"
            ? "يرجى كتابة اسمك الكامل."
            : "Please type your full name."
        );
      } else {
        await sendTextMessage(
          userPhone,
          session.language === "ar"
            ? "يرجى اختيار 'استمر' أو 'إنهاء الطلب'."
            : "Please pick Continue or Checkout."
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
 * Finalizes the order by inserting the order header and items into the database.
 * Also generates a PDF invoice.
 * @param {string} userPhone - The customer's phone number.
 * @param {object} session - The session object containing order details.
 */
const finalizeOrder = async (userPhone, session) => {
  try {
    // Acquire a connection from the pool
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      // Insert the order header into the orders table
      const insertOrderQuery = `
        INSERT INTO orders (phone, customer_name, delivery_address, delivery_location, billing_address, status)
        VALUES (?, ?, ?, ?, ?, ?)
      `;
      const [orderResult] = await connection.query(insertOrderQuery, [
        userPhone,
        session.name,
        session.delivery_address, // Delivery address text
        session.delivery_location, // Google Maps link or location data
        session.billing_address, // Billing address
        "Placed",
      ]);

      // Retrieve the auto-generated order id
      const orderId = orderResult.insertId;

      // Insert each order item into the order_item table
      const insertItemQuery = `
        INSERT INTO order_item (order_id, product_id, product_name, product_price, quantity)
        VALUES (?, ?, ?, ?, ?)
      `;
      for (const item of session.cart) {
        await connection.query(insertItemQuery, [
          orderId,
          item.id, // Static product id for testing
          item.name,
          item.price,
          item.quantity,
        ]);
      }

      // Commit the transaction
      await connection.commit();

      // Prepare orderData for invoice generation
      const orderData = {
        id: orderId,
        phone: userPhone,
        customer_name: session.name,
        delivery_address: session.delivery_address,
        delivery_location: session.delivery_location,
        billing_address: session.billing_address,
        items: session.cart,
      };

      // Generate the PDF invoice and get the file path
      const invoicePath = await generateInvoice(orderData);
      // Upload the invoice to get a media ID
      const mediaId = await uploadMedia(invoicePath);
      // Send Pdf invoice to the user
      await sendMediaMessage(userPhone, invoicePath);
      // Send a confirmation message, optionally include the invoice path or link
      const confirmationMsg =
        session.language === "ar"
          ? `شكراً! تم إنشاء طلبك (${orderId}).فاتورتك : `
          : `Thank you! Your order (${orderId}) is placed. Here's your invoice!`;
      await sendTextMessage(userPhone, confirmationMsg);
    } catch (err) {
      await connection.rollback();
      console.error("Error finalizing order:", err);
      await sendTextMessage(
        userPhone,
        "There was an error placing your order. Please try again later."
      );
    } finally {
      connection.release();
    }
  } catch (err) {
    console.error("Database connection error:", err);
    await sendTextMessage(userPhone, "Database error. Please try again later.");
  }

  // Reset the session after finalizing the order
  resetSession(userPhone);
};

export { finalizeOrder };

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
 * Handles product quick reply messages by looking up the product from a hard-coded list,
 * setting it as the current product, and prompting the user for the quantity.
 * @param {object} session - The current user session.
 * @param {string} userPhone - The user's phone number.
 * @param {string} buttonId - The identifier of the selected product.
 */
const handleProductQuickReply = async (session, userPhone, buttonId) => {
  // Lookup the product from the hard-coded products list
  const product = products.find((p) => p.id === buttonId);
  if (!product) {
    await sendTextMessage(
      userPhone,
      session.language === "ar"
        ? "لم يتم العثور على المنتج."
        : "Product not found."
    );
    return;
  }
  // Set the product as the current product and prompt for quantity
  session.currentProduct = product;
  session.state = "ASK_QUANTITY";
  await sendTextMessage(
    userPhone,
    session.language === "ar"
      ? `الرجاء إدخال الكمية لمنتج ${product.name}.`
      : `Please enter the quantity for product ${product.name}.`
  );
};

/**
 * Checks the order status by retrieving all previous orders for the user (by phone number)
 * from the database and sends the details to the customer.
 * @param {string} userPhone - The user's phone number.
 * @param {object} session - The current user session.
 */
const checkOrderStatus = async (userPhone, session) => {
  try {
    // Query the orders table for orders associated with the user's phone number
    const [ordersResult] = await pool.query(
      "SELECT * FROM orders WHERE phone = ?",
      [userPhone]
    );
    if (ordersResult.length === 0) {
      await sendTextMessage(
        userPhone,
        session.language === "ar"
          ? "لم يتم العثور على طلب لهذا الرقم."
          : "No orders found for your phone."
      );
    } else {
      let message =
        session.language === "ar"
          ? "طلباتك السابقة:\n"
          : "Your previous orders:\n";
      // For each order, query the order_item table and format the order details
      for (const order of ordersResult) {
        const [items] = await pool.query(
          "SELECT * FROM order_item WHERE order_id = ?",
          [order.id]
        );
        message += `Order ID: ${order.id} - Status: ${order.status}\n`;
        if (items.length > 0) {
          items.forEach((item) => {
            message += `   ${item.quantity} x ${item.product_name} @ ${item.product_price}\n`;
          });
        }
        message += "\n";
      }
      await sendTextMessage(userPhone, message);
    }
    session.state = "MAIN_MENU";
    await sendMainMenu(userPhone);
  } catch (error) {
    console.error("Error retrieving order status:", error);
    await sendTextMessage(
      userPhone,
      session.language === "ar"
        ? "حدث خطأ أثناء استرجاع طلباتك."
        : "Error retrieving your orders."
    );
    session.state = "MAIN_MENU";
    await sendMainMenu(userPhone);
  }
};

export { handleTextMessage, handleButtonReply, handleListReply };
