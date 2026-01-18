# LocalProof API

Customer check-in loyalty system with geo-verified social proof for local businesses.

## Quick Start

### 1. Prerequisites
- Node.js 18+
- PostgreSQL database (Railway provides this)

### 2. Local Development

```bash
# Clone/download the project
cd localproof-api

# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Edit .env with your database URL and secrets
# For local Postgres: postgresql://user:password@localhost:5432/localproof

# Run database migrations
npm run db:migrate

# Seed with sample data (optional)
npm run db:seed

# Start development server
npm run dev
```

The API will be running at `http://localhost:3000`

### 3. Test the API

```bash
# Health check
curl http://localhost:3000/health

# Register a user
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123","name":"Test User"}'

# Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}'
```

---

## Deploy to Railway (5 minutes)

### Step 1: Create Railway Account
Go to [railway.app](https://railway.app) and sign up with GitHub.

### Step 2: Create New Project
1. Click "New Project"
2. Select "Deploy from GitHub repo" or "Empty Project"

### Step 3: Add PostgreSQL Database
1. Click "+ New" in your project
2. Select "Database" → "PostgreSQL"
3. Railway will provision the database automatically

### Step 4: Add the API Service
1. Click "+ New" → "GitHub Repo" (or upload code)
2. Select this repository
3. Railway will detect it's a Node.js app

### Step 5: Configure Environment Variables
In your API service settings, add:

```
NODE_ENV=production
JWT_SECRET=generate-a-random-64-character-string-here
JWT_EXPIRES_IN=7d
MAX_CHECKIN_DISTANCE_METERS=150
```

Railway automatically provides `DATABASE_URL` from your PostgreSQL service.

### Step 6: Run Migrations
In Railway's service settings:
1. Go to Settings → Deploy
2. Set "Start Command" to: `npm run db:migrate && npm start`

Or run once via Railway CLI:
```bash
railway run npm run db:migrate
```

### Step 7: Get Your API URL
Railway provides a URL like: `https://localproof-api-production.up.railway.app`

---

## API Endpoints

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Register new user |
| POST | `/api/auth/login` | Login, get token |
| GET | `/api/auth/me` | Get current user |
| PUT | `/api/auth/me` | Update profile |

### Users
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/users/points` | Get points & transactions |
| GET | `/api/users/checkins` | Get check-in history |
| GET | `/api/users/stats` | Get user statistics |

### Businesses
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/businesses` | List all businesses |
| GET | `/api/businesses/nearby?lat=X&lng=Y` | Find nearby businesses |
| GET | `/api/businesses/:slug` | Get business details |
| POST | `/api/businesses` | Create business (auth) |
| GET | `/api/businesses/:id/dashboard` | Owner dashboard |

### Check-ins
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/checkins` | Create check-in (auth) |
| GET | `/api/checkins/:id` | Get check-in details |
| GET | `/api/checkins/business/:id` | Get business check-ins |
| DELETE | `/api/checkins/:id` | Hide own check-in |

### Widget (Public)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/widget/:key` | Get widget data |
| GET | `/api/widget/:key/schema` | Get JSON-LD schema |
| GET | `/api/widget/:key/embed.js` | Get embed script |

---

## Embedding the Widget

Add this to any website:

```html
<!-- Where you want the widget to appear -->
<div id="localproof-widget"></div>

<!-- Load the widget script (replace WIDGET_KEY) -->
<script src="https://your-api-url.com/api/widget/WIDGET_KEY/embed.js"></script>
```

The widget will:
1. Display recent check-ins with GPS verification
2. Show stats (total check-ins, unique visitors)
3. Auto-inject JSON-LD schema for SEO

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | - | PostgreSQL connection string |
| `JWT_SECRET` | Yes | - | Secret for signing tokens |
| `PORT` | No | 3000 | Server port |
| `NODE_ENV` | No | development | Environment mode |
| `JWT_EXPIRES_IN` | No | 7d | Token expiration |
| `MAX_CHECKIN_DISTANCE_METERS` | No | 150 | Max distance for valid check-in |
| `API_BASE_URL` | No | auto | Base URL for widget scripts |

---

## Project Structure

```
localproof-api/
├── src/
│   ├── index.js          # Express app entry point
│   ├── db/
│   │   ├── index.js      # Database connection
│   │   ├── migrate.js    # Migration script
│   │   └── seed.js       # Sample data seeder
│   ├── routes/
│   │   ├── auth.js       # Authentication routes
│   │   ├── users.js      # User routes
│   │   ├── businesses.js # Business routes
│   │   ├── checkins.js   # Check-in routes
│   │   └── widget.js     # Public widget routes
│   ├── middleware/
│   │   ├── auth.js       # JWT authentication
│   │   └── errorHandler.js
│   └── utils/
│       └── geo.js        # Geo calculations & schema generation
├── package.json
├── .env.example
└── README.md
```

---

## What's Next

After deploying the API:

1. **Build the mobile app** (React Native/Expo)
2. **Build the business dashboard** (React web app)
3. **Test with real businesses**

---

## Support

Built by IHC Technology for Citrus County local businesses.
