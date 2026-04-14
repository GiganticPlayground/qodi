# Flutter Demo

This is a minimal Flutter client for Qodi.

It demonstrates:
- fetching `GET /qodi/publickey`
- building a `{ data, exp }` JSON payload
- encrypting that payload with RSA-OAEP in Dart
- base64-encoding the ciphertext as `qodiPayload`
- rendering `qodiPayload` as a QR code
- scanning a QR code back from the camera
- sending the scanned `qodiPayload` to `POST /qodi/decrypt`

## Run

Start the backend first. The compose example uses:
- base URL: `http://localhost:8080`
- bearer token: `demo-qodi-token`

Then run the Flutter demo:

```bash
cd examples/flutter-demo
flutter pub get
flutter run -d chrome
```

On Android or iOS, camera scanning works through the same UI. On web, the browser will prompt for camera permission.

## Notes

- This demo is intentionally minimal and is meant for small payloads only.
- RSA-OAEP cannot encrypt arbitrarily large plaintexts directly. If the payload grows too large, the demo will fail with a size error.
- The field sent to Qodi for decryption is called `qodiPayload`.
