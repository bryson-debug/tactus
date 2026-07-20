const { COOKIE_NAME, checkPassword } = require('../lib/dashboard-auth');

module.exports.config = { api: { bodyParser: true } };

function formHtml(showError) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Tactus</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; background: #0d0d0d; color: #fff; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
  form { background: #1a1a19; padding: 32px; border-radius: 12px; width: 260px; border: 1px solid rgba(255,255,255,0.1); }
  h1 { font-size: 18px; margin: 0 0 16px; }
  input { width: 100%; padding: 8px 10px; margin-bottom: 12px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.2); background: #0d0d0d; color: #fff; box-sizing: border-box; font-size: 14px; }
  button { width: 100%; padding: 8px; border-radius: 6px; border: none; background: #3987e5; color: #fff; cursor: pointer; font-size: 14px; }
  .error { color: #e66767; font-size: 13px; margin-bottom: 12px; }
</style>
</head>
<body>
  <form method="POST" action="/api/login">
    <h1>Tactus</h1>
    ${showError ? '<div class="error">Incorrect password.</div>' : ''}
    <input type="password" name="password" placeholder="Password" autofocus required />
    <button type="submit">Sign in</button>
  </form>
</body>
</html>`;
}

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    res.status(200).setHeader('Content-Type', 'text/html').send(formHtml(req.query.error));
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  let valid;
  try {
    valid = checkPassword((req.body || {}).password);
  } catch (err) {
    res.status(500).send(`Dashboard misconfigured: ${err.message}`);
    return;
  }

  if (!valid) {
    res.writeHead(302, { Location: '/api/login?error=1' });
    res.end();
    return;
  }

  const oneMonthSeconds = 30 * 24 * 60 * 60;
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${encodeURIComponent(req.body.password)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${oneMonthSeconds}`
  );
  res.writeHead(302, { Location: '/' });
  res.end();
};
