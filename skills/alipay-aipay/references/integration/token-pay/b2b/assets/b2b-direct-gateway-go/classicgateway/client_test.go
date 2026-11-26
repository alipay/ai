package classicgateway

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"io"
	"math/big"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestCanonicalizeUsesRawValuesAndKeepsSignType(t *testing.T) {
	params := map[string]string{
		"sign":        "ignored",
		"empty":       "",
		"app_id":      "app+id",
		"sign_type":   "RSA2",
		"biz_content": `{"subject":"中文 + % & space","nested":{"a":1}}`,
	}
	want := `app_id=app+id&biz_content={"subject":"中文 + % & space","nested":{"a":1}}&sign_type=RSA2`
	if got := Canonicalize(params); got != want {
		t.Fatalf("Canonicalize() = %q, want %q", got, want)
	}
}

func TestSignerAcceptsPKCS1AndPKCS8(t *testing.T) {
	privateKey := mustRSAKey(t)
	publicPEM := pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: mustPKIXPublicKey(t, &privateKey.PublicKey)})
	verifier, err := NewPublicKeyVerifier(publicPEM)
	if err != nil {
		t.Fatal(err)
	}

	privateKeys := [][]byte{
		pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(privateKey)}),
		pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: mustPKCS8PrivateKey(t, privateKey)}),
	}
	for _, material := range privateKeys {
		signer, err := NewRSA2Signer(material)
		if err != nil {
			t.Fatal(err)
		}
		signature, err := signer.Sign([]byte("content"))
		if err != nil {
			t.Fatal(err)
		}
		if err := verifier.Verify([]byte("content"), signature, ""); err != nil {
			t.Fatal(err)
		}
	}
}

func TestExecuteSignsRequestAndVerifiesRawResponse(t *testing.T) {
	privateKey := mustRSAKey(t)
	signer := mustSigner(t, privateKey)
	verifier := mustVerifier(t, privateKey)
	payload := []byte(`{ "code":"10000", "message":"Success", "url":"https:\/\/example.com\/a+b" }`)

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost {
			t.Errorf("method = %s", request.Method)
		}
		body, err := io.ReadAll(request.Body)
		if err != nil {
			t.Error(err)
			return
		}
		form, err := url.ParseQuery(string(body))
		if err != nil {
			t.Error(err)
			return
		}
		params := make(map[string]string)
		for key, values := range request.URL.Query() {
			if key != "sign" && len(values) > 0 {
				params[key] = values[0]
			}
		}
		params["biz_content"] = form.Get("biz_content")
		if err := verifier.Verify([]byte(Canonicalize(params)), request.URL.Query().Get("sign"), ""); err != nil {
			t.Errorf("request signature: %v", err)
			return
		}

		responseSign, err := signer.Sign(payload)
		if err != nil {
			t.Error(err)
			return
		}
		writer.Header().Set("trace_id", "trace-1")
		_, _ = writer.Write([]byte(`{"alipay_trade_saas_order_query_response":` + string(payload) + `,"sign":"` + responseSign + `"}`))
	}))
	defer server.Close()

	client, err := NewClient(
		Config{GatewayURL: server.URL, AppID: "app-id"},
		signer,
		verifier,
		WithClock(func() time.Time { return time.Date(2026, 8, 17, 10, 11, 12, 0, time.UTC) }),
	)
	if err != nil {
		t.Fatal(err)
	}
	response, err := client.Execute(context.Background(), "alipay.trade.saas.order.query", map[string]any{
		"out_trade_no": "订单 + % & 1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if string(response.Payload) != string(payload) {
		t.Fatalf("payload = %q, want exact raw payload %q", response.Payload, payload)
	}
	if response.TraceID != "trace-1" {
		t.Fatalf("trace ID = %q", response.TraceID)
	}
}

func TestParseResponseRejectsTamperingAndDuplicateRoot(t *testing.T) {
	privateKey := mustRSAKey(t)
	signer := mustSigner(t, privateKey)
	verifier := mustVerifier(t, privateKey)
	original := []byte(`{"code":"10000"}`)
	signature, err := signer.Sign(original)
	if err != nil {
		t.Fatal(err)
	}
	tampered := []byte(`{"alipay_trade_saas_order_query_response":{"code":"20000"},"sign":"` + signature + `"}`)
	if _, err := parseAndVerifyResponse("alipay.trade.saas.order.query", tampered, verifier); !errors.Is(err, ErrInvalidSignature) {
		t.Fatalf("tampered response error = %v", err)
	}
	valid := []byte(`{"alipay_trade_saas_order_query_response":` + string(original) + `,"sign":"` + signature + `"}`)
	wrongVerifier := mustVerifier(t, mustRSAKey(t))
	if _, err := parseAndVerifyResponse("alipay.trade.saas.order.query", valid, wrongVerifier); !errors.Is(err, ErrInvalidSignature) {
		t.Fatalf("wrong public key error = %v", err)
	}

	duplicate := []byte(`{"alipay_trade_saas_order_query_response":{},"alipay_trade_saas_order_query_response":{},"sign":"x"}`)
	if _, err := parseAndVerifyResponse("alipay.trade.saas.order.query", duplicate, verifier); err == nil || !strings.Contains(err.Error(), "duplicate") {
		t.Fatalf("duplicate response error = %v", err)
	}

	missingSign := []byte(`{"alipay_trade_saas_order_query_response":{"code":"10000"}}`)
	if _, err := parseAndVerifyResponse("alipay.trade.saas.order.query", missingSign, verifier); err == nil || !strings.Contains(err.Error(), "missing sign") {
		t.Fatalf("missing sign error = %v", err)
	}
}

func TestExecuteRejectsHTTPStatusAndOversizedResponse(t *testing.T) {
	privateKey := mustRSAKey(t)
	signer := mustSigner(t, privateKey)
	verifier := mustVerifier(t, privateKey)

	statusServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(http.StatusBadGateway)
	}))
	defer statusServer.Close()
	statusClient, err := NewClient(Config{GatewayURL: statusServer.URL, AppID: "app-id"}, signer, verifier)
	if err != nil {
		t.Fatal(err)
	}
	_, err = statusClient.Execute(context.Background(), "alipay.trade.saas.order.query", map[string]string{"order_no": "1"})
	var statusError *HTTPStatusError
	if !errors.As(err, &statusError) || statusError.StatusCode != http.StatusBadGateway {
		t.Fatalf("HTTP status error = %v", err)
	}

	largeServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		_, _ = writer.Write([]byte(`{"response":"too large"}`))
	}))
	defer largeServer.Close()
	largeClient, err := NewClient(Config{GatewayURL: largeServer.URL, AppID: "app-id", ResponseLimit: 8}, signer, verifier)
	if err != nil {
		t.Fatal(err)
	}
	_, err = largeClient.Execute(context.Background(), "alipay.trade.saas.order.query", map[string]string{"order_no": "1"})
	if err == nil || !strings.Contains(err.Error(), "exceeds") {
		t.Fatalf("oversized response error = %v", err)
	}
}

func TestExecuteHonorsCanceledContext(t *testing.T) {
	privateKey := mustRSAKey(t)
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Fatal("canceled request reached server")
	}))
	defer server.Close()
	client, err := NewClient(Config{GatewayURL: server.URL, AppID: "app-id"}, mustSigner(t, privateKey), mustVerifier(t, privateKey))
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err = client.Execute(ctx, "alipay.trade.saas.order.query", map[string]string{"order_no": "1"})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled context error = %v", err)
	}
}

func TestCertificateVerifierFailsClosedForUnknownSN(t *testing.T) {
	privateKey := mustRSAKey(t)
	certificatePEM := mustCertificatePEM(t, privateKey)
	verifier, err := NewCertificateVerifier(map[string][]byte{"trusted-sn": certificatePEM})
	if err != nil {
		t.Fatal(err)
	}
	signature, err := mustSigner(t, privateKey).Sign([]byte("content"))
	if err != nil {
		t.Fatal(err)
	}
	if err := verifier.Verify([]byte("content"), signature, "unknown-sn"); err == nil {
		t.Fatal("unknown certificate SN was accepted")
	}
	if err := verifier.Verify([]byte("content"), signature, "trusted-sn"); err != nil {
		t.Fatal(err)
	}
}

func TestCertificateModeSendsSerialNumbersAndSelectsResponseCertificate(t *testing.T) {
	privateKey := mustRSAKey(t)
	signer := mustSigner(t, privateKey)
	certificatePEM := mustCertificatePEM(t, privateKey)
	verifier, err := NewCertificateVerifier(map[string][]byte{"alipay-sn": certificatePEM})
	if err != nil {
		t.Fatal(err)
	}
	payload := []byte(`{"code":"10000"}`)

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		query := request.URL.Query()
		if query.Get("app_cert_sn") != "app-sn" || query.Get("alipay_root_cert_sn") != "root-sn" {
			t.Errorf("certificate query = %v", query)
		}
		responseSign, signErr := signer.Sign(payload)
		if signErr != nil {
			t.Error(signErr)
			return
		}
		_, _ = writer.Write([]byte(`{"alipay_trade_saas_order_query_response":` + string(payload) + `,"alipay_cert_sn":"alipay-sn","sign":"` + responseSign + `"}`))
	}))
	defer server.Close()

	client, err := NewClient(Config{
		GatewayURL:       server.URL,
		AppID:            "app-id",
		SecurityMode:     SecurityModeCertificate,
		AppCertSN:        "app-sn",
		AlipayRootCertSN: "root-sn",
	}, signer, verifier)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.Execute(context.Background(), "alipay.trade.saas.order.query", map[string]string{"order_no": "1"}); err != nil {
		t.Fatal(err)
	}
}

func mustRSAKey(t *testing.T) *rsa.PrivateKey {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	return key
}

func mustSigner(t *testing.T, key *rsa.PrivateKey) *RSA2Signer {
	t.Helper()
	material := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: mustPKCS8PrivateKey(t, key)})
	signer, err := NewRSA2Signer(material)
	if err != nil {
		t.Fatal(err)
	}
	return signer
}

func mustVerifier(t *testing.T, key *rsa.PrivateKey) *PublicKeyVerifier {
	t.Helper()
	material := pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: mustPKIXPublicKey(t, &key.PublicKey)})
	verifier, err := NewPublicKeyVerifier(material)
	if err != nil {
		t.Fatal(err)
	}
	return verifier
}

func mustPKCS8PrivateKey(t *testing.T, key *rsa.PrivateKey) []byte {
	t.Helper()
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	return der
}

func mustPKIXPublicKey(t *testing.T, key *rsa.PublicKey) []byte {
	t.Helper()
	der, err := x509.MarshalPKIXPublicKey(key)
	if err != nil {
		t.Fatal(err)
	}
	return der
}

func mustCertificatePEM(t *testing.T, key *rsa.PrivateKey) []byte {
	t.Helper()
	template := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	return pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
}
