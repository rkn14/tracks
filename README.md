# Tracks

Application desktop construite avec **Electron**, **TypeScript** et **Vite**.

## Structure du projet

```
src/
├── main/           Process principal Electron
│   ├── index.ts    Point d'entrée, cycle de vie de l'app
│   ├── window.ts   Création et configuration des fenêtres
│   └── ipc.ts      Handlers IPC (communication main ↔ renderer)
├── preload/        Bridge sécurisé (contextBridge)
│   └── index.ts    API exposée au renderer
├── renderer/       Interface utilisateur
│   ├── index.html  Page HTML principale
│   ├── index.ts    Point d'entrée renderer
│   ├── app.ts      Logique applicative
│   └── styles/     Feuilles de style
└── shared/         Code partagé entre les process
    ├── types.ts    Types et canaux IPC
    └── constants.ts Constantes de l'application
```

## Démarrage rapide

```bash
# Installer les dépendances
npm install

# Lancer en mode développement
npm start

# Linter
npm run lint

# Formatter
npm run format

# Packager l'application
npm run make
```

## Stack technique

| Outil            | Rôle                             |
| ---------------- | -------------------------------- |
| Electron         | Runtime desktop                  |
| TypeScript       | Typage statique                  |
| Vite             | Bundling (main, preload, renderer) |
| Electron Forge   | Packaging et distribution        |
| ESLint           | Linting                         |
| Prettier         | Formatage du code                |

## Sécurité

- `contextIsolation: true` – le renderer n'a pas accès à Node.js
- `nodeIntegration: false` – pas d'API Node dans le renderer
- `sandbox: true` – process renderer sandboxé
- Communication via `contextBridge` + canaux IPC typés
- CSP configurée dans le HTML
