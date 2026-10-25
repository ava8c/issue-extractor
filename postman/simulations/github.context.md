# GitHub Enterprise simulation

## Purpose

Simulazione locale esistente con fixture sintetiche da contratto GitHub; comportamento in `../mocks/github/default.js`. Il mock del proprietario non è stato usato: il repository non ha un workspace Postman collegato.

## Execution

Avvio e test sono descritti nel README. La verifica del 2026-10-24 ha usato Postman CLI 1.74.0, con output NDJSON temporaneo: il segnale `listening` riportava `http://localhost:4900/github`. La suite include anche server SMTP TLS locali. Interrompere il processo della simulazione al termine.

## Assumptions

- Il sandbox può rifiutare l’apertura delle porte locali con `listen EPERM`: eseguire simulazione e test di integrazione con l’autorizzazione locale necessaria. (observed 2026-10-24)
- I test concorrenti avvolgono le chiamate reali con una barriera per sovrapporre ricerca e polling; le richieste attraversano comunque HTTP. I quattro progetti usano ID univoci per evitare che scansioni precedenti alterino la baseline sintetica. (observed 2026-10-24, `tests/github.test.ts`)
- Il risultato non verifica VPN, token, schema o SMTP della reale istanza Enterprise. (reasoned 2026-10-24, configurazione di test)

## Observations

<!-- begin:observations -->

2026-10-25: il solo membro `github` ha servito traffico, inclusi i commenti con nomi su più pagine; nessun membro silenzioso. La suite ha verificato nomi mancanti, autori non disponibili e bot senza richieste aggiuntive per profilo. Le query del client sono state validate anche con lo schema GraphQL ufficiale disponibile localmente. La verifica resta contro fixture sintetiche, non contro l’istanza Enterprise.

2026-10-24: il solo membro `github` ha servito traffico GraphQL, inclusi ricerca e polling sovrapposti; nessun membro silenzioso. Tutti i test della suite HTTP/SMTP sono passati.
<!-- end:observations -->
