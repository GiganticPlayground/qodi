# Getting Started

Two guides below: one for running the Qodi backend with Docker Compose, and one for running the Flutter demo app.

---

## Part 1 — Run the Backend with Docker Compose

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (or Docker Engine + Compose plugin)
- Node.js 18+ (only needed to run the key generation script)

---

### Step 1 — Install dependencies (for key generation)

```bash
npm install
```

---

### Step 2 — Generate the RSA keypair

Qodi encrypts QR payloads with RSA. You need a private/public keypair before the server will start.

```bash
npm run gen:keys
```

This writes two files:

```
config/keys/private-key.pem
config/keys/public-key.pem
```

The Docker Compose file mounts `./config` into the container as read-only, so the container will pick these files up automatically.

---

### Step 3 — Create your environment file

```bash
cp .env.example .env
```

Open `.env` and set at minimum:

| Variable | What to set |
|---|---|
| `QODI_AUTH_MODE` | `static-token` (simplest mode for local dev) |
| `QODI_STATIC_TOKEN` | Any string you choose, e.g. `demo-qodi-token` |
| `QODI_ALGORITHM` | `RSA-OAEP-SHA256` (recommended default, already set in the example) |
| `QODI_PRIVATE_KEY_PATH` | `./config/keys/private-key.pem` (already set in the example) |
| `QODI_PUBLIC_KEY_PATH` | `./config/keys/public-key.pem` (already set in the example) |

A minimal `.env` for local development using the defaults from the example:

```dotenv
QODI_PORT=8080
NODE_ENV=production
QODI_ALGORITHM=RSA-OAEP-SHA256
QODI_CLOCK_SKEW_SECONDS=0
QODI_PRIVATE_KEY_PATH=./config/keys/private-key.pem
QODI_PUBLIC_KEY_PATH=./config/keys/public-key.pem
QODI_AUTH_MODE=static-token
QODI_STATIC_TOKEN=demo-qodi-token
```

---

### Step 4 — Start the container

```bash
docker compose up
```

Docker will build the image on the first run. Subsequent starts are fast.

To run in the background:

```bash
docker compose up -d
```

---

### Step 5 — Verify it is running

```bash
curl http://localhost:8080/health
```

Expected response:

```json
{"status":"ok"}
```

Check the public key endpoint (replace `demo-qodi-token` with whatever you set for `QODI_STATIC_TOKEN`):

```bash
curl -H "Authorization: Bearer demo-qodi-token" http://localhost:8080/qodi/publickey
```

You should receive a JSON response with `publicKey` and `algorithm` fields.

---

### Step 6 — Explore the API docs

Open your browser:

```
http://localhost:8080/api-docs
```

This is the interactive OpenAPI UI where you can try every endpoint.

---

### Stopping the backend

```bash
docker compose down
```

---

## Run locally without Docker

If you prefer to run the server directly with Node.js instead of Docker Compose, skip Step 4 above and do the following after Step 3.

Generate the TypeScript types from the OpenAPI spec (required before first run):

```bash
npm run gen-types
```

Start the development server with hot reload:

```bash
npm run dev
```

Then open:
- `http://localhost:8080/api-docs`
- `http://localhost:8080/health`

---

## Part 2 — Run the Flutter Demo App

The Flutter demo at `examples/flutter-demo` lets you:

- Fetch the Qodi public key from a running backend
- Generate an encrypted QR payload
- Render the QR code on screen
- Scan a QR code with the device camera
- Call `/qodi/decrypt` to verify and decode the payload

### Prerequisites

- [Flutter SDK](https://docs.flutter.dev/get-started/install) 3.x (Dart SDK ^3.11.1 required)
- A physical device **or** an emulator with camera support (camera is required to scan QR codes)
- The Qodi backend running (see Part 1 above)

Verify your Flutter environment:

```bash
flutter doctor
```

Resolve any issues it reports before continuing.

---

### Step 1 — Navigate to the demo directory

```bash
cd examples/flutter-demo
```

---

### Step 2 — Install Flutter dependencies

```bash
flutter pub get
```

---

### Step 3 — Connect a device or start an emulator

List available devices:

```bash
flutter devices
```

To start an Android emulator (if one is configured):

```bash
flutter emulators --launch <emulator-id>
```

For iOS, open Simulator.app or plug in a device.

---

### Step 4 — Run the app

```bash
flutter run
```

Flutter will prompt you to select a device if more than one is connected.

---

### Step 5 — Use the demo

Once the app is running:

1. **Connection section** — enter the Qodi base URL and bearer token.
   - If the backend is on the same machine and you are using an Android emulator, the URL is `http://10.0.2.2:8080` (not `localhost`).
   - For a physical device on the same Wi-Fi network, use your machine's local IP, e.g. `http://192.168.1.x:8080`.
   - For iOS Simulator on the same Mac, `http://localhost:8080` works.
   - Bearer token: whatever you set for `QODI_STATIC_TOKEN` in your `.env` (e.g. `demo-qodi-token`).

2. **Fetch Public Key** — tap the button. The app will retrieve the RSA public key from the backend.

3. **Generate section** — edit the payload JSON and expiry window, then tap **Generate QR**. The QR code appears in the QR Output section.

4. **Scan + Decrypt section** — tap **Scan QR** to use the camera, or paste a payload directly, then tap **Decrypt** to call the backend.

---

### Android network note

Android blocks plain HTTP on real devices by default. For development you can either:

- Use HTTPS with a valid certificate, or
- Add a network security config to allow cleartext for your local IP (see the [Android docs](https://developer.android.com/training/articles/security-config))

The emulator (`10.0.2.2`) does not have this restriction by default in debug builds.
