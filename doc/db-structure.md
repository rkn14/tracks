# Structure de la base `doc/m.db`

Document aligné sur **`PRAGMA table_info`** et la liste des tables réelle (vérifié sur le fichier SQLite `doc/m.db`). Pour les écarts avec le script Python `doc/database.py`, voir la fin du fichier.

## Tables présentes dans `m.db`

| Table |
|-------|
| `AlbumArt` |
| `Information` |
| `Pack` |
| `PerformanceData` |
| `Playlist` |
| `PlaylistEntity` |
| `PreparelistEntity` |
| `Smartlist` |
| `Track` |
| `sqlite_sequence` |

---

## `AlbumArt`

| Colonne | Type | PK |
|---------|------|----|
| `id` | INTEGER | oui |
| `hash` | TEXT | |
| `albumArt` | BLOB | |

---

## `Information`

| Colonne | Type | PK |
|---------|------|----|
| `id` | INTEGER | oui |
| `uuid` | TEXT | |
| `schemaVersionMajor` | INTEGER | |
| `schemaVersionMinor` | INTEGER | |
| `schemaVersionPatch` | INTEGER | |
| `currentPlayedIndiciator` | INTEGER | |
| `lastRekordBoxLibraryImportReadCounter` | INTEGER | |

Les noms `currentPlayedIndiciator` et `lastRekordBoxLibraryImportReadCounter` sont tels qu’en base (orthographe incluse).

---

## `Pack`

| Colonne | Type | PK |
|---------|------|----|
| `id` | INTEGER | oui |
| `packId` | TEXT | |
| `changeLogDatabaseUuid` | TEXT | |
| `changeLogId` | INTEGER | |
| `lastPackTime` | DATETIME | |

---

## `PerformanceData`

| Colonne | Type | PK |
|---------|------|----|
| `trackId` | INTEGER | oui |
| `trackData` | BLOB | |
| `overviewWaveFormData` | BLOB | |
| `beatData` | BLOB | |
| `quickCues` | BLOB | |
| `loops` | BLOB | |
| `thirdPartySourceId` | INTEGER | |
| `activeOnLoadLoops` | INTEGER | |

---

## `Playlist`

| Colonne | Type | PK |
|---------|------|----|
| `id` | INTEGER | oui |
| `title` | TEXT | |
| `parentListId` | INTEGER | |
| `isPersisted` | BOOLEAN | |
| `nextListId` | INTEGER | |
| `lastEditTime` | DATETIME | |
| `isExplicitlyExported` | BOOLEAN | |

---

## `PlaylistEntity`

| Colonne | Type | PK |
|---------|------|----|
| `id` | INTEGER | oui |
| `listId` | INTEGER | |
| `trackId` | INTEGER | |
| `databaseUuid` | TEXT | |
| `nextEntityId` | INTEGER | |
| `membershipReference` | INTEGER | |

---

## `PreparelistEntity`

| Colonne | Type | PK |
|---------|------|----|
| `id` | INTEGER | oui |
| `trackId` | INTEGER | |
| `trackNumber` | INTEGER | |

---

## `Smartlist`

| Colonne | Type | PK |
|---------|------|----|
| `listUuid` | TEXT | oui |
| `title` | TEXT | |
| `parentPlaylistPath` | TEXT | |
| `nextPlaylistPath` | TEXT | |
| `nextListUuid` | TEXT | |
| `rules` | TEXT | |
| `lastEditTime` | DATETIME | |

---

## `Track`

Ordre des colonnes tel qu’exposé par SQLite (après `id`) :

| # | Colonne | Type |
|---|---------|------|
| 1 | `playOrder` | INTEGER |
| 2 | `length` | INTEGER |
| 3 | `bpm` | INTEGER |
| 4 | `year` | INTEGER |
| 5 | `path` | TEXT |
| 6 | `filename` | TEXT |
| 7 | `bitrate` | INTEGER |
| 8 | `bpmAnalyzed` | REAL |
| 9 | `albumArtId` | INTEGER |
| 10 | `fileBytes` | INTEGER |
| 11 | `title` | TEXT |
| 12 | `artist` | TEXT |
| 13 | `album` | TEXT |
| 14 | `genre` | TEXT |
| 15 | `comment` | TEXT |
| 16 | `label` | TEXT |
| 17 | `composer` | TEXT |
| 18 | `remixer` | TEXT |
| 19 | `key` | INTEGER |
| 20 | `rating` | INTEGER |
| 21 | `albumArt` | TEXT |
| 22 | `timeLastPlayed` | DATETIME |
| 23 | `isPlayed` | BOOLEAN |
| 24 | `fileType` | TEXT |
| 25 | `isAnalyzed` | BOOLEAN |
| 26 | `dateCreated` | DATETIME |
| 27 | `dateAdded` | DATETIME |
| 28 | `isAvailable` | BOOLEAN |
| 29 | `isMetadataOfPackedTrackChanged` | BOOLEAN |
| 30 | `isPerfomanceDataOfPackedTrackChanged` | BOOLEAN |
| 31 | `playedIndicator` | INTEGER |
| 32 | `isMetadataImported` | BOOLEAN |
| 33 | `pdbImportKey` | INTEGER |
| 34 | `streamingSource` | TEXT |
| 35 | `uri` | TEXT |
| 36 | `isBeatGridLocked` | BOOLEAN |
| 37 | `originDatabaseUuid` | TEXT |
| 38 | `originTrackId` | INTEGER |
| 39 | `streamingFlags` | INTEGER |
| 40 | `explicitLyrics` | BOOLEAN |
| 41 | `lastEditTime` | DATETIME |

Remarques :

- La colonne 30 s’appelle **`isPerfomanceDataOfPackedTrackChanged`** en base (faute probable par rapport à `Performance`). Le code Python utilise `isPerformanceDataOfPackedTrackChanged` : à vérifier si les requêtes utilisent le bon nom selon la base.
- Les champs BLOB type `trackData`, forme d’onde, `beatData`, `quickCues`, `loops`, etc. ne sont **pas** dans `Track` dans ce fichier : ils sont portés par **`PerformanceData`** (clé `trackId`).

---

## `sqlite_sequence`

| Colonne | Type |
|---------|------|
| `name` | |
| `seq` | |

---

## Écarts avec `doc/database.py`

La classe `database` déclare une liste de tables qui **ne correspond pas** à `m.db` :

| Dans `database.py` | Dans `m.db` |
|--------------------|-------------|
| `ChangeLog`, `PlayListAllChildren`, `PlaylistAllParent`, `PlaylistPath` | absentes |
| — | `PreparelistEntity`, `Smartlist` présentes |

Le tuple d’insertion décrit dans `database.py` pour **`Track`** (47 valeurs + `lastEditTime` conditionnel, incluant `trackData`, `overviewWaveformData`, `beatData`, `quickCues`, `loops`, `thirdPartySourceId`, `activeOnLoadLoops`) **ne colle pas** au schéma de `m.db` : cette base a **41 colonnes** hors `id`, sans ces BLOB dans `Track`, avec `streamingFlags` / `explicitLyrics` / `lastEditTime` en fin de ligne.

Pour une autre exportation Rekordbox / version de schéma, le fichier `.db` peut donc diverger : toujours valider avec `PRAGMA table_info` ou `SELECT * FROM sqlite_master WHERE type='table'`.

---

## Relations logiques (inchangées conceptuellement)

- `Playlist` (1) — (N) `PlaylistEntity` via `listId` → `Playlist.id`.
- `Track` (1) — (N) `PlaylistEntity` via `trackId` → `Track.id`.
- `PerformanceData.trackId` → `Track.id`.
- `Information.uuid` : identifiant de base (référencé par `PlaylistEntity.databaseUuid` et `Track.originDatabaseUuid`).
