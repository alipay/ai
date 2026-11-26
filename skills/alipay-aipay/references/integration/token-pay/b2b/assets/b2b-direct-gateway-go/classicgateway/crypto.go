package classicgateway

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"errors"
	"fmt"
	"sort"
	"strings"
)

var ErrInvalidSignature = errors.New("classicgateway: invalid response signature")

type Signer interface {
	Sign(content []byte) (string, error)
}

type ResponseVerifier interface {
	Mode() SecurityMode
	Verify(content []byte, signature, alipayCertSN string) error
}

type RSA2Signer struct {
	privateKey *rsa.PrivateKey
}

func NewRSA2Signer(privateKeyMaterial []byte) (*RSA2Signer, error) {
	privateKey, err := parsePrivateKey(privateKeyMaterial)
	if err != nil {
		return nil, err
	}
	return &RSA2Signer{privateKey: privateKey}, nil
}

func (s *RSA2Signer) Sign(content []byte) (string, error) {
	digest := sha256.Sum256(content)
	signature, err := rsa.SignPKCS1v15(rand.Reader, s.privateKey, crypto.SHA256, digest[:])
	if err != nil {
		return "", fmt.Errorf("classicgateway: sign request: %w", err)
	}
	return base64.StdEncoding.EncodeToString(signature), nil
}

type PublicKeyVerifier struct {
	publicKey *rsa.PublicKey
}

func NewPublicKeyVerifier(publicKeyMaterial []byte) (*PublicKeyVerifier, error) {
	publicKey, err := parsePublicKey(publicKeyMaterial)
	if err != nil {
		return nil, err
	}
	return &PublicKeyVerifier{publicKey: publicKey}, nil
}

func (v *PublicKeyVerifier) Mode() SecurityMode {
	return SecurityModePublicKey
}

func (v *PublicKeyVerifier) Verify(content []byte, signature, _ string) error {
	return verifyRSA2(v.publicKey, content, signature)
}

// CertificateVerifier selects only explicitly trusted Alipay certificate keys.
// Certificate refresh and chain validation belong in the merchant's controlled
// configuration workflow, not in the request path.
type CertificateVerifier struct {
	publicKeys map[string]*rsa.PublicKey
}

func NewCertificateVerifier(alipayCertificates map[string][]byte) (*CertificateVerifier, error) {
	if len(alipayCertificates) == 0 {
		return nil, errors.New("classicgateway: at least one Alipay certificate is required")
	}
	publicKeys := make(map[string]*rsa.PublicKey, len(alipayCertificates))
	for certSN, material := range alipayCertificates {
		if strings.TrimSpace(certSN) == "" {
			return nil, errors.New("classicgateway: Alipay certificate SN is empty")
		}
		publicKey, err := parseCertificatePublicKey(material)
		if err != nil {
			return nil, fmt.Errorf("classicgateway: parse Alipay certificate %q: %w", certSN, err)
		}
		publicKeys[certSN] = publicKey
	}
	return &CertificateVerifier{publicKeys: publicKeys}, nil
}

func parseCertificatePublicKey(material []byte) (*rsa.PublicKey, error) {
	der, blockType, err := decodeKeyMaterial(material)
	if err != nil {
		return nil, fmt.Errorf("classicgateway: decode Alipay certificate: %w", err)
	}
	if blockType != "" && blockType != "CERTIFICATE" {
		return nil, fmt.Errorf("classicgateway: expected CERTIFICATE PEM block, got %q", blockType)
	}
	certificate, err := x509.ParseCertificate(der)
	if err != nil {
		return nil, fmt.Errorf("classicgateway: parse X.509 certificate: %w", err)
	}
	publicKey, ok := certificate.PublicKey.(*rsa.PublicKey)
	if !ok {
		return nil, errors.New("classicgateway: certificate public key is not RSA")
	}
	return publicKey, nil
}

func (v *CertificateVerifier) Mode() SecurityMode {
	return SecurityModeCertificate
}

func (v *CertificateVerifier) Verify(content []byte, signature, alipayCertSN string) error {
	if alipayCertSN == "" {
		return errors.New("classicgateway: response is missing alipay_cert_sn")
	}
	publicKey, ok := v.publicKeys[alipayCertSN]
	if !ok {
		return fmt.Errorf("classicgateway: untrusted alipay_cert_sn %q", alipayCertSN)
	}
	return verifyRSA2(publicKey, content, signature)
}

// Canonicalize applies the classic gateway V2 signing rules. Values are used
// exactly as supplied; URL encoding happens only after signing.
func Canonicalize(params map[string]string) string {
	keys := make([]string, 0, len(params))
	for key, value := range params {
		if key == "" || key == "sign" || value == "" {
			continue
		}
		keys = append(keys, key)
	}
	sort.Strings(keys)

	var builder strings.Builder
	for index, key := range keys {
		if index > 0 {
			builder.WriteByte('&')
		}
		builder.WriteString(key)
		builder.WriteByte('=')
		builder.WriteString(params[key])
	}
	return builder.String()
}

func verifyRSA2(publicKey *rsa.PublicKey, content []byte, signature string) error {
	decoded, err := base64.StdEncoding.DecodeString(signature)
	if err != nil {
		return fmt.Errorf("classicgateway: decode response signature: %w", err)
	}
	digest := sha256.Sum256(content)
	if err := rsa.VerifyPKCS1v15(publicKey, crypto.SHA256, digest[:], decoded); err != nil {
		return fmt.Errorf("%w: %v", ErrInvalidSignature, err)
	}
	return nil
}

func parsePrivateKey(material []byte) (*rsa.PrivateKey, error) {
	der, blockType, err := decodeKeyMaterial(material)
	if err != nil {
		return nil, fmt.Errorf("classicgateway: decode application private key: %w", err)
	}

	if blockType == "RSA PRIVATE KEY" {
		key, err := x509.ParsePKCS1PrivateKey(der)
		if err != nil {
			return nil, fmt.Errorf("classicgateway: parse PKCS#1 private key: %w", err)
		}
		return key, nil
	}

	parsed, pkcs8Err := x509.ParsePKCS8PrivateKey(der)
	if pkcs8Err == nil {
		key, ok := parsed.(*rsa.PrivateKey)
		if !ok {
			return nil, errors.New("classicgateway: PKCS#8 key is not RSA")
		}
		return key, nil
	}
	if key, pkcs1Err := x509.ParsePKCS1PrivateKey(der); pkcs1Err == nil {
		return key, nil
	}
	return nil, fmt.Errorf("classicgateway: parse private key as PKCS#8 or PKCS#1: %w", pkcs8Err)
}

func parsePublicKey(material []byte) (*rsa.PublicKey, error) {
	der, blockType, err := decodeKeyMaterial(material)
	if err != nil {
		return nil, fmt.Errorf("classicgateway: decode Alipay public key: %w", err)
	}

	if blockType == "CERTIFICATE" {
		certificate, err := x509.ParseCertificate(der)
		if err != nil {
			return nil, fmt.Errorf("classicgateway: parse X.509 certificate: %w", err)
		}
		publicKey, ok := certificate.PublicKey.(*rsa.PublicKey)
		if !ok {
			return nil, errors.New("classicgateway: certificate public key is not RSA")
		}
		return publicKey, nil
	}
	if blockType == "RSA PUBLIC KEY" {
		key, err := x509.ParsePKCS1PublicKey(der)
		if err != nil {
			return nil, fmt.Errorf("classicgateway: parse PKCS#1 public key: %w", err)
		}
		return key, nil
	}

	parsed, pkixErr := x509.ParsePKIXPublicKey(der)
	if pkixErr == nil {
		key, ok := parsed.(*rsa.PublicKey)
		if !ok {
			return nil, errors.New("classicgateway: public key is not RSA")
		}
		return key, nil
	}
	if key, pkcs1Err := x509.ParsePKCS1PublicKey(der); pkcs1Err == nil {
		return key, nil
	}
	if certificate, certErr := x509.ParseCertificate(der); certErr == nil {
		key, ok := certificate.PublicKey.(*rsa.PublicKey)
		if !ok {
			return nil, errors.New("classicgateway: certificate public key is not RSA")
		}
		return key, nil
	}
	return nil, fmt.Errorf("classicgateway: parse public key as PKIX, PKCS#1, or certificate: %w", pkixErr)
}

func decodeKeyMaterial(material []byte) ([]byte, string, error) {
	trimmed := strings.TrimSpace(string(material))
	if trimmed == "" {
		return nil, "", errors.New("key material is empty")
	}
	if block, rest := pem.Decode([]byte(trimmed)); block != nil {
		if strings.TrimSpace(string(rest)) != "" {
			return nil, "", errors.New("multiple PEM blocks are not supported")
		}
		return block.Bytes, block.Type, nil
	}

	compact := strings.NewReplacer("\r", "", "\n", "", "\t", "", " ", "").Replace(trimmed)
	der, err := base64.StdEncoding.DecodeString(compact)
	if err != nil {
		return nil, "", fmt.Errorf("key is neither PEM nor base64 DER: %w", err)
	}
	return der, "", nil
}
