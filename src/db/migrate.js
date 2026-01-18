require('dotenv').config();
const { pool } = require('./index');

const migrate = async () => {
  console.log('🔧 Running database migrations...\n');

  const migrations = [
    // Users table
    `CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email VARCHAR(255) UNIQUE NOT NULL,
      phone VARCHAR(20),
      password_hash VARCHAR(255) NOT NULL,
      name VARCHAR(255) NOT NULL,
      total_points INTEGER DEFAULT 0,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )`,

    // Businesses table
    `CREATE TABLE IF NOT EXISTS businesses (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255) NOT NULL,
      slug VARCHAR(255) UNIQUE NOT NULL,
      description TEXT,
      address VARCHAR(500) NOT NULL,
      city VARCHAR(100) NOT NULL,
      state VARCHAR(50) NOT NULL,
      zip VARCHAR(20) NOT NULL,
      lat DECIMAL(10, 8) NOT NULL,
      lng DECIMAL(11, 8) NOT NULL,
      phone VARCHAR(20),
      website VARCHAR(255),
      category VARCHAR(100),
      logo_url VARCHAR(500),
      owner_id UUID REFERENCES users(id),
      widget_key UUID DEFAULT gen_random_uuid(),
      points_per_checkin INTEGER DEFAULT 50,
      photo_bonus_points INTEGER DEFAULT 25,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )`,

    // Check-ins table
    `CREATE TABLE IF NOT EXISTS checkins (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id),
      business_id UUID NOT NULL REFERENCES businesses(id),
      lat DECIMAL(10, 8) NOT NULL,
      lng DECIMAL(11, 8) NOT NULL,
      distance_meters DECIMAL(10, 2) NOT NULL,
      comment TEXT,
      photo_url VARCHAR(500),
      points_earned INTEGER NOT NULL,
      is_verified BOOLEAN DEFAULT true,
      is_visible BOOLEAN DEFAULT true,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )`,

    // Point transactions table
    `CREATE TABLE IF NOT EXISTS point_transactions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id),
      business_id UUID REFERENCES businesses(id),
      checkin_id UUID REFERENCES checkins(id),
      amount INTEGER NOT NULL,
      type VARCHAR(50) NOT NULL,
      description VARCHAR(255),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )`,

    // Rewards table (for future use)
    `CREATE TABLE IF NOT EXISTS rewards (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id UUID NOT NULL REFERENCES businesses(id),
      name VARCHAR(255) NOT NULL,
      description TEXT,
      points_required INTEGER NOT NULL,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )`,

    // Indexes for performance
    `CREATE INDEX IF NOT EXISTS idx_checkins_business_id ON checkins(business_id)`,
    `CREATE INDEX IF NOT EXISTS idx_checkins_user_id ON checkins(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_checkins_created_at ON checkins(created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_businesses_slug ON businesses(slug)`,
    `CREATE INDEX IF NOT EXISTS idx_businesses_widget_key ON businesses(widget_key)`,
    `CREATE INDEX IF NOT EXISTS idx_businesses_location ON businesses(lat, lng)`,
    `CREATE INDEX IF NOT EXISTS idx_point_transactions_user_id ON point_transactions(user_id)`,
  ];

  for (const sql of migrations) {
    try {
      await pool.query(sql);
      // Extract table/index name for logging
      const match = sql.match(/(?:TABLE|INDEX)\s+(?:IF NOT EXISTS\s+)?(\w+)/i);
      const name = match ? match[1] : 'query';
      console.log(`  ✅ ${name}`);
    } catch (error) {
      console.error(`  ❌ Error:`, error.message);
      throw error;
    }
  }

  console.log('\n✅ All migrations completed successfully!');
  process.exit(0);
};

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
