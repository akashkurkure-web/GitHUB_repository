'use strict';
const config = require('./config');

/**
 * Delivery promise for a PIN code (blueprint stages 4 and 6).
 * Starter rules, written so they are easy to replace with a courier partner's serviceability list later:
 *  - Express (under 90 minutes) runs in the cities where Bazaario has partner stores, for products marked Express.
 *  - Standard delivery takes 2 days in those cities, 3 days elsewhere, 5 days in the North East and Jammu, Kashmir
 *    and Ladakh, and 7 days to the islands.
 *  - Cash on Delivery is not offered on the islands.
 */
const EXPRESS_CITIES = {
  110: 'Delhi', 400: 'Mumbai', 411: 'Pune', 560: 'Bengaluru', 500: 'Hyderabad', 600: 'Chennai', 700: 'Kolkata', 380: 'Ahmedabad',
};

function zoneOf(pincode) {
  const pin = String(pincode);
  if (/^744/.test(pin) || /^68255/.test(pin)) return { zone: 'island', days: 7, cod: false };
  if (/^(78|79|18|19)/.test(pin)) return { zone: 'remote', days: 5, cod: true };
  const city = EXPRESS_CITIES[pin.slice(0, 3)];
  if (city) return { zone: 'metro', city, days: 2, cod: true };
  return { zone: 'national', days: 3, cod: true };
}

// India Standard Time is UTC+5:30 all year.
const IST_OFFSET = 330 * 60 * 1000;
const istHour = (ts) => new Date(ts + IST_OFFSET).getUTCHours() + new Date(ts + IST_OFFSET).getUTCMinutes() / 60;

/** Next time an Express rider can arrive: within 90 minutes during working hours, else 10:00 next morning (IST). */
function expressPromise(now = Date.now()) {
  const hour = istHour(now);
  if (hour >= config.expressOpenHour && hour < config.expressCloseHour - 1.5) return now + 90 * 60 * 1000;
  const ist = new Date(now + IST_OFFSET);
  const dayStart = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - IST_OFFSET;
  const morning = dayStart + 10 * 3600_000;
  return hour < config.expressOpenHour ? morning : morning + 86400_000;
}

/** Standard delivery promise: end of day (8 pm IST) after the zone's number of days. */
function standardPromise(days, now = Date.now()) {
  const ist = new Date(now + IST_OFFSET);
  const dayStart = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - IST_OFFSET;
  return dayStart + days * 86400_000 + 20 * 3600_000;
}

/**
 * Delivery options for a PIN code and a set of products.
 * Express is offered only when every product is an Express product and the PIN code is in an Express city.
 */
function options(pincode, products = [], now = Date.now()) {
  const z = zoneOf(pincode);
  const allExpress = products.length > 0 && products.every((p) => p.express);
  const list = [];
  if (z.zone === 'metro' && allExpress) {
    list.push({ speed: 'express', label: 'Express', promisedAt: expressPromise(now), fee: config.expressFee });
  }
  list.push({ speed: 'standard', label: 'Standard', promisedAt: standardPromise(z.days, now), fee: null });
  return { pincode: String(pincode), zone: z.zone, city: z.city || null, cod: z.cod, options: list };
}

module.exports = { zoneOf, options, expressPromise, standardPromise, EXPRESS_CITIES };
