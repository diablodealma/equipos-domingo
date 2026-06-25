import { initializeApp } from "firebase/app";
import { getFirestore, doc, onSnapshot, setDoc } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyD6bDsy1JhWraNwOEvlVHoXX5GtDdJMgGI",
  authDomain: "equipos-domingo.firebaseapp.com",
  projectId: "equipos-domingo",
  storageBucket: "equipos-domingo.firebasestorage.app",
  messagingSenderId: "582493741897",
  appId: "1:582493741897:web:175c9927442643afdeb098",
};

const ready = !!firebaseConfig.apiKey && !String(firebaseConfig.apiKey).includes("PEGAR");

let _db = null;
if (ready) {
  try { _db = getFirestore(initializeApp(firebaseConfig)); }
  catch (e) { console.error("No se pudo iniciar Firebase:", e); }
}

const COL = "equipos";
const ID = "data";

export const cloud = {
  ready: !!_db,
  subscribe(cb) {
    if (!_db) return () => {};
    return onSnapshot(
      doc(_db, COL, ID),
      snap => cb(snap.exists() ? snap.data() : null),
      err => console.error("Error de sincronización:", err)
    );
  },
  async save(partial) {
    if (!_db) return;
    try { await setDoc(doc(_db, COL, ID), partial, { merge: true }); }
    catch (e) { console.error("Error al guardar en la nube:", e); }
  },
};
