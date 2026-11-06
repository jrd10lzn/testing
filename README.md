# Claude Usage: dashboard de escritorio para Claude Pro

App para Windows que se queda en la bandeja del sistema y muestra cuánto te queda de tu plan Claude Pro: la sesión actual (ventana de 5 horas) y los límites semanales.

- El icono de la bandeja muestra el **% consumido de la sesión**, en verde, ámbar o rojo.
- El panel muestra cada límite como un anillo circular con el % consumido en el centro, la hora de reinicio y un gráfico de las últimas 24 h.
- Sesión actual y semanal van en la primera fila; el resto de límites, debajo, con el mismo ancho.
- Avisa al llegar al 80 % y al 95 %.
- Muestra solo los límites de **sesión, semanal, Opus y Sonnet** (se descartan chats, Cowork y otros).
- Una sección **Previsión** estima, al ritmo de consumo reciente, cuánto llevarás al reiniciarse cada límite o cuándo se agotaría. Necesita unas lecturas para calcularla (unos 15 minutos con la app abierta) y es una estimación, no un dato de Anthropic.
- Puede iniciarse con Windows y quedarse siempre visible.

## Cómo funciona

Claude Pro no tiene una API de uso. La app abre tu página oficial `https://claude.ai/settings/usage` en una ventana oculta, con tu propia sesión, lee los porcentajes que aparecen y los muestra. No usa endpoints internos ni comparte tus datos: todo se queda en tu PC, en `%APPDATA%\claude-usage-dashboard`.

## Requisitos

- Windows 10 u 11
- [Node.js](https://nodejs.org) 20 o superior (versión LTS)

## Instalación y uso

Abre una terminal (PowerShell) en esta carpeta y ejecuta:

```powershell
npm install
npm start
```

La primera vez pulsa **Iniciar sesión en Claude**. Usa **«Continuar con correo»**: el inicio de sesión con Google suele bloquearse dentro de apps de escritorio. Cuando entres, la ventana se cierra y el panel se rellena solo.

Cerrar el panel no cierra la app: sigue en la bandeja. Para salir, haz clic derecho en el icono y elige **Salir**.

## Crear un instalador .exe

```powershell
npm run dist
```

El instalador y una versión portable aparecen en la carpeta `dist\`.

## Si algo falla

- **"No se encontraron datos de uso"**: puede que Anthropic haya cambiado el diseño de la página. Pulsa **Ver página** para ver lo que lee la app. Los textos se interpretan en `src/parser.js`, y `npm test` comprueba el parser y la previsión.
- **Te pide iniciar sesión otra vez**: tu sesión de claude.ai ha caducado. Vuelve a iniciarla desde el panel.
- **No actualices con demasiada frecuencia.** Con 5 minutos basta. Cada actualización es una visita normal a la página.

## Estructura

```
src/main.js        proceso principal: ventana oculta, bandeja, avisos, ajustes
src/parser.js      extrae los porcentajes del texto de la página
src/forecast.js    previsión de consumo a partir del histórico
src/preload.js     puente seguro entre el panel y el proceso principal
src/renderer/      interfaz del panel (HTML/CSS/JS)
test/              pruebas del parser
```
