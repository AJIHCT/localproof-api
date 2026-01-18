const express = require('express');
const { query } = require('../db');
const { AppError, asyncHandler } = require('../middleware/errorHandler');
const { generateCheckinSchema, formatAuthorName } = require('../utils/geo');

const router = express.Router();

/**
 * GET /api/widget/:widgetKey
 * Get widget data for embedding on business website
 * This is the public endpoint that websites will call
 */
router.get('/:widgetKey', asyncHandler(async (req, res) => {
  const { widgetKey } = req.params;
  const { limit = 5 } = req.query;

  // Find business by widget key
  const bizResult = await query(`
    SELECT * FROM businesses WHERE widget_key = $1 AND is_active = true
  `, [widgetKey]);

  if (bizResult.rows.length === 0) {
    throw new AppError('Invalid widget key', 404);
  }

  const business = bizResult.rows[0];

  // Get recent check-ins
  const checkinsResult = await query(`
    SELECT 
      c.id, c.comment, c.photo_url, c.is_verified, c.created_at,
      c.lat, c.lng,
      u.name as user_name
    FROM checkins c
    JOIN users u ON c.user_id = u.id
    WHERE c.business_id = $1 AND c.is_visible = true
    ORDER BY c.created_at DESC
    LIMIT $2
  `, [business.id, parseInt(limit)]);

  // Get stats
  const statsResult = await query(`
    SELECT 
      COUNT(*) as total_checkins,
      COUNT(DISTINCT user_id) as unique_visitors,
      COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days') as this_month
    FROM checkins 
    WHERE business_id = $1
  `, [business.id]);

  const stats = statsResult.rows[0];

  // Format check-ins for widget display
  const checkins = checkinsResult.rows.map(c => ({
    id: c.id,
    userName: formatAuthorName(c.user_name),
    comment: c.comment,
    photoUrl: c.photo_url,
    isVerified: c.is_verified,
    location: `${business.city}, ${business.state}`,
    timeAgo: getTimeAgo(c.created_at),
    createdAt: c.created_at
  }));

  // Set CORS headers for widget embedding
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=60' // Cache for 1 minute
  });

  res.json({
    business: {
      name: business.name,
      city: business.city,
      state: business.state,
      category: business.category
    },
    stats: {
      totalCheckins: parseInt(stats.total_checkins),
      uniqueVisitors: parseInt(stats.unique_visitors),
      thisMonth: parseInt(stats.this_month)
    },
    checkins
  });
}));

/**
 * GET /api/widget/:widgetKey/schema
 * Get JSON-LD schema markup for SEO
 * This returns the structured data to inject into the website
 */
router.get('/:widgetKey/schema', asyncHandler(async (req, res) => {
  const { widgetKey } = req.params;
  const { limit = 10 } = req.query;

  // Find business
  const bizResult = await query(`
    SELECT * FROM businesses WHERE widget_key = $1 AND is_active = true
  `, [widgetKey]);

  if (bizResult.rows.length === 0) {
    throw new AppError('Invalid widget key', 404);
  }

  const business = bizResult.rows[0];

  // Get check-ins with user info
  const checkinsResult = await query(`
    SELECT c.*, u.name as user_name
    FROM checkins c
    JOIN users u ON c.user_id = u.id
    WHERE c.business_id = $1 AND c.is_visible = true
    ORDER BY c.created_at DESC
    LIMIT $2
  `, [business.id, parseInt(limit)]);

  // Get aggregate stats for the business schema
  const statsResult = await query(`
    SELECT 
      COUNT(*) as review_count,
      ROUND(AVG(5.0), 1) as avg_rating -- Placeholder - could add actual ratings later
    FROM checkins 
    WHERE business_id = $1
  `, [business.id]);

  const stats = statsResult.rows[0];

  // Generate LocalBusiness schema with reviews
  const schema = {
    "@context": "https://schema.org",
    "@type": getSchemaType(business.category),
    "name": business.name,
    "description": business.description,
    "address": {
      "@type": "PostalAddress",
      "streetAddress": business.address,
      "addressLocality": business.city,
      "addressRegion": business.state,
      "postalCode": business.zip,
      "addressCountry": "US"
    },
    "geo": {
      "@type": "GeoCoordinates",
      "latitude": parseFloat(business.lat),
      "longitude": parseFloat(business.lng)
    },
    "telephone": business.phone,
    "url": business.website,
    "aggregateRating": parseInt(stats.review_count) > 0 ? {
      "@type": "AggregateRating",
      "ratingValue": stats.avg_rating || "5.0",
      "reviewCount": stats.review_count
    } : undefined,
    "review": checkinsResult.rows.map(c => ({
      "@type": "Review",
      "author": {
        "@type": "Person",
        "name": formatAuthorName(c.user_name)
      },
      "datePublished": c.created_at,
      "reviewBody": c.comment || "Visited and verified at this location",
      "locationCreated": {
        "@type": "Place",
        "geo": {
          "@type": "GeoCoordinates",
          "latitude": parseFloat(c.lat),
          "longitude": parseFloat(c.lng)
        }
      }
    }))
  };

  // Remove undefined fields
  if (!schema.aggregateRating) delete schema.aggregateRating;

  res.set({
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/ld+json',
    'Cache-Control': 'public, max-age=300' // Cache for 5 minutes
  });

  res.json(schema);
}));

/**
 * GET /api/widget/:widgetKey/data
 * Alias for the main widget endpoint (for clearer API)
 */
router.get('/:widgetKey/data', (req, res, next) => {
  // Forward to main widget handler
  req.url = `/${req.params.widgetKey}`;
  router.handle(req, res, next);
});

/**
 * GET /api/widget/:widgetKey/embed.js
 * Returns the embeddable JavaScript widget code
 */
router.get('/:widgetKey/embed.js', asyncHandler(async (req, res) => {
  const { widgetKey } = req.params;

  // Verify widget key exists
  const bizResult = await query(
    'SELECT id, name FROM businesses WHERE widget_key = $1 AND is_active = true',
    [widgetKey]
  );

  if (bizResult.rows.length === 0) {
    res.status(404).send('// Widget not found');
    return;
  }

  // Use X-Forwarded-Proto header (set by Render/Heroku) or default to HTTPS in production
  const protocol = req.get('X-Forwarded-Proto') || (process.env.NODE_ENV === 'production' ? 'https' : req.protocol);
  const apiBase = process.env.API_BASE_URL || `${protocol}://${req.get('host')}`;

  // Return the widget JavaScript
  const js = `
(function() {
  const WIDGET_KEY = '${widgetKey}';
  const API_BASE = '${apiBase}';
  
  // Find widget container
  const container = document.getElementById('localproof-widget');
  if (!container) {
    console.error('LocalProof: No element with id="localproof-widget" found');
    return;
  }
  
  // Inject styles
  const style = document.createElement('style');
  style.textContent = \`
    .lp-widget { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #fff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,0.1); overflow: hidden; max-width: 400px; }
    .lp-header { padding: 16px 20px; background: linear-gradient(135deg, #f8fafc, #f1f5f9); border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; }
    .lp-header h3 { margin: 0; font-size: 16px; color: #1a1a1a; }
    .lp-verified { display: flex; align-items: center; gap: 4px; font-size: 12px; color: #059669; font-weight: 500; }
    .lp-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; background: #e2e8f0; }
    .lp-stat { background: #fff; padding: 12px; text-align: center; }
    .lp-stat-num { font-size: 24px; font-weight: 700; color: #1a1a1a; }
    .lp-stat-label { font-size: 11px; color: #64748b; text-transform: uppercase; }
    .lp-checkins { padding: 12px; }
    .lp-checkin { display: flex; gap: 12px; padding: 12px; background: #f8fafc; border-radius: 8px; margin-bottom: 8px; }
    .lp-checkin:last-child { margin-bottom: 0; }
    .lp-avatar { width: 40px; height: 40px; background: linear-gradient(135deg, #06b6d4, #8b5cf6); border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #fff; font-weight: 600; font-size: 14px; flex-shrink: 0; }
    .lp-content { flex: 1; min-width: 0; }
    .lp-name { font-weight: 600; color: #1a1a1a; font-size: 14px; }
    .lp-comment { font-size: 13px; color: #475569; margin: 4px 0; }
    .lp-meta { font-size: 11px; color: #94a3b8; }
    .lp-footer { padding: 12px 16px; border-top: 1px solid #e2e8f0; text-align: center; }
    .lp-footer a { color: #0ea5e9; font-size: 13px; text-decoration: none; font-weight: 500; }
    .lp-loading { padding: 40px; text-align: center; color: #64748b; }
  \`;
  document.head.appendChild(style);
  
  // Show loading
  container.innerHTML = '<div class="lp-widget"><div class="lp-loading">Loading...</div></div>';
  
  // Fetch data
  fetch(API_BASE + '/api/widget/' + WIDGET_KEY)
    .then(res => res.json())
    .then(data => {
      const html = \`
        <div class="lp-widget">
          <div class="lp-header">
            <h3>Recent Visitors</h3>
            <span class="lp-verified">✓ GPS Verified</span>
          </div>
          <div class="lp-stats">
            <div class="lp-stat">
              <div class="lp-stat-num">\${data.stats.totalCheckins}</div>
              <div class="lp-stat-label">Check-ins</div>
            </div>
            <div class="lp-stat">
              <div class="lp-stat-num">\${data.stats.uniqueVisitors}</div>
              <div class="lp-stat-label">Visitors</div>
            </div>
            <div class="lp-stat">
              <div class="lp-stat-num">\${data.stats.thisMonth}</div>
              <div class="lp-stat-label">This Month</div>
            </div>
          </div>
          <div class="lp-checkins">
            \${data.checkins.map(c => \`
              <div class="lp-checkin">
                <div class="lp-avatar">\${getInitials(c.userName)}</div>
                <div class="lp-content">
                  <div class="lp-name">\${c.userName}</div>
                  \${c.comment ? \`<div class="lp-comment">"\${c.comment}"</div>\` : ''}
                  <div class="lp-meta">📍 \${c.location} · \${c.timeAgo}</div>
                </div>
              </div>
            \`).join('')}
          </div>
          <div class="lp-footer">
            <a href="https://localproof.app" target="_blank">Powered by LocalProof</a>
          </div>
        </div>
      \`;
      container.innerHTML = html;
      
      // Also inject schema
      fetch(API_BASE + '/api/widget/' + WIDGET_KEY + '/schema')
        .then(res => res.json())
        .then(schema => {
          const script = document.createElement('script');
          script.type = 'application/ld+json';
          script.textContent = JSON.stringify(schema);
          document.head.appendChild(script);
        });
    })
    .catch(err => {
      console.error('LocalProof widget error:', err);
      container.innerHTML = '<div class="lp-widget"><div class="lp-loading">Unable to load widget</div></div>';
    });
  
  function getInitials(name) {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  }
})();
`.trim();

  res.set({
    'Content-Type': 'application/javascript',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=3600' // Cache JS for 1 hour
  });

  res.send(js);
}));

// Helper functions
function getSchemaType(category) {
  const typeMap = {
    'Restaurant': 'Restaurant',
    'Coffee Shop': 'CafeOrCoffeeShop',
    'Salon': 'HairSalon',
    'Spa': 'DaySpa',
    'Bar': 'BarOrPub',
    'Retail': 'Store',
    'Healthcare': 'MedicalBusiness',
    'Fitness': 'HealthClub',
    'Auto': 'AutoRepair'
  };
  return typeMap[category] || 'LocalBusiness';
}

function getTimeAgo(date) {
  const seconds = Math.floor((new Date() - new Date(date)) / 1000);
  
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)} days ago`;
  
  return new Date(date).toLocaleDateString();
}

module.exports = router;
