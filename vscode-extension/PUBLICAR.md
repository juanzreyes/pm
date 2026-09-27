# Publicar la extensión en el Marketplace de VS Code

La extensión ya está lista (icono, descripción, palabras clave, novedades). Para publicarla hace falta
una cuenta de editor, que es personal y solo puedes crearla tú:

1. Entra en https://marketplace.visualstudio.com/manage con tu cuenta Microsoft y crea el editor
   **juanzreyes** (el mismo que figura en `package.json` → `publisher`).
2. En https://dev.azure.com crea un *Personal Access Token* con el ámbito **Marketplace → Manage**.
3. En esta carpeta:
   ```
   npx @vscode/vsce login juanzreyes
   npx @vscode/vsce publish
   ```
   (pega el token cuando lo pida). Para versiones nuevas: sube `version` y repite `vsce publish`.

Si prefieres Open VSX (VSCodium, Cursor, Windsurf): `npx ovsx publish -p <token>` con un token de https://open-vsx.org.

> Si tienes una web o un repositorio público, añádelo en `package.json` (`homepage` / `repository`) antes de publicar; si no, usa `vsce publish --allow-missing-repository`.
