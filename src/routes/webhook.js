/***************************************************
 * webhook.js
 *
 * Defines routes for the /webhook endpoint.
 ***************************************************/

import express from "express";
import { getWebhook, postWebhook } from "../controllers/webhookController.js";

const router = express.Router();

// GET /webhook for verification
router.get("/", getWebhook);

// POST /webhook for processing incoming messages
router.post("/", postWebhook);

export default router;
