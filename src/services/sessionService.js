/***************************************************
 * sessionService.js
 * Service for managing user sessions and orders. This is just for testing.
 * This uses in-memory storage for demonstration. In production, use a persistent store.
 ***************************************************/

export const sessions = {};

/**
 * Returns the session for a given phone number or creates a new one.
 * New fields added: delivery_location and billing_address.
 */
export const getSession = (phone) => {
  if (!sessions[phone]) {
    sessions[phone] = createNewSession();
  }
  return sessions[phone];
};

/**
 * Resets the session for the given phone.
 */
export const resetSession = (phone) => {
  sessions[phone] = createNewSession(false);
};

/**
 * Creates a new session object.
 * @param {boolean} isFirstTime - Indicates if the user is interacting for the first time.
 * @returns {object} Session object.
 */
const createNewSession = (isFirstTime = true) => ({
  isFirstTime,
  language: null,
  state: "WELCOME",
  gender: null,
  category: null,
  cart: [],
  name: null,
  delivery_address: null, // New: Delivery address text
  delivery_location: null, // New: Google Maps link or location data
  billing_address: null, // New: Billing address text
  // Ticket fields, etc.
  ticketName: null,
  ticketOrderNum: null,
  ticketTopic: null,
  ticketDesc: null,
});
