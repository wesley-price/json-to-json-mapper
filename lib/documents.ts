// Several mapping documents in this browser, plus save/open to a file so work
// doesn't depend on the browser's storage alone. The document on screen is
// still kept under the app's main key (the report reads it from there); every
// document is also kept under its own key with an index of names and dates.

const INDEX_KEY = "object-mapper:docs";
const docKey = (id: string) => `object-mapper:doc:${id}`;

export interface DocEntry {
  id: string;
  name: string;
  /** ISO time of the last change. */
  updated: string;
}

export const newDocId = () => `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function listDocs(): DocEntry[] {
  try {
    const list = JSON.parse(localStorage.getItem(INDEX_KEY) ?? "[]") as DocEntry[];
    return Array.isArray(list) ? [...list].sort((a, b) => b.updated.localeCompare(a.updated)) : [];
  } catch {
    return [];
  }
}

/** Keep a document (its JSON) and update the index. Returns false when the browser's storage is full. */
export function storeDoc(id: string, name: string, json: string): boolean {
  try {
    localStorage.setItem(docKey(id), json);
    const list = listDocs().filter((d) => d.id !== id);
    list.push({ id, name: name.trim() || "Untitled mapping", updated: new Date().toISOString() });
    localStorage.setItem(INDEX_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

export function readDoc(id: string): unknown | null {
  try {
    const raw = localStorage.getItem(docKey(id));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function deleteDoc(id: string) {
  try {
    localStorage.removeItem(docKey(id));
    localStorage.setItem(INDEX_KEY, JSON.stringify(listDocs().filter((d) => d.id !== id)));
  } catch {
    // storage unavailable
  }
}

// ---------- files ----------

const FILE_APP = "object-mapper";

/** The document as a file: everything the app keeps, with a marker so it can be recognised. */
export const documentFile = (doc: unknown) => JSON.stringify({ app: FILE_APP, version: 1, savedAt: new Date().toISOString(), document: doc }, null, 2);

/** The document inside a file saved by documentFile (throws when it isn't one). */
export function readDocumentFile(text: string): Record<string, unknown> {
  const v = JSON.parse(text) as { app?: string; document?: Record<string, unknown> };
  if (v?.app !== FILE_APP || typeof v.document !== "object" || !v.document) {
    throw new Error("This isn't a document saved by the Object Mapper (use Import from Excel for workbooks).");
  }
  return v.document;
}
