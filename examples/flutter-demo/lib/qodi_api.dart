import 'dart:convert';
import 'dart:typed_data';

import 'package:basic_utils/basic_utils.dart';
import 'package:http/http.dart' as http;
import 'package:pointycastle/asymmetric/oaep.dart';
import 'package:pointycastle/asymmetric/rsa.dart';
import 'package:pointycastle/digests/sha1.dart';
import 'package:pointycastle/digests/sha256.dart';
import 'package:pointycastle/digests/sha384.dart';
import 'package:pointycastle/digests/sha512.dart';

class QodiPublicKeyResponse {
  const QodiPublicKeyResponse({
    required this.publicKey,
    required this.algorithm,
  });

  final String publicKey;
  final String algorithm;
}

class QodiApi {
  const QodiApi();

  Future<QodiPublicKeyResponse> fetchPublicKey({
    required String baseUrl,
    required String bearerToken,
  }) async {
    final response = await http.get(
      Uri.parse('$baseUrl/qodi/publickey'),
      headers: <String, String>{
        'Authorization': 'Bearer $bearerToken',
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

    return QodiPublicKeyResponse(
      publicKey: publicKey,
      algorithm: algorithm,
    );
  }

  Future<Object?> decryptQodiPayload({
    required String baseUrl,
    required String bearerToken,
    required String qodiPayload,
  }) async {
    final response = await http.post(
      Uri.parse('$baseUrl/qodi/decrypt'),
      headers: <String, String>{
        'Authorization': 'Bearer $bearerToken',
        'Content-Type': 'application/json',
      },
      body: jsonEncode(<String, String>{'qodiPayload': qodiPayload}),
    );

    if (response.statusCode != 200) {
      throw Exception(
        'Decrypt request failed: HTTP ${response.statusCode} ${response.body}',
      );
    }

    return jsonDecode(response.body);
  }

  String generateQodiPayload({
    required String publicKeyPem,
    required String algorithm,
    required Object? data,
    required int exp,
  }) {
    final plaintext = <String, Object?>{
      'data': data,
      'exp': exp,
    };

    final ciphertext = _encryptWithRsaOaep(
      publicKeyPem: publicKeyPem,
      algorithm: algorithm,
      plaintext: jsonEncode(plaintext),
    );

    return base64Encode(ciphertext);
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
}
