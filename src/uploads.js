'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const { HttpError } = require('./security');

const IMAGE_TYPES = [
  { ext: 'jpg', mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'png', mime: 'image/png', test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { ext: 'webp', mime: 'image/webp', test: (b) => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
];

/**
 * Saves a product photo sent as a data URL and returns its public URL.
 * The file type is checked from its bytes, not its name, and the file gets a random name.
 */
function saveProductPhoto(dataUrl) {
  const m = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(typeof dataUrl === 'string' ? dataUrl : '');
  if (!m) throw new HttpError(400, 'Please choose a JPG, PNG or WebP photo.');
  const bytes = Buffer.from(m[1], 'base64');
  if (bytes.length > config.maxImageBytes) throw new HttpError(413, 'Photo is too large. Please use one under 2 MB.');
  const type = IMAGE_TYPES.find((t) => bytes.length > 12 && t.test(bytes));
  if (!type) throw new HttpError(400, 'Please choose a JPG, PNG or WebP photo.');
  if (config.inlineImages) return { url: `data:${type.mime};base64,${bytes.toString('base64')}`, bytes: bytes.length };
  const dir = path.join(config.uploadDir, 'products');
  fs.mkdirSync(dir, { recursive: true });
  const name = `${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}.${type.ext}`;
  fs.writeFileSync(path.join(dir, name), bytes);
  return { url: `/uploads/products/${name}`, bytes: bytes.length };
}

/** A product photo is a link to an https image, an uploaded photo, a built-in picture or (demo build only) an inline image. */
function readImage(val) {
  if (val === undefined || val === null || val === '') return '';
  if (typeof val !== 'string') throw new HttpError(400, 'Photo must be a link.');
  const s = val.trim();
  if (/^\/uploads\/products\/[a-z0-9-]+\.(jpg|png|webp)$/.test(s)) return s;
  if (/^img\/products\/[a-z0-9-]+\.svg$/.test(s)) return s;
  if (config.inlineImages && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(s) && s.length < config.maxImageBytes * 1.4) return s;
  let url;
  try { url = new URL(s); } catch { throw new HttpError(400, 'Photo link is not a valid web address.'); }
  if (url.protocol !== 'https:' || s.length > 1000) throw new HttpError(400, 'Photo link must start with https:// and be under 1,000 characters.');
  return url.href;
}

module.exports = { saveProductPhoto, readImage };
