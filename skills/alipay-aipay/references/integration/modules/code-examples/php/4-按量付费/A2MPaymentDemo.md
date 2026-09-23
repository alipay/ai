# AI 按量付费完整接入示例 - PHP

以下代码展示严格验付和幂等履约的完整控制流。生成项目代码时，请按当前项目结构拆分并绑定真实持久化实现。

```php
<?php
/**
 * A2M 智能收产品接入示例 - PHP 版本
 *
 * 本示例展示 A2M 核心协议、严格验付和幂等履约流程。
 * 必须通过 configureOrderRepository 绑定项目真实持久化实现；
 * 端口未绑定时明确失败，不使用内存订单、固定资源或验付字段缺失兜底。
 * 订单快照将支付状态映射为 PENDING_PAYMENT/PAID，
 * 将履约状态映射为 UNFULFILLED/PENDING_CONFIRM/FULFILLED。
 * 
 * 本文件演示 A2M 核心协议调用流程：
 * 1. 返回 402 Payment-Needed Header
 * 2. 验证 Payment-Proof 支付凭证
 * 3. 发送履约回执确认
 * 4. 返回资源内容
 * 
 * 依赖安装：
 * composer require alipaysdk/openapi
 */

define('RESOURCE_CONFIG', [
    'path' => '/demo/a2m/resource',
    'goodsName' => 'AI 生成内容服务'
]);

$ORDER_REPOSITORY = null;

function configureOrderRepository($repository) {
    $requiredMethods = ['createPending', 'findByOutTradeNo', 'prepareFulfillment', 'markFulfilled'];
    foreach ($requiredMethods as $method) {
        if (!is_object($repository) || !is_callable([$repository, $method])) {
            throw new RuntimeException('orderRepository 必须实现 ' . implode(', ', $requiredMethods));
        }
    }
    $GLOBALS['ORDER_REPOSITORY'] = $repository;
}

function requireOrderRepository() {
    $repository = $GLOBALS['ORDER_REPOSITORY'] ?? null;
    if ($repository === null) {
        throw new RuntimeException('尚未绑定项目真实 orderRepository，禁止回退到内存订单');
    }
    return $repository;
}

// ==================== 配置信息（实际使用时请从配置中心读取）====================

/**
 * 返回第一个非空配置值。
 */
function firstNonBlank(...$values) {
    foreach ($values as $value) {
        if ($value !== false && $value !== null && $value !== '') {
            return (string)$value;
        }
    }
    return '';
}

/**
 * 只从已确认的项目根目录读取 Skill 快速沙箱配置，不依赖进程启动目录。
 */
function loadSandboxConfig() {
    $projectRoot = getenv('ALIPAY_AIPAY_PROJECT_ROOT');
    if ($projectRoot === false || $projectRoot === '') {
        return [];
    }
    $canonicalRoot = realpath($projectRoot);
    if ($canonicalRoot === false || !is_dir($canonicalRoot)) {
        throw new RuntimeException('ALIPAY_AIPAY_PROJECT_ROOT 必须是已确认的项目根目录绝对路径');
    }
    $path = $canonicalRoot . '/.alipay-sandbox.json';
    if (!is_file($path)) {
        return [];
    }
    $config = json_decode((string)file_get_contents($path), true);
    if (!is_array($config)) {
        throw new RuntimeException('.alipay-sandbox.json 不是合法 JSON');
    }
    return $config;
}

/**
 * 加载支付宝配置。
 *
 * Unix/macOS/Linux 快速沙箱生成的真实商家 PID 位于 .alipay-sandbox.json 的 appIds[0].pid。
 * 生产环境请通过环境变量或配置中心显式设置同一生产应用的 appId、应用私钥、支付宝公钥、
 * 商户 PID 和服务市场真实 serviceId。
 */
function loadAlipayConfig() {
    $sandbox = loadSandboxConfig();
    $sandboxApp = [];
    if (isset($sandbox['appIds']) && is_array($sandbox['appIds']) && isset($sandbox['appIds'][0]) && is_array($sandbox['appIds'][0])) {
        $sandboxApp = $sandbox['appIds'][0];
    }

    $privateKey = firstNonBlank(
        getenv('ALIPAY_AIPAY_PRIVATE_KEY'),
        $sandboxApp['appPrivatePkcsKey'] ?? null,
        $sandbox['appPrivatePkcsKey'] ?? null
    );

    $gateway = firstNonBlank(
        getenv('ALIPAY_AIPAY_GATEWAY'),
        getenv('ALIPAY_GATEWAY'),
        $sandbox['gateway'] ?? null,
        'https://openapi-sandbox.dl.alipaydev.com/gateway.do'
    );
    $serviceId = firstNonBlank(
        getenv('ALIPAY_AIPAY_SERVICE_ID'),
        $gateway === 'https://openapi-sandbox.dl.alipaydev.com/gateway.do' ? 'api_mock_service_id' : null
    );

    $config = [
        'appId' => firstNonBlank(
            getenv('ALIPAY_AIPAY_APP_ID'),
            $sandboxApp['appId'] ?? null,
            $sandbox['appId'] ?? null
        ),
        'privateKey' => $privateKey, // PHP 使用 PKCS#1 格式应用私钥
        'alipayPublicKey' => firstNonBlank(
            getenv('ALIPAY_AIPAY_PUBLIC_KEY'),
            $sandboxApp['alipayPublicKey'] ?? null,
            $sandbox['alipayPublicKey'] ?? null
        ),
        // 默认用于本 Skill 的快速沙箱联调；生产部署时设置 ALIPAY_AIPAY_GATEWAY=https://openapi.alipay.com/gateway.do
        'gateway' => $gateway,
        'sellerId' => firstNonBlank(
            getenv('ALIPAY_AIPAY_SELLER_ID'),
            $sandboxApp['pid'] ?? null,
            $sandboxApp['uid'] ?? null,
            $sandbox['sellerId'] ?? null
        ), // 商户 PID（2088 格式）
        'sellerName' => firstNonBlank(getenv('ALIPAY_AIPAY_SELLER_NAME'), '测试商户'),
        'serviceId' => $serviceId, // 仅固定沙箱网关可默认 api_mock_service_id；上线前替换为真实 serviceId
        'merchantPrivateKey' => $privateKey // 用于商家账单签名
    ];

    foreach (['appId', 'privateKey', 'alipayPublicKey', 'sellerId', 'serviceId'] as $requiredField) {
        if ($config[$requiredField] === '') {
            throw new RuntimeException("支付宝配置缺失：{$requiredField}");
        }
    }
    return $config;
}

define('ALIPAY_CONFIG', loadAlipayConfig());

/**
 * 初始化 SDK
 */
function initAlipayClient() {
    loadAopSdk();

    if (!class_exists('\AopClient')) {
        throw new RuntimeException('未找到支付宝 PHP SDK，请先执行：composer require alipaysdk/openapi');
    }

    $client = new \AopClient();
    $client->gatewayUrl = ALIPAY_CONFIG['gateway'];
    $client->appId = ALIPAY_CONFIG['appId'];
    $client->rsaPrivateKey = ALIPAY_CONFIG['privateKey'];
    $client->alipayrsaPublicKey = ALIPAY_CONFIG['alipayPublicKey'];
    $client->format = 'json';
    $client->postCharset = 'UTF-8';
    $client->signType = 'RSA2';

    return $client;
}

/**
 * 加载官方 alipaysdk/openapi v2 AOP 客户端。
 */
function loadAopSdk() {
    $configuredRoot = getenv('ALIPAY_AIPAY_PROJECT_ROOT');
    $candidateRoots = $configuredRoot ? [$configuredRoot] : [__DIR__, dirname(__DIR__)];

    $visited = [];
    foreach ($candidateRoots as $root) {
        if (isset($visited[$root])) {
            continue;
        }
        $visited[$root] = true;

        $autoload = $root . '/vendor/autoload.php';
        if (is_file($autoload)) {
            require_once $autoload;
        }

        $aopClient = $root . '/vendor/alipaysdk/openapi/v2/aop/AopClient.php';
        if (is_file($aopClient)) {
            require_once $aopClient;
        }
    }
}

/**
 * 格式化支付宝时间戳：yyyy-MM-dd HH:mm:ss
 */
function formatAlipayTimestamp($timestamp = null) {
    if ($timestamp === null) {
        $timestamp = time();
    }
    return date('Y-m-d H:i:s', $timestamp);
}

/**
 * 生成商家签名（seller_signature）
 */
function generateSellerSignature($params, $privateKey) {
    // 1. 按 key 字典序排序
    ksort($params);
    
    // 2. 拼接签名内容
    $signContent = [];
    foreach ($params as $key => $value) {
        if ($value !== null && $value !== '') {
            $signContent[] = "{$key}={$value}";
        }
    }
    $signString = implode('&', $signContent);
    
    // 3. OpenSSL 需要 PEM；仅为本次签名临时包装裸 PKCS#1 Base64，不修改原始配置。
    $privateKeyPem = "-----BEGIN RSA PRIVATE KEY-----\n"
        . chunk_split($privateKey, 64, "\n")
        . "-----END RSA PRIVATE KEY-----";
    $privateKeyResource = openssl_pkey_get_private($privateKeyPem);
    if ($privateKeyResource === false) {
        throw new RuntimeException('无法解析 PKCS#1 应用私钥');
    }
    if (!openssl_sign($signString, $signature, $privateKeyResource, OPENSSL_ALGO_SHA256)) {
        throw new RuntimeException('seller_signature 生成失败');
    }
    
    return base64_encode($signature);
}

/**
 * Base64URL 编码
 */
function base64UrlEncode($data) {
    return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
}

/**
 * Base64URL 解码
 */
function base64UrlDecode($data) {
    $padding = strlen($data) % 4;
    if ($padding) {
        $data .= str_repeat('=', 4 - $padding);
    }
    return base64_decode(strtr($data, '-_', '+/'));
}

function normalizeAmount($value) {
    $text = trim((string)$value);
    if (!preg_match('/^\d+(?:\.\d{1,2})?$/', $text)) {
        return null;
    }
    [$integer, $fraction] = array_pad(explode('.', $text, 2), 2, '');
    $integer = ltrim($integer, '0');
    return ($integer === '' ? '0' : $integer) . '.' . str_pad($fraction, 2, '0');
}

function amountsEqual($left, $right) {
    $leftAmount = normalizeAmount($left);
    $rightAmount = normalizeAmount($right);
    return $leftAmount !== null && $rightAmount !== null && $leftAmount === $rightAmount;
}

function isExactSandboxMode() {
    return ALIPAY_CONFIG['gateway'] === 'https://openapi-sandbox.dl.alipaydev.com/gateway.do'
        && ALIPAY_CONFIG['serviceId'] === 'api_mock_service_id';
}

/**
 * 发送 JSON 响应
 */
function jsonResponse($data, $statusCode = 200, $headers = []) {
    http_response_code($statusCode);
    header('Content-Type: application/json; charset=utf-8');
    
    foreach ($headers as $key => $value) {
        header("{$key}: {$value}");
    }
    
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

// ==================== 智能收产品接入示例接口 ====================

/**
 * 智能收产品统一接口
 * 
 * 核心协议流程演示：
 * 1. 不带 Payment-Proof Header：返回 HTTP 402 + Payment-Needed Header
 * 2. 带 Payment-Proof Header：验证支付 → 自动履约 → 返回资源
 */
function handleResourceRequest() {
    // 获取 Payment-Proof Header
    $paymentProof = isset($_SERVER['HTTP_PAYMENT_PROOF']) ? $_SERVER['HTTP_PAYMENT_PROOF'] : null;
    
    // 场景 1：用户未支付，返回 402 + Payment-Needed Header
    if (empty($paymentProof) || trim($paymentProof) === '') {
        createPaymentRequiredResponse();
        return;
    }
    
    // 场景 2：用户已支付，验证 Payment-Proof 并返回资源
    verifyPaymentAndDeliverResource($paymentProof);
}

/**
 * 创建 402 支付请求响应
 */
function createPaymentRequiredResponse() {
    try {
        // 1. 构造订单信息
        $outTradeNo = 'ORDER_' . time() . mt_rand(1000, 9999);
        $amount = '0.01'; // 单位：元
        $currency = 'CNY';
        $resourceId = RESOURCE_CONFIG['path'];
        $goodsName = RESOURCE_CONFIG['goodsName'];
        
        // 2. 计算支付截止时间（30 分钟后）
        $payBefore = date('c', time() + 30 * 60); // ISO 8601 格式
        
        // 3. 生成商家签名
        $sellerSignature = generateSellerSignature([
            'amount' => $amount,
            'currency' => $currency,
            'goods_name' => $goodsName,
            'out_trade_no' => $outTradeNo,
            'pay_before' => $payBefore,
            'resource_id' => $resourceId,
            'seller_id' => ALIPAY_CONFIG['sellerId'],
            'service_id' => ALIPAY_CONFIG['serviceId']
        ], ALIPAY_CONFIG['merchantPrivateKey']);
        
        requireOrderRepository()->createPending([
            'outTradeNo' => $outTradeNo,
            'amount' => normalizeAmount($amount),
            'currency' => $currency,
            'resourceId' => $resourceId,
            'goodsName' => $goodsName,
            'payBefore' => $payBefore,
            'orderStatus' => 'PENDING_PAYMENT',
            'fulfillStatus' => 'UNFULFILLED'
        ]);

        // 4. 持久化成功后构造 Payment-Needed Header 内容
        $paymentNeeded = [
            'protocol' => [
                'out_trade_no' => $outTradeNo,
                'amount' => $amount,
                'currency' => $currency,
                'resource_id' => $resourceId,
                'pay_before' => $payBefore,
                'seller_signature' => $sellerSignature,
                'seller_sign_type' => 'RSA2',
                'seller_unique_id' => ALIPAY_CONFIG['sellerId']
            ],
            'method' => [
                'seller_name' => ALIPAY_CONFIG['sellerName'],
                'seller_id' => ALIPAY_CONFIG['sellerId'],
                'seller_app_id' => ALIPAY_CONFIG['appId'],
                'goods_name' => $goodsName,
                'seller_unique_id_key' => 'seller_id',
                'service_id' => ALIPAY_CONFIG['serviceId']
            ]
        ];
        
        // 5. Base64URL 编码
        $paymentNeededEncoded = base64UrlEncode(json_encode($paymentNeeded, JSON_UNESCAPED_UNICODE));
        
        // 6. 构造 402 响应
        $response = [
            'code' => 'Payment-Needed',
            'message' => '需要支付',
            'out_trade_no' => $outTradeNo,
            'amount' => $amount,
            'currency' => $currency,
            'goods_name' => $goodsName
        ];
        
        error_log("创建支付订单成功：outTradeNo={$outTradeNo}, amount={$amount}");
        
        jsonResponse($response, 402, ['Payment-Needed' => $paymentNeededEncoded]);
        
    } catch (Exception $e) {
        error_log('创建订单失败：' . $e->getMessage());
        jsonResponse([
            'code' => 'CREATE_ORDER_ERROR',
            'message' => '创建订单失败：' . $e->getMessage()
        ], 500);
    }
}

/**
 * 验证支付凭证并交付资源
 */
function verifyPaymentAndDeliverResource($paymentProof) {
    try {
        // 1. 从 Payment-Proof 中解析订单信息
        $decodedProof = base64UrlDecode($paymentProof);
        $proofJson = json_decode($decodedProof, true);
        
        if (json_last_error() !== JSON_ERROR_NONE) {
            error_log('Payment-Proof 解析失败：' . json_last_error_msg());
            createPaymentRequiredResponse();
        }
        
        // 从 protocol 层获取 payment_proof 和 trade_no
        $paymentProofValue = null;
        $tradeNo = null;
        $clientSession = null;
        
        if (isset($proofJson['protocol'])) {
            $paymentProofValue = $proofJson['protocol']['payment_proof'] ?? null;
            $tradeNo = $proofJson['protocol']['trade_no'] ?? null;
        }
        
        // 从 method 层获取 client_session
        if (isset($proofJson['method'])) {
            $clientSession = $proofJson['method']['client_session'] ?? null;
        }
        
        // 校验必要字段
        if (empty($paymentProofValue)) {
            createPaymentRequiredResponse();
        }
        
        if (empty($tradeNo)) {
            createPaymentRequiredResponse();
        }
        
        // 2. 调用支付宝 API 验证支付凭证
        $alipayClient = initAlipayClient();
        $request = new \AlipayAipayAgentPaymentVerifyRequest();
        
        $model = [
            'payment_proof' => $paymentProofValue,
            'trade_no' => $tradeNo
        ];
        if ($clientSession !== null && trim((string)$clientSession) !== '') {
            $model['client_session'] = $clientSession;
        }
        
        $request->setBizContent(json_encode($model, JSON_UNESCAPED_UNICODE));
        $responseResult = $alipayClient->execute($request);
        $responseApiName = str_replace('.', '_', $request->getApiMethodName()) . '_response';
        $verifyResponse = $responseResult->$responseApiName ?? (object)[];
        
        // 3. 验证失败，返回错误
        if (empty($verifyResponse->code) || $verifyResponse->code !== '10000') {
            error_log('支付凭证验证失败：' . ($verifyResponse->sub_msg ?? 'Unknown error'));
            createPaymentRequiredResponse();
        }
        
        // 4. 验证成功，获取订单信息
        $returnedTradeNo = $verifyResponse->trade_no ?? $verifyResponse->tradeNo ?? '';
        $verifyOutTradeNo = $verifyResponse->out_trade_no ?? $verifyResponse->outTradeNo ?? '';
        $returnedAmount = $verifyResponse->amount ?? '';
        $returnedResourceId = $verifyResponse->resource_id ?? $verifyResponse->resourceId ?? '';
        $active = $verifyResponse->active ?? null;

        $repository = requireOrderRepository();
        $order = $verifyOutTradeNo !== '' ? $repository->findByOutTradeNo($verifyOutTradeNo) : null;
        $sandboxMode = isExactSandboxMode();
        $verifyTradeNo = $returnedTradeNo !== '' ? $returnedTradeNo : ($sandboxMode ? $tradeNo : '');
        $verifyAmount = $returnedAmount !== '' ? $returnedAmount : ($sandboxMode && $order ? $order['amount'] : '');
        $resourceIdVerified = $returnedResourceId !== '' ? $returnedResourceId : ($sandboxMode && $order ? $order['resourceId'] : '');
        
        error_log("支付凭证验证成功：tradeNo={$verifyTradeNo}, outTradeNo={$verifyOutTradeNo}");
        
        // 5. 校验凭证有效性（active=true 表示凭证有效）
        $isActive = $active === true || $active === 'true' || $active === '1' || $active === 1;
        if (!$isActive || $verifyTradeNo === '' || $verifyTradeNo !== $tradeNo || $verifyOutTradeNo === '' || $resourceIdVerified === '') {
            error_log("支付凭证无效或已过期：outTradeNo={$verifyOutTradeNo}");
            createPaymentRequiredResponse();
        }

        $amountMatches = $order && amountsEqual($order['amount'], $verifyAmount);
        $resourceMatches = $order
            && $order['resourceId'] === $resourceIdVerified
            && $resourceIdVerified === RESOURCE_CONFIG['path'];
        $fulfillmentInProgress = $order
            && in_array($order['fulfillStatus'], ['PENDING_CONFIRM', 'FULFILLED'], true);
        $orderUsable = $order
            && $order['currency'] === 'CNY'
            && in_array($order['orderStatus'], ['PENDING_PAYMENT', 'PAID'], true)
            && in_array($order['fulfillStatus'], ['UNFULFILLED', 'PENDING_CONFIRM', 'FULFILLED'], true)
            && ($fulfillmentInProgress || strtotime($order['payBefore']) > time());
        if (!$amountMatches || !$resourceMatches || !$orderUsable) {
            createPaymentRequiredResponse();
        }

        $fulfillment = $repository->prepareFulfillment([
            'outTradeNo' => $verifyOutTradeNo,
            'tradeNo' => $verifyTradeNo,
            'expectedAmount' => normalizeAmount($verifyAmount),
            'expectedResourceId' => $resourceIdVerified,
            'createResource' => function () use ($resourceIdVerified) {
                return generateServiceResource($resourceIdVerified);
            }
        ]);
        if (!is_array($fulfillment)
            || !in_array($fulfillment['state'] ?? '', ['PENDING_CONFIRM', 'FULFILLED'], true)
            || empty($fulfillment['serviceResult'])) {
            throw new RuntimeException('orderRepository::prepareFulfillment 未返回已持久化的履约结果');
        }
        $serviceResult = $fulfillment['serviceResult'];
        if ($fulfillment['state'] === 'FULFILLED') {
            sendSuccessfulResource($verifyTradeNo, $verifyOutTradeNo, $resourceIdVerified, $serviceResult, true);
        }

        $fulfillmentTradeNo = $verifyTradeNo;
        error_log("资源已生成，准备发送履约确认：outTradeNo={$verifyOutTradeNo}, tradeNo={$fulfillmentTradeNo}");

        // 12. 发送履约确认到支付宝，确认成功后才返回成功交付
        if (!sendFulfillmentConfirm($fulfillmentTradeNo)) {
            jsonResponse([
                'code' => 'FULFILLMENT_CONFIRM_FAILED',
                'message' => '资源已生成但履约确认失败，请稍后使用同一 Payment-Proof 重试'
            ], 502);
        }

        $repository->markFulfilled($verifyOutTradeNo, $fulfillmentTradeNo);

        error_log("履约确认成功：outTradeNo={$verifyOutTradeNo}, tradeNo={$fulfillmentTradeNo}");
        
        sendSuccessfulResource($fulfillmentTradeNo, $verifyOutTradeNo, $resourceIdVerified, $serviceResult, false);
        
    } catch (Exception $e) {
        error_log('支付凭证验证异常：' . $e->getMessage());
        jsonResponse([
            'code' => 'VERIFY_FAILED',
            'message' => '支付凭证验证失败：' . $e->getMessage()
        ], 500);
    }
}

function sendSuccessfulResource($tradeNo, $outTradeNo, $resourceId, $serviceResult, $alreadyFulfilled) {
    $paymentValidation = base64UrlEncode(json_encode([
        'trade_no' => $tradeNo,
        'out_trade_no' => $outTradeNo,
        'validated' => true,
        'resource_id' => $resourceId
    ], JSON_UNESCAPED_UNICODE));
    jsonResponse([
        'resource_id' => $resourceId,
        'content' => $serviceResult,
        'trade_no' => $tradeNo,
        'out_trade_no' => $outTradeNo,
        'already_fulfilled' => $alreadyFulfilled,
        'fulfillment_confirmed' => true
    ], 200, ['Payment-Validation' => $paymentValidation]);
}

/**
 * 生成服务资源内容
 */
function generateServiceResource($resourceId) {
    return json_encode([
        'status' => 'success',
        'service_type' => 'AI_CONTENT_GENERATION',
        'resource_id' => $resourceId,
        'content' => '这是 AI 生成的内容示例，可根据实际业务替换为任意数字服务内容',
        'generated_at' => date('c')
    ], JSON_UNESCAPED_UNICODE);
}

/**
 * 发送履约确认
 */
function sendFulfillmentConfirm($tradeNo) {
    if (empty($tradeNo)) {
        error_log('履约确认失败：tradeNo 为空');
        return false;
    }

    try {
        error_log("开始发送履约确认：tradeNo={$tradeNo}");
        
        $alipayClient = initAlipayClient();
        $request = new \AlipayAipayAgentFulfillmentConfirmRequest();
        
        $request->setBizContent(json_encode([
            'trade_no' => $tradeNo
        ], JSON_UNESCAPED_UNICODE));
        
        $responseResult = $alipayClient->execute($request);
        $responseApiName = str_replace('.', '_', $request->getApiMethodName()) . '_response';
        $response = $responseResult->$responseApiName ?? (object)[];
        
        if (!empty($response->code) && $response->code === '10000') {
            error_log("履约确认成功：tradeNo={$tradeNo}");
            return true;
        } else {
            error_log("履约确认失败：tradeNo={$tradeNo}, errorCode=" . 
                ($response->sub_code ?? 'Unknown') . ", errorMsg=" . 
                ($response->sub_msg ?? 'Unknown'));
            return false;
        }
        
    } catch (Exception $e) {
        error_log("履约确认异常：tradeNo={$tradeNo}, error=" . $e->getMessage());
        return false;
    }
}

// 官方 alipaysdk/openapi 当前未内置以下两个 A2M Request 类，示例在本地补齐 AOP 客户端会调用的方法。
if (!class_exists('AlipayAipayAgentPaymentVerifyRequest')) {
    final class AlipayAipayAgentPaymentVerifyRequest
    {
        private $bizContent = '';
        private $apiParas = [];
        private $apiVersion = '1.0';
        private $needEncrypt = false;
        private $terminalType = null;
        private $terminalInfo = null;
        private $prodCode = null;
        private $notifyUrl = null;
        private $returnUrl = null;

        public function setBizContent($bizContent) {
            $this->bizContent = $bizContent;
            $this->apiParas['biz_content'] = $bizContent;
        }

        public function getBizContent() {
            return $this->bizContent;
        }

        public function getApiMethodName() {
            return 'alipay.aipay.agent.payment.verify';
        }

        public function getApiParas() {
            return $this->apiParas;
        }

        public function getApiVersion() {
            return $this->apiVersion;
        }

        public function setApiVersion($apiVersion) {
            $this->apiVersion = $apiVersion;
        }

        public function getNeedEncrypt() {
            return $this->needEncrypt;
        }

        public function setNeedEncrypt($needEncrypt) {
            $this->needEncrypt = $needEncrypt;
        }

        public function getTerminalType() {
            return $this->terminalType;
        }

        public function setTerminalType($terminalType) {
            $this->terminalType = $terminalType;
        }

        public function getTerminalInfo() {
            return $this->terminalInfo;
        }

        public function setTerminalInfo($terminalInfo) {
            $this->terminalInfo = $terminalInfo;
        }

        public function getProdCode() {
            return $this->prodCode;
        }

        public function setProdCode($prodCode) {
            $this->prodCode = $prodCode;
        }

        public function getNotifyUrl() {
            return $this->notifyUrl;
        }

        public function setNotifyUrl($notifyUrl) {
            $this->notifyUrl = $notifyUrl;
        }

        public function getReturnUrl() {
            return $this->returnUrl;
        }

        public function setReturnUrl($returnUrl) {
            $this->returnUrl = $returnUrl;
        }
    }
}

if (!class_exists('AlipayAipayAgentFulfillmentConfirmRequest')) {
    final class AlipayAipayAgentFulfillmentConfirmRequest
    {
        private $bizContent = '';
        private $apiParas = [];
        private $apiVersion = '1.0';
        private $needEncrypt = false;
        private $terminalType = null;
        private $terminalInfo = null;
        private $prodCode = null;
        private $notifyUrl = null;
        private $returnUrl = null;

        public function setBizContent($bizContent) {
            $this->bizContent = $bizContent;
            $this->apiParas['biz_content'] = $bizContent;
        }

        public function getBizContent() {
            return $this->bizContent;
        }

        public function getApiMethodName() {
            return 'alipay.aipay.agent.fulfillment.confirm';
        }

        public function getApiParas() {
            return $this->apiParas;
        }

        public function getApiVersion() {
            return $this->apiVersion;
        }

        public function setApiVersion($apiVersion) {
            $this->apiVersion = $apiVersion;
        }

        public function getNeedEncrypt() {
            return $this->needEncrypt;
        }

        public function setNeedEncrypt($needEncrypt) {
            $this->needEncrypt = $needEncrypt;
        }

        public function getTerminalType() {
            return $this->terminalType;
        }

        public function setTerminalType($terminalType) {
            $this->terminalType = $terminalType;
        }

        public function getTerminalInfo() {
            return $this->terminalInfo;
        }

        public function setTerminalInfo($terminalInfo) {
            $this->terminalInfo = $terminalInfo;
        }

        public function getProdCode() {
            return $this->prodCode;
        }

        public function setProdCode($prodCode) {
            $this->prodCode = $prodCode;
        }

        public function getNotifyUrl() {
            return $this->notifyUrl;
        }

        public function setNotifyUrl($notifyUrl) {
            $this->notifyUrl = $notifyUrl;
        }

        public function getReturnUrl() {
            return $this->returnUrl;
        }

        public function setReturnUrl($returnUrl) {
            $this->returnUrl = $returnUrl;
        }
    }
}

// ==================== 路由处理 ====================

// 简单路由
$requestUri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if ($requestUri === RESOURCE_CONFIG['path'] && $_SERVER['REQUEST_METHOD'] === 'GET') {
    handleResourceRequest();
} else {
    http_response_code(404);
    echo json_encode(['code' => 'NOT_FOUND', 'message' => '接口不存在'], JSON_UNESCAPED_UNICODE);
}
```
