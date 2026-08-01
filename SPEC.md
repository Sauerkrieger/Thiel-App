# 

System-Spezifikation & Entwicklungs-Prompt (SPEC.md)

Projekt: Thiel Dienstleistungen – Liefer- & Tourenplanungs-App

**Anleitung für Freebuff / KI-Agenten:** Diese Spezifikation beschreibt das Gesamtsystem so, dass es modular, voll-skalierbar (Multi-User-ready) und ohne manuelles Schreiben von Code entwickelt werden kann.

## **1\. System-Architektur & Skalierbarkeit**

Die Anwendung wird als rollenbasierte Multi-User-Webapplikation (PWA) aufgesetzt. Auch wenn zu Beginn nur ein Fahrer-Zugang genutzt wird, ist die Datenbankstruktur von Tag 1 an mandanten- und rollenfähig aufgebaut.

| Ebene | Technologie | Funktion / Zweck   |
| :---- | :---- | :---- |
| **Frontend** | Next.js (App Router), Tailwind CSS, Shadcn/UI | Mobile-optimierte Benutzeroberfläche (PWA) für schnelle Bedienung unterwegs. |
| **Backend / DB** | Supabase (PostgreSQL \+ Auth \+ Storage) | Zentrales Datenmodell, Rollenrechte (RLS), Foto-Uploads für Listen-Import. |
| **Routen-Engine** | Google Maps API / OpenRouteService API | Berechnung optimaler Rundtouren unter Berücksichtigung von Zeitfenstern & Restriktionen. |
| **Vision AI** | OpenAI GPT-4o-mini / Gemini Vision API | OCR & automatisches Matching von fotografierten Adress- und Tourenlisten. |

## **2\. Datenmodell (Schema-Übersicht)**

Das Datenmodell ist so strukturiert, dass Objekte, Zeitrestriktionen, Wochenvorlagen und Packscheine nahtlos ineinandergreifen:

* **Users & Roles:** ID, Name, Role (driver, admin, facility\_manager).  
* **Objects:** ID, Name, Address, Category (objekt, treppenhaus), TimeWindowStart (z.B. 11:00 Uhr), TimeWindowEnd, PedestrianZone (Boolean, z.B. nur bis 11:00 befahrbar).  
* **ObjectItems:** ID, ObjectId, ItemName, IsAlwaysRequired (Boolean, z.B. Standard-Reiniger ausgegraut).  
* **WeeklyDefaultRoutes:** DayOfWeek (0-6), ObjectId, SelectionOrder.  
* **ActiveTours:** TourId, DriverId, Date, Status (packing, in\_transit, completed).  
* **TourStops:** TourId, ObjectId, StopOrder, IsDelivered (Boolean), NextDeliveryItems (JSON-Liste der wählbaren Items für die nächste Tour).

## **3\. Kernfunktionen & Workflow-Phasen**

### **Phase 1: Objektverwaltung & KI-Fotoimport**

* **Manuelle Verwaltung:** Anlegen, Bearbeiten und Löschen von Objekten inkl. Name, Adresse, Kategorie (Objekt vs. Treppenhaus) und Restriktionen (z.B. Öffnungszeit erst ab 11:00 Uhr, Fußgängerzone nur bis 11:00 Uhr).  
* **Foto-Import (Listen-Erkennung):** Abfotografieren einer gedruckten Liste. Die KI analysiert den Text, vergleicht ihn mit der bestehenden Datenbank und fügt nur unbeschriebene/neue Objekte hinzu.

### **Phase 2: Routenplanung & Wochentags-Defaults**

* **Wochentags-Vorlage:** Bei Aufruf der Tourenplanung an einem Montag lädt die App automatisch die Objektauswahl des vergangenen Montags als Vorauswahl.  
* **Foto-Auswahl:** Alternativ kann eine ausgedruckte Routenliste abfotografiert werden, um Häkchen automatisch zu setzen.  
* **Optimierte Rundtour-Berechnung:**  
  * Start- & Endpunkt: *Thiel Dienstleistungen (Lager)*.  
  * Berechnung der absolut kürzesten Fahrzeit für die gesamte Rundtour.  
  * Hard Restriktion 1: Fußgängerzonen-Objekte müssen vor 11:00 Uhr angefahren werden.  
  * Hard Restriktion 2: Objekte mit Öffnungszeit ab 11:00 Uhr dürfen erst ab 11:00 Uhr im Routenablauf eingeplant werden.

### **Phase 3: Pack-Modus (Lager)**

* Nach Bestätigung der optimierten Route schaltet die App in den **Pack-Modus**.  
* Beim Anklicken eines Objekts wird die konsolidierte Packliste angezeigt (Standard-Items \+ manuell vorgemerkte Extra-Items aus der vorherigen Belieferung).  
* Button: **"Ausfahren beginnen"** startet den Tour-Modus.

### **Phase 4: Tour-Modus & Item-Vormerkung**

* Übersichtliche Liste der Stopps in optimierter Reihenfolge.  
* Anklicken eines Stopps öffnet die Item-Liste des Objekts:  
  * Standard-Items sind fest ausgewählt und ausgegraut (nicht abwählbar).  
  * Variable Items können für die *nächste Belieferung* an- oder abgewählt werden.  
* Button: **"Beliefern fertig"** hakte den Stopp ab und führt zurück zum Hauptbildschirm.

## **4\. Master-Prompt für Freebuff / KI-Code-Editor**

Kopiere den folgenden Prompt vollständig in deinen KI-Code-Editor (z.B. Cursor, Windsurf, Bolt.new oder Freebuff), um die gesamte App in einem Schritt generieren zu lassen:

Du bist ein Senior Fullstack Engineer. Baue eine skalierbare, mobile-optimierte Web-App (Next.js App Router, Tailwind CSS, Shadcn/UI, Supabase) für die Firma "Thiel Dienstleistungen". PROJEKT-SPEZIFIKATION: 1\. BENUTZER & SKALIERBARKEIT: \- Setze Supabase Auth ein mit Rollensystem (Rollen: 'driver', 'admin'). \- Die Datenbankstruktur muss mandantenfähig sein, damit später weitere Fahrer und Admins hinzugefügt werden können. 2\. OBJEKTVERWALTUNG & FOTO-OCR: \- Tabellen: \`objects\` (id, name, address, category: 'objekt' | 'treppenhaus', is\_pedestrian\_zone\_until\_11: boolean, opens\_at: time), \`object\_items\` (id, object\_id, item\_name, is\_always\_required: boolean). \- Biete eine Ansicht zur Verwaltung der Objekte. \- API-Route für Foto-Upload: Nutze OpenAI GPT-4o-mini / Gemini Vision, um abfotografierte Adresslisten zu analysieren, Adressen zu extrahieren und neue Objekte automatisch in die DB einzutragen. 3\. ROUTENPLANUNG & RESTRIKTIONS-OPTIMIERUNG: \- Der Start- und Endpunkt ist immer das Lager "Thiel Dienstleistungen". \- Wochentags-Defaults: Speichere für jeden Wochentag (Montag-Sonntag) die ausgewählte Objekt-Liste. Wenn heute Montag ist, wähle automatisch alle Objekte vor, die letzten Montag ausgewählt waren. \- Biete auch hier Foto-Auswahl per Kamera. \- Sortier-Algorithmus (Rundtour): Integriere eine Routenoptimierung (z.B. via Google Maps Distance Matrix / OpenRouteService), die die Gesamtfahrzeit minimiert und folgende Zeit-Restriktionen strikt einhält: a) Objekte mit \`is\_pedestrian\_zone\_until\_11 \= true\` MÜSSEN vor 11:00 Uhr angefahren werden. b) Objekte mit \`opens\_at \= 11:00\` DÜRFEN ERST ab 11:00 Uhr angefahren werden. 4\. PACK-MODUS: \- Nach Sortierung gelangt der Nutzer in die Packansicht. \- Klick auf ein Objekt zeigt die zusammengestellte Packliste (Standard-Items \+ Zusatz-Items für diese Tour). \- Button "Ausfahren beginnen" startet den Auslieferungs-Modus. 5\. TOUR-MODUS & ITEM-PRESELECTION: \- Zeigt die sortierten Stopps an. \- Detailansicht eines Stopps: Zeigt die Items des Objekts. Standard-Items (\`is\_always\_required \= true\`) sind angehakt und ausgegraut. Andere Items können für die NÄCHSTE Belieferung an-/abgewählt werden. \- Button "Beliefern fertig" markiert den Stopp als erledigt und führt zur Hauptübersicht zurück. Schreibe sauberen, modularen TypeScript-Code und erstelle alle erforderlichen Komponenten, API-Routen und Supabase-Migrationen.