const DB_NAME = "roi_crypto";
const STORE = "keys";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function storeKey(name, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(key, name);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function loadKey(name) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(name);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function generateAndStoreKeyPair(username) {
  const keyPair = await window.crypto.subtle.generateKey(
    { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["encrypt", "decrypt"]
  );

  const publicKeySpki = await window.crypto.subtle.exportKey("spki", keyPair.publicKey);
  const privateKeyPkcs8 = await window.crypto.subtle.exportKey("pkcs8", keyPair.privateKey);

  await storeKey(`${username}_private`, keyPair.privateKey);

  const publicKeyB64 = btoa(String.fromCharCode(...new Uint8Array(publicKeySpki)));
  const privateKeyB64 = btoa(String.fromCharCode(...new Uint8Array(privateKeyPkcs8)));

  localStorage.setItem(`${username}_private_b64`, privateKeyB64);
  localStorage.setItem(`${username}_public_b64`, publicKeyB64);

  return publicKeyB64;
}

// Returns the public key B64 that matches the private key currently in this browser
export function getStoredPublicKey(username) {
  return localStorage.getItem(`${username}_public_b64`) || null;
}

export function getPrivateKeyPem(username) {
  const b64 = localStorage.getItem(`${username}_private_b64`);
  if (!b64) return null;
  const lines = b64.match(/.{1,64}/g)?.join("\n") || b64;
  return `-----BEGIN PRIVATE KEY-----\n${lines}\n-----END PRIVATE KEY-----`;
}

export function downloadPrivateKeyFile(username) {
  const pem = getPrivateKeyPem(username);
  if (!pem) return false;
  const blob = new Blob([pem], { type: "application/x-pem-file" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${username}_private_key.pem`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return true;
}

async function getPrivateKey(username) {
  const b64 = localStorage.getItem(`${username}_private_b64`);
  if (!b64) throw new Error("Private key not found");

  const pkcs8 = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const key = await window.crypto.subtle.importKey(
    "pkcs8", pkcs8,
    { name: "RSA-OAEP", hash: "SHA-256" },
    false, ["decrypt"]
  );
  return key;
}

export async function rsaDecrypt(username, encryptedHex) {
  const privateKey = await getPrivateKey(username);
  const encryptedBytes = new Uint8Array(encryptedHex.match(/.{1,2}/g).map(b => parseInt(b, 16)));
  console.log("[rsaDecrypt] username:", username);
  console.log("[rsaDecrypt] encryptedHex length:", encryptedHex.length);
  console.log("[rsaDecrypt] localStorage private_b64 exists:", !!localStorage.getItem(`${username}_private_b64`));
  console.log("[rsaDecrypt] localStorage public_b64:", localStorage.getItem(`${username}_public_b64`));
  const decrypted = await window.crypto.subtle.decrypt({ name: "RSA-OAEP" }, privateKey, encryptedBytes);
  return new Uint8Array(decrypted);
}

export async function rsaEncrypt(publicKeyB64, aesKeyBytes) {
  const spki = Uint8Array.from(atob(publicKeyB64), c => c.charCodeAt(0));
  const publicKey = await window.crypto.subtle.importKey(
    "spki", spki,
    { name: "RSA-OAEP", hash: "SHA-256" },
    false, ["encrypt"]
  );
  const encrypted = await window.crypto.subtle.encrypt({ name: "RSA-OAEP" }, publicKey, aesKeyBytes);
  return Array.from(new Uint8Array(encrypted)).map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function aesGcmDecrypt(aesKeyBytes, encryptedBytes) {
  // Layout written by Python: nonce(16) + tag(16) + ciphertext
  const NONCE_LEN = 16;
  const TAG_LEN = 16;
  const nonce = encryptedBytes.slice(0, NONCE_LEN);
  const tag = encryptedBytes.slice(NONCE_LEN, NONCE_LEN + TAG_LEN);
  const ciphertext = encryptedBytes.slice(NONCE_LEN + TAG_LEN);

  const key = await window.crypto.subtle.importKey(
    "raw", aesKeyBytes, { name: "AES-GCM" }, false, ["decrypt"]
  );

  // Web Crypto AES-GCM expects ciphertext || tag as a single buffer
  const ciphertextWithTag = new Uint8Array(ciphertext.length + TAG_LEN);
  ciphertextWithTag.set(new Uint8Array(ciphertext));
  ciphertextWithTag.set(new Uint8Array(tag), ciphertext.length);

  const decrypted = await window.crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(nonce), tagLength: 128 },
    key,
    ciphertextWithTag
  );
  return new Uint8Array(decrypted);
}
