'use strict';
const crypto = require('node:crypto');

/**
 * Where a PIN code is on the map (blueprint stage 6, Express routing).
 * Test geocoder: each Express city has a centre, and a PIN code is placed at a fixed spot up to about 8 km from it,
 * worked out from the PIN code itself, so the same PIN code always lands in the same place.
 * A real geocoding partner (for example MapmyIndia or Google Maps) replaces locate() without changing anything else.
 */
const CITY_CENTRES = {
  110: { city: 'Delhi', lat: 28.6315, lng: 77.2167 },
  400: { city: 'Mumbai', lat: 19.0760, lng: 72.8777 },
  411: { city: 'Pune', lat: 18.5204, lng: 73.8567 },
  560: { city: 'Bengaluru', lat: 12.9716, lng: 77.5946 },
  500: { city: 'Hyderabad', lat: 17.3850, lng: 78.4867 },
  600: { city: 'Chennai', lat: 13.0827, lng: 80.2707 },
  700: { city: 'Kolkata', lat: 22.5726, lng: 88.3639 },
  380: { city: 'Ahmedabad', lat: 23.0225, lng: 72.5714 },
};

const KM_PER_DEG = 111.32;

/** Moves a point `km` kilometres at `bearing` degrees. */
function offset({ lat, lng }, km, bearing) {
  const rad = (bearing * Math.PI) / 180;
  return {
    lat: lat + (km * Math.cos(rad)) / KM_PER_DEG,
    lng: lng + (km * Math.sin(rad)) / (KM_PER_DEG * Math.cos((lat * Math.PI) / 180)),
  };
}

/** A point for a PIN code inside an Express city, or null outside them. `salt` spreads several shops in one PIN code. */
function locate(pincode, salt = '') {
  const pin = String(pincode || '');
  const centre = CITY_CENTRES[pin.slice(0, 3)];
  if (!centre) return null;
  const hash = crypto.createHash('sha256').update(pin).digest();
  const spot = offset(centre, 1 + (hash[0] / 255) * 7, (hash[1] / 255) * 360);
  if (salt) {
    const s = crypto.createHash('sha256').update(`${pin}:${salt}`).digest();
    return { city: centre.city, ...offset(spot, 0.3 + (s[0] / 255) * 0.9, (s[1] / 255) * 360) };
  }
  return { city: centre.city, ...spot };
}

/** Straight-line distance in kilometres (haversine). */
function distanceKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/** Point a fraction `t` (0 to 1) of the way from a to b. */
const between = (a, b, t) => ({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t });

const cityCentre = (pincode) => CITY_CENTRES[String(pincode || '').slice(0, 3)] || null;

module.exports = { CITY_CENTRES, locate, distanceKm, between, offset, cityCentre };
