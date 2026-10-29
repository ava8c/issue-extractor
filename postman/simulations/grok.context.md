# Grok webhook simulation

## Purpose

Verifica delle richieste reali delle app verso la routine, con il contratto in `../../docs/grok-webhook.md` e il mock locale in `../mocks/grok/default.js`. Nessun workspace del proprietario collegato; mock remoto non cercato.

## Execution

Postman CLI 1.74.0: `postman simulation run postman/simulations/grok.sim.yaml --port 4901 --output ndjson`. Il segnale listening ha riportato `http://localhost:4901/grok`. La suite usa `GROK_SIMULATION_URL=http://127.0.0.1:4901/grok npm test`. Arrestare la simulazione con Ctrl-C al termine.

## Assumptions

- Il sandbox rifiuta l’ascolto su loopback con `listen EPERM`: simulazione e test HTTP richiedono l’autorizzazione locale. (observed 2026-10-26)
- Accettazione HTTP e idempotenza della routine reale non sono provate dal mock; i test verificano invio e stati locali. (reasoned 2026-10-26, docs/grok-webhook.md)

## Observations

<!-- begin:observations -->
2026-10-26: il solo membro `grok` ha ricevuto traffico per payload JSON, Authorization sintetico, ricevute e gestione di 401/403/429/5xx, redirect e timeout; nessun membro silenzioso. Verificati invii di issue, call e mail con client e code reali. Nessuna credenziale reale usata.
<!-- end:observations -->

## What didn't work

- 2026-10-26: una chiusura volontaria del socket nel mock diventa HTTP 502 nel proxy della simulazione; non riproduce un reset diretto del socket del chiamante. Il timeout del chiamante è verificato con una risposta ritardata. HTTP 5xx viene conservativamente trattato come esito incerto.
