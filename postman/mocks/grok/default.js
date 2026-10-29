// Contract: docs/grok-webhook.md. Synthetic Authorization only in local tests.
const http = require('node:http')
const requests = []
http.createServer((req, res) => {
  let body = ''
  req.on('data', chunk => { body += chunk })
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json')
    if (req.method === 'GET' && req.url === '/requests') return res.end(JSON.stringify(requests))
    if (req.method !== 'POST') { res.writeHead(501); return res.end('{}') }
    if (req.headers.authorization !== 'Bearer synthetic-key') { res.writeHead(401); return res.end('{}') }
    let event; try { event = JSON.parse(body) } catch { res.writeHead(400); return res.end('{}') }
    const events = event.eventi || [event]
    if (!events.every(item => ['issue','email','call','nota'].includes(item.tipo))) { res.writeHead(400); return res.end('{}') }
    requests.push({ path: req.url, event, eventId: req.headers['idempotency-key'] })
    const status = /^\/reject\/(\d+)/.exec(req.url)
    if (status) { res.writeHead(Number(status[1])); return res.end('{}') }
    if (req.url === '/redirect') { res.writeHead(302, { location: '/webhook' }); return res.end('{}') }
    if (req.url === '/disconnect') { req.socket.destroy(); return }
    if (req.url === '/timeout') { setTimeout(() => res.end('{}'), 500).unref(); return }
    res.end('{}')
  })
}).listen(process.env.PORT || 0, '127.0.0.1')
