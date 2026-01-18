/**
 * Geo utilities for LocalProof
 * Handles distance calculations and location verification
 */

/**
 * Calculate distance between two coordinates using Haversine formula
 * @param {number} lat1 - Latitude of point 1
 * @param {number} lng1 - Longitude of point 1
 * @param {number} lat2 - Latitude of point 2
 * @param {number} lng2 - Longitude of point 2
 * @returns {number} Distance in meters
 */
const calculateDistance = (lat1, lng1, lat2, lng2) => {
  const R = 6371000; // Earth's radius in meters
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  
  return R * c;
};

const toRadians = (degrees) => {
  return degrees * (Math.PI / 180);
};

/**
 * Check if a location is within acceptable distance of a business
 * @param {number} userLat - User's latitude
 * @param {number} userLng - User's longitude
 * @param {number} bizLat - Business latitude
 * @param {number} bizLng - Business longitude
 * @param {number} maxDistance - Maximum allowed distance in meters (default from env)
 * @returns {object} { isValid, distance }
 */
const verifyLocation = (userLat, userLng, bizLat, bizLng, maxDistance = null) => {
  const maxDist = maxDistance || parseInt(process.env.MAX_CHECKIN_DISTANCE_METERS) || 150;
  const distance = calculateDistance(userLat, userLng, bizLat, bizLng);
  
  return {
    isValid: distance <= maxDist,
    distance: Math.round(distance * 100) / 100, // Round to 2 decimal places
    maxAllowed: maxDist
  };
};

/**
 * Generate JSON-LD schema markup for a check-in
 * This is what makes LocalProof valuable for SEO
 */
const generateCheckinSchema = (checkin, business, user) => {
  return {
    "@context": "https://schema.org",
    "@type": "Review",
    "itemReviewed": {
      "@type": getSchemaBusinessType(business.category),
      "name": business.name,
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
      "url": business.website
    },
    "author": {
      "@type": "Person",
      "name": formatAuthorName(user.name)
    },
    "reviewBody": checkin.comment || "Visited this location",
    "datePublished": checkin.created_at,
    "locationCreated": {
      "@type": "Place",
      "geo": {
        "@type": "GeoCoordinates",
        "latitude": parseFloat(checkin.lat),
        "longitude": parseFloat(checkin.lng)
      }
    }
  };
};

/**
 * Map business category to Schema.org type
 */
const getSchemaBusinessType = (category) => {
  const typeMap = {
    'Restaurant': 'Restaurant',
    'Coffee Shop': 'CafeOrCoffeeShop',
    'Salon': 'HairSalon',
    'Spa': 'DaySpa',
    'Bar': 'BarOrPub',
    'Retail': 'Store',
    'Healthcare': 'MedicalBusiness',
    'Fitness': 'HealthClub',
    'Auto': 'AutoRepair',
    'default': 'LocalBusiness'
  };
  
  return typeMap[category] || typeMap['default'];
};

/**
 * Format author name for privacy (first name + last initial)
 */
const formatAuthorName = (fullName) => {
  if (!fullName) return 'Anonymous';
  const parts = fullName.trim().split(' ');
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`;
};

module.exports = {
  calculateDistance,
  verifyLocation,
  generateCheckinSchema,
  getSchemaBusinessType,
  formatAuthorName
};
