# Nebula ERP — app móvil

App Android (Capacitor 8) para usar **cualquier servidor FilaOps** desde el móvil,
esté alojado donde esté (cada empresa con su dominio).

## Cómo funciona

- La app arranca en una **pantalla local de servidores** (`www/`): añades la dirección
  de tu ERP (`gestion.tuempresa.com`, `http://192.168.1.50:13003`…) y la comprueba.
- Al elegir un servidor, la app carga **la web de ese servidor**. Por eso cada uno
  muestra sus propias funciones: un servidor con la versión de Nebula
  ([`Nebula-Syst/filaops`](https://github.com/Nebula-Syst/filaops)) tendrá español,
  usuarios ilimitados, etc.; un FilaOps estándar funciona igual pero sin esos extras.
- Se recuerda el último servidor y se abre solo al arrancar. Para cambiar de servidor:
  botón **atrás** de Android, o **Ajustes → Cambiar servidor** (solo en servidores Nebula).
- Cada servidor mantiene su propia sesión (cookies por dominio): puedes tener varios
  con la sesión iniciada.

### Qué detecta al añadir un servidor

| Resultado | Qué significa |
| --- | --- |
| **Nebula** | FilaOps con la versión de Nebula (sirve `/nebula.json`) |
| **FilaOps estándar** | Responde `/api/v1/setup/status`, sin `/nebula.json` |
| **Con acceso protegido** | Hay un login previo (p. ej. Cloudflare Access); se pide al abrir |
| Sin verificar | Se guardó igualmente aunque no respondía como FilaOps |

Las comprobaciones usan el HTTP nativo (`CapacitorHttp`) para no depender del CORS del
servidor. `CapacitorHttp` **no** reemplaza el `fetch` global: las webs remotas usan
sus cookies de siempre.

## Integración con el fork de FilaOps

- User-Agent con `NebulaErpApp` → el fork muestra en Ajustes la tarjeta "App móvil"
  con **Cambiar servidor** (enlaza a `https://localhost/?select=1`, el origen local).
- `/nebula.json` en el servidor → `{ "edition": "nebula", "features": [...] }`.

## Desarrollo

```bash
npm install
npm test                      # tests de la pantalla de servidores (Node, sin red)
npx cap sync android
cd android
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk
export ANDROID_HOME=~/Android/Sdk
./gradlew assembleDebug       # android/app/build/outputs/apk/debug/app-debug.apk
```

Probar la pantalla de servidores en el navegador: `python3 -m http.server -d www`
(las comprobaciones fallarán por CORS; en el móvil van por HTTP nativo).

Iconos/splash desde `resources/icon.svg`:

```bash
rsvg-convert -w 1024 -h 1024 resources/icon.svg -o resources/icon.png
npx capacitor-assets generate --android --iconBackgroundColor '#0b0d17' --splashBackgroundColor '#0b0d17'
```

## CI/CD

`.github/workflows/build-apk.yml`: cada push a `main` pasa los tests, compila el APK
(debug, sin firma de Play Store) y lo publica como GitHub Release `1.0.<run>`.

## Pendiente

- iOS: se puede añadir con `npx cap add ios`, pero compilar requiere macOS/Xcode.
- Firma de release / Play Store.
