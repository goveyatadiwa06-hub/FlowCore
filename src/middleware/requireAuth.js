function requireAuth(req, res, next) {
  if (req.session?.merchantId) return next();

  // store original destination
  req.session.returnTo = req.originalUrl;

  return res.redirect('/login');
}

module.exports = { requireAuth };
