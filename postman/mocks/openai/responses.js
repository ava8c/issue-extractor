// Synthetic OpenAI responses, based on the documented Responses / Models contract.
// The fixed Italian phrases below exercise ledger updates; this is not an LLM.
const http = require('node:http')
const entry = (sourceId, min, unit, excerpt) => ({
  sourceId,
  amount: min,
  unit,
  label: 'Intervento',
  excerpt,
})
http
  .createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
    })
    req.on('end', () => {
      res.setHeader('content-type', 'application/json')
      if (!req.headers.authorization?.startsWith('Bearer simulation-')) {
        res.writeHead(401)
        return res.end('{}')
      }
      if (req.url === '/v1/models' && req.method === 'GET')
        return res.end(
          JSON.stringify({
            object: 'list',
            data: [{ id: 'gpt-6-luna', object: 'model', created: 1, owned_by: 'openai' }],
          }),
        )
      if (req.url === '/v1/decisions' && req.method === 'POST') {
        try {
          const body = JSON.parse(raw)
          if (
            body.model !== 'gpt-6-luna' ||
            !Array.isArray(body.questions) ||
            !body.questions.length ||
            body.questions.length > 400 ||
            body.store !== undefined
          ) {
            res.writeHead(400)
            return res.end('{}')
          }
          if (req.headers.authorization === 'Bearer simulation-decisions-rate-limit') {
            res.writeHead(429)
            return res.end('{}')
          }
          const input = JSON.parse(body.input)
          const answers = body.questions.map((question, index) => {
            const source = input.sources[index]
            let choice = 'ignore'
            if (/Aggiungiamo 4 ore|aggiungiamo 4 ore|Altre 2 ore/.test(source.text)) choice = 'add'
            if (/Nuovo totale|Nuova stima|Tempo di analisi/.test(source.text)) choice = 'replace'
            if (/Serve anche|Non sono sicuro|Da ricostruire/.test(source.text)) choice = 'rebuild'
            const confidence = /Decisione incerta/.test(source.text) ? 0.55 : 0.99
            if (/Rifiuto decisione/.test(source.text))
              return { type: 'refusal', name: question.name }
            return {
              type: 'choice',
              name: question.name,
              choice,
              confidence,
              probabilities: question.choices.map((item) => ({
                value: item.value,
                probability: item.value === choice ? confidence : (1 - confidence) / 3,
              })),
            }
          })
          return res.end(
            JSON.stringify({
              model: 'gpt-6-luna',
              answers,
              usage: {
                input_tokens: 100,
                input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
                output_tokens: 0,
                output_tokens_details: { reasoning_tokens: 0 },
                total_tokens: 100,
              },
            }),
          )
        } catch {
          res.writeHead(400)
          return res.end('{}')
        }
      }
      if (req.url !== '/v1/responses' || req.method !== 'POST') {
        res.writeHead(501)
        return res.end('{}')
      }
      try {
        const body = JSON.parse(raw)
        if (
          !body.model ||
          body.store !== false ||
          body.text?.format?.type !== 'json_schema' ||
          !body.text.format.strict ||
          !body.max_output_tokens ||
          !body.instructions
        ) {
          res.writeHead(400)
          return res.end(
            JSON.stringify({
              error: { message: 'Unexpected request shape', type: 'invalid_request_error' },
            }),
          )
        }
        if (body.model === 'test-rate-limit') {
          res.writeHead(429)
          return res.end(JSON.stringify({ error: { type: 'rate_limit_error' } }))
        }
        if (body.model === 'test-html-error') {
          res.writeHead(503, { 'content-type': 'text/html' })
          return res.end('<html>Proxy down</html>')
        }
        if (body.model === 'test-invalid-json') return res.end('not-json')
        const input = JSON.parse(body.input)
        let entries = []
        let needsReview = false
        let note = ''
        for (const source of input.sources) {
          if (source.text.includes('Stima: 2 giorni.'))
            entries.push(entry(source.id, 2, 'days', 'Stima: 2 giorni.'))
          if (source.text.includes('Stima: 3 giorni.'))
            entries.push(entry(source.id, 3, 'days', 'Stima: 3 giorni.'))
          if (source.text.includes('Aggiungiamo 4 ore.'))
            entries.push(entry(source.id, 4, 'hours', 'Aggiungiamo 4 ore.'))
          if (source.text.includes('Altre 2 ore.'))
            entries.push(entry(source.id, 2, 'hours', 'Altre 2 ore.'))
          if (source.text.includes('Totale 1,5h.')) {
            entries = [
              entry(
                source.id,
                1,
                'hours',
                'Tempo di analisi 1h. Tempo di fix 0,5h.\n\nTotale 1,5h.',
              ),
            ]
            note = 'Totale esplicito di analisi e fix.'
          }
          if (source.text.includes('Nuovo totale: 5 giorni.')) {
            entries = [entry(source.id, 5, 'days', 'Nuovo totale: 5 giorni.')]
            needsReview = false
            note = ''
          }
          if (source.text.includes('Serve anche esportare in PDF.')) {
            needsReview = true
            note = 'Nuovo requisito senza stima aggiuntiva.'
          }
        }
        const result = { entries, needsReview, note }
        if (body.model === 'test-invalid-source')
          result.entries = [entry('missing', 900, 'days', 'Inventato')]
        const reply = () =>
          res.end(
            JSON.stringify({
              id: 'resp_simulation',
              object: 'response',
              status: body.model === 'test-incomplete' ? 'incomplete' : 'completed',
              output: [
                {
                  type: 'message',
                  role: 'assistant',
                  content:
                    body.model === 'test-refusal'
                      ? [{ type: 'refusal', refusal: 'Synthetic refusal' }]
                      : [{ type: 'output_text', text: JSON.stringify(result) }],
                },
              ],
              usage: { input_tokens: 200, output_tokens: 70, total_tokens: 270 },
            }),
          )
        if (body.model === 'test-slow') setTimeout(reply, 250)
        else reply()
      } catch {
        res.writeHead(400)
        res.end('{}')
      }
    })
  })
  .listen(process.env.PORT || 4902)
