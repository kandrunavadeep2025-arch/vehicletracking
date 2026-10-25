
require("dotenv").config();

const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
    console.error("Missing JWT_SECRET in .env");
    process.exit(1);
}

app.use(cors());
app.use(express.json());
app.use(express.static("public"));



const db = mysql.createConnection({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || "vehicle_tracking",
  ssl: {
    rejectUnauthorized: true
  }
});


db.connect((err) => {
    if (err) {
        console.error("MySQL connection failed:", err.message);
        process.exit(1);
    }

    console.log("MySQL connected successfully!");
});

// ============================================
// HELPERS
// ============================================

function query(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.query(sql, params, (err, results) => {
            if (err) reject(err);
            else resolve(results);
        });
    });
}

function errorResponse(res, err, message) {
    console.error(message + ":", err.message);
    return res.status(500).json({ error: message });
}

function authenticateToken(req, res, next) {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(" ")[1];

    if (!token) {
        return res.status(401).json({
            error: "Access denied. Please log in."
        });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err || !user || !user.user_id) {
            return res.status(403).json({
                error: "Invalid or expired token. Please log in again."
            });
        }

        req.user = user;
        next();
    });
}

async function ownsVehicle(vehicleId, userId) {
    const rows = await query(
        "SELECT vehicle_id FROM vehicle WHERE vehicle_id = ? AND user_id = ?",
        [vehicleId, userId]
    );

    return rows.length > 0;
}

function validDate(value) {
    if (typeof value !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return false;
    }

    const date = new Date(`${value}T00:00:00Z`);

    return !Number.isNaN(date.getTime()) &&
        date.toISOString().slice(0, 10) === value;
}

// ============================================
// TEST
// ============================================

app.get("/api/test-route", (req, res) => {
    res.json({
        message: "Vehicle Tracking API is running"
    });
});

// ============================================
// REGISTER
// ============================================

app.post("/api/register", async (req, res) => {
    try {
        const { name, email, phone, password } = req.body;

        if (
            typeof name !== "string" || !name.trim() ||
            typeof email !== "string" || !email.trim() ||
            typeof password !== "string"
        ) {
            return res.status(400).json({
                error: "Name, email and password are required"
            });
        }

        if (password.length < 8) {
            return res.status(400).json({
                error: "Password must be at least 8 characters"
            });
        }

        const normalizedEmail = email.trim().toLowerCase();

        const existing = await query(
            "SELECT user_id FROM users WHERE email = ?",
            [normalizedEmail]
        );

        if (existing.length) {
            return res.status(409).json({
                error: "An account with this email already exists"
            });
        }

        const passwordHash = await bcrypt.hash(password, 12);

        const result = await query(
            `INSERT INTO users (name, email, phone, password_hash)
             VALUES (?, ?, ?, ?)`,
            [
                name.trim(),
                normalizedEmail,
                phone ? String(phone).trim() : null,
                passwordHash
            ]
        );

        const user = {
            user_id: result.insertId,
            name: name.trim(),
            email: normalizedEmail,
            phone: phone || null
        };

        const token = jwt.sign(
            { user_id: user.user_id },
            JWT_SECRET,
            { expiresIn: "1d" }
        );

        res.status(201).json({
            message: "Account created successfully",
            token,
            user
        });
    } catch (err) {
        if (err.code === "ER_DUP_ENTRY") {
            return res.status(409).json({
                error: "An account with this email already exists"
            });
        }

        errorResponse(res, err, "Registration failed");
    }
});

// ============================================
// LOGIN
// ============================================

app.post("/api/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                error: "Email and password are required"
            });
        }

        const rows = await query(
            `SELECT user_id, name, email, phone, password_hash
             FROM users WHERE email = ?`,
            [String(email).trim().toLowerCase()]
        );

        if (
            !rows.length ||
            !rows[0].password_hash ||
            !(await bcrypt.compare(password, rows[0].password_hash))
        ) {
            return res.status(401).json({
                error: "Invalid email or password"
            });
        }

        const row = rows[0];

        const user = {
            user_id: row.user_id,
            name: row.name,
            email: row.email,
            phone: row.phone
        };

        const token = jwt.sign(
            { user_id: user.user_id },
            JWT_SECRET,
            { expiresIn: "1d" }
        );

        res.json({
            message: "Login successful",
            token,
            user
        });
    } catch (err) {
        errorResponse(res, err, "Login failed");
    }
});

// ============================================
// CURRENT USER
// ============================================

app.get("/api/me", authenticateToken, async (req, res) => {
    try {
        const rows = await query(
            `SELECT user_id, name, email, phone
             FROM users WHERE user_id = ?`,
            [req.user.user_id]
        );

        if (!rows.length) {
            return res.status(404).json({
                error: "User account not found"
            });
        }

        res.json(rows[0]);
    } catch (err) {
        errorResponse(res, err, "Failed to load profile");
    }
});

// ============================================
// DASHBOARD
// ============================================

app.get("/api/dashboard", authenticateToken, async (req, res) => {
    try {
        const userId = req.user.user_id;

        const rows = await query(
            `SELECT
                (SELECT COUNT(*)
                 FROM vehicle
                 WHERE user_id = ?) AS vehicles,

                (SELECT COUNT(*)
                 FROM license
                 WHERE user_id = ?
                   AND expiry_date <= DATE_ADD(CURDATE(), INTERVAL 7 DAY)
                ) AS licenseAlerts,

                (SELECT COUNT(*)
                 FROM puc p
                 JOIN vehicle v ON v.vehicle_id = p.vehicle_id
                 WHERE v.user_id = ?
                   AND p.expiry_date <= DATE_ADD(CURDATE(), INTERVAL 7 DAY)
                ) AS pucAlerts,

                (SELECT COUNT(*)
                 FROM service s
                 JOIN vehicle v ON v.vehicle_id = s.vehicle_id
                 WHERE v.user_id = ?) AS serviceRecords,

                (SELECT COUNT(*)
                 FROM alert a
                 JOIN vehicle v ON v.vehicle_id = a.vehicle_id
                 WHERE v.user_id = ?
                   AND a.status = 'Pending'
                ) AS pendingAlerts`,
            [userId, userId, userId, userId, userId]
        );

        res.json(rows[0]);
    } catch (err) {
        errorResponse(res, err, "Failed to load dashboard");
    }
});

// ============================================
// GET VEHICLES
// ============================================

app.get("/api/vehicles", authenticateToken, async (req, res) => {
    try {
        const rows = await query(
            `SELECT v.vehicle_id, v.user_id,
                    v.registration_number, v.vehicle_type,
                    v.brand, v.model, v.manufacturing_year,
                    u.name AS owner_name,
                    u.email AS owner_email,
                    u.phone AS owner_phone
             FROM vehicle v
             JOIN users u ON u.user_id = v.user_id
             WHERE v.user_id = ?
             ORDER BY v.vehicle_id DESC`,
            [req.user.user_id]
        );

        res.json(rows);
    } catch (err) {
        errorResponse(res, err, "Failed to load vehicles");
    }
});

// ============================================
// COMPLETE VEHICLE PROFILE
// ============================================

app.get("/api/vehicles/:id/profile", authenticateToken, async (req, res) => {
    try {
        const vehicleId = req.params.id;
        const userId = req.user.user_id;

        const vehicles = await query(
            `SELECT v.*, u.name AS owner_name,
                    u.email AS owner_email, u.phone AS owner_phone
             FROM vehicle v
             JOIN users u ON u.user_id = v.user_id
             WHERE v.vehicle_id = ? AND v.user_id = ?`,
            [vehicleId, userId]
        );

        if (!vehicles.length) {
            return res.status(404).json({
                error: "Vehicle not found"
            });
        }

        const licenses = await query(
            `SELECT license_id, license_number,
                    DATE_FORMAT(issue_date, '%Y-%m-%d') AS issue_date,
                    DATE_FORMAT(expiry_date, '%Y-%m-%d') AS expiry_date
             FROM license
             WHERE user_id = ?
             ORDER BY license_id DESC
             LIMIT 1`,
            [userId]
        );

        const pucs = await query(
            `SELECT puc_id, puc_number,
                    DATE_FORMAT(issue_date, '%Y-%m-%d') AS issue_date,
                    DATE_FORMAT(expiry_date, '%Y-%m-%d') AS expiry_date
             FROM puc
             WHERE vehicle_id = ?
             ORDER BY puc_id DESC
             LIMIT 1`,
            [vehicleId]
        );

        const services = await query(
            `SELECT service_id,
                    DATE_FORMAT(service_date, '%Y-%m-%d') AS service_date,
                    service_type, cost, odometer_reading, description
             FROM service
             WHERE vehicle_id = ?
             ORDER BY service_date DESC`,
            [vehicleId]
        );

        const kms = services
            .map(row => Number(row.odometer_reading))
            .filter(value => Number.isFinite(value) && value >= 0);

        res.json({
            vehicle: vehicles[0],
            license: licenses[0] || null,
            puc: pucs[0] || null,
            services,
            km_driven: kms.length > 1
                ? Math.max(...kms) - Math.min(...kms)
                : 0
        });
    } catch (err) {
        errorResponse(res, err, "Failed to load vehicle profile");
    }
});

// ============================================
// ADD VEHICLE — PUC IS OPTIONAL
// ============================================

app.post("/api/vehicles", authenticateToken, async (req, res) => {
    try {
        const {
            registration_number,
            vehicle_type,
            brand,
            model,
            manufacturing_year,
            puc_number,
            puc_issue_date,
            puc_expiry_date
        } = req.body;

        if (
            typeof registration_number !== "string" ||
            !registration_number.trim()
        ) {
            return res.status(400).json({
                error: "Registration number is required"
            });
        }

        // Validate PUC before inserting the vehicle.
        // All three PUC fields may be blank.
        const pucFields = [
            puc_number,
            puc_issue_date,
            puc_expiry_date
        ];

        const filledPucFields = pucFields.filter(
            value => value !== undefined &&
                value !== null &&
                String(value).trim() !== ""
        ).length;

        if (filledPucFields > 0 && filledPucFields < 3) {
            return res.status(400).json({
                error: "Enter all three PUC fields, or leave all three blank."
            });
        }

        if (filledPucFields === 3) {
            if (
                !validDate(puc_issue_date) ||
                !validDate(puc_expiry_date) ||
                puc_expiry_date < puc_issue_date
            ) {
                return res.status(400).json({
                    error: "Please enter valid PUC issue and expiry dates."
                });
            }
        }

        const registration = registration_number.trim().toUpperCase();

        const result = await query(
            `INSERT INTO vehicle
                (user_id, registration_number, vehicle_type,
                 brand, model, manufacturing_year)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                req.user.user_id,
                registration,
                vehicle_type || null,
                brand || null,
                model || null,
                manufacturing_year || null
            ]
        );

        // A PUC record is created only when all fields are supplied.
        if (filledPucFields === 3) {
            await query(
                `INSERT INTO puc
                    (vehicle_id, puc_number, issue_date, expiry_date)
                 VALUES (?, ?, ?, ?)`,
                [
                    result.insertId,
                    String(puc_number).trim(),
                    puc_issue_date,
                    puc_expiry_date
                ]
            );
        }

        res.status(201).json({
            message: "Vehicle added successfully",
            vehicle_id: result.insertId
        });
    } catch (err) {
        if (err.code === "ER_DUP_ENTRY") {
            return res.status(409).json({
                error: "Registration number or PUC number already exists"
            });
        }

        errorResponse(res, err, "Failed to add vehicle");
    }
});

// ============================================
// UPDATE VEHICLE
// ============================================

app.put("/api/vehicles/:id", authenticateToken, async (req, res) => {
    try {
        const {
            registration_number,
            vehicle_type,
            brand,
            model,
            manufacturing_year
        } = req.body;

        if (
            typeof registration_number !== "string" ||
            !registration_number.trim()
        ) {
            return res.status(400).json({
                error: "Registration number is required"
            });
        }

        const result = await query(
            `UPDATE vehicle
             SET registration_number = ?,
                 vehicle_type = ?,
                 brand = ?,
                 model = ?,
                 manufacturing_year = ?
             WHERE vehicle_id = ? AND user_id = ?`,
            [
                registration_number.trim().toUpperCase(),
                vehicle_type || null,
                brand || null,
                model || null,
                manufacturing_year || null,
                req.params.id,
                req.user.user_id
            ]
        );

        if (!result.affectedRows) {
            const rows = await query(
                `SELECT vehicle_id FROM vehicle
                 WHERE vehicle_id = ? AND user_id = ?`,
                [req.params.id, req.user.user_id]
            );

            if (!rows.length) {
                return res.status(404).json({
                    error: "Vehicle not found or access denied"
                });
            }
        }

        res.json({
            message: "Vehicle updated successfully"
        });
    } catch (err) {
        if (err.code === "ER_DUP_ENTRY") {
            return res.status(409).json({
                error: "This registration number already exists"
            });
        }

        errorResponse(res, err, "Failed to update vehicle");
    }
});

// ============================================
// DELETE VEHICLE
// ============================================

app.delete("/api/vehicles/:id", authenticateToken, async (req, res) => {
    const vehicleId = req.params.id;
    const userId = req.user.user_id;

    db.beginTransaction(async (transactionError) => {
        if (transactionError) {
            return res.status(500).json({
                error: "Failed to start transaction"
            });
        }

        try {
            const rows = await query(
                `SELECT vehicle_id FROM vehicle
                 WHERE vehicle_id = ? AND user_id = ?`,
                [vehicleId, userId]
            );

            if (!rows.length) {
                return db.rollback(() => {
                    res.status(404).json({
                        error: "Vehicle not found or access denied"
                    });
                });
            }

            // Do not delete license records here.
            // A driving license belongs to the account holder, not a vehicle.
            const tables = [
                "alert",
                "km_history",
                "maintenance",
                "service",
                "puc"
            ];

            for (const table of tables) {
                await query(
                    `DELETE FROM ${table} WHERE vehicle_id = ?`,
                    [vehicleId]
                );
            }

            await query(
                `DELETE FROM vehicle
                 WHERE vehicle_id = ? AND user_id = ?`,
                [vehicleId, userId]
            );

            db.commit((commitError) => {
                if (commitError) {
                    return db.rollback(() => {
                        res.status(500).json({
                            error: "Failed to complete deletion"
                        });
                    });
                }

                res.json({
                    message: "Vehicle deleted successfully"
                });
            });
        } catch (err) {
            db.rollback(() => {
                errorResponse(res, err, "Failed to delete vehicle");
            });
        }
    });
});

// ============================================
// DRIVING LICENSE — ONE PER ACCOUNT
// ============================================

app.get("/api/licenses", authenticateToken, async (req, res) => {
    try {
        const rows = await query(
            `SELECT license_id, user_id, license_number,
                    DATE_FORMAT(issue_date, '%Y-%m-%d') AS issue_date,
                    DATE_FORMAT(expiry_date, '%Y-%m-%d') AS expiry_date,
                    CASE
                        WHEN expiry_date < CURDATE() THEN 'Expired'
                        WHEN expiry_date <= DATE_ADD(CURDATE(), INTERVAL 7 DAY)
                            THEN 'Expiring Soon'
                        ELSE 'Valid'
                    END AS status
             FROM license
             WHERE user_id = ?
             ORDER BY expiry_date`,
            [req.user.user_id]
        );

        res.json(rows);
    } catch (err) {
        errorResponse(res, err, "Failed to load licenses");
    }
});

app.post("/api/licenses", authenticateToken, async (req, res) => {
    try {
        const { license_number, issue_date, expiry_date } = req.body;

        if (
            typeof license_number !== "string" ||
            !license_number.trim() ||
            !validDate(issue_date) ||
            !validDate(expiry_date)
        ) {
            return res.status(400).json({
                error: "License number and valid issue/expiry dates are required"
            });
        }

        if (expiry_date < issue_date) {
            return res.status(400).json({
                error: "Expiry date cannot be before issue date"
            });
        }

        const existing = await query(
            `SELECT license_id FROM license
             WHERE user_id = ?
             ORDER BY license_id DESC
             LIMIT 1`,
            [req.user.user_id]
        );

        if (existing.length) {
            await query(
                `UPDATE license
                 SET license_number = ?, issue_date = ?, expiry_date = ?
                 WHERE license_id = ?`,
                [
                    license_number.trim(),
                    issue_date,
                    expiry_date,
                    existing[0].license_id
                ]
            );

            return res.json({
                message: "License record updated successfully",
                license_id: existing[0].license_id
            });
        }

        const result = await query(
            `INSERT INTO license
                (user_id, license_number, issue_date, expiry_date)
             VALUES (?, ?, ?, ?)`,
            [
                req.user.user_id,
                license_number.trim(),
                issue_date,
                expiry_date
            ]
        );

        res.status(201).json({
            message: "License record saved successfully",
            license_id: result.insertId
        });
    } catch (err) {
        if (err.code === "ER_DUP_ENTRY") {
            return res.status(409).json({
                error: "This license number is already in use"
            });
        }

        errorResponse(res, err, "Failed to save license record");
    }
});

// ============================================
// PUC — SHOW EVERY VEHICLE
// ============================================

app.get("/api/puc", authenticateToken, async (req, res) => {
    try {
        const rows = await query(
            `SELECT p.puc_id, v.vehicle_id,
                    v.registration_number,
                    u.name AS owner_name,
                    p.puc_number,
                    DATE_FORMAT(p.issue_date, '%Y-%m-%d') AS issue_date,
                    DATE_FORMAT(p.expiry_date, '%Y-%m-%d') AS expiry_date,
                    CASE
                        WHEN p.puc_id IS NULL THEN 'Not Added'
                        WHEN p.expiry_date IS NULL THEN 'Not Added'
                        WHEN p.expiry_date < CURDATE() THEN 'Expired'
                        WHEN p.expiry_date <= DATE_ADD(CURDATE(), INTERVAL 7 DAY)
                            THEN 'Expiring Soon'
                        ELSE 'Valid'
                    END AS status
             FROM vehicle v
             JOIN users u ON u.user_id = v.user_id
             LEFT JOIN puc p ON p.vehicle_id = v.vehicle_id
             WHERE v.user_id = ?
             ORDER BY v.registration_number`,
            [req.user.user_id]
        );

        res.json(rows);
    } catch (err) {
        errorResponse(res, err, "Failed to load PUC records");
    }
});

app.post("/api/puc", authenticateToken, async (req, res) => {
    try {
        const { vehicle_id, puc_number, issue_date, expiry_date } = req.body;

        if (
            !vehicle_id ||
            typeof puc_number !== "string" ||
            !puc_number.trim() ||
            !validDate(issue_date) ||
            !validDate(expiry_date)
        ) {
            return res.status(400).json({
                error: "Vehicle, PUC number, and valid issue/expiry dates are required"
            });
        }

        if (expiry_date < issue_date) {
            return res.status(400).json({
                error: "Expiry date cannot be before issue date"
            });
        }

        if (!(await ownsVehicle(vehicle_id, req.user.user_id))) {
            return res.status(404).json({
                error: "Vehicle not found or access denied"
            });
        }

        const existing = await query(
            `SELECT puc_id FROM puc
             WHERE vehicle_id = ?
             ORDER BY puc_id DESC
             LIMIT 1`,
            [vehicle_id]
        );

        if (existing.length) {
            await query(
                `UPDATE puc
                 SET puc_number = ?, issue_date = ?, expiry_date = ?
                 WHERE puc_id = ?`,
                [
                    puc_number.trim(),
                    issue_date,
                    expiry_date,
                    existing[0].puc_id
                ]
            );

            return res.json({
                message: "PUC details updated successfully",
                puc_id: existing[0].puc_id
            });
        }

        const result = await query(
            `INSERT INTO puc
                (vehicle_id, puc_number, issue_date, expiry_date)
             VALUES (?, ?, ?, ?)`,
            [vehicle_id, puc_number.trim(), issue_date, expiry_date]
        );

        res.status(201).json({
            message: "PUC details saved successfully",
            puc_id: result.insertId
        });
    } catch (err) {
        if (err.code === "ER_DUP_ENTRY") {
            return res.status(409).json({
                error: "This PUC number is already in use"
            });
        }

        errorResponse(res, err, "Failed to save PUC record");
    }
});

// ============================================
// SERVICE HISTORY
// ============================================

app.get("/api/services", authenticateToken, async (req, res) => {
    try {
        const rows = await query(
            `SELECT s.service_id, s.vehicle_id,
                    v.registration_number,
                    u.name AS owner_name,
                    DATE_FORMAT(s.service_date, '%Y-%m-%d') AS service_date,
                    s.service_type, s.cost,
                    s.odometer_reading, s.description
             FROM service s
             JOIN vehicle v ON v.vehicle_id = s.vehicle_id
             JOIN users u ON u.user_id = v.user_id
             WHERE v.user_id = ?
             ORDER BY s.service_date DESC`,
            [req.user.user_id]
        );

        res.json(rows);
    } catch (err) {
        errorResponse(res, err, "Failed to load service records");
    }
});

app.post("/api/services", authenticateToken, async (req, res) => {
    try {
        const {
            vehicle_id, service_date, service_type,
            cost, odometer_reading, description
        } = req.body;

        if (!vehicle_id || !validDate(service_date)) {
            return res.status(400).json({
                error: "Vehicle and valid service date are required"
            });
        }

        if (!(await ownsVehicle(vehicle_id, req.user.user_id))) {
            return res.status(404).json({
                error: "Vehicle not found or access denied"
            });
        }

        if (
            cost !== "" && cost != null &&
            (!Number.isFinite(Number(cost)) || Number(cost) < 0)
        ) {
            return res.status(400).json({
                error: "Cost must be a non-negative number"
            });
        }

        if (
            odometer_reading !== "" && odometer_reading != null &&
            (!Number.isFinite(Number(odometer_reading)) ||
                Number(odometer_reading) < 0)
        ) {
            return res.status(400).json({
                error: "Odometer reading must be a non-negative number"
            });
        }

        const result = await query(
            `INSERT INTO service
                (vehicle_id, service_date, service_type, cost,
                 odometer_reading, description)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                vehicle_id,
                service_date,
                service_type || null,
                cost === "" || cost == null ? null : Number(cost),
                odometer_reading === "" || odometer_reading == null
                    ? null : Number(odometer_reading),
                description || null
            ]
        );

        res.status(201).json({
            message: "Service record added successfully",
            service_id: result.insertId
        });
    } catch (err) {
        errorResponse(res, err, "Failed to add service record");
    }
});

// ============================================
// MAINTENANCE — KEPT FOR EXISTING DATA
// ============================================

app.get("/api/maintenance", authenticateToken, async (req, res) => {
    try {
        const rows = await query(
            `SELECT m.maintenance_id, m.vehicle_id,
                    v.registration_number, u.name AS owner_name,
                    DATE_FORMAT(m.maintenance_date, '%Y-%m-%d') AS maintenance_date,
                    m.maintenance_type, m.cost, m.description
             FROM maintenance m
             JOIN vehicle v ON v.vehicle_id = m.vehicle_id
             JOIN users u ON u.user_id = v.user_id
             WHERE v.user_id = ?
             ORDER BY m.maintenance_date DESC`,
            [req.user.user_id]
        );

        res.json(rows);
    } catch (err) {
        errorResponse(res, err, "Failed to load maintenance records");
    }
});

app.post("/api/maintenance", authenticateToken, async (req, res) => {
    try {
        const {
            vehicle_id, maintenance_date, maintenance_type,
            cost, description
        } = req.body;

        if (!vehicle_id || !validDate(maintenance_date)) {
            return res.status(400).json({
                error: "Vehicle and valid maintenance date are required"
            });
        }

        if (!(await ownsVehicle(vehicle_id, req.user.user_id))) {
            return res.status(404).json({
                error: "Vehicle not found or access denied"
            });
        }

        const result = await query(
            `INSERT INTO maintenance
                (vehicle_id, maintenance_date, maintenance_type, cost, description)
             VALUES (?, ?, ?, ?, ?)`,
            [
                vehicle_id,
                maintenance_date,
                maintenance_type || null,
                cost === "" || cost == null ? null : cost,
                description || null
            ]
        );

        res.status(201).json({
            message: "Maintenance record added successfully",
            maintenance_id: result.insertId
        });
    } catch (err) {
        errorResponse(res, err, "Failed to add maintenance record");
    }
});

// ============================================
// KM HISTORY — KEPT FOR EXISTING DATA
// ============================================

app.get("/api/km-history", authenticateToken, async (req, res) => {
    try {
        const rows = await query(
            `SELECT k.km_id, k.vehicle_id,
                    v.registration_number,
                    DATE_FORMAT(k.recorded_date, '%Y-%m-%d') AS recorded_date,
                    k.km_reading
             FROM km_history k
             JOIN vehicle v ON v.vehicle_id = k.vehicle_id
             WHERE v.user_id = ?
             ORDER BY k.recorded_date DESC`,
            [req.user.user_id]
        );

        res.json(rows);
    } catch (err) {
        errorResponse(res, err, "Failed to load KM history");
    }
});

app.post("/api/km-history", authenticateToken, async (req, res) => {
    try {
        const { vehicle_id, recorded_date, km_reading } = req.body;

        if (
            !vehicle_id ||
            !validDate(recorded_date) ||
            km_reading === "" ||
            km_reading == null ||
            !Number.isFinite(Number(km_reading)) ||
            Number(km_reading) < 0
        ) {
            return res.status(400).json({
                error: "Vehicle, valid date, and non-negative KM reading are required"
            });
        }

        if (!(await ownsVehicle(vehicle_id, req.user.user_id))) {
            return res.status(404).json({
                error: "Vehicle not found or access denied"
            });
        }

        const result = await query(
            `INSERT INTO km_history (vehicle_id, recorded_date, km_reading)
             VALUES (?, ?, ?)`,
            [vehicle_id, recorded_date, Number(km_reading)]
        );

        res.status(201).json({
            message: "KM record added successfully",
            km_id: result.insertId
        });
    } catch (err) {
        errorResponse(res, err, "Failed to add KM record");
    }
});

// ============================================
// EXPIRY ALERTS — LICENSE AND PUC
// ============================================

app.get("/api/alerts", authenticateToken, async (req, res) => {
    try {
        const userId = req.user.user_id;

        const rows = await query(
            `SELECT *
             FROM (
                SELECT
                    CONCAT('license-', l.license_id) AS alert_id,
                    NULL AS vehicle_id,
                    NULL AS registration_number,
                    'Driving License' AS alert_type,
                    CONCAT(
                        'Driving license ', l.license_number,
                        CASE
                            WHEN l.expiry_date < CURDATE() THEN ' expired '
                            ELSE ' expires '
                        END,
                        DATE_FORMAT(l.expiry_date, '%d %b %Y')
                    ) AS message,
                    DATE_FORMAT(l.expiry_date, '%Y-%m-%d') AS alert_date,
                    'Pending' AS status
                FROM license l
                WHERE l.user_id = ?
                  AND l.expiry_date <= DATE_ADD(CURDATE(), INTERVAL 7 DAY)

                UNION ALL

                SELECT
                    CONCAT('puc-', p.puc_id) AS alert_id,
                    p.vehicle_id,
                    v.registration_number,
                    'PUC' AS alert_type,
                    CONCAT(
                        v.registration_number, ' PUC',
                        CASE
                            WHEN p.expiry_date < CURDATE() THEN ' expired '
                            ELSE ' expires '
                        END,
                        DATE_FORMAT(p.expiry_date, '%d %b %Y')
                    ) AS message,
                    DATE_FORMAT(p.expiry_date, '%Y-%m-%d') AS alert_date,
                    'Pending' AS status
                FROM puc p
                JOIN vehicle v ON v.vehicle_id = p.vehicle_id
                WHERE v.user_id = ?
                  AND p.expiry_date IS NOT NULL
                  AND p.expiry_date <= DATE_ADD(CURDATE(), INTERVAL 7 DAY)
             ) AS expiry_alerts
             ORDER BY alert_date`,
            [userId, userId]
        );

        res.json(rows);
    } catch (err) {
        errorResponse(res, err, "Failed to load alerts");
    }
});

// ============================================
// STORED ALERT STATUS
// ============================================

app.put("/api/alerts/:id", authenticateToken, async (req, res) => {
    try {
        const { status } = req.body;

        if (!["Pending", "Completed"].includes(status)) {
            return res.status(400).json({
                error: "Invalid alert status"
            });
        }

        const result = await query(
            `UPDATE alert a
             JOIN vehicle v ON v.vehicle_id = a.vehicle_id
             SET a.status = ?
             WHERE a.alert_id = ? AND v.user_id = ?`,
            [status, req.params.id, req.user.user_id]
        );

        if (!result.affectedRows) {
            return res.status(404).json({
                error: "Stored alert not found or access denied"
            });
        }

        res.json({
            message: "Alert status updated successfully"
        });
    } catch (err) {
        errorResponse(res, err, "Failed to update alert");
    }
});

// ============================================
// VEHICLE STATUS
// ============================================

app.get("/api/vehicle-status", authenticateToken, async (req, res) => {
    try {
        const rows = await query(
            `SELECT vs.*
             FROM vehicle_status vs
             JOIN vehicle v
               ON v.registration_number = vs.registration_number
             WHERE v.user_id = ?
             ORDER BY vs.registration_number`,
            [req.user.user_id]
        );

        res.json(rows);
    } catch (err) {
        errorResponse(res, err, "Failed to load vehicle status");
    }
});

// ============================================
// START SERVER
// ============================================

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
});
