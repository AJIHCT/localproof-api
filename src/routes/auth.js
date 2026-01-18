const express = require('express');
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../db');
const { authenticate } = require('../middleware/auth');
const { AppError, asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

/**
 * POST /api/auth/register
 * Register a new user
 */
router.post('/register', [
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('phone').optional().trim()
], asyncHandler(async (req, res) => {
  // Validate input
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new AppError(errors.array()[0].msg, 400);
  }

  const { email, password, name, phone } = req.body;

  // Check if user exists
  const existingUser = await query('SELECT id FROM users WHERE email = $1', [email]);
  if (existingUser.rows.length > 0) {
    throw new AppError('Email already registered', 409);
  }

  // Hash password
  const passwordHash = await bcrypt.hash(password, 10);

  // Create user
  const result = await query(
    `INSERT INTO users (email, password_hash, name, phone)
     VALUES ($1, $2, $3, $4)
     RETURNING id, email, name, phone, total_points, created_at`,
    [email, passwordHash, name, phone]
  );

  const user = result.rows[0];

  // Generate token
  const token = jwt.sign(
    { userId: user.id },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );

  res.status(201).json({
    message: 'Registration successful',
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      totalPoints: user.total_points
    },
    token
  });
}));

/**
 * POST /api/auth/login
 * Login user and return token
 */
router.post('/login', [
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').notEmpty().withMessage('Password required')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new AppError(errors.array()[0].msg, 400);
  }

  const { email, password } = req.body;

  // Find user
  const result = await query(
    'SELECT id, email, name, phone, password_hash, total_points, is_active FROM users WHERE email = $1',
    [email]
  );

  if (result.rows.length === 0) {
    throw new AppError('Invalid email or password', 401);
  }

  const user = result.rows[0];

  if (!user.is_active) {
    throw new AppError('Account is deactivated', 401);
  }

  // Verify password
  const isValidPassword = await bcrypt.compare(password, user.password_hash);
  if (!isValidPassword) {
    throw new AppError('Invalid email or password', 401);
  }

  // Generate token
  const token = jwt.sign(
    { userId: user.id },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );

  res.json({
    message: 'Login successful',
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      totalPoints: user.total_points
    },
    token
  });
}));

/**
 * GET /api/auth/me
 * Get current user profile
 */
router.get('/me', authenticate, asyncHandler(async (req, res) => {
  // Get full user data with stats
  const result = await query(`
    SELECT 
      u.id, u.email, u.name, u.phone, u.total_points, u.created_at,
      (SELECT COUNT(*) FROM checkins WHERE user_id = u.id) as total_checkins,
      (SELECT COUNT(DISTINCT business_id) FROM checkins WHERE user_id = u.id) as businesses_visited
    FROM users u
    WHERE u.id = $1
  `, [req.user.id]);

  const user = result.rows[0];

  res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    phone: user.phone,
    totalPoints: parseInt(user.total_points),
    totalCheckins: parseInt(user.total_checkins),
    businessesVisited: parseInt(user.businesses_visited),
    memberSince: user.created_at
  });
}));

/**
 * PUT /api/auth/me
 * Update current user profile
 */
router.put('/me', authenticate, [
  body('name').optional().trim().notEmpty().withMessage('Name cannot be empty'),
  body('phone').optional().trim()
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new AppError(errors.array()[0].msg, 400);
  }

  const { name, phone } = req.body;
  const updates = [];
  const values = [];
  let paramCount = 1;

  if (name) {
    updates.push(`name = $${paramCount++}`);
    values.push(name);
  }
  if (phone !== undefined) {
    updates.push(`phone = $${paramCount++}`);
    values.push(phone);
  }

  if (updates.length === 0) {
    throw new AppError('No fields to update', 400);
  }

  updates.push(`updated_at = CURRENT_TIMESTAMP`);
  values.push(req.user.id);

  const result = await query(
    `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING id, email, name, phone, total_points`,
    values
  );

  res.json({
    message: 'Profile updated',
    user: {
      id: result.rows[0].id,
      email: result.rows[0].email,
      name: result.rows[0].name,
      phone: result.rows[0].phone,
      totalPoints: result.rows[0].total_points
    }
  });
}));

module.exports = router;
