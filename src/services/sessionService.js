/***************************************************
 * sessionService.js
 * Service for managing user sessions and orders. This is just for testing.
 * This uses in-memory storage for demonstration. In production, use a persistent store.
 ***************************************************/

export const sessions = {};
export const orders = {};

/**
 * Retrieves an existing session or creates a new one for the given phone.
 * @param {string} phone - The user's phone number.
 * @returns {object} The session object.
 */
export const getSession = (phone) => {
  if (!sessions[phone]) {
    sessions[phone] = createNewSession();
  }
  return sessions[phone];
};

/**
 * Resets the session for the given phone number.
 * @param {string} phone - The user's phone number.
 */
export const resetSession = (phone) => {
  sessions[phone] = createNewSession(false);
};

/**
 * Creates a new session object.
 * @param {boolean} isFirstTime - Indicates if this is the user's first interaction.
 * @returns {object} A new session object.
 */
const createNewSession = (isFirstTime = true) => ({
  isFirstTime,
  language: null,
  state: "WELCOME",
  gender: null,
  category: null,
  cart: [],
  name: null,
  address: null,
  currentProduct: null,
  // Ticket fields
  ticketName: null,
  ticketOrderNum: null,
  ticketTopic: null,
  ticketDesc: null,
});
