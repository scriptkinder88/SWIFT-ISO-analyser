# SWIFT ISO Analyser

Strumento per auditor: mappa interattiva dell'architettura, inventory dei componenti
sincronizzato dagli agent Wazuh, valutazione dei sotto-punti del framework e
export in PowerPoint.

Backend in Go con sola standard library (nessuna dipendenza esterna in `go.mod`),
frontend in JavaScript vanilla con SVG (nessun build step).

> **Stato**: scaffold. Il framework incluso è una **bozza di esempio**: testi e numerazione
> vanno confrontati con la versione corrente del CSCF pubblicata da SWIFT prima di un uso reale.
> L'architettura di esempio è fittizia.

## Avvio

```bash
go run ./cmd/server                       # http://127.0.0.1:8080
go run ./cmd/server -addr 127.0.0.1:9000  # porta diversa
go run ./cmd/server -data ""              # solo in memoria
```

Il server ascolta solo su localhost per impostazione predefinita. I dati vanno in `var/store.json`
(ignorato da git).

### Collegamento a Wazuh (opzionale, sola lettura)

```bash
export WAZUH_URL=https://wazuh.internal:55000
export WAZUH_USER=...               # utente API con permessi di sola lettura
export WAZUH_PASSWORD=...
export WAZUH_CA_FILE=/path/ca.pem   # opzionale, per una CA interna
```

Le credenziali si passano solo come variabili d'ambiente, mai nel repository.
Il client usa gli endpoint `syscollector` (`hardware`, `os`, `packages`, `ports`) dell'API
Wazuh 4.x: verificarli sulla versione in uso.

## API

| Metodo | Percorso | Descrizione |
|---|---|---|
| GET | `/api/health` | stato e disponibilità di Wazuh |
| GET | `/api/framework` | framework con controlli e sotto-punti |
| GET / PUT | `/api/architecture` | componenti e flussi (la PUT valida i riferimenti) |
| GET | `/api/components/{id}/inventory` | inventory del componente |
| POST | `/api/wazuh/sync` | aggiorna l'inventory da Wazuh |
| GET / PUT | `/api/assessments` | esiti per sotto-punto (globali o per componente) |
| GET | `/api/report.pptx` | deck PowerPoint per l'audit |

## Test

```bash
go vet ./...
go test ./...
```

## Struttura

```
cmd/server/          punto d'ingresso
data/                framework e architettura di esempio (incorporati nel binario)
internal/model/      modello di dominio e validazione
internal/store/      persistenza JSON atomica
internal/wazuh/      client Wazuh in sola lettura
internal/pptx/       generatore .pptx con archive/zip ed encoding/xml
internal/report/     costruzione delle slide dal database
internal/api/        handler HTTP
web/                 interfaccia (HTML, CSS, JS)
```

## Limiti noti

- Nessuna autenticazione: va esposto solo su rete fidata, o protetto da un reverse proxy.
- Nessun controllo di accesso per ruolo (auditor/admin).
- Le etichette degli archi nella mappa possono sovrapporsi ai nodi nei diagrammi densi.
- L'esito del tool è una proposta: la conformità la dichiara l'auditor.
