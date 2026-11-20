import express from "express";
import {
    createProperty,
    deleteProperty,
    getAllProperties,
    getAllPropertiesAdmin,
    getFeaturedProperties,
    getLatestProperties,
    getMyProperties,
    getPropertyById,
    getPropertyStats,
    getSimilarProperties,
    searchProperties,
    updateProperty,
    updatePropertyStatus,
} from "../controllers/property.controller.js";
import { protectRoute } from "../middlewares/auth.middleware.js";
import { authorizeRoles } from "../middlewares/role.middleware.js";
import { upload } from "../middlewares/multer.middleware.js";

const router = express.Router();

// Public routes
router.get('/', getAllProperties);
router.get('/search', searchProperties);
router.get('/featured', getFeaturedProperties);
router.get('/latest', getLatestProperties);
router.get('/similar/:id', getSimilarProperties);

// Seller routes
router.post('/', protectRoute, authorizeRoles("seller"), upload.array("images", 5), createProperty);
router.get('/my-properties', protectRoute, authorizeRoles("seller"), getMyProperties);

router.get('/stats',protectRoute, authorizeRoles("seller"), getPropertyStats);

// Admin routes
router.patch('/:id/status', protectRoute, authorizeRoles('admin'), updatePropertyStatus);
router.get('/admin/all', protectRoute, authorizeRoles('admin'), getAllPropertiesAdmin);


// dynamic routes
router.get('/:id', getPropertyById);

router.patch('/:id', protectRoute, authorizeRoles("seller"), updateProperty);
router.delete("/:id", protectRoute, authorizeRoles("seller"), deleteProperty);

export default router;