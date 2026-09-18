# SPEC — Sketch 3D di interventi su DTM (v1)

> Documento di specifica per lo sviluppo con Claude Code.
> Nome di lavoro del progetto: **CivilSketch**.

---

## 1. Obiettivo

App leggera per lo **schizzo concettuale 3D** di interventi di mitigazione del dissesto idrogeologico e di opere lungo linee ferroviarie, su **DTM reale**.

Serve a due cose:
1. **Verificare** l'inserimento geometrico e morfologico delle opere: ingombri, pendenze, ricoprimenti, compatibilità con il terreno.
2. **Comunicare** l'intervento a chi non è tecnico, con viste 3D ed etichette chiare.

Non è un software di progettazione esecutiva né di calcolo. Riferimento concettuale: "un Civil 3D ridotto a quattro funzioni: terreno, traccia, sezione, etichetta".

### Utenti
- Ingegneri e tecnici di studi professionali (fasi DOCFAP / PFTE).
- Utenti non tecnici con familiarità con i videogiochi 3D: l'app deve essere comprensibile senza formazione CAD.

### Obiettivo commerciale
Il prodotto è pensato per essere venduto a studi professionali: codice pulito, modulare, estendibile.

---

## 2. Principi di progetto

- **Leggerezza**: nessuno strato informativo superfluo, avvio rapido, fluido su un portatile.
- **Griglia e snap**: gli oggetti si agganciano a una griglia di passo impostabile, niente precisione "millimetrica".
- **Opere parametriche**: le dimensioni si impostano da maschera, non a mano libera.
- **Affidabilità geometrica**: le quote vengono sempre dal DTM reale. Lo schizzo deve essere dimensionalmente coerente.
- **Non distruttivo**: il DTM originale non si modifica mai. Il terreno di progetto si ricalcola dalle operazioni.
- **Usabilità da videogioco**: navigazione intuitiva, trascinamento, cursori, annulla/ripeti.

---

## 3. Stack tecnico (proposta)

- **Web app** desktop che gira nel browser, utilizzabile offline con file locali.
- **TypeScript + Vite**.
- **Three.js** per il rendering 3D.
- **geotiff.js** (o equivalente) per leggere i GeoTIFF.
- UI: framework leggero (React o Svelte, a scelta motivata da Claude Code).
- Nessun backend nella v1. Salvataggio su file locale.

> Claude Code deve verificare le versioni correnti delle librerie prima di usarle.

---

## 4. Terreno (DTM)

### 4.1 Import
- Input: **GeoTIFF** a singola banda con risoluzione da **1 a 5 m** (tipicamente LiDAR MASE/PST o DTM regionali).
- Sistema di riferimento proiettato in metri (letto dal file). Se manca, chiederlo all'utente.
- Gestione dei valori **NoData** (celle escluse o riempite per interpolazione, a scelta dell'utente).
- **Ritaglio area di lavoro**: rettangolo o poligono disegnato su vista 2D dopo l'import.

### 4.2 Rappresentazione
- Terreno come **heightmap** (griglia regolare di quote).
- **Ricampionamento opzionale** a maglia più larga (es. 1 → 2 m) per aree grandi.
- **Chunking + LOD**: il terreno è diviso in blocchi con livello di dettaglio variabile in base alla distanza.
- Obiettivo prestazionale: area di almeno 2×2 km a 1 m navigabile in modo fluido su portatile recente.

### 4.3 Quota in un punto
- Interpolazione **bilineare** sui 4 nodi più vicini.
- Se il punto coincide con un nodo, si usa la quota del nodo.

### 4.4 Visualizzazione del terreno
- Isoipse leggere con equidistanza impostabile.
- **Mappa delle pendenze** attivabile, con classi di colore impostabili.
- **Trasparenza** regolabile, per vedere le opere interrate.
- **Piano di taglio** verticale per vedere il sottosuolo.

---

## 5. Griglia e snap

- **Snap planimetrico** impostabile: 0,25 / 0,5 / 1 / 2 m (default 0,5 m).
- **Snap verticale** impostabile per le quote di progetto (default 0,10 m).
- Avviso non bloccante se lo snap è molto più fine della maglia del DTM (precisione solo apparente).
- Griglia visibile a richiesta, sottile e con dissolvenza sulla distanza.
- Snap disattivabile temporaneamente tenendo premuto un tasto (es. Alt).

---

## 6. Entità di base

### 6.1 Traccia
- Polilinea disegnata in pianta con snap.
- Vertici modificabili: trascinamento, aggiunta, eliminazione.
- **Progressive** calcolate automaticamente dall'inizio della traccia.

### 6.2 Livelletta (profilo di progetto)
Per ogni traccia si imposta il profilo di progetto in uno di questi modi:
- quota iniziale + pendenza costante;
- quota iniziale + quota finale;
- vertici di livelletta (progressiva, quota) per profili spezzati.

### 6.3 Punto
- Per le opere puntuali (es. una briglia su un alveo): posizione, rotazione e quota.
- Quota: dal DTM oppure impostata a mano.

---

## 7. Modifica del terreno (scavi e riporti)

Operazioni applicate alla heightmap di progetto, ricalcolabili in qualunque momento.

### Algoritmo (per ogni cella entro la fascia d'influenza della traccia)
1. Calcola la progressiva `s` e la distanza trasversale `d` dall'asse.
2. Calcola la quota di progetto `z(s, d)` = quota di livelletta(s) + profilo della sezione(d), comprese le scarpate.
3. **Scavo**: `z_nuova = min(z_terreno, z_progetto)`.
4. **Riporto**: `z_nuova = max(z_terreno, z_progetto)`.
5. Le scarpate si estendono finché non incontrano il terreno (daylight).

### Volumi
- Sterro e riporto approssimati come somma di Δz × area della cella, mostrati nel pannello dell'oggetto.

---

## 8. Libreria di opere tipologiche

Ogni opera ha:
- **nome** assegnabile dall'utente;
- **categoria** (determina colore e icona);
- **parametri** modificabili da maschera o cursori;
- **valori di default** salvati come preset che l'utente può modificare e riusare.

> I valori di default iniziali sono **segnaposto** e vanno impostati dall'utente secondo i propri standard. Nessun valore normativo è cablato nel codice.

### 8.1 Linea ferroviaria (su traccia + livelletta)
La traccia è suddivisa in **tratti per progressiva**, ciascuno con una tipologia:
- **Rilevato**: larghezza piattaforma, pendenza scarpate (modifica terreno in riporto).
- **Trincea**: larghezza piattaforma, pendenza scarpate (modifica terreno in scavo).
- **A raso**: solo sagoma della piattaforma.
- **Galleria** (naturale o artificiale): sagoma semplificata (larghezza, altezza, spessore rivestimento).
  - La quota è quella della livelletta.
  - Il **ricoprimento** si calcola come quota DTM − quota estradosso galleria, lungo tutto il tratto.
  - Se il ricoprimento scende sotto una soglia impostabile, il tratto viene evidenziato.
  - Imbocchi resi come semplici portali.

Esempio d'uso: traccia con quota inizio e quota fine, galleria dalla progressiva 100 alla 300.

### 8.2 Opere idrauliche
- **Canale** (trapezio o rettangolare, su traccia): base, altezza, pendenza sponde, livelletta di fondo. Modifica terreno in scavo.
- **Briglia** (puntuale o trasversale): altezza, larghezza, spessore, gaveta (larghezza e altezza), fondazione semplificata.
- **Vasca** di laminazione o deposito (poligono): quota di fondo, pendenza scarpe. Modifica terreno in scavo.

### 8.3 Opere di contenimento
- **Muro** (su traccia): altezza, spessore, fondazione (larghezza, spessore).
- **Paratia** (su traccia): tipologia (pali o diaframma), altezza fuori terra, infissione, diametro e interasse o spessore.
- **Cordolo in c.a.** (su traccia): larghezza e altezza.

### 8.4 Opere di protezione
- **Barriera** paramassi o paradetriti (stesso modello, su traccia): altezza, interasse montanti, lunghezza. Resa come montanti + rete semitrasparente.

### 8.5 Primitive in calcestruzzo
Solidi generici posizionabili su punto o estrudibili su traccia:
- parallelepipedo;
- prisma trapezio;
- cilindro;
- estrusione di sezioni tipo L, T, U, rettangolare.

---

## 9. Etichette e annotazioni

- Ogni oggetto ha un **nome**, ad esempio "Canale scolmatore" o "Muro di sostegno".
- **Etichetta con freccia** ancorata all'oggetto, riposizionabile trascinando.
- Etichette sempre leggibili: orientate verso la camera, senza sovrapposizioni se possibile.
- Visibilità delle etichette attivabile e disattivabile per categoria.
- Le etichette compaiono negli **screenshot**.

---

## 10. Strumenti di analisi

### 10.1 Interrogazione
- Click sul terreno: quota, pendenza locale (% e °), coordinate.

### 10.2 Profilo longitudinale
- Per ogni traccia: grafico 2D con terreno naturale, terreno di progetto, livelletta e opere.
- Pendenze leggibili per tratto.
- Ricoprimento della galleria visibile.
- Sincronizzato con la vista 3D: il passaggio del mouse sul profilo evidenzia il punto in 3D.

### 10.3 Sezione trasversale al click
- Click su un punto qualsiasi (o su una traccia a una progressiva): sezione 2D perpendicolare.
- Larghezza impostabile.
- Mostra terreno naturale, terreno di progetto e opere intersecate, con quote principali.

### 10.4 Scenari
- **Ante operam / Post operam** con un interruttore.
- **Alternative A / B / C**: ogni scenario contiene il proprio set di opere e modifiche del terreno.
- Duplicazione di uno scenario per crearne una variante.
- Confronto rapido dei volumi di sterro e riporto tra scenari.

---

## 11. Navigazione

- **Orbita** (default): rotazione, pan e zoom con il mouse, stile visualizzatore 3D.
- **Volo libero**: WASD + mouse.
- **Prima persona**: l'utente cammina sul terreno con occhi a circa 1,7 m sopra il DTM di progetto (Pointer Lock), con collisioni semplici con le opere.
- **Cammina lungo il tracciato**: la camera scorre sulla linea ferroviaria alla quota del ferro, entrando anche in galleria.
- **Viste rapide**: pianta, prospettiva, vista salvata.

---

## 12. Grafica

- Stile **low-poly pulito**: colori piatti, ombre morbide, luce diurna.
- Professionale ma non da disegno tecnico, e non giocoso.
- Palette per categoria (idraulica, contenimento, protezione, ferrovia, cls generico), coerente e accessibile.
- Terreno con tinta neutra e isoipse leggere.
- Tema chiaro di default.

---

## 13. Interfaccia e UX

- **Barra strumenti** con icone: Seleziona, Traccia, Punto, Opere, Misura, Sezione, Screenshot.
- **Pannello libreria** con le opere, da trascinare o selezionare.
- **Pannello proprietà** dell'oggetto selezionato, con cursori e campi numerici.
- **Albero degli oggetti** per scenario.
- **Annulla / Ripeti** illimitato.
- **Scorciatoie da tastiera** documentate in un pannello di aiuto.
- **Tutorial iniziale** breve (3–5 passi) e progetto di esempio.
- Lingua dell'interfaccia: italiano, con struttura predisposta per l'inglese.

---

## 14. File e export

- **Progetto**: file unico (JSON) con opere, tracce, scenari, etichette, impostazioni e riferimento al DTM (con opzione di includere il DTM ritagliato).
- **Screenshot** ad alta risoluzione (PNG) con etichette, eventuale scala grafica e nord.
- **Export profili e sezioni** come PNG.
- Autosalvataggio locale periodico.

---

## 15. Fuori scope (v1)

- Ortofoto sul terreno.
- Piano d'acqua / allagamento.
- Computi e stime di costo.
- Volo drone animato ed export video.
- Sagome di scala (persona, treno, mezzi).
- Import/export DWG, DXF, IFC.
- Calcoli strutturali, idraulici o geotecnici.
- Collaborazione multiutente e cloud.

---

## 16. Fasi di sviluppo

1. **Terreno**: import GeoTIFF, ritaglio, heightmap con chunk/LOD, navigazione orbita, quota e pendenza al click.
2. **Griglia e tracce**: snap, disegno e modifica delle tracce, progressive, livelletta.
3. **Modifica terreno**: canale in scavo e rilevato in riporto con scarpate e volumi.
4. **Libreria opere**: tutte le opere del §8 con parametri e preset.
5. **Linea ferroviaria completa**: tratti per progressiva, galleria, ricoprimento con soglia.
6. **Etichette e screenshot**.
7. **Analisi**: profilo longitudinale, sezione al click, scenari A/B e ante/post.
8. **Navigazione avanzata**: prima persona e cammina lungo il tracciato.
9. **Rifinitura UX**: tutorial, scorciatoie, progetto di esempio, grafica.

Ogni fase deve produrre una versione funzionante e testabile.

---

## 17. Criteri di accettazione (v1)

- Un GeoTIFF a 1 m di un'area di 2×2 km si carica e si naviga in modo fluido.
- Un canale trapezio su traccia modifica il terreno con scarpate corrette e ne riporta i volumi.
- Una briglia inserita a valle del canale si appoggia correttamente alla quota del terreno di progetto.
- Una linea ferroviaria con galleria dalla progressiva 100 alla 300 mostra il ricoprimento lungo il profilo ed evidenzia i tratti sotto soglia.
- Il profilo longitudinale e la sezione al click corrispondono alla geometria 3D.
- Due scenari si confrontano con un interruttore.
- Uno screenshot esportato mostra le etichette con i nomi assegnati.
- Un utente non tecnico, dopo il tutorial, riesce a inserire un'opera e a navigare in prima persona.
