/**
 * mlkemUtils.js
 * ML-KEM-768 (Kyber) post-quantum key encapsulation utilities.
 * Used for the video ROI encryption pipeline.
 *
 * Wraps the `mlkem` npm package (pure JS ML-KEM-768 implementation).
 * Keys are stored in IndexedDB (raw bytes) and localStorage (base64 for server registration).
 */

const DB_NAME = "roi_mlkem";
const STORE = "keys";

// ── IndexedDB helpers ─────────────────────────────────────────────────────────
function openKemDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function storeKemKey(name, bytes) {
  const db = await openKemDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(bytes, name);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function loadKemKey(name) {
  const db = await openKemDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(name);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ── Lazy-load the mlkem library ───────────────────────────────────────────────
let _MlKem768 = null;

async function getMlKem768() {
  if (_MlKem768) return _MlKem768;
  try {
    const mod = await import("mlkem");
    // The package exports MlKem768 directly or as default.MlKem768
    _MlKem768 = mod.MlKem768 || (mod.default && mod.default.MlKem768) || mod.default;
    if (!_MlKem768) throw new Error("MlKem768 not found in mlkem package exports");
    return _MlKem768;
  } catch (err) {
    throw new Error(`Failed to load ML-KEM library: ${err.message}`);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Generate an ML-KEM-768 keypair for the given username.
 * Stores private key in IndexedDB, public key in localStorage (base64).
 * Returns the base64-encoded public key (to register with the server).
 */
export async function generateAndStoreMlKemKeyPair(username) {
  const MlKem768 = await getMlKem768();
  const kem = new MlKem768();

  // generateKeyPair returns [publicKey, privateKey] as Uint8Arrays
  const [publicKey, privateKey] = await kem.generateKeyPair();

  // Store private key bytes in IndexedDB
  await storeKemKey(`${username}_mlkem_private`, privateKey);

  // Store both as base64 in localStorage for easy retrieval
  const publicKeyB64 = btoa(String.fromCharCode(...publicKey));
  const privateKeyB64 = btoa(String.fromCharCode(...privateKey));
  localStorage.setItem(`${username}_mlkem_public_b64`, publicKeyB64);
  localStorage.setItem(`${username}_mlkem_private_b64`, privateKeyB64);

  return publicKeyB64;
}

/**
 * Returns the stored ML-KEM-768 public key (base64) for the given username.
 */
export function getStoredMlKemPublicKey(username) {
  return localStorage.getItem(`${username}_mlkem_public_b64`) || null;
}

/**
 * Download the ML-KEM private key as a binary .bin file.
 */
export function downloadMlKemPrivateKey(username) {
  const b64 = localStorage.getItem(`${username}_mlkem_private_b64`);
  if (!b64) return false;
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${username}_mlkem_private.bin`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return true;
}

/**
 * Encapsulate: given a recipient's ML-KEM-768 public key (base64),
 * generate a shared secret and ciphertext.
 * Returns { ciphertextB64: string, sharedSecretBytes: Uint8Array }
 */
export async function mlkemEncapsulate(recipientPublicKeyB64) {
  const MlKem768 = await getMlKem768();
  const kem = new MlKem768();
  const publicKey = Uint8Array.from(atob(recipientPublicKeyB64), c => c.charCodeAt(0));
  // encap returns [ciphertext, sharedSecret]
  const [ciphertext, sharedSecret] = await kem.encap(publicKey);
  return {
    ciphertextB64: btoa(String.fromCharCode(...ciphertext)),
    sharedSecretBytes: new Uint8Array(sharedSecret),
  };
}

/**
 * Decapsulate: given a ciphertext (base64) and the local user's ML-KEM private key,
 * recover the shared secret bytes (which IS the AES-256 key).
 */
export async function mlkemDecapsulate(username, ciphertextB64) {
  const MlKem768 = await getMlKem768();
  const kem = new MlKem768();

  // Try IndexedDB first, fall back to localStorage
  let privateKey = await loadKemKey(`${username}_mlkem_private`);
  if (!privateKey) {
    const b64 = localStorage.getItem(`${username}_mlkem_private_b64`);
    if (!b64) throw new Error("ML-KEM private key not found for this user");
    privateKey = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  }

  const ciphertext = Uint8Array.from(atob(ciphertextB64), c => c.charCodeAt(0));
  // decap returns the shared secret as Uint8Array
  const sharedSecret = await kem.decap(ciphertext, privateKey);
  return new Uint8Array(sharedSecret);
}
