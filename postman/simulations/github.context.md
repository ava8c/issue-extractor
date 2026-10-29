# GitHub Enterprise simulation

## Purpose

Simulazione locale esistente con fixture sintetiche da contratto GitHub; comportamento in `../mocks/github/default.js`. Il mock del proprietario non è stato usato: il repository non ha un workspace Postman collegato.

## Execution

Avvio e test sono descritti nel README. La verifica del 2026-10-24 ha usato Postman CLI 1.74.0, con output NDJSON temporaneo: il segnale `listening` riportava `http://localhost:4900/github`. La suite attuale include anche il client webhook Grok, verificabile con la sua simulazione locale. Interrompere il processo della simulazione al termine.

## Assumptions

- Il sandbox può rifiutare l’apertura delle porte locali con `listen EPERM`: eseguire simulazione e test di integrazione con l’autorizzazione locale necessaria. (observed 2026-10-24)
- I test concorrenti avvolgono le chiamate reali con una barriera per sovrapporre ricerca e polling; le richieste attraversano comunque HTTP. I quattro progetti usano ID univoci per evitare che scansioni precedenti alterino la baseline sintetica. (observed 2026-10-24, `tests/github.test.ts`)
- Il risultato non verifica VPN, token, schema o SMTP della reale istanza Enterprise. (reasoned 2026-10-24, configurazione di test)

## Observations

<!-- begin:observations -->

2026-10-26: il membro `github` ha servito la suite di regressione e il recupero dei dettagli per l’invio di una issue al simulatore Grok tramite il client reale. Entrambi i simulatori hanno registrato traffico; nessun membro silenzioso. Verificati metadati persistenti e passaggio della descrizione GitHub nel payload JSON; nessun accesso all’istanza Enterprise o alla routine reale.

2026-10-26: il solo membro `github` ha servito traffico per il riconoscimento automatico dell’account del token; nessun membro silenzioso. I test HTTP hanno verificato il riuso dell’identità già ottenuta dalla verifica della connessione, richieste concorrenti senza duplicazioni e controlli di rete ancora effettivi. Le notifiche proprie vengono lette senza configurazione manuale e il test HTTP/SMTP TLS ne ha confermato la consegna a tutti i destinatari. La verifica usa fixture sintetiche, non l’istanza Enterprise reale.

2026-10-26: il solo membro `github` ha servito traffico per il riconoscimento dell’autore; nessun membro silenzioso. I test HTTP con schema ufficiale hanno verificato commenti su più pagine, gruppi misti, cambi di stato nel progetto corretto e autori non disponibili su schemi Enterprise precedenti. Il test HTTP/SMTP TLS ha consegnato una notifica propria già letta a tutti i destinatari. Le fixture sono sintetiche; la disponibilità degli eventi di stato sulla reale istanza Enterprise resta da verificare.

2026-10-26: il solo membro `github` ha servito traffico; nessun membro silenzioso. `tests/github-connection.test.ts` ha verificato perdita della connessione su una porta locale chiusa, navigazione dai dati salvati, conversazioni mantenute in memoria e riconnessione al simulatore, distinguendo i problemi di token e permessi. La suite HTTP/SMTP è passata; una verifica Electron con profilo temporaneo e dati sintetici ha confermato avviso VPN, stime locali e riconnessione automatica. La VPN reale non è stata verificata.

2026-10-25: il solo membro `github` ha servito traffico, inclusi i commenti con nomi su più pagine; nessun membro silenzioso. La suite ha verificato nomi mancanti, autori non disponibili e bot senza richieste aggiuntive per profilo. Le query del client sono state validate anche con lo schema GraphQL ufficiale disponibile localmente. La verifica resta contro fixture sintetiche, non contro l’istanza Enterprise.

2026-10-24: il solo membro `github` ha servito traffico GraphQL, inclusi ricerca e polling sovrapposti; nessun membro silenzioso. Tutti i test della suite HTTP/SMTP sono passati.
<!-- end:observations -->
