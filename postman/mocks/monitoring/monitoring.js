// Synthetic implementation of docs/monitoring-api.openapi.json. No real credentials.
const http = require('node:http')
const received = new Map()
http
  .createServer((req, res) => {
    const send = (status, value) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(value))
    }
    const token = req.headers.authorization || ''
    if (!/^Bearer iat_[a-f0-9]{24}\.[A-Za-z0-9_-]{43}$/.test(token) || token.includes('iat_bbbbb'))
      return send(401, { version: 1, error: 'Invalid API key' })
    if (token.includes('iat_ccccc')) {
      res.writeHead(503, { 'content-type': 'text/html' })
      return res.end('<h1>Unavailable</h1>')
    }
    if (token.includes('iat_ddddd')) return send(429, { version: 1, error: 'Rate limit' })
    if (token.includes('iat_eeeee')) {
      res.writeHead(200, { 'content-type': 'text/html' })
      return res.end('<h1>Login</h1>')
    }
    if (token.includes('iat_fffff')) {
      res.writeHead(307, { location: 'http://127.0.0.1:9/credential-leak' })
      return res.end()
    }
    if (req.url === '/api/v1/integration' && req.method === 'GET')
      return send(200, { version: 1, status: 'ok' })
    if (req.url.startsWith('/__test/received/') && req.method === 'GET')
      return send(
        200,
        received.get(decodeURIComponent(req.url.slice('/__test/received/'.length))) || {
          requests: 0,
        },
      )
    if (req.url !== '/api/v1/estimate-inbox' || req.method !== 'POST')
      return send(501, { error: 'Not modelled' })
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
    })
    req.on('end', () => {
      try {
        const payload = JSON.parse(raw)
        if (
          payload.version !== 1 ||
          !payload.project.id ||
          !payload.issue.id ||
          !Array.isArray(payload.estimate.entries)
        )
          return send(422, { version: 1, error: 'Invalid payload' })
        const previous = received.get(payload.project.id)
        received.set(payload.project.id, { payload, requests: (previous?.requests || 0) + 1 })
        send(200, {
          version: 1,
          status: previous?.payload.checked_at === payload.checked_at ? 'duplicate' : 'received',
          id: 1,
        })
      } catch {
        send(422, { version: 1, error: 'Invalid JSON' })
      }
    })
  })
  .listen(process.env.PORT || 3000)
