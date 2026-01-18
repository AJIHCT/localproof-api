const express = require('express');
const { query } = require('../db');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

/**
 * GET /api/users/points
 * Get user's point balance and transaction history
 */
router.get('/points', authenticate, asyncHandler(async (req, res) => {
  const { limit = 20, offset = 0 } = req.query;

  // Get transactions
  const transactions = await query(`
    SELECT 
      pt.id, pt.amount, pt.type, pt.description, pt.created_at,
      b.name as business_name, b.slug as business_slug
    FROM point_transactions pt
    LEFT JOIN businesses b ON pt.business_id = b.id
    WHERE pt.user_id = $1
    ORDER BY pt.created_at DESC
    LIMIT $2 OFFSET $3
  `, [req.user.id, parseInt(limit), parseInt(offset)]);

  // Get total count
  const countResult = await query(
    'SELECT COUNT(*) as total FROM point_transactions WHERE user_id = $1',
    [req.user.id]
  );

  res.json({
    balance: req.user.total_points,
    transactions: transactions.rows.map(t => ({
      id: t.id,
      amount: t.amount,
      type: t.type,
      description: t.description,
      businessName: t.business_name,
      businessSlug: t.business_slug,
      createdAt: t.created_at
    })),
    pagination: {
      total: parseInt(countResult.rows[0].total),
      limit: parseInt(limit),
      offset: parseInt(offset)
    }
  });
}));

/**
 * GET /api/users/checkins
 * Get user's check-in history
 */
router.get('/checkins', authenticate, asyncHandler(async (req, res) => {
  const { limit = 20, offset = 0 } = req.query;

  const checkins = await query(`
    SELECT 
      c.id, c.comment, c.photo_url, c.points_earned, c.created_at,
      b.id as business_id, b.name as business_name, b.slug as business_slug,
      b.address, b.city, b.category
    FROM checkins c
    JOIN businesses b ON c.business_id = b.id
    WHERE c.user_id = $1
    ORDER BY c.created_at DESC
    LIMIT $2 OFFSET $3
  `, [req.user.id, parseInt(limit), parseInt(offset)]);

  const countResult = await query(
    'SELECT COUNT(*) as total FROM checkins WHERE user_id = $1',
    [req.user.id]
  );

  res.json({
    checkins: checkins.rows.map(c => ({
      id: c.id,
      comment: c.comment,
      photoUrl: c.photo_url,
      pointsEarned: c.points_earned,
      createdAt: c.created_at,
      business: {
        id: c.business_id,
        name: c.business_name,
        slug: c.business_slug,
        address: c.address,
        city: c.city,
        category: c.category
      }
    })),
    pagination: {
      total: parseInt(countResult.rows[0].total),
      limit: parseInt(limit),
      offset: parseInt(offset)
    }
  });
}));

/**
 * GET /api/users/stats
 * Get user statistics summary
 */
router.get('/stats', authenticate, asyncHandler(async (req, res) => {
  const stats = await query(`
    SELECT
      (SELECT COUNT(*) FROM checkins WHERE user_id = $1) as total_checkins,
      (SELECT COUNT(DISTINCT business_id) FROM checkins WHERE user_id = $1) as unique_businesses,
      (SELECT COUNT(*) FROM checkins WHERE user_id = $1 AND created_at > NOW() - INTERVAL '30 days') as checkins_this_month,
      (SELECT COALESCE(SUM(amount), 0) FROM point_transactions WHERE user_id = $1 AND amount > 0) as total_earned,
      (SELECT COALESCE(ABS(SUM(amount)), 0) FROM point_transactions WHERE user_id = $1 AND amount < 0) as total_redeemed
  `, [req.user.id]);

  const s = stats.rows[0];

  res.json({
    totalCheckins: parseInt(s.total_checkins),
    uniqueBusinesses: parseInt(s.unique_businesses),
    checkinsThisMonth: parseInt(s.checkins_this_month),
    pointsEarned: parseInt(s.total_earned),
    pointsRedeemed: parseInt(s.total_redeemed),
    currentBalance: req.user.total_points
  });
}));

module.exports = router;
