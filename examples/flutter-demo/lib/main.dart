import 'dart:convert';
import 'dart:typed_data';

import 'package:basic_utils/basic_utils.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:pointycastle/asymmetric/oaep.dart';
import 'package:pointycastle/asymmetric/rsa.dart';
import 'package:pointycastle/digests/sha1.dart';
import 'package:pointycastle/digests/sha256.dart';
import 'package:pointycastle/digests/sha384.dart';
import 'package:pointycastle/digests/sha512.dart';
import 'package:qr_flutter/qr_flutter.dart';

void main() {
  runApp(const QodiFlutterDemoApp());
}

class QodiFlutterDemoApp extends StatelessWidget {
  const QodiFlutterDemoApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Qodi Flutter Demo',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF0F8B8D),
          brightness: Brightness.dark,
        ),
        scaffoldBackgroundColor: const Color(0xFF101417),
        useMaterial3: true,
      ),
      home: const QodiDemoPage(),
    );
  }
}

class QodiDemoPage extends StatefulWidget {
  const QodiDemoPage({super.key});

  @override
  State<QodiDemoPage> createState() => _QodiDemoPageState();
}

class _QodiDemoPageState extends State<QodiDemoPage> {
  final _apiBaseUrlController = TextEditingController(
    text: 'http://localhost:8080',
  );
  final _bearerTokenController = TextEditingController(text: 'demo-qodi-token');
  final _payloadController = TextEditingController(
    text: const JsonEncoder.withIndent(
      '  ',
    ).convert(<String, Object>{'badgeId': 'guest-42', 'location': 'hall-a'}),
  );
  final _expiresInMinutesController = TextEditingController(text: '5');
  final _scanPayloadController = TextEditingController();

  String _status =
      'Fetch the Qodi public key, then generate or scan a QR payload.';
  String? _publicKeyPem;
  String? _algorithm;
  String? _qodiPayload;
  String? _plaintextPreview;
  String? _decryptPreview;
  bool _isFetchingKey = false;
  bool _isEncrypting = false;
  bool _isDecrypting = false;

  @override
  void dispose() {
    _apiBaseUrlController.dispose();
    _bearerTokenController.dispose();
    _payloadController.dispose();
    _expiresInMinutesController.dispose();
    _scanPayloadController.dispose();
    super.dispose();
  }

  Future<void> _fetchPublicKey() async {
    setState(() {
      _isFetchingKey = true;
      _status = 'Fetching /qodi/publickey...';
    });

    try {
      final response = await http.get(
        Uri.parse('${_apiBaseUrlController.text}/qodi/publickey'),
        headers: <String, String>{
          'Authorization': 'Bearer ${_bearerTokenController.text}',
        },
      );

      if (response.statusCode != 200) {
        throw Exception(
          'Public key request failed: HTTP ${response.statusCode} ${response.body}',
        );
      }

      final payload = jsonDecode(response.body) as Map<String, dynamic>;
      final publicKey = payload['publicKey'];
      final algorithm = payload['algorithm'];

      if (publicKey is! String || algorithm is! String) {
        throw Exception('Public key response is missing expected fields.');
      }

      setState(() {
        _publicKeyPem = publicKey;
        _algorithm = algorithm;
        _status = 'Fetched public key using $algorithm.';
      });
    } catch (error) {
      setState(() {
        _publicKeyPem = null;
        _algorithm = null;
        _status = error.toString();
      });
    } finally {
      if (mounted) {
        setState(() {
          _isFetchingKey = false;
        });
      }
    }
  }

  Future<void> _generateQodiPayload() async {
    if (_publicKeyPem == null || _algorithm == null) {
      setState(() {
        _status = 'Fetch the public key before generating a QR payload.';
      });
      return;
    }

    final expiresInMinutes = int.tryParse(_expiresInMinutesController.text);
    if (expiresInMinutes == null || expiresInMinutes <= 0) {
      setState(() {
        _status = 'Expires in minutes must be a positive integer.';
      });
      return;
    }

    setState(() {
      _isEncrypting = true;
      _status = 'Encrypting payload with RSA-OAEP...';
    });

    try {
      final payloadData = jsonDecode(_payloadController.text);
      final plaintext = <String, Object?>{
        'data': payloadData,
        'exp':
            DateTime.now().millisecondsSinceEpoch ~/ 1000 +
            (expiresInMinutes * 60),
      };
      final plaintextJson = jsonEncode(plaintext);
      final ciphertext = _encryptWithRsaOaep(
        publicKeyPem: _publicKeyPem!,
        algorithm: _algorithm!,
        plaintext: plaintextJson,
      );

      final generated = base64Encode(ciphertext);
      setState(() {
        _plaintextPreview = const JsonEncoder.withIndent(
          '  ',
        ).convert(plaintext);
        _qodiPayload = generated;
        _scanPayloadController.text = generated;
        _status =
            'Generated qodiPayload. The QR code now contains encrypted ciphertext only.';
      });
    } catch (error) {
      setState(() {
        _qodiPayload = null;
        _plaintextPreview = null;
        _status = error.toString();
      });
    } finally {
      if (mounted) {
        setState(() {
          _isEncrypting = false;
        });
      }
    }
  }

  Future<void> _openScanner() async {
    final scannedValue = await Navigator.of(context).push<String>(
      MaterialPageRoute<String>(builder: (_) => const _ScannerPage()),
    );

    if (!mounted || scannedValue == null || scannedValue.isEmpty) {
      return;
    }

    setState(() {
      _scanPayloadController.text = scannedValue;
      _status = 'Scanned qodiPayload from camera.';
    });
  }

  Future<void> _decryptScannedPayload() async {
    final qodiPayload = _scanPayloadController.text.trim();
    if (qodiPayload.isEmpty) {
      setState(() {
        _status = 'Scan or paste a qodiPayload before decrypting.';
      });
      return;
    }

    setState(() {
      _isDecrypting = true;
      _status = 'Posting qodiPayload to /qodi/decrypt...';
    });

    try {
      final response = await http.post(
        Uri.parse('${_apiBaseUrlController.text}/qodi/decrypt'),
        headers: <String, String>{
          'Authorization': 'Bearer ${_bearerTokenController.text}',
          'Content-Type': 'application/json',
        },
        body: jsonEncode(<String, String>{'qodiPayload': qodiPayload}),
      );

      if (response.statusCode != 200) {
        throw Exception(
          'Decrypt request failed: HTTP ${response.statusCode} ${response.body}',
        );
      }

      final payload = jsonDecode(response.body);
      setState(() {
        _decryptPreview = const JsonEncoder.withIndent('  ').convert(payload);
        _status = 'Decrypt request completed.';
      });
    } catch (error) {
      setState(() {
        _decryptPreview = null;
        _status = error.toString();
      });
    } finally {
      if (mounted) {
        setState(() {
          _isDecrypting = false;
        });
      }
    }
  }

  Uint8List _encryptWithRsaOaep({
    required String publicKeyPem,
    required String algorithm,
    required String plaintext,
  }) {
    final publicKey = CryptoUtils.rsaPublicKeyFromPem(publicKeyPem);
    final encoding = OAEPEncoding.withCustomDigest(
      () => _hashDigestForAlgorithm(algorithm),
      RSAEngine(),
      Uint8List(0),
    )..init(true, PublicKeyParameter<RSAPublicKey>(publicKey));

    final input = Uint8List.fromList(utf8.encode(plaintext));
    final maxInputBlockSize = encoding.inputBlockSize;

    if (input.length > maxInputBlockSize) {
      throw Exception(
        'Payload too large for $algorithm with this key. Keep the payload small for this minimal demo.',
      );
    }

    return encoding.process(input);
  }

  Digest _hashDigestForAlgorithm(String algorithm) {
    switch (algorithm) {
      case 'RSA-OAEP':
        return SHA1Digest();
      case 'RSA-OAEP-SHA256':
        return SHA256Digest();
      case 'RSA-OAEP-SHA384':
        return SHA384Digest();
      case 'RSA-OAEP-SHA512':
        return SHA512Digest();
      default:
        throw Exception('Unsupported Qodi algorithm: $algorithm');
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Qodi Flutter Demo'),
        centerTitle: false,
      ),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 920),
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: <Widget>[
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Text(
                          'Minimal Qodi generator + scanner',
                          style: theme.textTheme.headlineSmall,
                        ),
                        const SizedBox(height: 12),
                        const Text(
                          'This demo can generate a qodiPayload, render it as a QR code, scan a QR code back from the camera, and call /qodi/decrypt against the backend.',
                        ),
                        const SizedBox(height: 12),
                        Text(_status, style: theme.textTheme.bodyMedium),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                _SectionCard(
                  title: 'Connection',
                  action: FilledButton(
                    onPressed: _isFetchingKey ? null : _fetchPublicKey,
                    child: Text(
                      _isFetchingKey ? 'Fetching...' : 'Fetch Public Key',
                    ),
                  ),
                  child: Column(
                    children: <Widget>[
                      TextField(
                        controller: _apiBaseUrlController,
                        decoration: const InputDecoration(
                          labelText: 'Qodi base URL',
                        ),
                      ),
                      const SizedBox(height: 12),
                      TextField(
                        controller: _bearerTokenController,
                        decoration: const InputDecoration(
                          labelText: 'Bearer token',
                        ),
                      ),
                      const SizedBox(height: 12),
                      _InfoBlock(
                        label: 'Algorithm',
                        value: _algorithm ?? 'Not loaded',
                      ),
                      const SizedBox(height: 12),
                      _InfoBlock(
                        label: 'Public key preview',
                        value: _publicKeyPem == null
                            ? 'Fetch the public key to inspect it.'
                            : _publicKeyPem!.substring(
                                0,
                                _publicKeyPem!.length.clamp(0, 180),
                              ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 12),
                _SectionCard(
                  title: 'Generate',
                  action: FilledButton.tonal(
                    onPressed: _isEncrypting ? null : _generateQodiPayload,
                    child: Text(
                      _isEncrypting ? 'Encrypting...' : 'Generate QR',
                    ),
                  ),
                  child: Column(
                    children: <Widget>[
                      TextField(
                        controller: _payloadController,
                        minLines: 8,
                        maxLines: 12,
                        decoration: const InputDecoration(
                          labelText: 'Payload JSON',
                        ),
                      ),
                      const SizedBox(height: 12),
                      TextField(
                        controller: _expiresInMinutesController,
                        keyboardType: TextInputType.number,
                        decoration: const InputDecoration(
                          labelText: 'Expires in minutes',
                        ),
                      ),
                      const SizedBox(height: 12),
                      _InfoBlock(
                        label: 'Encrypted plaintext preview',
                        value:
                            _plaintextPreview ??
                            'Generate a qodiPayload to see the encrypted JSON structure.',
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 12),
                _SectionCard(
                  title: 'QR Output',
                  child: Column(
                    children: <Widget>[
                      Container(
                        padding: const EdgeInsets.all(16),
                        decoration: BoxDecoration(
                          color: const Color(0xFFF4EFE4),
                          borderRadius: BorderRadius.circular(16),
                        ),
                        child: _qodiPayload == null
                            ? const Padding(
                                padding: EdgeInsets.all(32),
                                child: Text(
                                  'Generate a qodiPayload to render the QR code.',
                                  style: TextStyle(color: Color(0xFF1A2328)),
                                  textAlign: TextAlign.center,
                                ),
                              )
                            : QrImageView(
                                data: _qodiPayload!,
                                version: QrVersions.auto,
                                size: 260,
                                backgroundColor: const Color(0xFFF4EFE4),
                              ),
                      ),
                      const SizedBox(height: 12),
                      _InfoBlock(
                        label: 'qodiPayload preview',
                        value: _qodiPayload ?? 'No qodiPayload yet.',
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 12),
                _SectionCard(
                  title: 'Scan + Decrypt',
                  action: Wrap(
                    spacing: 8,
                    children: <Widget>[
                      OutlinedButton(
                        onPressed: _openScanner,
                        child: const Text('Scan QR'),
                      ),
                      FilledButton(
                        onPressed: _isDecrypting
                            ? null
                            : _decryptScannedPayload,
                        child: Text(
                          _isDecrypting ? 'Decrypting...' : 'Decrypt',
                        ),
                      ),
                    ],
                  ),
                  child: Column(
                    children: <Widget>[
                      TextField(
                        controller: _scanPayloadController,
                        minLines: 4,
                        maxLines: 8,
                        decoration: const InputDecoration(
                          labelText: 'Scanned or pasted qodiPayload',
                        ),
                      ),
                      const SizedBox(height: 12),
                      _InfoBlock(
                        label: 'Decrypt response',
                        value:
                            _decryptPreview ??
                            'Scan a QR code or paste a qodiPayload, then call /qodi/decrypt.',
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _ScannerPage extends StatefulWidget {
  const _ScannerPage();

  @override
  State<_ScannerPage> createState() => _ScannerPageState();
}

class _ScannerPageState extends State<_ScannerPage> {
  final MobileScannerController _controller = MobileScannerController(
    detectionSpeed: DetectionSpeed.noDuplicates,
    facing: CameraFacing.back,
  );
  bool _hasResult = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _onDetect(BarcodeCapture capture) {
    if (_hasResult) {
      return;
    }

    final rawValue = capture.barcodes
        .map((barcode) => barcode.rawValue)
        .whereType<String>()
        .firstWhere((value) => value.isNotEmpty, orElse: () => '');

    if (rawValue.isEmpty) {
      return;
    }

    _hasResult = true;
    Navigator.of(context).pop(rawValue);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Scan Qodi QR')),
      body: Stack(
        fit: StackFit.expand,
        children: <Widget>[
          MobileScanner(controller: _controller, onDetect: _onDetect),
          Align(
            alignment: Alignment.bottomCenter,
            child: Container(
              margin: const EdgeInsets.all(16),
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Colors.black.withValues(alpha: 0.65),
                borderRadius: BorderRadius.circular(12),
              ),
              child: const Text(
                'Point the camera at a QR code generated by this demo.',
                textAlign: TextAlign.center,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _SectionCard extends StatelessWidget {
  const _SectionCard({required this.title, required this.child, this.action});

  final String title;
  final Widget child;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Expanded(
                  child: Text(
                    title,
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                ),
                action ?? const SizedBox.shrink(),
              ],
            ),
            const SizedBox(height: 16),
            child,
          ],
        ),
      ),
    );
  }
}

class _InfoBlock extends StatelessWidget {
  const _InfoBlock({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFF182027),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            label,
            style: Theme.of(context).textTheme.labelMedium?.copyWith(
              color: const Color(0xFF9FB4C1),
              letterSpacing: 0.6,
            ),
          ),
          const SizedBox(height: 8),
          SelectableText(value),
        ],
      ),
    );
  }
}
