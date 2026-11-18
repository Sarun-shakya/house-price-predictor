import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load environment variables
dotenv.config({
    path: path.resolve(__dirname, "../.env"),
});

const { default: pool } = await import("./config/db.js");
const { default: app } = await import("./app.js");

const PORT = process.env.PORT || 3000;

// Check database connection
try {
    const ans = await pool.query("SELECT NOW()");
    console.log("Database Connected Successfully:", ans.rows[0]);
} catch (error) {
    console.error("Failed to connect DB:", error.message);
    process.exit(1);
}

// Start server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});