package classicgateway

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type SecurityMode string

const (
	SecurityModePublicKey   SecurityMode = "PUBLIC_KEY"
	SecurityModeCertificate SecurityMode = "CERTIFICATE"

	defaultResponseLimit int64 = 4 << 20
)

type Config struct {
	GatewayURL       string
	AppID            string
	SecurityMode     SecurityMode
	AppCertSN        string
	AlipayRootCertSN string
	ResponseLimit    int64
}

type Client struct {
	config     Config
	signer     Signer
	verifier   ResponseVerifier
	httpClient *http.Client
	now        func() time.Time
}

type Option func(*Client) error

func WithHTTPClient(httpClient *http.Client) Option {
	return func(client *Client) error {
		if httpClient == nil {
			return errors.New("classicgateway: HTTP client is nil")
		}
		if httpClient.Timeout <= 0 {
			return errors.New("classicgateway: HTTP client must have a positive timeout")
		}
		client.httpClient = httpClient
		return nil
	}
}

func WithClock(now func() time.Time) Option {
	return func(client *Client) error {
		if now == nil {
			return errors.New("classicgateway: clock is nil")
		}
		client.now = now
		return nil
	}
}

func NewClient(config Config, signer Signer, verifier ResponseVerifier, options ...Option) (*Client, error) {
	if signer == nil || verifier == nil {
		return nil, errors.New("classicgateway: signer and verifier are required")
	}
	if config.AppID == "" {
		return nil, errors.New("classicgateway: app ID is required")
	}
	gatewayURL, err := url.Parse(config.GatewayURL)
	if err != nil || gatewayURL.Host == "" || (gatewayURL.Scheme != "https" && gatewayURL.Scheme != "http") {
		return nil, errors.New("classicgateway: gateway URL must be an absolute HTTP(S) URL")
	}
	if gatewayURL.Scheme == "http" && !isLoopbackHost(gatewayURL.Hostname()) {
		return nil, errors.New("classicgateway: non-loopback gateway URL must use HTTPS")
	}
	if gatewayURL.RawQuery != "" || gatewayURL.Fragment != "" {
		return nil, errors.New("classicgateway: gateway URL must not contain query or fragment")
	}
	if config.SecurityMode == "" {
		config.SecurityMode = SecurityModePublicKey
	}
	if config.SecurityMode != SecurityModePublicKey && config.SecurityMode != SecurityModeCertificate {
		return nil, fmt.Errorf("classicgateway: unsupported security mode %q", config.SecurityMode)
	}
	if verifier.Mode() != config.SecurityMode {
		return nil, fmt.Errorf("classicgateway: verifier mode %q does not match config mode %q", verifier.Mode(), config.SecurityMode)
	}
	if config.SecurityMode == SecurityModeCertificate {
		if config.AppCertSN == "" || config.AlipayRootCertSN == "" {
			return nil, errors.New("classicgateway: certificate mode requires app_cert_sn and alipay_root_cert_sn")
		}
	} else if config.AppCertSN != "" || config.AlipayRootCertSN != "" {
		return nil, errors.New("classicgateway: certificate serial numbers require CERTIFICATE mode")
	}
	if config.ResponseLimit <= 0 {
		config.ResponseLimit = defaultResponseLimit
	}

	client := &Client{
		config:     config,
		signer:     signer,
		verifier:   verifier,
		httpClient: &http.Client{Timeout: 10 * time.Second},
		now:        time.Now,
	}
	for _, option := range options {
		if err := option(client); err != nil {
			return nil, err
		}
	}
	return client, nil
}

func isLoopbackHost(host string) bool {
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

type Response struct {
	Root    string
	Payload json.RawMessage
	TraceID string
}

func (r *Response) Decode(target any) error {
	if target == nil {
		return errors.New("classicgateway: response target is nil")
	}
	if err := json.Unmarshal(r.Payload, target); err != nil {
		return fmt.Errorf("classicgateway: decode verified response payload: %w", err)
	}
	return nil
}

type HTTPStatusError struct {
	StatusCode int
}

func (e *HTTPStatusError) Error() string {
	return fmt.Sprintf("classicgateway: gateway returned HTTP %d", e.StatusCode)
}

func (c *Client) Execute(ctx context.Context, method string, bizContent any) (*Response, error) {
	if ctx == nil {
		return nil, errors.New("classicgateway: context is nil")
	}
	if !strings.HasPrefix(method, "alipay.trade.saas.") {
		return nil, fmt.Errorf("classicgateway: method %q is outside enterprise payment", method)
	}
	bizContentJSON, err := json.Marshal(bizContent)
	if err != nil {
		return nil, fmt.Errorf("classicgateway: marshal biz_content: %w", err)
	}

	params := map[string]string{
		"app_id":      c.config.AppID,
		"method":      method,
		"format":      "JSON",
		"charset":     "UTF-8",
		"sign_type":   "RSA2",
		"timestamp":   c.now().In(time.FixedZone("UTC+8", 8*60*60)).Format("2006-01-02 15:04:05"),
		"version":     "1.0",
		"biz_content": string(bizContentJSON),
	}
	if c.config.SecurityMode == SecurityModeCertificate {
		params["app_cert_sn"] = c.config.AppCertSN
		params["alipay_root_cert_sn"] = c.config.AlipayRootCertSN
	}

	signature, err := c.signer.Sign([]byte(Canonicalize(params)))
	if err != nil {
		return nil, err
	}
	query := make(url.Values, len(params))
	for key, value := range params {
		if key != "biz_content" {
			query.Set(key, value)
		}
	}
	query.Set("sign", signature)

	form := url.Values{"biz_content": []string{params["biz_content"]}}
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		c.config.GatewayURL+"?"+query.Encode(),
		strings.NewReader(form.Encode()),
	)
	if err != nil {
		return nil, fmt.Errorf("classicgateway: create HTTP request: %w", err)
	}
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8")
	request.Header.Set("Accept", "application/json")

	httpResponse, err := c.httpClient.Do(request)
	if err != nil {
		return nil, fmt.Errorf("classicgateway: execute HTTP request: %w", err)
	}
	defer httpResponse.Body.Close()

	body, err := readLimited(httpResponse.Body, c.config.ResponseLimit)
	if err != nil {
		return nil, err
	}
	if httpResponse.StatusCode < 200 || httpResponse.StatusCode >= 300 {
		return nil, &HTTPStatusError{StatusCode: httpResponse.StatusCode}
	}
	response, err := parseAndVerifyResponse(method, body, c.verifier)
	if err != nil {
		return nil, err
	}
	response.TraceID = httpResponse.Header.Get("trace_id")
	return response, nil
}

func readLimited(reader io.Reader, limit int64) ([]byte, error) {
	body, err := io.ReadAll(io.LimitReader(reader, limit+1))
	if err != nil {
		return nil, fmt.Errorf("classicgateway: read response: %w", err)
	}
	if int64(len(body)) > limit {
		return nil, fmt.Errorf("classicgateway: response exceeds %d bytes", limit)
	}
	return body, nil
}

func parseAndVerifyResponse(method string, body []byte, verifier ResponseVerifier) (*Response, error) {
	values, err := decodeTopLevelRaw(body)
	if err != nil {
		return nil, err
	}
	methodRoot := strings.ReplaceAll(method, ".", "_") + "_response"
	methodPayload, hasMethodPayload := values[methodRoot]
	errorPayload, hasErrorPayload := values["error_response"]
	if hasMethodPayload == hasErrorPayload {
		return nil, errors.New("classicgateway: response must contain exactly one method response or error_response")
	}
	root := methodRoot
	payload := methodPayload
	if hasErrorPayload {
		root = "error_response"
		payload = errorPayload
	}

	signatureRaw, ok := values["sign"]
	if !ok {
		return nil, errors.New("classicgateway: response is missing sign")
	}
	var signature string
	if err := json.Unmarshal(signatureRaw, &signature); err != nil || signature == "" {
		return nil, errors.New("classicgateway: response sign must be a non-empty string")
	}
	var alipayCertSN string
	if raw, ok := values["alipay_cert_sn"]; ok {
		if err := json.Unmarshal(raw, &alipayCertSN); err != nil {
			return nil, errors.New("classicgateway: alipay_cert_sn must be a string")
		}
	}
	if err := verifier.Verify(payload, signature, alipayCertSN); err != nil {
		return nil, err
	}

	return &Response{
		Root:    root,
		Payload: append(json.RawMessage(nil), payload...),
	}, nil
}

func decodeTopLevelRaw(body []byte) (map[string]json.RawMessage, error) {
	decoder := json.NewDecoder(bytes.NewReader(body))
	start, err := decoder.Token()
	if err != nil {
		return nil, fmt.Errorf("classicgateway: decode response JSON: %w", err)
	}
	if delimiter, ok := start.(json.Delim); !ok || delimiter != '{' {
		return nil, errors.New("classicgateway: response JSON must be an object")
	}

	values := make(map[string]json.RawMessage)
	for decoder.More() {
		token, err := decoder.Token()
		if err != nil {
			return nil, fmt.Errorf("classicgateway: decode response key: %w", err)
		}
		key, ok := token.(string)
		if !ok {
			return nil, errors.New("classicgateway: response key must be a string")
		}
		if _, duplicate := values[key]; duplicate {
			return nil, fmt.Errorf("classicgateway: duplicate top-level response key %q", key)
		}
		var raw json.RawMessage
		if err := decoder.Decode(&raw); err != nil {
			return nil, fmt.Errorf("classicgateway: decode response field %q: %w", key, err)
		}
		values[key] = raw
	}
	if _, err := decoder.Token(); err != nil {
		return nil, fmt.Errorf("classicgateway: close response JSON object: %w", err)
	}
	if token, err := decoder.Token(); err != io.EOF {
		if err != nil {
			return nil, fmt.Errorf("classicgateway: decode trailing response data: %w", err)
		}
		return nil, fmt.Errorf("classicgateway: unexpected trailing response token %v", token)
	}
	return values, nil
}
