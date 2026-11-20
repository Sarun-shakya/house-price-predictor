import pool from '../config/db.js';
import { uploadOnCloudinary, deleteOnCloudinary } from '../config/cloudinary.js';
import fs from 'fs';

// Create property
export const createProperty = async (req, res) => {
    let client;
    const files = req.files || [];
    const uploadedImages = [];
    let transactionStarted = false;
    let committed = false;
    try {
        
        const {
            title,
            description,
            property_type,
            location,
            district,
            municipality,
            ward_no,
            land_area_aana,
            built_up_area_sqft,
            price,
            road_access,
            facing,
            floors,
            bedrooms,
            bathrooms,
            built_year,
            parking_spaces,
            amenities,
            primaryImageIndex
        } = req.body;

        

        if (
            !title?.trim() ||
            !property_type ||
            !location?.trim() ||
            !district?.trim() ||
            !price
        ) {
            return res.status(400).json({
                success: false,
                message: "Please provide all required property fields."
            });
        }

        if (!["house", "land", "apartment"].includes(property_type)) {
            return res.status(400).json({
                success: false,
                message: "Invalid property type."
            });
        }

        if (!Number.isFinite(Number(price)) || Number(price) <= 0) {
            return res.status(400).json({
                success: false,
                message: "Please provide a valid property price."
            });
        }

        if (files.length === 0) {
            return res.status(400).json({
                success: false,
                message: "Please upload at least one property image."
            });
        }

        const primaryIndex = Number(primaryImageIndex ?? 0);

        if (
            !Number.isInteger(primaryIndex) ||
            primaryIndex < 0 ||
            primaryIndex >= files.length
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid primary image selection."
            });
        }

        const optionalNumbers = {
            ward_no,
            land_area_aana,
            built_up_area_sqft,
            floors,
            bedrooms,
            bathrooms,
            built_year,
            parking_spaces
        };

        const convertedNumbers = {};

        for (const [key, value] of Object.entries(optionalNumbers)) {
            if (value === undefined || value === null || value === "") {
                convertedNumbers[key] = null;
                continue;
            }

            const number = Number(value);

            if (!Number.isFinite(number)) {
                return res.status(400).json({
                    success: false,
                    message: `Invalid value for ${key}.`
                });
            }

            convertedNumbers[key] = number;
        }

        if (
            (convertedNumbers.ward_no !== null && convertedNumbers.ward_no <= 0) ||
            (convertedNumbers.land_area_aana !== null && convertedNumbers.land_area_aana <= 0) ||
            (convertedNumbers.built_up_area_sqft !== null && convertedNumbers.built_up_area_sqft <= 0) ||
            (convertedNumbers.floors !== null && convertedNumbers.floors <= 0) ||
            (convertedNumbers.bedrooms !== null && convertedNumbers.bedrooms < 0) ||
            (convertedNumbers.bathrooms !== null && convertedNumbers.bathrooms < 0) ||
            (convertedNumbers.parking_spaces !== null && convertedNumbers.parking_spaces < 0)
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid property measurements or details."
            });
        }

        let parsedAmenities = [];

        if (amenities) {
            try {
                parsedAmenities = Array.isArray(amenities)
                    ? amenities
                    : JSON.parse(amenities);

                if (!Array.isArray(parsedAmenities)) {
                    throw new Error("Amenities must be an array.");
                }
            } catch {
                return res.status(400).json({
                    success: false,
                    message: "Invalid amenities format."
                });
            }
        }

        for (const file of files) {
            const result = await uploadOnCloudinary(file.path);

            if (!result?.url || !result?.public_id) {
                throw new Error("Failed to upload property image.");
            }

            uploadedImages.push({
                image_url: result.url,
                public_id: result.public_id
            });
        }
        client = await pool.connect();
        await client.query("BEGIN");
        transactionStarted = true;

        const propertyResult = await client.query(
            `INSERT INTO properties (
                owner_id,
                title,
                description,
                property_type,
                location,
                district,
                municipality,
                ward_no,
                land_area_aana,
                built_up_area_sqft,
                price,
                road_access,
                facing,
                floors,
                bedrooms,
                bathrooms,
                built_year,
                parking_spaces,
                amenities
            )
            VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                $11, $12, $13, $14, $15, $16, $17, $18, $19
            )
            RETURNING *`,
            [
                req.user.id,
                title.trim(),
                description?.trim() || null,
                property_type,
                location.trim(),
                district.trim(),
                municipality?.trim() || null,
                convertedNumbers.ward_no,
                convertedNumbers.land_area_aana,
                convertedNumbers.built_up_area_sqft,
                Number(price),
                road_access || null,
                facing || null,
                convertedNumbers.floors,
                convertedNumbers.bedrooms,
                convertedNumbers.bathrooms,
                convertedNumbers.built_year,
                convertedNumbers.parking_spaces,
                parsedAmenities
            ]
        );

        const property = propertyResult.rows[0];

        for (let i = 0; i < uploadedImages.length; i++) {
            const image = uploadedImages[i];

            await client.query(
                `INSERT INTO property_images (
                    property_id,
                    image_url,
                    public_id,
                    is_primary
                )
                VALUES ($1, $2, $3, $4)`,
                [
                    property.id,
                    image.image_url,
                    image.public_id,
                    i === primaryIndex
                ]
            );
        }

        await client.query("COMMIT");
        committed = true;

        return res.status(201).json({
            success: true,
            message: "Property created successfully. Awaiting admin approval.",
            property
        });
    } catch (error) {
        console.error("Error in createProperty:", error.message);

        // Rollback database changes
        if (transactionStarted && !committed) {
            try {
                await client.query("ROLLBACK");
            } catch (rollbackError) {
                console.error("Rollback error:", rollbackError.message);
            }
        }

        // Delete uploaded Cloudinary images if creation failed
        if (!committed) {
            for (const image of uploadedImages) {
                try {
                    await deleteOnCloudinary(image.public_id);
                } catch (deleteError) {
                    console.error(
                        "Cloudinary cleanup error:",
                        deleteError.message
                    );
                }
            }
        }

        return res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });

    } finally {
    for (const file of files) {
        try {
            if (fs.existsSync(file.path)) {
                fs.unlinkSync(file.path);
            }
        } catch (error) {
            console.error("Temporary file cleanup error:", error.message);
        }
    }

    if (client) {
        client.release();
    }
}
};

// Get all properties
export const getAllProperties = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT p.*, u.full_name AS owner_name,
            u.phone AS owner_phone,
            (
                SELECT json_agg(
                    json_build_object(
                        'id', pi.id,
                        'image_url', pi.image_url,
                        'is_primary', pi.is_primary
                    )
                    ORDER BY pi.is_primary  DESC , pi.created_at ASC
                )
                FROM property_images pi
                WHERE pi.property_id = p.id
            ) AS IMAGES
            FROM properties p
            JOIN users u ON p.owner_id = u.id
            WHERE p.status = 'published'
            ORDER BY p.created_at DESC`
        );

        return res.status(200).json({
            success: true,
            count: result.rows.length,
            properties: result.rows
        });
    } catch (error) {
        console.error("Error in getAllProperties:", error.message);

        return res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};

// Get property by id
export const getPropertyById = async (req, res) => {
    try {
        const { id } = req.params;

        const result = await pool.query(
            `SELECT
                p.*,
                u.full_name AS owner_name,
                u.phone AS owner_phone,
                u.email AS owner_email,
                (
                    SELECT json_agg(
                        json_build_object(
                            'id', pi.id,
                            'image_url', pi.image_url,
                            'is_primary', pi.is_primary
                        )
                        ORDER BY pi.is_primary DESC, pi.created_at ASC
                    )
                    FROM property_images pi
                    WHERE pi.property_id = p.id
                ) AS images
            FROM properties p
            JOIN users u ON p.owner_id = u.id
            WHERE p.id = $1
            AND p.status = 'published'`,
            [id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({
                success: false,
                message: "Property not found."
            });
        }

        return res.status(200).json({
            success: true,
            property: result.rows[0]
        });

    } catch (error) {
        console.error("Error in getPropertyById:", error.message);

        return res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};

// Get my properties
export const getMyProperties = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT
                p.*,
                (
                    SELECT json_agg(
                        json_build_object(
                            'id', pi.id,
                            'image_url', pi.image_url,
                            'is_primary', pi.is_primary
                        )
                        ORDER BY pi.is_primary DESC, pi.created_at ASC
                    )
                    FROM property_images pi
                    WHERE pi.property_id = p.id
                ) AS images
            FROM properties p
            WHERE p.owner_id = $1
            ORDER BY p.created_at DESC`,
            [req.user.id]
        );

        return res.status(200).json({
            success: true,
            count: result.rowCount,
            properties: result.rows
        });

    } catch (error) {
        console.error("Error in getMyProperties:", error.message);

        return res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};

// Update property
export const updateProperty = async (req, res) => {
    let client;
    const files = req.files || [];
    const uploadedImages = [];
    let transactionStarted = false;
    let committed = false;
    let oldImages = [];

    try {
        const { id } = req.params;

        const {
            title,
            description,
            property_type,
            location,
            district,
            municipality,
            ward_no,
            land_area_aana,
            built_up_area_sqft,
            price,
            road_access,
            facing,
            floors,
            bedrooms,
            bathrooms,
            built_year,
            parking_spaces,
            amenities,
            primaryImageIndex
        } = req.body;

        if (
            !title?.trim() ||
            !property_type ||
            !location?.trim() ||
            !district?.trim() ||
            !price
        ) {
            return res.status(400).json({
                success: false,
                message: "Please provide all required property fields."
            });
        }

        if (!["house", "land", "apartment"].includes(property_type)) {
            return res.status(400).json({
                success: false,
                message: "Invalid property type."
            });
        }

        if (!Number.isFinite(Number(price)) || Number(price) <= 0) {
            return res.status(400).json({
                success: false,
                message: "Please provide a valid property price."
            });
        }

        const primaryIndex = Number(primaryImageIndex ?? 0);

        if (
            files.length > 0 &&
            (
                !Number.isInteger(primaryIndex) ||
                primaryIndex < 0 ||
                primaryIndex >= files.length
            )
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid primary image selection."
            });
        }

        const optionalNumbers = {
            ward_no,
            land_area_aana,
            built_up_area_sqft,
            floors,
            bedrooms,
            bathrooms,
            built_year,
            parking_spaces
        };

        const convertedNumbers = {};

        for (const [key, value] of Object.entries(optionalNumbers)) {
            if (value === undefined || value === null || value === "") {
                convertedNumbers[key] = null;
                continue;
            }

            const number = Number(value);

            if (!Number.isFinite(number)) {
                return res.status(400).json({
                    success: false,
                    message: `Invalid value for ${key}.`
                });
            }

            convertedNumbers[key] = number;
        }

        if (
            (convertedNumbers.ward_no !== null && convertedNumbers.ward_no <= 0) ||
            (convertedNumbers.land_area_aana !== null && convertedNumbers.land_area_aana <= 0) ||
            (convertedNumbers.built_up_area_sqft !== null && convertedNumbers.built_up_area_sqft <= 0) ||
            (convertedNumbers.floors !== null && convertedNumbers.floors <= 0) ||
            (convertedNumbers.bedrooms !== null && convertedNumbers.bedrooms < 0) ||
            (convertedNumbers.bathrooms !== null && convertedNumbers.bathrooms < 0) ||
            (convertedNumbers.built_year !== null &&
                (convertedNumbers.built_year < 1800 || convertedNumbers.built_year > 2100)) ||
            (convertedNumbers.parking_spaces !== null && convertedNumbers.parking_spaces < 0)
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid property measurements or details."
            });
        }

        let parsedAmenities = [];

        if (amenities) {
            try {
                parsedAmenities = Array.isArray(amenities)
                    ? amenities
                    : JSON.parse(amenities);

                if (
                    !Array.isArray(parsedAmenities) ||
                    !parsedAmenities.every(item => typeof item === "string")
                ) {
                    throw new Error("Invalid amenities.");
                }
            } catch {
                return res.status(400).json({
                    success: false,
                    message: "Invalid amenities format."
                });
            }
        }

        for (const file of files) {
            const result = await uploadOnCloudinary(file.path);

            if (!result?.url || !result?.public_id) {
                throw new Error("Failed to upload property image.");
            }

            uploadedImages.push({
                image_url: result.url,
                public_id: result.public_id
            });
        }
        client = await pool.connect();

        await client.query("BEGIN");
        transactionStarted = true;
        if (files.length > 0) {
            const imageResult = await client.query(
                `SELECT public_id
                 FROM property_images
                 WHERE property_id = $1`,
                [id]
            );

            oldImages = imageResult.rows;
        }

        const propertyResult = await client.query(
            `UPDATE properties
             SET
                title = $1,
                description = $2,
                property_type = $3,
                location = $4,
                district = $5,
                municipality = $6,
                ward_no = $7,
                land_area_aana = $8,
                built_up_area_sqft = $9,
                price = $10,
                road_access = $11,
                facing = $12,
                floors = $13,
                bedrooms = $14,
                bathrooms = $15,
                built_year = $16,
                parking_spaces = $17,
                amenities = $18,
                status = CASE
                    WHEN status IN ('published', 'rejected') THEN 'pending'
                    ELSE status
                END,
                updated_at = NOW()
             WHERE id = $19
             AND owner_id = $20
             AND status != 'sold'
             RETURNING *`,
            [
                title.trim(),
                description?.trim() || null,
                property_type,
                location.trim(),
                district.trim(),
                municipality?.trim() || null,
                convertedNumbers.ward_no,
                convertedNumbers.land_area_aana,
                convertedNumbers.built_up_area_sqft,
                Number(price),
                road_access || null,
                facing || null,
                convertedNumbers.floors,
                convertedNumbers.bedrooms,
                convertedNumbers.bathrooms,
                convertedNumbers.built_year,
                convertedNumbers.parking_spaces,
                parsedAmenities,
                id,
                req.user.id
            ]
        );

        if (propertyResult.rowCount === 0) {
            await client.query("ROLLBACK");
            transactionStarted = false;

            return res.status(404).json({
                success: false,
                message: "Property not found or cannot be updated."
            });
        }

        const property = propertyResult.rows[0];

        if (files.length > 0) {

            await client.query(
                `DELETE FROM property_images
                 WHERE property_id = $1`,
                [id]
            );

            for (let i = 0; i < uploadedImages.length; i++) {
                const image = uploadedImages[i];

                await client.query(
                    `INSERT INTO property_images (
                        property_id,
                        image_url,
                        public_id,
                        is_primary
                    )
                    VALUES ($1, $2, $3, $4)`,
                    [
                        id,
                        image.image_url,
                        image.public_id,
                        i === primaryIndex
                    ]
                );
            }
        }

        await client.query("COMMIT");
        committed = true;
        transactionStarted = false;

        // Delete old Cloudinary images after successful commit
        for (const image of oldImages) {
            try {
                await deleteOnCloudinary(image.public_id);
            } catch (deleteError) {
                console.error(
                    "Old image deletion error:",
                    deleteError.message
                );
            }
        }

        return res.status(200).json({
            success: true,
            message: "Property updated successfully.",
            property
        });
    } catch (error) {
        console.error("Error in updateProperty:", error.message);

        // Rollback database changes
        if (client && transactionStarted && !committed) {
            try {
                await client.query("ROLLBACK");
            } catch (rollbackError) {
                console.error("Rollback error:", rollbackError.message);
            }
        }

        // Delete newly uploaded images if update failed
        if (!committed) {
            for (const image of uploadedImages) {
                try {
                    await deleteOnCloudinary(image.public_id);
                } catch (deleteError) {
                    console.error(
                        "Cloudinary cleanup error:",
                        deleteError.message
                    );
                }
            }
        }

        return res.status(500).json({
            success: false,
            message: "Failed to update property."
        });

    } finally {
        for (const file of files) {
            try {
                if (fs.existsSync(file.path)) {
                    fs.unlinkSync(file.path);
                }
            } catch (error) {
                console.error("Temporary file cleanup error:", error.message);
            }
        }

        if (client) {
            client.release();
        }
    }
};

// Delete property
export const deleteProperty = async (req, res) => {
    try {
        const { id } = req.params;

        const propertyResult =  await pool.query(
            `SELECT id
            FROM properties
            WHERE id = $1 AND owner_id = $2`,
            [id, req.user.id]
        );

        if(propertyResult.rowCount === 0){
            return res.status(404).json({
                success: false,
                message: "Property not found"
            });
        }

        const imageResult = await pool.query(
            `SELECT public_id
            FROM property_images
            WHERE property_id = $1`,
            [id]
        );

        await pool.query(
            `DELETE FROM properties
            WHERE id = $1 AND owner_id = $2`,
            [id, req.user.id]
        );

        for(const image of imageResult.rows){
            try {
                await deleteOnCloudinary(image.public_id);
            } catch (error) {
                console.error("Cloudinary image deletion failed:", error.message);
            }
        }

        return res.status(200).json({
            success: true,
            message: "Property deleted successfully"
        });
    } catch (error) {
        console.error("Error in deleteProperty:", error.message);

        return res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};

// Get similar properties
export const getSimilarProperties = async (req, res) => {
    try {
        const { id } = req.params;

        const propertyResult = await pool.query(
            `SELECT id, property_type, district, price, land_area_aana
            FROM properties
            WHERE id = $1 AND status = 'published'`,
            [id]
        );

        if (propertyResult.rowCount === 0) {
            return res.status(404).json({
                success: false,
                message: "Property not found."
            });
        }

        const property = propertyResult.rows[0];

        const result = await pool.query(
            `SELECT
                p.*,
                u.full_name AS owner_name,
                (
                    SELECT json_agg(
                        json_build_object(
                            'id', pi.id,
                            'image_url', pi.image_url,
                            'is_primary', pi.is_primary
                        )
                        ORDER BY pi.is_primary DESC, pi.created_at ASC
                    )
                    FROM property_images pi
                    WHERE pi.property_id = p.id
                ) AS images
            FROM properties p
            JOIN users u ON p.owner_id = u.id
            WHERE p.status = 'published'
                AND p.id != $1
                AND p.property_type = $2
                AND p.district = $3
                AND p.price BETWEEN $4 * 0.8 AND $4 * 1.2
            ORDER BY
                ABS(p.price - $4) ASC,
                CASE
                    WHEN p.land_area_aana IS NOT NULL
                        AND $5::NUMERIC IS NOT NULL
                    THEN ABS(p.land_area_aana - $5::NUMERIC)
                    ELSE NULL
                END ASC
            LIMIT 8`,
            [
                id,
                property.property_type,
                property.district,
                property.price,
                property.land_area_aana
            ]
        );

        return res.status(200).json({
            success: true,
            count: result.rowCount,
            data: result.rows
        });
    } catch (error) {
        console.error("Error in getSimilarProperties:", error.message);

        return res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};

// Update property status
export const updatePropertyStatus = async (req, res) => {
    let client;
    try {
        const { id } = req.params;
        const { status, remarks } = req.body;

        if (!["approved", "rejected"].includes(status)) {
            return res.status(400).json({
                success: false,
                message: "Status must be approved or rejected."
            });
        }
        
        client = await pool.connect();

        await client.query("BEGIN");
        const propertyStatus = status === "approved" ? "published" : "rejected";

        const propertyResult = await client.query(
            `UPDATE properties
             SET status = $1,
                 updated_at = NOW()
             WHERE id = $2
               AND status = 'pending'
             RETURNING id, title, status`,
            [propertyStatus, id]
        );

        if (propertyResult.rowCount === 0) {
            await client.query("ROLLBACK");

            return res.status(404).json({
                success: false,
                message: "Pending property not found."
            });
        }

        await client.query(
            `INSERT INTO property_verifications (
                property_id,
                admin_id,
                status,
                remarks
            )
            VALUES ($1, $2, $3, $4)`,
            [id, req.user.id, status, remarks || null]
        );

        await client.query("COMMIT");

        return res.status(200).json({
            success: true,
            message: `Property ${status} successfully.`,
            property: propertyResult.rows[0]
        });
    } catch (error) {
        await client.query("ROLLBACK");

        console.error("Error in updatePropertyStatus:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to update property status."
        });
    } finally {
        client.release();
    }
};

// Get Featured Properties
export const getFeaturedProperties = async (req, res) => {
    try {

    } catch (error) {
        console.error("Error in login controller:", error.message);
        res.status(500).json({
            success: false,
            message: "Internal Server error"
        });
    }
};

// Get Latest Properties
export const getLatestProperties = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT
                p.*,
                u.full_name AS owner_name,
                (
                    SELECT json_agg(
                        json_build_object(
                            'id', pi.id,
                            'image_url', pi.image_url,
                            'is_primary', pi.is_primary
                        )
                        ORDER BY pi.is_primary DESC, pi.created_at ASC
                    )
                    FROM property_images pi
                    WHERE pi.property_id = p.id
                ) AS images
            FROM properties p
            JOIN users u ON p.owner_id = u.id
            WHERE p.status = 'published'
            ORDER BY p.created_at DESC
            LIMIT $1`,
            [10]
        );

        return res.status(200).json({
            success: true,
            count: result.rowCount,
            properties: result.rows
        });

    } catch (error) {
        console.error("Error in getLatestProperties:", error.message);

        return res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};

// Search properties
export const searchProperties = async (req, res) => {
    try {
        const {
            location,
            district,
            property_type,
            minPrice,
            maxPrice,
            bedrooms,
            minLandArea
        } = req.query;

        let query = `
            SELECT
                p.*,
                u.full_name AS owner_name,
                (
                    SELECT json_agg(
                        json_build_object(
                            'id', pi.id,
                            'image_url', pi.image_url,
                            'is_primary', pi.is_primary
                        )
                        ORDER BY pi.is_primary DESC, pi.created_at ASC
                    )
                    FROM property_images pi
                    WHERE pi.property_id = p.id
                ) AS images
            FROM properties p
            JOIN users u ON p.owner_id = u.id
            WHERE p.status = 'published'
        `;

        const values = [];
        let index = 1;

        // Search by location
        if (location) {
            query += ` AND p.location ILIKE $${index}`;
            values.push(`%${location}%`);
            index++;
        }

        // Filter by district
        if (district) {
            query += ` AND p.district ILIKE $${index}`;
            values.push(`%${district}%`);
            index++;
        }

        // Filter by property type
        if (property_type) {
            query += ` AND p.property_type = $${index}`;
            values.push(property_type);
            index++;
        }

        // Minimum price
        if (minPrice) {
            query += ` AND p.price >= $${index}`;
            values.push(Number(minPrice));
            index++;
        }

        // Maximum price
        if (maxPrice) {
            query += ` AND p.price <= $${index}`;
            values.push(Number(maxPrice));
            index++;
        }

        // Minimum bedrooms
        if (bedrooms) {
            query += ` AND p.bedrooms >= $${index}`;
            values.push(Number(bedrooms));
            index++;
        }

        // Minimum land area
        if (minLandArea) {
            query += ` AND p.land_area_aana >= $${index}`;
            values.push(Number(minLandArea));
            index++;
        }

        query += ` ORDER BY p.created_at DESC`;

        const result = await pool.query(query, values);

        return res.status(200).json({
            success: true,
            count: result.rowCount,
            properties: result.rows
        });

    } catch (error) {
        console.error("Error in searchProperties:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to search properties."
        });
    }
};

// Get Property Stats
export const getPropertyStats = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT
                COUNT(*) AS total_properties,

                COUNT(*) FILTER (
                    WHERE status = 'published'
                ) AS published_properties,

                COUNT(*) FILTER (
                    WHERE status = 'pending'
                ) AS pending_properties,

                COUNT(*) FILTER (
                    WHERE status = 'rejected'
                ) AS rejected_properties,

                COUNT(*) FILTER (
                    WHERE status = 'sold'
                ) AS sold_properties

            FROM properties
            WHERE owner_id = $1`,
            [req.user.id]
        );

        return res.status(200).json({
            success: true,
            stats: result.rows[0]
        });

    } catch (error) {
        console.error("Error in getPropertyStats:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to fetch property statistics."
        });
    }
};

// Get all properties admin
export const getAllPropertiesAdmin = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT
                p.*,
                u.full_name AS owner_name,
                u.email AS owner_email,
                u.phone AS owner_phone,
                (
                    SELECT json_agg(
                        json_build_object(
                            'id', pi.id,
                            'image_url', pi.image_url,
                            'is_primary', pi.is_primary
                        )
                        ORDER BY pi.is_primary DESC, pi.created_at ASC
                    )
                    FROM property_images pi
                    WHERE pi.property_id = p.id
                ) AS images
            FROM properties p
            JOIN users u ON p.owner_id = u.id
            ORDER BY p.created_at DESC`
        );

        return res.status(200).json({
            success: true,
            count: result.rowCount,
            properties: result.rows
        });
    } catch (error) {
        console.error("Error in getAllPropertiesAdmin:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to fetch properties."
        });
    }
}