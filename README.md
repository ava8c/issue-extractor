# Issue Atlas

App desktop per macOS per navigare GitHub Enterprise Projects v2, leggere le conversazioni e organizzare il lavoro. Electron, React e TypeScript; nessun backend remoto.

## Avvio su Mac

Richiede Node.js 22.12+ e macOS compatibile con Electron 43.

```sh
npm ci
npm run dev
```

Durante modifiche, test e miglioramenti usa **`npm run dev`**: avvia direttamente Electron e Vite dal terminale. Le modifiche React/CSS sono visibili subito; dopo modifiche al processo principale o al preload interrompi con `Ctrl+C` e rilancia lo stesso comando. Non è necessario creare DMG o reinstallare l’app. Chiudi eventuali vecchie copie dell’app installata per evitare di provare una versione precedente.

## Collegare GitHub Enterprise

1. Apri **Impostazioni** (`⌘ ,`).
2. L’istanza `https://github.servizi.allitude.it`, l’organizzazione `corebanking` e il link al Project 59 sono già precompilati.
3. Inserisci il personal access token. Per un PAT classico: `read:project`, `repo` per le issue private e `read:org` per scoprire le organizzazioni. Se l’istanza usa SSO, autorizza il token per l’organizzazione. Con un PAT fine-grained, assegna accesso in lettura a Projects e alle issue dei repository interessati secondo i permessi della tua versione Enterprise.
4. **Verifica connessione**, poi **Salva e connetti**.

L’app scopre i progetti personali e quelli delle organizzazioni visibili al token, seguendo tutte le pagine. Le organizzazioni esterne alla membership possono essere aggiunte manualmente. I link diretti `…/orgs/ORG/projects/NUMERO/views/…` o `…/users/USER/projects/NUMERO` permettono di aggiungere progetti specifici. Gli errori di accesso sono mostrati, senza fingere che una scoperta parziale sia completa.

Projects v2 viene letto via GraphQL (`/api/graphql` su Enterprise Server, `https://api.github.com/graphql` su github.com). La compatibilità effettiva dipende dalla versione e dallo schema della tua istanza Enterprise. Non vengono effettuate mutazioni su GitHub.

## Integrazione con Monitoraggio

In **Impostazioni → Monitoraggio** puoi configurare URL base HTTPS e chiave API dedicata. All’attivazione vengono inviate le stime disponibili e poi i loro aggiornamenti; una coda locale conserva gli invii e ritenta gli errori con l’app aperta. La chiave è cifrata nel Portachiavi e va reinserita cambiando URL.

Le issue arrivano in **Rapportini → Issue in attesa** di Monitoraggio: da lì scegli manualmente mese, risorsa, area, progetto e tipo attività. I mapping si salvano in Monitoraggio. Gli invii non modificano i rapportini esistenti. Per attivare l’API sul server segui la [guida di integrazione](docs/monitoring.md); il [contratto OpenAPI](docs/monitoring-api.openapi.json) è generato dai modelli Python di Monitoraggio.

## Navigazione

- Progetti, preferiti e vista **Tutte le issue**, con deduplicazione delle issue presenti in più progetti.
- **Dashboard generale**, aperta all’avvio, con le sette metriche comuni, copertura dei dati e tabella per progetto. I nomi dei progetti aprono Lista/Kanban; l’icona di configurazione permette di impostare le associazioni direttamente dalla dashboard.
- **Configura metriche**, nella pagina di ogni progetto, associa uno o più stati a **In attesa Allitude**, **Da stimare**, **Backlog**, **In lavorazione**, **Da rilasciare**, **Rilasciate** e **Completate**. **Backlog** rappresenta le issue già stimate, in attesa di lavorazione: associa gli stati del progetto che corrispondono a questa fase. Le schede danno risalto ai valori insieme a issue totali, aperte e senza mapping. Le associazioni sono personali, salvate per progetto e istanza, separate dai filtri e mantenute alla riapertura. Non vengono dedotte dal nome degli stati: una metrica senza associazioni mostra **—**, mentre una metrica configurata senza issue mostra **0**. Puoi associare uno stato a più metriche; in quel caso i conteggi si sovrappongono.
- Le metriche leggono tutti gli stati dall’indice del controllo attività (o da una lista completa più recente), comprese issue chiuse, pull request e bozze; ricerca e filtri Lista/Kanban non le modificano. La dashboard somma i conteggi dei progetti visibili: una issue presente in più progetti conta in ciascuno, perché può avere stati e mapping diversi. I progetti nascosti sono esclusi. **Senza mapping** indica gli elementi in stati non associati ad alcuna metrica; la copertura di ogni numerica indica quanti progetti contribuiscono al totale. I dati si aggiornano con il controllo attività ogni due minuti o con **Aggiorna metriche**. In caso di errore rimangono visibili i valori precedenti con l’orario di sincronizzazione; progetti mai sincronizzati mostrano **—**.
- **Organizza progetti** consente di assegnare nomi locali, riordinare con le frecce e nascondere/mostrare i progetti. Puoi trascinare i progetti anche nella barra laterale. I progetti nascosti sono esclusi da **Tutte le issue**. Le modifiche sono personali nell’app e non cambiano i progetti su GitHub.
- La barra laterale si ridimensiona trascinando il bordo destro (180–420 px). Doppio clic per ripristinarla; quando il divisore ha il focus puoi usare le frecce della tastiera.
- Ricerca locale in titolo, numero, repository ed etichette del progetto selezionato (`⌘ K`). Filtri per apertura/chiusura, repository e **selezione multipla degli stati** del progetto, con comandi **Tutti** e **Nessuno**; ordinamento per stato, aggiornamento, creazione o titolo. La selezione degli stati è salvata automaticamente per ogni progetto, condivisa tra **Lista** e **Kanban** e mantenuta anche dopo la riapertura dell’app. Le selezioni singole già salvate vengono conservate. Vista **Lista** e **Kanban**, con apertura delle schede nel dettaglio laterale.
- **Vai a issue** (`⌘ P` su Mac, `Ctrl+P` altrove; anche dal menu **Naviga**) apre la ricerca rapida. Digita il numero, anche preceduto da `#`, scegli una riga con `↑` e `↓`, poi premi **Invio**. Ogni risultato indica repository e progetto: lo stesso numero in repository diversi e la stessa issue in più progetti restano distinti. La ricerca usa l’indice locale di tutti gli stati dei progetti visibili, aggiornato dal controllo attività; solo i progetti mai indicizzati richiedono una scansione iniziale. L’issue si apre direttamente nel progetto scelto, mantenendo i filtri salvati. Se è fuori dai filtri, un avviso nel dettaglio permette di tornare alla lista. **Esc** chiude la ricerca e ripristina il focus.
- La campanella apre il **centro notifiche**, con badge delle non lette, ordine dal più recente, raggruppamento per data e schede **Tutte**, **Stato**, **Nuove issue** e **Commenti**. Puoi mostrare solo le non lette, segnare una notifica o tutte come lette e aprire direttamente l’issue nel suo progetto. Il primo controllo di un progetto crea una base di confronto senza generare notifiche per le issue già presenti.
- Il controllo attività parte in background ogni **due minuti mentre l’app è aperta**, quando la lista non sta caricando. Legge solo metadati e conteggi dei commenti dei progetti visibili, indipendentemente dai filtri di stato; non scarica descrizioni, conversazioni o allegati. Il pulsante **Aggiorna** nel centro notifiche forza un controllo. Le nuove issue sono quelle aggiunte a un progetto già monitorato; i cambi di stato includono anche apertura/chiusura della issue. Un aumento del conteggio segnala nuovi commenti, deduplicati tra progetti per la stessa issue. Modifiche ai commenti e aggiunte compensate da cancellazioni tra due controlli non vengono rilevate. L’orario della notifica indica quando il cambiamento è stato rilevato, non quello esatto dell’azione su GitHub.
- **Cache locale e aggiornamenti incrementali**: progetti e liste già visitate vengono salvati sul Mac e mostrati subito, anche dopo la riapertura. Per cinque minuti la navigazione riusa le liste senza richieste di aggiornamento; tornando su una lista più vecchia, la sincronizzazione parte in background. Il pulsante **Aggiorna progetti e issue** forza il controllo anche prima. L’orario dell’ultima sincronizzazione è disponibile passando sul pulsante di aggiornamento nella barra superiore. In caso di errore restano visibili i dati salvati, con un avviso.
- La sincronizzazione della lista legge un indice di ID, stato progetto e data di modifica, recuperando i metadati completi **solo per issue nuove o modificate negli stati selezionati**. Rileva anche rimozioni e cambi di stato. Selezionando **Nessuno**, la lista non richiede elementi; il controllo attività resta indipendente per poter rilevare cambi di stato. Descrizioni e conversazioni vengono scaricate solo aprendo una scheda, per mantenere leggero il caricamento della lista. I conteggi della lista si riferiscono agli stati caricati; le schede metriche coprono tutti gli stati.
- Vista, filtri e ordine degli stati sono salvati **per progetto**. L’ordine iniziale viene letto dalle opzioni del campo GitHub `Status` o `Stato`, incluse le colonne vuote. **Ordine stati** permette di personalizzarlo e di ripristinare quello GitHub; nel Kanban puoi anche trascinare le intestazioni. L’ordinamento del campo può differire da configurazioni particolari di una singola vista web: l’app non replica filtri, colonne nascoste o ordinamenti aggiuntivi di quella vista.
- Il dettaglio dà priorità alla conversazione: descrizione espandibile (aperta quando non ci sono commenti), autori e date separati dal testo, accesso diretto all’ultimo commento. Le fonti delle stime aprono automaticamente la descrizione se necessario.
- Descrizione e conversazione in Markdown/GFM, tabelle, checklist, HTML sanitizzato, immagini protette caricate dal processo principale, ingrandimento e copia delle immagini. I download delle immagini partono quando entrano nell’area visibile, con al massimo tre richieste contemporanee; riferimenti ripetuti condividono il download. La cache conserva fino a 20 immagini entro un budget di 32 MiB per le stringhe delle anteprime ed esclude quelle troppo grandi; il cambio di connessione invalida anche i risultati dei download precedenti ancora in corso.
- Tutti i commenti della conversazione vengono recuperati, anche oltre 100, prima di abilitare l’export. La conversazione mostra il nome completo del profilo GitHub e le iniziali dell’autore; se il nome non è compilato usa lo username, e se l’autore non è disponibile lo segnala. Gli autori vengono letti insieme ai commenti, senza richieste per ogni profilo. L’export continua a escludere i metadati degli autori; nomi o menzioni nel testo originale restano intatti.
- Le date nell’interfaccia sono locali con fuso orario; quelle esportate sono UTC, con data e ora, incluse le modifiche ai commenti.

Sono mostrati anche bozze e pull request presenti nei progetti. Per le PR sono inclusi i commenti della conversazione, **non** le review inline del codice; l’interfaccia lo segnala. Lo stato del progetto legge il campo `Status` o `Stato`; se non disponibile viene mostrato “Senza stato”.

Nel filtro degli stati, **Bozze** permette di escludere le bozze da Lista e Kanban in qualsiasi stato. La scelta è salvata per progetto e si combina con gli altri filtri; inizialmente le bozze sono incluse. Non aggiunge uno stato a GitHub.

Il pulsante **Notifiche progetto**, disponibile aprendo un singolo progetto, permette di selezionare gli stati per cui ricevere notifiche nell’app e via mail, comprese le voci **Senza stato** e **Bozze**. Inizialmente è tutto selezionato; gli stati aggiunti in seguito sono abilitati automaticamente. Una issue creata in uno stato escluso, spostata in quello stato o commentata mentre si trova lì non genera notifiche né email. Disattivare **Bozze** le esclude in qualsiasi stato. La scelta è indipendente dai filtri della lista e viene conservata alla riapertura dell’app. Il monitoraggio aggiorna comunque la base di confronto: riabilitare uno stato non invia gli eventi ignorati. Le notifiche già ricevute restano nello storico; le email ancora in attesa che risultano escluse vengono annullate.

Quando disponibile, viene usato il filtro [`ProjectV2.items(query:)`](https://docs.github.com/en/graphql/reference/projects#projectv2) con la [sintassi degli stati multipli](https://docs.github.com/en/issues/planning-and-tracking-with-projects/customizing-views-in-your-project/filtering-projects). Le versioni Enterprise precedenti, ad esempio [Server 3.18](https://docs.github.com/en/enterprise-server%403.18/graphql/reference/projects#projectv2), non espongono questo argomento: l’app passa automaticamente all’indice leggero dell’intero progetto e filtra prima di scaricare i metadati. Questo controllo resta necessario per riconoscere rimozioni e cambi di stato; non è un endpoint delta fornito da GitHub. Non viene applicato un limite arbitrario alle issue, che potrebbe nascondere elementi attivi più vecchi.

## Stime delle issue con OpenAI

1. In **Impostazioni → OpenAI e stime**, inserisci la chiave API e attiva l’estrazione. Il modello predefinito è **GPT-6 Luna (`gpt-6-luna`)**; la precedente impostazione `gpt-4.1-mini` viene migrata a Luna al caricamento, mantenendo la chiave cifrata. Gli altri modelli scelti esplicitamente restano selezionabili per l’estrazione. **Carica modelli e verifica chiave** legge l’elenco senza generare testo.
2. Apri un progetto e scegli **Stime progetto**. Abilita gli stati da monitorare, per esempio “Da stimare”, “Da approvare”, “Backlog” e gli stati di lavorazione in cui ricevete integrazioni. Le regole sono indipendenti dai filtri Lista/Kanban e dalle notifiche; i nuovi stati non si abilitano automaticamente.
3. Scegli se includere issue chiuse e bozze (escluse inizialmente), una data minima di ultima modifica, le ore per giornata e le convenzioni del progetto. **Non esiste un ricalcolo ogni X ore.** I valori precedenti di “Ricontrollo testo” vengono ignorati.

Le stime sono visibili in **Lista, Kanban e dettaglio**, anche quando un’issue esce dagli stati monitorati. Il valore mostrato è sempre un **totale singolo**. Un totale esplicito prevale sulle componenti: `Tempo di analisi 1h. Tempo di fix 0,5h. Totale 1,5h.` produce **1,5 h**, senza intervalli e senza sommare due volte il totale. La virgola è un separatore decimale. In assenza di un totale si sommano le componenti; ore e giornate miste vengono convertite in un totale in ore usando le ore/giorno del progetto. Per un vero intervallo dichiarato nella fonte si usa il limite superiore, con una nota prudenziale. Le precedenti stime salvate come intervalli vengono normalizzate localmente, privilegiando i totali espliciti presenti nelle citazioni, senza nuove chiamate AI.

Se non ci sono quantità esplicite, compare solo **Nessuna stima**, senza “verifica”. Una quantità conosciuta con nuovi requisiti non quantificati può essere segnalata **da verificare**. Apri la scheda **Stima** nel dettaglio per vedere componenti, totale e citazioni esatte; **Vai alla fonte nella conversazione** apre il punto corrispondente. Il modello può sbagliare: le fonti permettono di controllare il risultato.

Il processo riusa l’indice delle notifiche ogni due minuti, mentre l’app è aperta e il progetto visibile. L’indice contiene metadati e conteggi, non il corpo dei nuovi commenti. Per una issue già analizzata vengono scaricati solo i commenti in coda, risalendo fino all’ultimo commento noto, con un controllo della descrizione e del commento di confine. Le conversazioni appena scaricate per il dettaglio o per una mail vengono condivise in memoria per 30 secondi, fino a 20 risultati; le richieste simultanee condividono lo stesso download. Il pulsante di aggiornamento del dettaglio e il ricalcolo manuale ignorano la cache temporanea.

La prima analisi usa la conversazione completa. Poi la [Decisions API](https://developers.openai.com/api/docs/guides/decisions), con `gpt-6-luna`, classifica in un’unica chiamata i nuovi commenti (fino a 400), ricevendo solo il delta e il riepilogo numerico precedente:

- **Nessun effetto**: conserva la stima; nessuna richiesta di estrazione.
- **Aggiunta**: estrae solo le nuove quantità e le somma nel codice.
- **Sostituzione**: estrae solo il nuovo totale e sostituisce il precedente nel codice.
- **Incerto / revisione parziale**: recupera la storia completa e ricostruisce la stima. Anche un rifiuto o una confidenza sotto la soglia configurata richiede la ricostruzione.

L’estrazione delle quantità usa [Responses e Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs), con `store: false`; su Luna usa `reasoning.effort: none` per limitare i consumi. Le risposte contengono quantità scalari, senza campi di intervallo. Il codice privilegia i totali espliciti nelle fonti e applica le operazioni in ordine cronologico, evitando di riesporre al modello tutto il riepilogo delle vecchie stime per ogni aggiornamento. Errori HTTP o timeout di Decisions conservano l’ultima stima e rispettano il backoff, senza aggirare l’errore con un’altra chiamata a pagamento.

Senza nuovi commenti o modifiche rilevate non si rilegge il testo e non si chiama l’AI, anche a distanza di giorni. Modifiche/cancellazioni rilevate dai metadati o un confine del delta incoerente richiedono una lettura completa; se le impronte del testo coincidono non serve estrazione. Modifiche a vecchi commenti non riflesse dall’indice richiedono **Ricalcola da tutta la conversazione**: non c’è un controllo periodico nascosto. Cambiare modello o convenzioni non rianalizza in massa le issue: le nuove impostazioni si applicano al prossimo aggiornamento pertinente o al ricalcolo manuale. Issue e convenzioni coincidenti in più progetti riusano il risultato.

Sono configurabili caratteri per estrazione (24.000), token di output (1.600), issue per ciclo (5), budget token giornaliero (100.000, reset UTC) e soglia di confidenza Decisions (0,90). Il budget include entrambe le API e prenota su disco un massimo prudenziale prima di ogni richiesta; i consumi riportati dalla risposta sostituiscono la prenotazione. Errori senza conteggio mantengono la prenotazione. È un limite locale di token, non un tetto monetario sul conto OpenAI. I testi non vengono troncati: un contesto oltre il limite richiede di aumentarlo e ricalcolare. Gli errori mantengono l’ultima stima valida e attendono almeno 15 minuti prima del successivo tentativo automatico.

La chiave è cifrata con Electron `safeStorage` in `openai.json` e non viene restituita all’interfaccia. `estimates.json` conserva regole, impronte, risultati, citazioni di massimo 240 caratteri per voce e consumi, con permessi `0600` e scritture atomiche; non salva intere conversazioni né chiavi. È isolato per istanza/credenziale GitHub ed eliminato al cambio connessione o alla disconnessione. I testi delle issue ammesse sono inviati direttamente dal Mac a OpenAI; immagini e allegati non vengono scaricati per l’AI. La demo usa soltanto esempi sintetici.

## Ricevi notifiche via mail

In **Impostazioni → Notifiche via mail** attiva **Ricevi notifiche via mail** e configura server SMTP, porta, **TLS implicito** (normalmente 465) oppure **STARTTLS** (normalmente 587), utente/password se richiesti dal relay, indirizzo mittente e uno o più destinatari. Inserisci un indirizzo per riga oppure separali con virgole o punti e virgola; sono ammessi fino a 50 destinatari. Ogni indirizzo riceve un messaggio separato.

**Verifica SMTP** controlla connessione, certificato e autenticazione senza inviare messaggi. **Invia mail di prova** invia agli indirizzi del modulo un messaggio privo di dati delle issue, anche prima del salvataggio. Premi **Salva impostazioni** per applicare la configurazione. L’invio usa [Nodemailer SMTP](https://nodemailer.com/smtp), richiede una connessione cifrata e verifica il certificato del server; per una CA aziendale segui le indicazioni `NODE_EXTRA_CA_CERTS` riportate sotto.

La funzione inoltra automaticamente le **nuove notifiche** rilevate nei progetti visibili: cambio di stato, nuova issue e nuovi commenti. Non invia lo storico né le issue già presenti al primo controllo di un progetto. Il controllo segue la cadenza del centro notifiche: **ogni due minuti con l’app aperta**, oppure subito premendo **Aggiorna** nel centro notifiche. Anche gli invii in attesa vengono ripresi alla riapertura dell’app; l’app chiusa non monitora GitHub e non invia mail.

I messaggi contengono progetto, repository, numero/titolo issue, tipo di evento, cambio di stato o conteggio nuovi commenti, orario di rilevamento e link GitHub. Il testo viene reso in HTML sanitizzato con alternativa testuale. Per i commenti vengono inclusi solo quelli recenti relativi alla notifica; quelli arrivati dopo il rilevamento sono esclusi. Le immagini PNG, JPEG, GIF e WebP accessibili sono [incorporate nel messaggio](https://nodemailer.com/message/embedded-images), senza richiedere l’autenticazione GitHub al lettore. Limiti: 10 immagini, 5 MB ciascuna e 10 MB complessivi; immagini non disponibili o non supportate sono indicate esplicitamente. Gli altri file vengono soltanto segnalati per nome, senza scaricarli o allegarli. Il testo oltre 200.000 caratteri viene abbreviato con un avviso e il link al contenuto completo. Se il recupero del contenuto fallisce, resta comunque l’evento con il link GitHub.

La coda degli invii è persistente e separata per destinatario: un errore temporaneo riprova solo gli indirizzi interessati, con attesa crescente e fino a cinque tentativi. Le mail già accettate dal server non vengono inviate nuovamente. Se manca la conferma SMTP dopo l’invio o l’app si interrompe durante la consegna, lo stato diventa **da verificare**, senza ritentare automaticamente. La sezione **Invii per destinatario** mostra esiti ed errori, con comandi per riprovare; controlla la casella prima di ripetere un invio non confermato. “Accettato” indica la conferma del server SMTP, non garantisce l’arrivo nella posta in ingresso. Cambiare configurazione o disattivare la funzione annulla gli invii ancora in attesa della configurazione precedente; nuovi destinatari non ricevono notifiche pregresse.

La password SMTP viene salvata cifrata in `email.json`, nella cartella dati dell’app, usando `safeStorage` con chiavi protette dal Portachiavi macOS; non viene restituita all’interfaccia. Reinseriscila quando cambi server, porta, modalità di sicurezza o utente. La configurazione SMTP è indipendente dalla connessione GitHub e resta disponibile dopo **Disconnetti**; senza connessione GitHub non partono invii. La coda in `issue-cache.json` conserva soltanto metadati dell’evento, destinatario ed esito, senza corpi delle issue, commenti o immagini. Cambiare credenziale GitHub o disconnettersi elimina anche la vecchia coda.

## Export e connessione locale opzionali

La funzione è **disattivata di default**: tab Export, pulsanti di copia (anche delle immagini), download ZIP e server MCP non sono disponibili. I relativi comandi sono bloccati anche nel processo principale. Per abilitarla, copia `.env.example` in `.env` nella radice del progetto e imposta:

```dotenv
ISSUE_ATLAS_HANDOFF_ENABLED=true
ISSUE_ATLAS_MCP_PORT=47321
```

Riavvia l’app dopo ogni modifica. Le variabili del processo hanno precedenza su `.env`. Nell’app distribuita il file `.env` viene letto nella cartella dati dell’app (`app.getPath('userData')`); non viene incluso nel pacchetto. Il flag viene applicato anche alla demo web, che mantiene copia testo e ZIP ma non avvia un server MCP.

**Copia riferimento** copia una stringa pronta all’uso: identifica la issue, il server e gli strumenti da chiamare, spiega come leggere immagini/documenti e richiede di segnalare le risorse mancanti per il download manuale. Non scarica allegati finché il client non richiede il contesto. Il server è avviato dall’app solo con il flag attivo e ascolta esclusivamente su `127.0.0.1`, senza autenticazione. Rifiuta richieste con Origin e Host estranei. I processi dello stesso computer possono accedervi; non esporre la porta tramite proxy o tunnel.

Configura una sola volta il client locale, ad esempio [Codex](https://learn.chatgpt.com/docs/extend/mcp?surface=cli):

```sh
codex mcp add issue_atlas --url http://127.0.0.1:47321/mcp
```

In alternativa, in `~/.codex/config.toml`:

```toml
[mcp_servers.issue_atlas]
url = "http://127.0.0.1:47321/mcp"
tool_timeout_sec = 300
```

Mantieni Issue Atlas aperto e riavvia/riconnetti il client dopo la prima configurazione. Client remoti o cloud non raggiungono questo localhost. Se cambi porta, aggiorna anche il client. Una porta occupata mostra un errore, lasciando disponibili copia testo e ZIP.

Il server Streamable HTTP espone solo `get_issue_context(handoffId)` e `get_issue_asset(handoffId, assetId)`. Un riferimento pubblica una fotografia della conversazione completa già caricata, senza esporre altre issue o accesso arbitrario a URL/file. Il contesto restituisce tutto il Markdown, il manifest con percorsi locali assoluti, le risorse scaricate e `manualAssets` con nome, URL e motivo del mancato recupero. Le immagini PNG/JPEG/GIF/WebP fino a 5 MB possono essere lette direttamente dallo strumento; altri formati e documenti si leggono dai file locali. Pagine web/login, link ambigui, errori e limiti di download restano espliciti nel manifest. Non viene effettuato crawling né dichiarato estratto il contenuto dei documenti binari.

Gli allegati vengono scaricati una sola volta per riferimento, condividendo richieste simultanee. La cartella temporanea usa permessi privati e contiene gli stessi file dello ZIP. I riferimenti durano **8 ore**, fino a **10 fotografie** contemporanee; un nuovo riferimento oltre il limite revoca il più vecchio. Scadenza, cambio connessione, disconnessione e chiusura dell’app revocano i riferimenti e rimuovono i file temporanei. Dopo un arresto anomalo possono restare cartelle temporanee del sistema, ma i riferimenti non sono recuperabili al riavvio. Aggiorna la issue e copia un nuovo riferimento per acquisire nuovi commenti o riprovare download falliti. Token e credenziali non compaiono nella stringa o nei risultati MCP.

Il recupero MCP ha un budget complessivo di **45 secondi**: conserva i download completati e segnala le risorse rimanenti per il recupero manuale, così può restituire il contesto anche quando più allegati non rispondono. Lo ZIP mantiene i propri limiti di download per file.

**Copia testo** copia negli appunti il Markdown integrale: titolo, repository, URL, stato, descrizione, tutti i commenti con date/ore e reference di immagini e file. Gli appunti contengono un contenuto alla volta.

**Esporta ZIP** conserva gli allegati:

```text
issue.md          Testo originale + commenti + reference originali e locali
assets/           Immagini e file realmente scaricati
manifest.json     Provenienza, esito di ogni download e verifiche manuali
LEGGIMI.txt       Come usare il pacchetto
```

Estrai lo ZIP e apri `issue.md`. I riferimenti originali non vengono sostituiti o persi; una sezione aggiuntiva associa ogni risorsa al suo file locale. Link senza contenuto estratto, pagine di login, file non accessibili e download falliti vengono elencati esplicitamente come **da verificare manualmente**. Non si esegue crawling dei siti collegati.

I file sono riconosciuti da estensioni note o dai percorsi GitHub degli allegati. I collegamenti ambigui restano nella lista manuale. Limiti: 25 MB per file, 200 MB totali, 30 secondi per richiesta, fino a 5 redirect. Immagini in formati non supportati dalla clipboard possono comunque essere incluse nello ZIP. Non viene disabilitata la verifica TLS: per certificati aziendali usa la CA approvata dall’organizzazione, ad esempio avviando con `NODE_EXTRA_CA_CERTS=/percorso/ca.pem npm run dev`.

## Credenziali e dati

Il token è cifrato tramite le API asincrone Electron `safeStorage`, con chiavi protette dal Portachiavi macOS. È salvato cifrato in `connection.json` nella cartella dati dell’app; non viene restituito al renderer dopo il salvataggio. Se il Portachiavi non è disponibile, il salvataggio viene rifiutato. **Disconnetti** rimuove le credenziali locali. Nessun token in localStorage, nei log o nei pacchetti esportati.

`issue-cache.json`, nella stessa cartella dati, conserva i metadati delle liste (titoli, repository, etichette, stati e date) e dei progetti. È un file locale con permessi `0600`, senza descrizioni, commenti, allegati o token, separato per istanza e credenziale tramite un’impronta SHA-256. Mantiene al massimo 30 combinazioni progetto/filtro. Salvataggi atomici e una coda di scrittura evitano file parziali durante aggiornamenti simultanei. Gli aggiornamenti accodati vengono accorpati prima di serializzare il file, mantenendo l’attesa della scrittura su disco per preferenze notifiche e tentativi email. Cambiare o salvare la connessione e **Disconnetti** eliminano la cache precedente. Un file mancante o corrotto viene ricostruito alla sincronizzazione successiva.

Lo stesso file conserva un indice di attività per progetto e fino a **500 notifiche recenti**, con lo stato letta/non letta. L’indice sopravvive alla riapertura, così il controllo successivo può rilevare anche differenze rispetto all’ultima sessione. Una scansione fallita conserva la base precedente e mostra l’errore nel centro notifiche. Ricerche e controlli simultanei condividono le richieste già in corso, con al massimo due progetti in parallelo complessivi anche quando partono più scansioni insieme. La demo include tre notifiche sintetiche esplicite, una per tipo, con letture salvate separatamente.

Il renderer è isolato e sandboxed, senza Node.js, con Content Security Policy, contenuto HTML sanitizzato, permessi negati e navigazione bloccata. I link HTTP(S) vengono aperti nel browser. I download usano la rete di Electron e le impostazioni di sistema per proxy e certificati; il token viene inviato solo all’origine GitHub configurata, rivalutando ogni redirect. Gli host dello **stesso dominio aziendale registrato** sono ammessi anche su indirizzi privati/VPN. Per host aziendali su altri domini, usa **Impostazioni → Host allegati aziendali**. Questi host non ricevono il token GitHub. Loopback, indirizzi link-local/metadata e host privati non autorizzati restano bloccati. Gli errori indicano l’host coinvolto, senza prefissi tecnici IPC. La cache delle immagini è limitata e rimane in memoria. Preferiti e personalizzazioni locali in localStorage, con preferenze separate per istanza e per demo. Il codice delle issue e gli allegati non vengono eseguiti.

Senza token l’app mostra una **demo esplicita**, con dati sintetici e un’immagine locale. `npm run dev:web` apre la stessa demo nel browser; non è un client GitHub e non salva credenziali. I flussi reali passano attraverso Electron.

## Verifica

```sh
npm run build
npm test
npm run test:email
```

I test unitari verificano estrazione da Markdown/HTML/commenti, deduplicazione, date, blocco degli export incompleti, contenuto binario dello ZIP, reference locali, download falliti, autorizzazione degli host aziendali, isolamento del token, blocco di loopback/metadata, ordine degli stati e persistenza delle personalizzazioni per progetto. Verificano inoltre cache dopo la riapertura, isolamento tra credenziali, filtri indipendenti, file corrotti, errori di scrittura e concorrenza limitata. Le verifiche email coprono cifratura e validazione SMTP, sanitizzazione HTML, testo alternativo, immagini binarie incorporate, esclusione degli altri allegati e coda persistente. `npm run test:email` usa un vero server SMTP **solo locale**, con credenziali sintetiche e certificato temporaneo generato da OpenSSL: prova TLS/STARTTLS con verifica del certificato, destinatari separati, autenticazione errata, rifiuto temporaneo e ripartenza senza duplicati. Non invia mail esterne.

Test HTTP con [Postman API Simulation](https://learning.postman.com/docs/design-apis/mock-apis/): richiede Postman CLI >= 1.70. In un terminale:

```sh
postman simulation run postman/simulations/github.sim.yaml --port 4900 --output ndjson
```

In un altro terminale:

```sh
npm run test:simulation
```

Con lo stesso simulatore in esecuzione, `npm run test:electron-network` verifica anche il motore di rete nativo Electron, i redirect manuali, i byte delle immagini e l’isolamento degli header. Il test avvia Electron senza finestre e usa un profilo temporaneo, senza leggere il token o le impostazioni personali.

Il client di produzione effettua vere richieste HTTP al simulatore locale. Le fixture sintetiche in `postman/mocks/github/default.js` seguono il contratto documentato di GitHub e coprono paginazione delle organizzazioni/progetti/issue, 103 commenti, 401, 403, 502 ed errori GraphQL. Verificano anche che un aggiornamento invariato richieda solo l’indice, che il delta scarichi solo gli ID modificati/nuovi, che spostamenti e rimozioni vengano applicati, il filtro server per stato e il fallback Enterprise. `test:simulation` include il passaggio dal contenuto GitHub via HTTP alla consegna email via SMTP TLS locale, oltre alle verifiche SMTP sopra. Non è stato cercato né usato un mock del proprietario: non ci sono workspace Postman o credenziali Enterprise collegati a questo repository. I test non sostituiscono la verifica finale con la tua istanza, VPN, token, allegati privati e server SMTP.

Riferimenti: [GitHub Projects API](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects), [Electron security](https://www.electronjs.org/docs/latest/tutorial/security), [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage).

Le stime si verificano senza chiavi reali con la simulazione combinata:

```sh
postman simulation run postman/simulations/estimates.sim.yaml --port 4901 --output ndjson --no-history
```

In un altro terminale:

```sh
OPENAI_SIMULATION_URL=http://127.0.0.1:4901/openai GITHUB_SIMULATION_URL=http://127.0.0.1:4901/github npm test
```

I client di produzione attraversano HTTP reale verso fixture locali per prima estrazione, totale 1,5h con virgola decimale, Decisions sul delta, commenti ignorati senza estrazione, aggiunte/sostituzioni, fallback per incertezza, paginazione oltre 100 nuovi commenti, modifiche/cancellazioni, assenza di ricalcoli periodici, esclusione degli stati, budget, riavvio, backoff, 429, errori HTML, timeout, rifiuti e fonti invalide. Le fixture a frasi prefissate verificano il processo, non la qualità semantica di un modello reale.
