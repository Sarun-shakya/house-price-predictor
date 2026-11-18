import express from "express";
import cookieParser from "cookie-parser";

// Import routes
import authRoutes from "./routes/auth.route.js";
import propertyRoutes from './routes/property.route.js';
import favoriteRoutes from './routes/favorite.route.js';
import predictionRoutes from './routes/prediction.route.js';
import propertyVerificationRoutes from './routes/propertyVerifications.route.js';

const app = express();

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// API Routes
app.use("/api/v1/users", authRoutes);
app.use("/api/v1/properties", propertyRoutes);
app.use("/api/v1/favorites", favoriteRoutes);
app.use("/api/v1/predictions", predictionRoutes);
app.use("/api/v1/property-verifications", propertyVerificationRoutes);

// Default route
app.get("/", (req, res) => {
    res.send("API is running");
});

export default app;