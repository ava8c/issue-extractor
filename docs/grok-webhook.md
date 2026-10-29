# Eventi Grok via webhook

Il contratto dei payload è quello fornito per la routine: un evento JSON per richiesta, oppure `{ "eventi": [...] }` per un chiamante che raggruppa eventi. Queste app inviano un evento alla volta.

## Trasporto e credenziali

`POST <Webhook URL>` con `Content-Type: application/json` e `Authorization: Bearer <key>`. Il modulo accetta la key oppure la riga completa `Authorization: ...`; due valori diversi vengono rifiutati. La key non va nel payload o nell’URL. [Documentazione della routine](https://prod.cursor.com/help/grok-bot/routines).

URL HTTPS, senza credenziali incorporate, parametri o frammenti. HTTP è consentito solo su loopback per i test locali. Nessun redirect viene seguito. Il client conserva la verifica TLS standard e interrompe la richiesta dopo 20 secondi. Key/header sono cifrati con safeStorage e non vengono restituiti al renderer. Cambiando URL occorre reinserirli. Il pulsante di prova invia `tipo: nota`, senza dati personali o issue; avvia realmente la routine.

## Payload

I campi sono facoltativi secondo il contratto della routine. Le app omettono le informazioni non disponibili e non inventano persone, priorità o scadenze.

- Campi comuni: `tipo`, `azione`, `sorgente`, `data` ISO 8601, `progetto`, `autore`, `url`, `contenuto`, `dati`.
- Issue: `tipo: issue`, azione `nuova`, `commento` o `cambio_stato`; `dati.id` è il numero leggibile, con `repository` e `url` per distinguerlo. Include titolo, stato della notifica e stato precedente, descrizione, assegnatari e soli commenti disponibili al momento della notifica, con autori e data. Nessun download di immagini o allegati. Un errore nel recupero GitHub conserva i metadati e segnala il contenuto mancante.
- Call: `tipo: call`, titolo, progetto, data originale e partecipanti; `contenuto` contiene riepilogo, azioni, scadenze relative e punti aperti già salvati, più gli appunti se abilitati. `dati` contiene ID locale e durata. Non viene chiamato un altro modello AI, né vengono allegati audio, screenshot o video.
- Mail: `tipo: email`, `azione: nuova`, `sorgente: Apple Mail`; `dati` contiene `mittente`, `destinatari`, `cc`, `oggetto`, `corpo`, `thread_id`, `message_id`, `allegati`, direzione e account. Usa la data originale della mail. Apple Mail non espone il conversationId Outlook: si usa il primo Message-ID di References, oppure In-Reply-To/Message-ID; senza questi dati il campo viene omesso. Il corpo conserva il testo esposto da Mail. Gli allegati binari non sono trasferiti e BCC resta locale per il controllo anticiclo.

Esempio issue:

```json
{
  "tipo": "issue",
  "azione": "cambio_stato",
  "sorgente": "GitHub",
  "data": "2026-10-26T11:00:00.000Z",
  "progetto": "Progetto esempio",
  "url": "https://github.example/org/repo/issues/79",
  "dati": { "id": "79", "titolo": "Verifica rilascio", "stato_precedente": "In test", "stato": "Chiusa" }
}
```

## Conferme e ritentativi

Un HTTP 2xx viene registrato come **accettato**, senza affermare che la routine abbia terminato l’elaborazione. Errori 4xx e redirect restano errori di consegna. HTTP 408/5xx, timeout, perdita della risposta o arresto durante l’invio restano **da verificare**: nessun ritentativo automatico. Verificare Grok prima di confermare un nuovo tentativo. Un 429 o una connessione sicuramente non aperta possono essere ritentati con attesa crescente dalla coda. Issue Atlas si ferma dopo cinque tentativi; Pulse mantiene il proprio registro e i ritentativi manuali per le call.

`Idempotency-Key` mantiene l’identificativo locale del tentativo logico fra i ritentativi. Non è documentata una garanzia di deduplicazione del ricevente: non sostituisce la verifica degli esiti incerti. Risposte del server, credenziali e payload non sono riportati nei log degli errori.

Le ricevute precedenti restano conservate: un evento già accettato via mail non viene reinviato automaticamente via webhook. I nomi legacy delle colonne e della coda sono mantenuti per compatibilità dei dati, senza codice SMTP attivo. Le copie Apple Mail già preparate vengono convertite in eventi con il testo conservato. Le credenziali SMTP non vengono riutilizzate.

## Verifica locale

Il mock in `postman/mocks/grok/default.js` deriva da questo contratto e usa solo dati sintetici. Non è disponibile un workspace del proprietario collegato; non è stato cercato un mock remoto né contattata la routine reale.

```sh
postman simulation run postman/simulations/grok.sim.yaml --port 4901 --output ndjson
GROK_SIMULATION_URL=http://127.0.0.1:4901/grok npm test
```

I test HTTP con l’URL del simulatore attraversano il client reale. Senza la variabile, i soli test di integrazione HTTP Grok vengono saltati. Il simulatore non dimostra l’elaborazione finale da parte di Grok: serve configurare i secret e usare il pulsante di prova.
