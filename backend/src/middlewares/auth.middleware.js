import jwt from 'jsonwebtoken';
import pool from '../config/db.js';

export const protectRoute = async (req, res, next) => {
    try {
        const token = req.cookies.jwt;

        if(!token){
            return res.status(401).json({
                success: false,
                message: "Unauthorized - No token provided"
            });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        if(!decoded){
            return res.status(401).json({
                success: false,
                message: "Unauthorized - Invalid token"
            });
        }

        const result = await pool.query(
            `SELECT
                id,
                full_name,
                email,
                phone,
                role,
                profile_image_url,
                created_at
             FROM users
             WHERE id = $1`,
            [decoded.userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                message: "User not found",
            });
        }

        req.user = result.rows[0];

        next();
    } catch (error) {
        console.log("Error in protectRoute middleware:", error.message);
        res.status(500).json({
            success: false,
            message: "Internal server error"
        });
    }
}