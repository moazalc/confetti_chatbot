/***************************************************
 * menuService.js
 * Service for sending various menus (language selection, main menu, category, support menus, etc.).
 ***************************************************/

import {
  sendInteractiveButtons,
  sendTextMessage,
  sendListMessage,
} from "./messageService.js";
import { localize } from "../utils/localize.js";
import { getSession, resetSession } from "./sessionService.js";

/**
 * Sends the first-time language selection menu.
 * @param {string} userPhone - The recipient's phone number.
 */
export const sendFirstTimeLanguageMenu = async (userPhone) => {
  const greeting = `Hello there! Welcome to Confetti London LY! We’re so excited to have you here.
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
};

/**
 * Sends a welcome message for returning users and displays the main menu.
 * @param {string} userPhone - The recipient's phone number.
 */
export const sendReturningWelcome = async (userPhone) => {
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
};

/**
 * Sends the main menu with options: ORDER, STATUS, SUPPORT.
 * @param {string} userPhone - The recipient's phone number.
 */
export const sendMainMenu = async (userPhone) => {
  const session = getSession(userPhone);
  if (session.isFirstTime && !session.language) {
    session.state = "WELCOME";
    await sendFirstTimeLanguageMenu(userPhone);
    return;
  }
  const bodyText =
    session.language === "ar"
      ? " يرجى اختيار إحدى الخيارات التالية:"
      : "Please choose one of the following options:";

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
};

/**
 * Sends the category selection menu based on gender.
 * @param {string} userPhone - The recipient's phone number.
 * @param {object} session - The current user session.
 */
export const sendCategoryMenu = async (userPhone, session) => {
  const categories = ["perfumes", "deodorants", "body sprays"];
  const categoriesMap = {
    perfumes: session.language === "ar" ? "عطور" : "Perfumes",
    deodorants: session.language === "ar" ? "مزيلات العرق" : "Deodorants",
    "body sprays": session.language === "ar" ? "رشاشات الجسم" : "Body sprays",
  };

  const bodyText =
    session.language === "ar"
      ? `اختر تصنيف للمنتجات ${session.gender === "men" ? "رجالية" : "نسائية"}:`
      : `Choose a category for ${session.gender}:`;

  const buttons = categories.map((cat) => ({
    id: cat,
    title: categoriesMap[cat],
  }));

  await sendInteractiveButtons(userPhone, bodyText, buttons);
};

/**
 * Sends the support main menu.
 * @param {string} userPhone - The recipient's phone number.
 * @param {string} lang - The language preference.
 */
export const sendSupportMainMenu = async (userPhone, lang) => {
  const text =
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
};

/**
 * Sends a list message for FAQ categories.
 * @param {string} userPhone - The recipient's phone number.
 * @param {string} lang - The language preference.
 */
export const sendFAQList = async (userPhone, lang) => {
  const header =
    lang === "ar"
      ? "إليك بعض الأسئلة الشائعة"
      : "Here are some frequently asked questions";
  const body =
    lang === "ar" ? "يرجى اختيار فئة" : "Please select a category below";
  const footer = lang === "ar" ? "انقر للعرض" : "Tap to view";
  const button = lang === "ar" ? "عرض" : "View";
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
};
