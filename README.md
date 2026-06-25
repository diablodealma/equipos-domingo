# Equipos del Domingo ⚽

App de fútbol 5: arma equipos balanceados, registra partidos y lleva las estadísticas de la temporada.

Hecha con React + Vite. Los datos se guardan en el navegador de cada dispositivo (localStorage).

## Probarla en tu compu (opcional)

```bash
npm install
npm run dev
```

Abre la URL que te muestra la terminal (típicamente http://localhost:5173).

## Subirla gratis (Vercel)

1. Creá una cuenta en **github.com** y otra en **vercel.com** (entrá a Vercel con "Continue with GitHub").
2. Subí esta carpeta a un repositorio nuevo de GitHub (podés arrastrar los archivos en github.com → "Add file" → "Upload files"). **No subas la carpeta `node_modules`.**
3. En Vercel: **Add New… → Project**, elegí el repositorio y dale **Deploy**. Vercel detecta Vite solo (no toques ninguna configuración).
4. En ~1 minuto te da una URL pública (tipo `equipos-domingo.vercel.app`).
5. Abrila en el celular → menú compartir → **Agregar a pantalla de inicio**. Queda con ícono, como una app.

## Build de producción (lo que hace Vercel por vos)

```bash
npm run build      # genera la carpeta dist/
npm run preview    # la sirve localmente para probar
```

## Nota sobre los datos

Cada teléfono guarda su propia información. Para que todo el grupo vea los mismos
jugadores, historial y estadísticas en tiempo real, el siguiente paso es conectar
Firebase (plan gratuito).
