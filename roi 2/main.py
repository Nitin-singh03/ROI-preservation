import cv2
import numpy as np
import os
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

# ==========================================
# 1. INITIALIZE CRYPTOGRAPHY
# ==========================================
# Generate a single 256-bit (32-byte) AES key for the session. 
# In production, this symmetric key would be wrapped by RSA.
aes_key = AESGCM.generate_key(bit_length=256)
aesgcm = AESGCM(aes_key)

# ==========================================
# 2. INITIALIZE FACE DETECTION
# ==========================================
# Using OpenCV's pre-trained Haar Cascade for instant testing.
face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')

# ==========================================
# 3. VIDEO PROCESSING PIPELINE
# ==========================================
# Set video input file path
video_path = 'video.mp4' 
cap = cv2.VideoCapture(video_path)

print("Starting ROIVault Video Test... Press 'q' to quit.")

while cap.isOpened():
    ret, frame = cap.read()
    if not ret:
        break

    # Convert frame to grayscale (required for Haar Cascade detection)
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    faces = face_cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(30, 30))

    # Masked frame: What the untrusted server would store/see
    masked_frame = frame.copy()
    
    # Restored frame: What the authorized client renders locally
    restored_frame = frame.copy()

    for (x, y, w, h) in faces:
        # --- PHASE 1: EXTRACT & MASK ---
        # Slice the raw pixel matrix for the detected face
        face_patch = frame[y:y+h, x:x+w]
        
        # Destructively overwrite the region in the base frame with black pixels
        masked_frame[y:y+h, x:x+w] = (0, 0, 0)
        
        # --- PHASE 2: ENCRYPT (Server-Side Action) ---
        # Convert the NumPy array to raw bytes
        patch_bytes = face_patch.tobytes()
        
        # Generate a unique 96-bit (12-byte) IV for this specific frame's patch
        iv = os.urandom(12)
        
        # Encrypt with AES-256-GCM (returns ciphertext + appended auth tag)
        encrypted_payload = aesgcm.encrypt(iv, patch_bytes, None)
        
        # --- PHASE 3: DECRYPT (Client-Side Action) ---
        try:
            # Attempt to decrypt using the session key and the patch's IV
            decrypted_bytes = aesgcm.decrypt(iv, encrypted_payload, None)
            
            # Reconstruct the raw bytes back into a NumPy image matrix
            decrypted_patch = np.frombuffer(decrypted_bytes, dtype=np.uint8).reshape((h, w, 3))
            
            # --- PHASE 4: RENDER OVERLAY ---
            # Paint the decrypted patch onto the blacked-out region of the restored frame
            restored_frame[y:y+h, x:x+w] = decrypted_patch
            
        except Exception as e:
            print(f"Decryption failed: {e}")

    # Combine frames side-by-side to visually verify the zero-knowledge concept
    combined_view = np.hstack((masked_frame, restored_frame))
    
    cv2.imshow('Left: Server View (Masked) | Right: Client View (Decrypted)', combined_view)

    # Press 'q' to exit the stream
    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

cap.release()
cv2.destroyAllWindows()
