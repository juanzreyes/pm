-- pm-sync: el servidor solo guarda paquetes cifrados en el dispositivo (AES-256-GCM).
-- No sabe qué hay dentro: ni tareas, ni nombres, ni nada.

-- Un espacio = el ecosistema de una persona (sus PCs y teléfonos).
CREATE TABLE spaces (
  id TEXT PRIMARY KEY,          -- aleatorio de 128+ bits, imposible de adivinar
  auth_hash TEXT NOT NULL,      -- SHA-256 de la llave de acceso (la llave nunca llega en claro a la base)
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);

-- La "foto" cifrada de cada dispositivo (una fila por dispositivo).
CREATE TABLE blobs (
  space TEXT NOT NULL,
  device TEXT NOT NULL,
  meta TEXT NOT NULL DEFAULT '',  -- nombre y tipo del dispositivo, también cifrado
  rev INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  data TEXT NOT NULL,             -- base64 de (iv + texto cifrado)
  PRIMARY KEY (space, device)
);
CREATE INDEX blobs_updated ON blobs (space, updated_at);

-- Mensajes entre dispositivos (avisos y órdenes), cifrados; se borran a los 14 días.
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  space TEXT NOT NULL,
  sender TEXT NOT NULL,
  target TEXT NOT NULL,           -- id de dispositivo o '*' (todos)
  created_at INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX messages_space ON messages (space, id);

-- Límite de pedidos por espacio y por hora.
CREATE TABLE rate (
  space TEXT NOT NULL,
  bucket INTEGER NOT NULL,
  n INTEGER NOT NULL,
  PRIMARY KEY (space, bucket)
);
