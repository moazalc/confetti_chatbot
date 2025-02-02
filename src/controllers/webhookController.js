/***************************************************
 * webhookController.js
 *
 * Controller for handling webhook GET and POST requests.
 ***************************************************/
import { WEBHOOK_VERIFY_TOKEN } from "../utils/constants.js";
import { handleIncomingMessage } from "../services/chatbotService.js";

/**
 * GET /webhook
 * Verifies the webhook by checking the token.
 */
export const getWebhook = (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === WEBHOOK_VERIFY_TOKEN) {
    console.log("Webhook verified successfully!");
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
};

/**
 * POST /webhook
 * Processes incoming webhook events and delegates message handling.
 */
export const postWebhook = async (req, res) => {
  console.log("Incoming webhook data:", JSON.stringify(req.body, null, 2));

  const changes = req.body.entry?.[0]?.changes?.[0];
  if (!changes) {
    return res.sendStatus(200);
  }

  const messages = changes.value?.messages;
  if (messages) {
    for (const msg of messages) {
      await handleIncomingMessage(msg);
    }
  }
  return res.sendStatus(200);
};
