/***************************************************
 * app.js
 *
 * Entry point for the Chatbot server.
 * Loads environment variables, sets up middleware, and starts the Express server.
 *
 * You run this file with: `npm start`
 ***************************************************/

import express from "express";
import dotenv from "dotenv";
import webhookRouter from "./routes/webhook.js";

dotenv.config();

const app = express();

// Middleware to parse JSON requests
app.use(express.json());

// Set up the /webhook route
app.use("/webhook", webhookRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
