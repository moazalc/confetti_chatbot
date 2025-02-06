// testConnection.js
import pool from "./db.js";

const testDb = async () => {
  try {
    const connection = await pool.getConnection();
    const [rows] = await connection.query("SELECT NOW() AS now");
    console.log("Database connected, current time:", rows[0].now);
    connection.release();
  } catch (err) {
    console.error("Database connection error:", err);
  }
};

testDb();
