require('dotenv').config();
const { pool } = require('./index');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const seed = async () => {
  console.log('🌱 Seeding database with sample data...\n');

  try {
    // Create test user (password: "testpass123")
    const passwordHash = await bcrypt.hash('testpass123', 10);
    const testUserId = uuidv4();
    
    await pool.query(`
      INSERT INTO users (id, email, phone, password_hash, name, total_points)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (email) DO NOTHING
    `, [testUserId, 'test@localproof.app', '352-555-0100', passwordHash, 'Test User', 250]);
    console.log('  ✅ Test user created (test@localproof.app / testpass123)');

    // Create business owner
    const ownerId = uuidv4();
    await pool.query(`
      INSERT INTO users (id, email, phone, password_hash, name, total_points)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (email) DO NOTHING
    `, [ownerId, 'owner@salspizza.com', '352-555-0200', passwordHash, 'Sal Romano', 0]);
    console.log('  ✅ Business owner created');

    // Create sample businesses in Citrus County
    const businesses = [
      {
        name: "Sal's Pizza Kitchen",
        slug: 'sals-pizza-kitchen',
        description: 'Authentic New York style pizza in the heart of Inverness',
        address: '218 Main Street',
        city: 'Inverness',
        state: 'FL',
        zip: '34450',
        lat: 28.8358,
        lng: -82.3412,
        phone: '352-555-0200',
        category: 'Restaurant',
        owner_id: ownerId
      },
      {
        name: 'Coastal Coffee Co',
        slug: 'coastal-coffee-co',
        description: 'Locally roasted coffee and fresh pastries',
        address: '112 US Highway 41',
        city: 'Inverness',
        state: 'FL',
        zip: '34450',
        lat: 28.8401,
        lng: -82.3456,
        phone: '352-555-0300',
        category: 'Coffee Shop',
        owner_id: null
      },
      {
        name: 'Style Studio',
        slug: 'style-studio',
        description: 'Full service hair salon',
        address: '305 Tompkins Street',
        city: 'Inverness',
        state: 'FL',
        zip: '34450',
        lat: 28.8372,
        lng: -82.3398,
        phone: '352-555-0400',
        category: 'Salon',
        owner_id: null
      }
    ];

    for (const biz of businesses) {
      const bizId = uuidv4();
      await pool.query(`
        INSERT INTO businesses (id, name, slug, description, address, city, state, zip, lat, lng, phone, category, owner_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (slug) DO NOTHING
      `, [bizId, biz.name, biz.slug, biz.description, biz.address, biz.city, biz.state, biz.zip, biz.lat, biz.lng, biz.phone, biz.category, biz.owner_id]);
      console.log(`  ✅ Business: ${biz.name}`);
    }

    // Get Sal's Pizza ID for sample checkins
    const bizResult = await pool.query(`SELECT id FROM businesses WHERE slug = 'sals-pizza-kitchen'`);
    if (bizResult.rows.length > 0) {
      const salsPizzaId = bizResult.rows[0].id;
      
      // Create sample check-ins
      const sampleCheckins = [
        { comment: "Best pizza in Citrus County! The garlic knots are amazing.", points: 75 },
        { comment: "Quick lunch, great service. Will be back!", points: 50 },
        { comment: "Family dinner spot. Kids loved it!", points: 50 },
      ];

      for (let i = 0; i < sampleCheckins.length; i++) {
        const checkin = sampleCheckins[i];
        const checkinId = uuidv4();
        const createdAt = new Date(Date.now() - (i * 24 * 60 * 60 * 1000)); // Stagger by days
        
        await pool.query(`
          INSERT INTO checkins (id, user_id, business_id, lat, lng, distance_meters, comment, points_earned, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [checkinId, testUserId, salsPizzaId, 28.8360, -82.3410, 15.5, checkin.comment, checkin.points, createdAt]);
        
        // Record point transaction
        await pool.query(`
          INSERT INTO point_transactions (user_id, business_id, checkin_id, amount, type, description)
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [testUserId, salsPizzaId, checkinId, checkin.points, 'checkin', `Check-in at Sal's Pizza Kitchen`]);
      }
      console.log('  ✅ Sample check-ins created');
    }

    // Update test user's total points
    await pool.query(`
      UPDATE users SET total_points = (
        SELECT COALESCE(SUM(amount), 0) FROM point_transactions WHERE user_id = $1
      ) WHERE id = $1
    `, [testUserId]);
    console.log('  ✅ User points updated');

    console.log('\n✅ Database seeded successfully!');
    console.log('\n📋 Test Credentials:');
    console.log('   Email: test@localproof.app');
    console.log('   Password: testpass123');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Seed failed:', error);
    process.exit(1);
  }
};

seed();
