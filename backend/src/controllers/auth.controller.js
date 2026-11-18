import bcrypt from 'bcryptjs';
import pool from '../config/db.js';
import { generateToken } from '../config/jwt.js';
import { uploadOnCloudinary, deleteOnCloudinary } from '../config/cloudinary.js';

// Register
export const register = async (req, res) => {
    try {
        const { full_name, email, password, phone, role } = req.body;

        if (!full_name || !email || !password) {
            return res.status(400).json({
                success: false,
                message: "Full name, email and password are required."
            });
        }

        if (password.length < 8) {
            return res.status(400).json({
                success: false,
                message: "Password must be at least 8 characters long."
            });
        }

        const allowedRoles = ["buyer", "seller"];
        const userRole = role?.toLowerCase() || "buyer";

        if (!allowedRoles.includes(userRole)) {
            return res.status(400).json({
                success: false,
                message: "Invalid user role."
            });
        }

        const normalizedEmail = email.trim().toLowerCase();

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(normalizedEmail)) {
            return res.status(400).json({
                success: false,
                message: "Invalid email format"
            });
        }

        const normalizedPhone = phone?.trim() || null;

        if (normalizedPhone) {
            const phoneRegex = /^(97|98)\d{8}$/;

            if (!phoneRegex.test(normalizedPhone)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid phone number."
                });
            }
        }

        const existingUser = await pool.query(
            "SELECT id FROM users WHERE email = $1",
            [normalizedEmail]
        );

        if (existingUser.rows.length > 0) {
            return res.status(409).json({
                success: false,
                message: "Email is already registered"
            });
        }

        let uploadedImage = null;
        if (req.file?.path) {
            uploadedImage = await uploadOnCloudinary(req.file.path);

            if (!uploadedImage) {
                return res.status(400).json({
                    success: false,
                    message: "Profile photo upload failed."
                })
            }
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const result = await pool.query(
            `INSERT INTO users (
                full_name,
                email,
                password,
                phone,
                profile_image_url,
                profile_image_public_id,
                role
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING id, full_name, email, phone, role, profile_image_url, profile_image_public_id, created_at`,
            [
                full_name.trim(),
                normalizedEmail,
                hashedPassword,
                normalizedPhone,
                uploadedImage?.url || null,
                uploadedImage?.public_id || null,
                userRole
            ]
        );

        const newUser = result.rows[0];

        return res.status(201).json({
            success: true,
            message: "User registered successfully.",
            data: newUser
        });
    } catch (error) {
        console.error("Error in register controller:", error.message);

        if (error.code === "23505") {
            return res.status(409).json({
                success: false,
                message: "Email is already registered."
            });
        }
        if (!res.headersSent) {
            return res.status(500).json({ message: "Internal server error" });
        }
    }
};

// login
export const login = async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: "All fields are required."
            });
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        if (!emailRegex.test(email)) {
            return res.status(400).json({
                success: false,
                message: "Invalid email format."
            });
        }

        const result = await pool.query(
            `SELECT id, full_name, email, password, phone,
                    role, profile_image_url, created_at
            FROM users 
            WHERE email = $1`,
            [email.trim().toLowerCase()]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({
                success: false,
                message: "Invalid credentials.",
            })
        }

        const user = result.rows[0];

        if (!user.password) {
            return res.status(400).json({
                success: false,
                message: "Please use google login."
            })
        }

        const isPasswordValid = await bcrypt.compare(password, user.password);

        if (!isPasswordValid) {
            return res.status(400).json({
                success: false,
                message: "Invalid credentials"
            });
        }

        generateToken(user, res);

        const { password: hashedPassword, ...userData } = user;

        return res.status(200).json({
            success: true,
            data: userData,
            message: "Logged in successfully"
        })
    } catch (error) {
        console.error("Error in login controller:", error.message);
        res.status(500).json({
            success: false,
            message: "Internal Server error"
        });
    }
};

// logout
export const logout = async (_, res) => {
    res.cookie("jwt", "", {
        maxAge: 0,
        httpOnly: true,
        sameSite: process.env.NODE_ENV === "production"
            ? "none"
            : "lax",
        secure: process.env.NODE_ENV === "production"
    });

    res.status(200).json({
        success: true,
        message: "Logged out successfully"
    });
};

// Profile
export const profile = async (req, res) => {
    try {
        const userId = req.user.id;
        const result = await pool.query(
            `SELECT id, full_name, email, phone,
                    role, profile_image_url, created_at
            FROM users 
            WHERE id = $1`,
            [userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "User not logged in.",
            });
        }

        const user = result.rows[0];

        return res.status(200).json({
            success: true,
            data: user,
            message: "User profile fetched successfully"
        });
    } catch (error) {
        console.log("Error in profile controller: ", error.message);
        return res.status(500).json({
            success: false,
            message: "Internal server error"
        });
    }
};

// Update Profile
export const updateProfile = async (req, res) => {
    try {
        const userId = req.user.id;
        const { full_name, email, phone, password } = req.body || {};

        if (
            full_name === undefined &&
            email === undefined &&
            phone === undefined &&
            password === undefined &&
            !req.file
        ) {
            return res.status(400).json({
                success: false,
                message: "Please provide atleast one field"
            });
        }

        const userResult = await pool.query(
            `SELECT id, full_name, email, phone,
            password, profile_image_url, profile_image_public_id
            FROM users
            WHERE id = $1`,
            [userId]
        );

        if (userResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Unser not found"
            })
        }

        const user = userResult.rows[0];

        const updatedName = full_name !== undefined ? full_name.trim() : user.full_name;

        if (!updatedName) {
            return res.status(400).json({
                success: false,
                message: "Full name cannot be empty"
            });
        }

        const updatedEmail = email !== undefined ? email.trim().toLowerCase() : user.email;

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        if (!emailRegex.test(updatedEmail)) {
            return res.status(400).json({
                success: false,
                message: "invalid email format"
            });
        }

        if (email !== undefined && updatedEmail !== user.email) {
            const existingUser = await pool.query(
                "SELECT id FROM users WHERE email = $1 AND id != $2",
                [updatedEmail, userId]
            );

            if (existingUser.rows.length > 0) {
                return res.status(409).json({
                    success: false,
                    message: "Email is already registered."
                });
            }
        }

        let updatedPhone = user.phone;

        if (phone !== undefined) {
            updatedPhone = phone.trim() || null;

            if (updatedPhone) {
                const phoneRegex = /^(97|98)\d{8}$/;

                if (!phoneRegex.test(updatedPhone)) {
                    return res.status(400).json({
                        success: false,
                        message: "Invalid phone number."
                    });
                }
            }
        }

        let updatedPassword = user.password;

        if (password !== undefined) {
            if (typeof password !== "string" || password.length < 8) {
                return res.status(400).json({
                    success: false,
                    message: "Password must be at least 8 characters long."
                });
            }
            const salt = await bcrypt.genSalt(10);
            updatedPassword = await bcrypt.hash(password, salt);
        }

        let uploadedImage = null;

        if (req.file?.path) {
            uploadedImage = await uploadOnCloudinary(req.file.path);

            if (!uploadedImage) {
                return res.status(500).json({
                    success: false,
                    message: "Profile photo upload failed."
                });
            }
        }

        const result = await pool.query(
            `UPDATE users 
            SET full_name = $1,
                email = $2,
                phone = $3,
                password = $4,
                profile_image_url = $5,
                profile_image_public_id = $6
            WHERE id = $7
            RETURNING id, full_name, email, phone, role, profile_image_url, created_at`,
            [
                updatedName,
                updatedEmail,
                updatedPhone,
                updatedPassword,
                uploadedImage?.url || user.profile_image_url,
                uploadedImage?.public_id || user.profile_image_public_id,
                userId
            ]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "User not found."
            });
        }

        if (uploadedImage && user.profile_image_public_id) {
            await deleteOnCloudinary(user.profile_image_public_id);
        }

        return res.status(200).json({
            success: true,
            message: "Profile updated successfully.",
            data: result.rows[0]
        });
    } catch (error) {
        console.error("Error in updateProfile controller:", error.message);

        if (error.code === "23505") {
            return res.status(409).json({
                success: false,
                message: "Email is already registered."
            });
        }

        return res.status(500).json({
            success: false,
            message: "Internal server error."
        });
    }
};
