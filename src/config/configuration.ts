export default () => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  database: {
    url: process.env.DATABASE_URL,
  },
  jwt: {
    secret: process.env.JWT_SECRET,
  },
  session: {
    // How long one device stays signed in after redeeming a token. The JWT,
    // the cookie and the TokenSession row all share this lifetime.
    days: Number(process.env.SESSION_DAYS ?? 30),
    // false only for plain-http local development; the VPS sits behind
    // Cloudflare/nginx on https.
    secureCookie: (process.env.COOKIE_SECURE ?? 'true') === 'true',
  },
  feUrl: process.env.FE_URL,
});
