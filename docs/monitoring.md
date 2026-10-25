# Integrazione Issue Atlas

Le stime entrano in **Rapportini → Issue in attesa**. Non vengono create attività tramite API. Un utente autenticato sceglie risorsa, area, progetto, tipo attività e mese, quindi preme **Aggiungi al rapportino**. La stima originale è conservata in ore; le giornate usano il valore ore/giorno di Issue Atlas. La stima con efficienza viene proposta uguale all’originale ed è modificabile prima dell’inserimento.

Il mapping si salva qui, separatamente per integrazione, istanza GitHub, progetto GitHub e repository. Propone i domini per le issue successive e non seleziona il mese. Sono disponibili l’anno corrente, il successivo e tutti i mesi già usati, anche nei filtri di visualizzazione e report.

Gli invii ripetuti non creano duplicati. Una revisione più recente aggiorna l’area di attesa e riapre una voce già gestita; non cambia un’attività esistente. Lo storico indica i mesi già inseriti e impedisce un secondo inserimento nello stesso mese. Puoi archiviare un aggiornamento e modificare l’attività da **Visualizza e Modifica**, oppure inserirla in un altro mese. Una stima rimossa in Issue Atlas viene segnalata senza cancellare i rapportini. Le stime da verificare richiedono una conferma delle fonti.

## Avvio

Richiede Python **3.11 o successivo**. Streamlit e l’API sono due processi che devono condividere lo stesso file SQLite su disco locale.

```bash
python -m pip install -r requirements.txt
export MONITORAGGIO_DB_PATH=/percorso/monitoraggio/monitoraggio.db
streamlit run app.py --server.address 127.0.0.1
```

In un secondo processo, con lo stesso `MONITORAGGIO_DB_PATH`:

```bash
python -m uvicorn api:app --host 127.0.0.1 --port 8502 --workers 1 --proxy-headers --forwarded-allow-ips=127.0.0.1 --no-server-header
```

Le migrazioni aggiungono le tabelle `atlas_*` senza modificare le attività esistenti. Esegui il normale backup del database prima di aggiornare l’installazione. Mantieni la porta 8502 raggiungibile solo dal reverse proxy locale; il collegamento pubblico deve usare HTTPS. Non impostare `MONITORAGGIO_ALLOW_LOCAL_HTTP` in produzione.

Nel server HTTPS Nginx esistente aggiungi questo percorso, preservando il routing Streamlit. La direttiva `limit_req_zone` va nel blocco `http`:

```nginx
limit_req_zone $binary_remote_addr zone=atlas_api:10m rate=2r/s;

# Nel server HTTPS già configurato con certificato valido:
location /api/v1/ {
    limit_req zone=atlas_api burst=30 nodelay;
    limit_req_status 429;
    client_max_body_size 64k;
    client_body_timeout 10s;
    proxy_pass http://127.0.0.1:8502;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_read_timeout 15s;
}
```

Il proxy sovrascrive gli header di inoltro. Uvicorn deve fidarsi solo dell’IP effettivo del proxy, come descritto nella [documentazione Uvicorn](https://uvicorn.dev/deployment/#proxies-and-forwarded-headers). Se il proxy è in un altro container, adatta sia il bind privato sia la lista degli IP fidati. Non aprire la porta dell’API su Internet. Gli endpoint rifiutano HTTP e non attivano CORS, sessioni browser o autenticazione tramite cookie.

## Collegamento

1. Accedi come amministratore e apri **Rapportini → Integrazione Issue Atlas**.
2. Genera una chiave dedicata e copiala. Il database conserva solo SHA-256 della chiave; puoi rigenerarla mantenendo lo stesso ID integrazione o revocarla. Rigenera una chiave per sostituirla senza perdere deduplicazione e mapping.
3. In Issue Atlas apri **Impostazioni → Monitoraggio** e inserisci URL base pubblico e chiave. L’URL non deve terminare con `/api/v1`. Sono supportati prefissi se il reverse proxy li rimuove prima di inoltrare all’API.
4. Verifica la connessione, abilita l’invio e salva. L’attivazione invia anche le stime già disponibili. La chiave viene cifrata usando il Portachiavi macOS e non viene restituita all’interfaccia.

Ogni chiave autorizza solo `GET /api/v1/integration` e `POST /api/v1/estimate-inbox`. Non consente lettura dei rapportini, promozione o modifiche alle attività. Sono applicati un limite persistente di 120 richieste/minuto per chiave, un limite preautenticazione per processo, un massimo di 64 KiB per richiesta e la validazione di campi, origini URL, numeri e totali. La protezione volumetrica prima del processo appartiene al reverse proxy.

## Contratto e verifica

Il contratto è [issue-atlas.openapi.json](monitoring-api.openapi.json); è generato dai modelli dell’API con `python scripts/export_atlas_contract.py`. La chiave di deduplicazione comprende ID integrazione, istanza GitHub, ID progetto e ID issue. `checked_at` ordina le revisioni; una revisione precedente riceve `stale`, un retry identico `duplicate`, una collisione di timestamp con contenuto diverso HTTP 409. Una risposta positiva conferma la scrittura SQLite. Titolo, dati di progetto e fonti delle stime sono trasferiti; il testo completo di issue e conversazione non viene inviato.

Issue Atlas salva la coda localmente e prova gli invii con timeout di 10 secondi, fino a 20 voci per ciclo. Ritenta dopo 1, 2, 4, 8, 16 e poi 30 minuti, con l’app aperta; **Riprova gli invii** azzera l’attesa. I redirect HTTP sono rifiutati e i certificati TLS vengono verificati. Il cambio di URL richiede di reinserire la chiave e avvia una coda per la nuova destinazione. La disconnessione GitHub cancella la coda dell’account.

```bash
python -m pip install -r requirements-dev.txt
python -m unittest discover -s tests -v
```

Dalla cartella Issue Atlas, usando il Python con le dipendenze di Monitoraggio:

```bash
/percorso/venv/bin/python scripts/test-monitoring-e2e.py /percorso/monitoraggio
```

Questo controllo avvia l’API locale con un database temporaneo, esegue il vero client TypeScript, verifica l’area di attesa e promuove manualmente un’attività di novembre con le ore giornaliere. Non legge né modifica il database di produzione. I test locali non verificano certificati, proxy e instradamento del server pubblico: dopo il deploy usa **Verifica connessione** sull’URL reale.
