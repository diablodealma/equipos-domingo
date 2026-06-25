// ─────────────────────────────────────────────────────────────────────────────
//  FIREBASE  ·  guardado en la nube (sincroniza entre teléfonos)
// ─────────────────────────────────────────────────────────────────────────────
//
//  👉 PASO ÚNICO: pegá acá abajo tu configuración de Firebase.
//     La sacás de: Firebase Console → ⚙️ Configuración del proyecto →
//     "Tus apps" → (tu app web) → "Configuración del SDK" → Config.
//     Reemplazá TODO el bloque { ... } por el que te da Firebase.
//
import { initializeApp } from "firebase/app";
import { getFirestore, doc, onSnapshot, setDoc } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "PEGAR_ACA",
  authDomain: "PEGAR_ACA",
  projectId: "PEGAR_ACA",
  storageBucket: "PEGAR_ACA",
  messagingSenderId: "PEGAR_ACA",
  appId: "PEGAR_ACA",
};

// ─── no hace falta tocar nada de acá para abajo ──────────────────────────────

const ready = !!firebaseConfig.apiKey && !String(firebaseConfig.apiKey).includes("PEGAR");

let _db = null;
if (ready) {
  try {
    _db = getFirestore(initializeApp(firebaseConfig));
  } catch (e) {
    console.error("No se pudo iniciar Firebase:", e);
  }
}

// Toda la info vive en un único documento: colección "equipos", doc "data".
const COL = "equipos";
const ID = "data";

export const cloud = {
  ready: !!_db,

  // Escucha cambios en tiempo real. cb recibe {players, matches} o null si no existe.
  subscribe(cb) {
    if (!_db) return () => {};
    return onSnapshot(
      doc(_db, COL, ID),
      snap => cb(snap.exists() ? snap.data() : null),
      err => console.error("Error de sincronización:", err)
    );
  },

  // Guarda sólo el campo que cambió ({players:[...]} o {matches:[...]}), sin pisar el otro.
  async save(partial) {
    if (!_db) return;
    try {
      await setDoc(doc(_db, COL, ID), partial, { merge: true });
    } catch (e) {
      console.error("Error al guardar en la nube:", e);
    }
  },
};
