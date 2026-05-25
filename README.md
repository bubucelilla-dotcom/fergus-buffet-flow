# Guía de Despliegue - Fergus Buffet flow 🛎

Esta aplicación de gestión de buffet en tiempo real está preparada para funcionar en **3 tablets independientes** (Puerta, Cocina y Sala) conectadas a la misma red Wi-Fi con acceso a Internet. La sincronización se realiza en tiempo real a través de un servidor centralizado en la nube usando **WebSockets**.

---

## Opción 1: Despliegue Gratuito en la Nube (Recomendado)

Esta es la forma más estable y rápida. No requiere mantener ningún ordenador encendido en el local como servidor.

### Pasos para desplegar en Render:
1. Crea una cuenta gratuita en **[Render.com](https://render.com/)**.
2. Sube esta carpeta a tu cuenta de **GitHub** (crea un repositorio privado o público).
3. En Render, crea un nuevo **Web Service**.
4. Vincula tu repositorio de GitHub.
5. Render detectará automáticamente el archivo `package.json` y configurará los comandos de arranque:
   - **Build Command**: `npm install` (se configura por defecto).
   - **Start Command**: `npm start` (se configura por defecto).
6. Haz clic en **Deploy**.
7. ¡Listo! Render te dará una URL pública gratuita del tipo `https://fergus-buffet.onrender.com`.

---

## Opción 2: Arrancar en un PC Local (Servidor local en la Wi-Fi)

Si prefieres ejecutar el servidor en un PC o portátil del propio local:
1. Asegúrate de tener instalado **Node.js** (descárgalo de [nodejs.org](https://nodejs.org/)).
2. Abre la consola de comandos (Terminal o PowerShell) en esta carpeta y ejecuta:
   ```bash
   npm install
   ```
3. Arranca el servidor:
   ```bash
   npm start
   ```
4. La consola mostrará la IP local del servidor (ej. `http://192.168.1.100:3000`). Todas las tablets conectadas a la misma red Wi-Fi podrán acceder usando esa dirección.

---

## Cómo Instalar la App en las Tablets (PWA - Tipo APK)

Una vez que el servidor esté activo (ya sea en la nube o en el PC local):

1. **Abrir el enlace:** Abre el navegador (recomendamos **Google Chrome** en Android y **Safari** en iOS) en cada una de las 3 tablets y entra a la URL del servidor (ej. `https://tu-app.onrender.com` o `http://192.168.1.100:3000`).
2. **Instalar en la Tablet (Apariencia de App Real / APK):**
   - **En Android (Chrome):** Verás una ventana emergente en la parte inferior que dice "Añadir Fergus Buffet flow a la pantalla de inicio" o puedes pulsar el menú de los tres puntos de Chrome y seleccionar **"Instalar aplicación"** / **"Añadir a pantalla de inicio"**.
   - **En iOS (Safari):** Pulsa el botón de compartir (cuadrado con flecha hacia arriba) y selecciona **"Añadir a la pantalla de inicio"**.
3. **Ejecutar como App:** Se creará un icono con el logotipo de la aplicación en el escritorio de la tablet. Al abrirlo desde ahí:
   - Funcionará a pantalla completa (sin la barra de dirección del navegador ni menús).
   - Se comportará exactamente igual que una **APK nativa**.
   - Soportará almacenamiento local persistente.
4. **Asignación de Roles:**
   - En la **Tablet 1 (Puerta)**: Selecciona el botón **Puerta** en la barra superior.
   - En la **Tablet 2 (Sala)**: Selecciona el botón **Sala**.
   - En la **Tablet 3 (Cocina)**: Selecciona el botón **Cocina**.

¡A partir de ese momento, cualquier reserva registrada en Puerta, comanda pedida en Sala o plato preparado en Cocina se actualizará instantáneamente en las otras pantallas con efectos de sonido en tiempo real!
