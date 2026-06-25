import { config } from '../config.js';

// Gate every protected route behind the shared password.
// The frontend sends it as the `x-app-password` header. No match → 401.
export function requirePassword(req, res, next) {
  const provided = req.get('x-app-password') || '';
  if (provided !== config.appPassword) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}
