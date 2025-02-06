// src/db.js
import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

/**
 * Create a MySQL connection pool using environment variables.
 */
const pool = mysql.createPool({
  host: process.env.DB_HOST || "127.0.0.1",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "admin",
  database: process.env.DB_NAME || "chatbot_schema",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

export default pool;
