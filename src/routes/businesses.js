const express = require('express');
const { body, validationResult } = require('express-validator');
const { query } = require('../db');
const { authenticate, optionalAuth, requireBusinessOwner } = require('../middleware/auth');
const { AppError, asyncHandler } = require('../middleware/errorHandler');
const { calculateDistance } = require('../utils/geo');

const router = express.Router();

/**
 * GET /api/businesses
 * List all active businesses (with optional location filtering)
 */
router.get('/', optionalAuth, asyncHandler(async (req, res) => {
  const { lat, lng, radius = 5000, category, limit = 50, offset = 0 } = req.query;

  let sql = `
    SELECT 
      id, name, slug, description, address, city, state, zip,
      lat, lng, phone, website, category, logo_url,
      points_per_checkin, photo_bonus_points
    FROM businesses
    WHERE is_active = true
  `;
  const params = [];
  let paramCount = 1;

  if (category) {
    sql += ` AND category = $${paramCount++}`;
    params.push(category);
  }

  sql += ` ORDER BY name ASC LIMIT $${paramCount++} OFFSET $${paramCount++}`;
  params.push(parseInt(limit), parseInt(offset));

  const result = await query(sql, params);

  let businesses = result.rows.map(b => ({
    id: b.id,
    name: b.name,
    slug: b.slug,
    description: b.description,
    address: b.address,
    city: b.city,
    state: b.state,
    zip: b.zip,
    lat: parseFloat(b.lat),
    lng: parseFloat(b.lng),
    phone: b.phone,
    website: b.website,
    category: b.category,
    logoUrl: b.logo_url,
    pointsPerCheckin: b.points_per_checkin,
    photoBonusPoints: b.photo_bonus_points
  }));

  // If location provided, calculate distances and filter
  if (lat && lng) {
    const userLat = parseFloat(lat);
    const userLng = parseFloat(lng);
    const maxRadius = parseFloat(radius);

    businesses = businesses
      .map(b => ({
        ...b,
        distance: Math.round(calculateDistance(userLat, userLng, b.lat, b.lng))
      }))
      .filter(b => b.distance <= maxRadius)
      .sort((a, b) => a.distance - b.distance);
  }

  res.json({
    businesses,
    count: businesses.length
  });
}));

/**
 * GET /api/businesses/nearby
 * Get businesses near a location (for check-in)
 */
router.get('/nearby', asyncHandler(async (req, res) => {
  const { lat, lng, radius = 500 } = req.query;

  if (!lat || !lng) {
    throw new AppError('Latitude and longitude are required', 400);
  }

  const userLat = parseFloat(lat);
  const userLng = parseFloat(lng);
  const maxRadius = parseFloat(radius);

  // Get all active businesses (in production, use PostGIS for efficient geo queries)
  const result = await query(`
    SELECT 
      id, name, slug, address, city, lat, lng, category, logo_url,
      points_per_checkin, photo_bonus_points
    FROM businesses
    WHERE is_active = true
  `);

  // Calculate distances and filter
  const nearby = result.rows
    .map(b => ({
      id: b.id,
      name: b.name,
      slug: b.slug,
      address: b.address,
      city: b.city,
      lat: parseFloat(b.lat),
      lng: parseFloat(b.lng),
      category: b.category,
      logoUrl: b.logo_url,
      pointsPerCheckin: b.points_per_checkin,
      photoBonusPoints: b.photo_bonus_points,
      distance: Math.round(calculateDistance(userLat, userLng, parseFloat(b.lat), parseFloat(b.lng)))
    }))
    .filter(b => b.distance <= maxRadius)
    .sort((a, b) => a.distance - b.distance);

  res.json({
    businesses: nearby,
    count: nearby.length,
    searchRadius: maxRadius
  });
}));

/**
 * GET /api/businesses/:slug
 * Get single business by slug
 */
router.get('/:slug', optionalAuth, asyncHandler(async (req, res) => {
  const { slug } = req.params;

  const result = await query(`
    SELECT 
      b.*,
      (SELECT COUNT(*) FROM checkins WHERE business_id = b.id) as total_checkins,
      (SELECT COUNT(DISTINCT user_id) FROM checkins WHERE business_id = b.id) as unique_visitors,
      (SELECT COUNT(*) FROM checkins WHERE business_id = b.id AND created_at > NOW() - INTERVAL '30 days') as checkins_this_month
    FROM businesses b
    WHERE b.slug = $1 AND b.is_active = true
  `, [slug]);

  if (result.rows.length === 0) {
    throw new AppError('Business not found', 404);
  }

  const b = result.rows[0];

  // Get recent check-ins for this business
  const recentCheckins = await query(`
    SELECT 
      c.id, c.comment, c.photo_url, c.created_at,
      u.name as user_name
    FROM checkins c
    JOIN users u ON c.user_id = u.id
    WHERE c.business_id = $1 AND c.is_visible = true
    ORDER BY c.created_at DESC
    LIMIT 5
  `, [b.id]);

  res.json({
    id: b.id,
    name: b.name,
    slug: b.slug,
    description: b.description,
    address: b.address,
    city: b.city,
    state: b.state,
    zip: b.zip,
    lat: parseFloat(b.lat),
    lng: parseFloat(b.lng),
    phone: b.phone,
    website: b.website,
    category: b.category,
    logoUrl: b.logo_url,
    pointsPerCheckin: b.points_per_checkin,
    photoBonusPoints: b.photo_bonus_points,
    stats: {
      totalCheckins: parseInt(b.total_checkins),
      uniqueVisitors: parseInt(b.unique_visitors),
      checkinsThisMonth: parseInt(b.checkins_this_month)
    },
    recentCheckins: recentCheckins.rows.map(c => ({
      id: c.id,
      comment: c.comment,
      photoUrl: c.photo_url,
      userName: formatName(c.user_name),
      createdAt: c.created_at
    }))
  });
}));

/**
 * POST /api/businesses
 * Create a new business (requires auth)
 */
router.post('/', authenticate, [
  body('name').trim().notEmpty().withMessage('Business name required'),
  body('address').trim().notEmpty().withMessage('Address required'),
  body('city').trim().notEmpty().withMessage('City required'),
  body('state').trim().notEmpty().withMessage('State required'),
  body('zip').trim().notEmpty().withMessage('ZIP code required'),
  body('lat').isFloat({ min: -90, max: 90 }).withMessage('Valid latitude required'),
  body('lng').isFloat({ min: -180, max: 180 }).withMessage('Valid longitude required'),
  body('category').optional().trim()
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new AppError(errors.array()[0].msg, 400);
  }

  const { name, description, address, city, state, zip, lat, lng, phone, website, category } = req.body;

  // Generate slug
  const slug = generateSlug(name);

  // Check if slug exists
  const existing = await query('SELECT id FROM businesses WHERE slug = $1', [slug]);
  if (existing.rows.length > 0) {
    throw new AppError('A business with a similar name already exists', 409);
  }

  const result = await query(`
    INSERT INTO businesses (name, slug, description, address, city, state, zip, lat, lng, phone, website, category, owner_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    RETURNING *
  `, [name, slug, description, address, city, state, zip, lat, lng, phone, website, category, req.user.id]);

  const b = result.rows[0];

  res.status(201).json({
    message: 'Business created successfully',
    business: {
      id: b.id,
      name: b.name,
      slug: b.slug,
      widgetKey: b.widget_key
    }
  });
}));

/**
 * GET /api/businesses/:businessId/dashboard
 * Get business dashboard data (owner only)
 */
router.get('/:businessId/dashboard', authenticate, requireBusinessOwner, asyncHandler(async (req, res) => {
  const { businessId } = req.params;

  // Get business details
  const bizResult = await query('SELECT * FROM businesses WHERE id = $1', [businessId]);
  const business = bizResult.rows[0];

  // Get stats
  const stats = await query(`
    SELECT
      (SELECT COUNT(*) FROM checkins WHERE business_id = $1) as total_checkins,
      (SELECT COUNT(DISTINCT user_id) FROM checkins WHERE business_id = $1) as unique_visitors,
      (SELECT COUNT(*) FROM checkins WHERE business_id = $1 AND created_at > NOW() - INTERVAL '30 days') as checkins_this_month,
      (SELECT COUNT(*) FROM checkins WHERE business_id = $1 AND created_at > NOW() - INTERVAL '7 days') as checkins_this_week,
      (SELECT COUNT(*) FROM checkins WHERE business_id = $1 AND DATE(created_at) = CURRENT_DATE) as checkins_today
  `, [businessId]);

  // Get recent check-ins
  const recentCheckins = await query(`
    SELECT 
      c.id, c.comment, c.photo_url, c.points_earned, c.created_at,
      u.name as user_name, u.email as user_email
    FROM checkins c
    JOIN users u ON c.user_id = u.id
    WHERE c.business_id = $1
    ORDER BY c.created_at DESC
    LIMIT 20
  `, [businessId]);

  // Get daily check-in counts for last 30 days
  const dailyStats = await query(`
    SELECT DATE(created_at) as date, COUNT(*) as count
    FROM checkins
    WHERE business_id = $1 AND created_at > NOW() - INTERVAL '30 days'
    GROUP BY DATE(created_at)
    ORDER BY date DESC
  `, [businessId]);

  const s = stats.rows[0];

  res.json({
    business: {
      id: business.id,
      name: business.name,
      widgetKey: business.widget_key
    },
    stats: {
      totalCheckins: parseInt(s.total_checkins),
      uniqueVisitors: parseInt(s.unique_visitors),
      checkinsThisMonth: parseInt(s.checkins_this_month),
      checkinsThisWeek: parseInt(s.checkins_this_week),
      checkinsToday: parseInt(s.checkins_today)
    },
    recentCheckins: recentCheckins.rows,
    dailyStats: dailyStats.rows
  });
}));

// Helper functions
function generateSlug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 100);
}

function formatName(name) {
  if (!name) return 'Anonymous';
  const parts = name.trim().split(' ');
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`;
}

module.exports = router;
