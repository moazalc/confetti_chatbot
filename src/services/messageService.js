/***************************************************
 * messageService.js
 * Service for sending messages to WhatsApp via the Graph API.
 ***************************************************/

import axios from "axios";
import {
  GRAPH_API_TOKEN,
  BUSINESS_PHONE_NUMBER_ID,
} from "../utils/constants.js";
import fs from "fs";
import FormData from "form-data";

/**
 * Sends a simple text message.
 * @param {string} to - Recipient's phone number.
 * @param {string} bodyText - The text message content.
 */
export const sendTextMessage = async (to, bodyText) => {
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
};

/**
 * Sends an interactive message with buttons.
 * @param {string} to - Recipient's phone number.
 * @param {string} bodyText - The message content.
 * @param {Array} buttons - Array of button objects with id and title.
 */
export const sendInteractiveButtons = async (to, bodyText, buttons) => {
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
};

/**
 * Sends a list message (used for FAQs or ticket topics).
 * @param {string} to - Recipient's phone number.
 * @param {string} headerText - The header of the list.
 * @param {string} bodyText - The body text.
 * @param {string} footerText - The footer text.
 * @param {string} buttonText - Text for the action button.
 * @param {Array} rows - List rows representing items.
 */
export const sendListMessage = async (
  to,
  headerText,
  bodyText,
  footerText,
  buttonText,
  rows
) => {
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
};
/**
 * Uploads a file to the WhatsApp Cloud API and returns the media ID.
 * @param {string} filePath - The path to the file to upload.
 * @returns {Promise<string>} - Resolves with the media ID.
 */
export const uploadMedia = async (filePath) => {
  try {
    const url = `https://graph.facebook.com/v16.0/${BUSINESS_PHONE_NUMBER_ID}/media`;
    const formData = new FormData();
    // Include messaging_product and proper file metadata (filename and contentType)
    formData.append("messaging_product", "whatsapp");
    formData.append("file", fs.createReadStream(filePath), {
      filename: "invoice.pdf",
      contentType: "application/pdf",
    });

    const headers = {
      ...formData.getHeaders(),
      Authorization: `Bearer ${GRAPH_API_TOKEN}`,
    };

    const response = await axios.post(url, formData, { headers });
    return response.data.id;
  } catch (err) {
    console.error("uploadMedia error:", err?.response?.data || err);
    throw err;
  }
};

/**
 * Sends a document message via the WhatsApp Cloud API using a media ID.
 * @param {string} to - The recipient's phone number.
 * @param {string} mediaId - The media ID returned from the upload.
 */
export const sendMediaMessage = async (to, mediaId) => {
  try {
    const url = `https://graph.facebook.com/v16.0/${BUSINESS_PHONE_NUMBER_ID}/messages`;
    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: to,
      type: "document",
      document: {
        id: mediaId,
        caption: "Your invoice",
        filename: "invoice.pdf",
      },
    };

    await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${GRAPH_API_TOKEN}`,
        "Content-Type": "application/json",
      },
    });
  } catch (err) {
    console.error("sendMediaMessage error:", err?.response?.data || err);
  }
};
