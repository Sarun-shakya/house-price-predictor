import express from "express";
import { 
    register,
    login,
    logout,
    profile,
    updateProfile
 } from "../controllers/auth.controller.js";
import { protectRoute } from "../middlewares/auth.middleware.js";
import { upload } from "../middlewares/multer.middleware.js";

const router = express.Router();

// Routes
router.post("/register", upload.single("profile"), register);
router.get("/login", login);
router.get("/logout", logout);
router.get('/profile', protectRoute, profile);
router.patch('/profile', protectRoute, upload.single("profile"), updateProfile);


export default router;
