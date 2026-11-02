-- Push de "despierta" (Firebase): el token de cada teléfono. La push no lleva el aviso (va cifrado
-- en el buzón); solo hace que el teléfono revise ya en vez de esperar su revisión periódica.
CREATE TABLE push_tokens (
  space TEXT NOT NULL,
  device TEXT NOT NULL,
  token TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (space, device)
);
CREATE INDEX push_tokens_token ON push_tokens (token);
