/**
 * Utility to generate a simple random order ID.
 */

import { v4 as uuidv4 } from "uuid";

/**
 * Generates an order ID by taking a slice of a UUID.
 * @returns {string} The generated order ID.
 */
export const generateOrderId = () => {
  return "P" + uuidv4().slice(0, 8).toUpperCase();
};
