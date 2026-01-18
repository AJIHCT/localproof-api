const express = require('express');
const { body, validationResult } = require('express-validator');
const { query, transaction } = require('../db');
const { authenticate } = require('../middleware/auth');
const { AppError, asyncHandler } = require('../middleware/errorHandler');
const { verifyLocation, generateCheckinSchema } = require('../utils/geo');

const router = express.Router();

/**
 * POST /api/checkins
 * Create a new check-in (the core feature!)
 */
router.post('/', authenticate, [
  body('businessId').isUUID().withMessage('Valid business ID required'),
  body('lat').isFloat({ min: -90, max: 90 }).withMessage('Valid latitude required'),
  body('lng').isFloat({ min: -180, max: 180 }).withMessage('Valid longitude required'),
  body('comment').optional().trim().isLength({ max: 500 }).withMessage('Comment too long (max 500 chars)'),
  body('photoUrl').optional().trim().isURL().withMessage('Invalid photo URL')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new AppError(errors.array()[0].msg, 400);
  }

  const { businessId, lat, lng, comment, photoUrl } = req.body;
  const userId = req.user.id;

  // Get business details
  const bizResult = await query(
    'SELECT * FROM businesses WHERE id = $1 AND is_active = true',
    [businessId]
  );

  if (bizResult.rows.length === 0) {
    throw new AppError('Business not found', 404);
  }

  const business = bizResult.rows[0];

  // Verify location
  const locationCheck = verifyLocation(
    parseFloat(lat),
    parseFloat(lng),
    parseFloat(business.lat),
    parseFloat(business.lng)
  );

  if (!locationCheck.isValid) {
    throw new AppError(
      `You must be within ${locationCheck.maxAllowed}m of the business to check in. You are ${Math.round(locationCheck.distance)}m away.`,
      400
    );
  }

  // Check for recent check-in (prevent spam - one per hour per business)
  const recentCheckin = await query(`
    SELECT id FROM checkins 
    WHERE user_id = $1 AND business_id = $2 AND created_at > NOW() - INTERVAL '1 hour'
  `, [userId, businessId]);

  if (recentCheckin.rows.length > 0) {
    throw new AppError('You already checked in here recently. Please wait before checking in again.', 429);
  }

  // Calculate points
  let pointsEarned = business.points_per_checkin;
  if (photoUrl) {
    pointsEarned += business.photo_bonus_points;
  }

  // Create check-in and update points in a transaction
  const result = await transaction(async (client) => {
    // Insert check-in
    const checkinResult = await client.query(`
      INSERT INTO checkins (user_id, business_id, lat, lng, distance_meters, comment, photo_url, points_earned)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [userId, businessId, lat, lng, locationCheck.distance, comment, photoUrl, pointsEarned]);

    const checkin = checkinResult.rows[0];

    // Record point transaction
    await client.query(`
      INSERT INTO point_transactions (user_id, business_id, checkin_id, amount, type, description)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [userId, businessId, checkin.id, pointsEarned, 'checkin', `Check-in at ${business.name}`]);

    // Update user's total points
    await client.query(`
      UPDATE users SET total_points = total_points + $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
    `, [pointsEarned, userId]);

    // Get updated user points
    const userResult = await client.query('SELECT total_points FROM users WHERE id = $1', [userId]);

    return {
      checkin,
      newTotalPoints: userResult.rows[0].total_points
    };
  });

  // Generate schema for SEO
  const schema = generateCheckinSchema(result.checkin, business, req.user);

  res.status(201).json({
    message: 'Check-in successful!',
    checkin: {
      id: result.checkin.id,
      businessName: business.name,
      pointsEarned,
      distance: locationCheck.distance,
      hasPhoto: !!photoUrl,
      createdAt: result.checkin.created_at
    },
    points: {
      earned: pointsEarned,
      newTotal: parseInt(result.newTotalPoints)
    },
    schema // Include schema for debugging/verification
  });
}));

/**
 * GET /api/checkins/:id
 * Get a single check-in
 */
router.get('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;

  const result = await query(`
    SELECT 
      c.*,
      b.name as business_name, b.slug as business_slug, b.address, b.city, b.state,
      b.lat as business_lat, b.lng as business_lng, b.category,
      u.name as user_name
    FROM checkins c
    JOIN businesses b ON c.business_id = b.id
    JOIN users u ON c.user_id = u.id
    WHERE c.id = $1 AND c.is_visible = true
  `, [id]);

  if (result.rows.length === 0) {
    throw new AppError('Check-in not found', 404);
  }

  const c = result.rows[0];

  res.json({
    id: c.id,
    comment: c.comment,
    photoUrl: c.photo_url,
    pointsEarned: c.points_earned,
    distance: parseFloat(c.distance_meters),
    isVerified: c.is_verified,
    createdAt: c.created_at,
    user: {
      name: formatName(c.user_name)
    },
    business: {
      name: c.business_name,
      slug: c.business_slug,
      address: c.address,
      city: c.city,
      state: c.state,
      category: c.category,
      lat: parseFloat(c.business_lat),
      lng: parseFloat(c.business_lng)
    }
  });
}));

/**
 * GET /api/checkins/business/:businessId
 * Get check-ins for a business (public, for widget)
 */
router.get('/business/:businessId', asyncHandler(async (req, res) => {
  const { businessId } = req.params;
  const { limit = 10, offset = 0 } = req.query;

  const result = await query(`
    SELECT 
      c.id, c.comment, c.photo_url, c.is_verified, c.created_at,
      c.lat, c.lng,
      u.name as user_name
    FROM checkins c
    JOIN users u ON c.user_id = u.id
    WHERE c.business_id = $1 AND c.is_visible = true
    ORDER BY c.created_at DESC
    LIMIT $2 OFFSET $3
  `, [businessId, parseInt(limit), parseInt(offset)]);

  // Get business info
  const bizResult = await query(
    'SELECT name, city, state, lat, lng, category FROM businesses WHERE id = $1',
    [businessId]
  );

  if (bizResult.rows.length === 0) {
    throw new AppError('Business not found', 404);
  }

  const business = bizResult.rows[0];

  // Get stats
  const statsResult = await query(`
    SELECT COUNT(*) as total, COUNT(DISTINCT user_id) as unique_visitors
    FROM checkins WHERE business_id = $1
  `, [businessId]);

  const stats = statsResult.rows[0];

  res.json({
    business: {
      name: business.name,
      city: business.city,
      state: business.state
    },
    stats: {
      totalCheckins: parseInt(stats.total),
      uniqueVisitors: parseInt(stats.unique_visitors)
    },
    checkins: result.rows.map(c => ({
      id: c.id,
      comment: c.comment,
      photoUrl: c.photo_url,
      isVerified: c.is_verified,
      userName: formatName(c.user_name),
      location: `${business.city}, ${business.state}`,
      createdAt: c.created_at
    }))
  });
}));

/**
 * DELETE /api/checkins/:id
 * Delete own check-in (soft delete - hides it)
 */
router.delete('/:id', authenticate, asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Verify ownership
  const checkin = await query(
    'SELECT id FROM checkins WHERE id = $1 AND user_id = $2',
    [id, req.user.id]
  );

  if (checkin.rows.length === 0) {
    throw new AppError('Check-in not found or not authorized', 404);
  }

  // Soft delete
  await query(
    'UPDATE checkins SET is_visible = false WHERE id = $1',
    [id]
  );

  res.json({ message: 'Check-in hidden' });
}));

// Helper function
function formatName(name) {
  if (!name) return 'Anonymous';
  const parts = name.trim().split(' ');
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`;
}

module.exports = router;
