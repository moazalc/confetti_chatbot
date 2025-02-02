/***************************************************
 * supportService.js
 * Service for handling support-related flows such as ticket submission.
 ***************************************************/

import { sendTextMessage, sendListMessage } from "./messageService.js";

/**
 * Sends a list message for ticket topics.
 * @param {string} userPhone - The recipient's phone number.
 * @param {string} lang - The language preference.
 */
export const sendTicketTopicsList = async (userPhone, lang) => {
  const header = lang === "ar" ? "اختر موضوعاً" : "Choose a topic";
  const body =
    lang === "ar" ? "يرجى اختيار أحد المواضيع" : "Please select a topic below";
  const footer = lang === "ar" ? "انقر للعرض" : "Tap to view";
  const button = lang === "ar" ? "عرض" : "View";
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
};

/**
 * Finalizes the ticket submission.
 * Logs the ticket data and sends a confirmation message to the user.
 * @param {string} userPhone - The recipient's phone number.
 * @param {object} session - The current user session.
 */
export const finalizeTicket = async (userPhone, session) => {
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

  // Reset ticket fields and return to main menu state.
  session.ticketName = null;
  session.ticketOrderNum = null;
  session.ticketTopic = null;
  session.ticketDesc = null;
  session.state = "MAIN_MENU";
};
