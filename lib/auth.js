const crypto = require('node:crypto');

const SESSION_DAYS = 30;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function checkPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const candidate = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(candidate, Buffer.from(hash, 'hex'));
}

async function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await db.query(
    `INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, now() + interval '${SESSION_DAYS} days')`,
    [token, userId],
  );
  return { token, maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000 };
}

async function userForSession(db, token) {
  if (!token) return null;
  const [user] = await db.query(`
    SELECT users.id, users.name, users.email FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token = $1 AND sessions.expires_at > now()
  `, [token]);
  return user ? { ...user, id: Number(user.id) } : null;
}

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

module.exports = { hashPassword, checkPassword, createSession, userForSession, readCookie };
