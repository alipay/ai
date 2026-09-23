# AI 按量付费完整接入示例 - C#

以下代码展示严格验付和幂等履约的完整控制流。生成项目代码时，请按当前项目结构拆分并绑定真实持久化实现。

```csharp
/*
 * A2M 智能收产品接入示例 - C# 版本
 *
 * 本示例展示 A2M 核心协议、严格验付和幂等履约流程。
 * 必须通过 ConfigureOrderRepository 绑定项目真实持久化实现；端口未绑定时明确失败，
 * 不使用内存订单、固定资源或验付字段缺失兜底。
 * 
 * 本文件演示 A2M 核心协议调用流程：
 * 1. 返回 402 Payment-Needed Header
 * 2. 验证 Payment-Proof 支付凭证
 * 3. 发送履约回执确认
 * 4. 返回资源内容
 * 
 * 依赖安装：
 * dotnet add package AlipaySDKNet.Standard
 */

using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Aop.Api;
using Aop.Api.Request;
using Aop.Api.Response;
using Aop.Api.Domain;

namespace A2MPaymentDemo
{
    public interface IOrderRepository
    {
        // OrderSnapshot 映射 PENDING_PAYMENT/PAID 与 UNFULFILLED/PENDING_CONFIRM/FULFILLED。
        Task CreatePendingAsync(OrderSnapshot order);
        Task<OrderSnapshot> FindByOutTradeNoAsync(string outTradeNo);
        Task<FulfillmentPreparation> PrepareFulfillmentAsync(FulfillmentRequest request);
        Task MarkFulfilledAsync(string outTradeNo, string tradeNo);
    }

    public sealed class OrderSnapshot
    {
        public string OutTradeNo { get; init; }
        public string Amount { get; init; }
        public string Currency { get; init; }
        public string ResourceId { get; init; }
        public string GoodsName { get; init; }
        public string PayBefore { get; init; }
        public string OrderStatus { get; init; }
        public string FulfillStatus { get; init; }
    }

    public sealed class FulfillmentRequest
    {
        public string OutTradeNo { get; init; }
        public string TradeNo { get; init; }
        public string ExpectedAmount { get; init; }
        public string ExpectedResourceId { get; init; }
        public Func<string> CreateResource { get; init; }
    }

    public sealed class FulfillmentPreparation
    {
        public string State { get; init; }
        public string ServiceResult { get; init; }
    }

    class Program
    {
        // ==================== 配置信息（实际使用时请从配置中心读取）====================
        private static readonly AlipayConfig AlipayConfig = new AlipayConfig
        {
            // 默认用于本 Skill 的快速沙箱联调；生产部署时设置 ALIPAY_GATEWAY=https://openapi.alipay.com/gateway.do
            ServerUrl = Environment.GetEnvironmentVariable("ALIPAY_GATEWAY")
                ?? "https://openapi-sandbox.dl.alipaydev.com/gateway.do",
            AppId = "<APP_ID>",
            PrivateKey = "<APP_PRIVATE_KEY>", // 请填写您的应用私钥（PKCS#1 格式）
            AlipayPublicKey = "<ALIPAY_PUBLIC_KEY>", // 请填写您的支付宝公钥
            Format = "json",
            Charset = "UTF-8",
            SignType = "RSA2"
        };

        private static readonly string SellerId = "<SELLER_ID_2088>"; // 商户 ID（2088 格式）
        private static readonly string ServiceId = Environment.GetEnvironmentVariable("ALIPAY_SERVICE_ID")
            ?? "api_mock_service_id"; // 仅用于沙箱联调；上线前替换为服务市场真实 serviceId
        private static readonly string MerchantPrivateKey = "<APP_PRIVATE_KEY>"; // 请填写您的应用私钥（用于商家签名）
        
        private const string ResourcePath = "/demo/a2m/resource";
        private const string GoodsName = "AI 生成内容服务";
        private const string SandboxGateway = "https://openapi-sandbox.dl.alipaydev.com/gateway.do";
        private static IOrderRepository OrderRepository;

        // 初始化支付宝客户端
        private static readonly IAopClient AlipayClient = new DefaultAopClient(AlipayConfig);

        /// <summary>
        /// 在项目组合根绑定真实数据库实现。实现必须使用事务和唯一约束。
        /// </summary>
        public static void ConfigureOrderRepository(IOrderRepository repository)
        {
            OrderRepository = repository ?? throw new ArgumentNullException(nameof(repository));
        }

        private static IOrderRepository RequireOrderRepository()
        {
            return OrderRepository
                ?? throw new InvalidOperationException("尚未绑定项目真实 IOrderRepository，禁止回退到内存订单");
        }

        static void Main(string[] args)
        {
            var builder = WebApplication.CreateBuilder(args);
            var app = builder.Build();

            // 路由处理
            app.MapGet(ResourcePath, async (HttpRequest request, HttpResponse response) =>
            {
                // 获取 Payment-Proof Header
                var paymentProof = request.Headers["Payment-Proof"].FirstOrDefault();

                // 场景 1：用户未支付，返回 402 + Payment-Needed Header
                if (string.IsNullOrWhiteSpace(paymentProof))
                {
                    await CreatePaymentRequiredResponse(response);
                    return;
                }

                // 场景 2：用户已支付，验证 Payment-Proof 并返回资源
                await VerifyPaymentAndDeliverResource(response, paymentProof);
            });

            Console.WriteLine($"A2M 按量付费服务已启动：http://localhost:5000{ResourcePath}");
            Console.WriteLine("测试步骤：");
            Console.WriteLine($"1. 无 Payment-Proof Header: curl http://localhost:5000{ResourcePath}");
            Console.WriteLine($"2. 有 Payment-Proof Header: curl -H \"Payment-Proof: <value>\" http://localhost:5000{ResourcePath}");

            app.Run();
        }

        // ==================== 工具方法 ====================

        /// <summary>
        /// 格式化支付宝时间戳：yyyy-MM-dd HH:mm:ss
        /// </summary>
        private static string FormatAlipayTimestamp(DateTime? dateTime = null)
        {
            return (dateTime ?? DateTime.Now).ToString("yyyy-MM-dd HH:mm:ss");
        }

        /// <summary>
        /// Base64URL 编码
        /// </summary>
        private static string Base64UrlEncode(string data)
        {
            var bytes = Encoding.UTF8.GetBytes(data);
            var base64 = Convert.ToBase64String(bytes);
            return base64.Replace('+', '-').Replace('/', '_').TrimEnd('=');
        }

        /// <summary>
        /// Base64URL 解码
        /// </summary>
        private static string Base64UrlDecode(string data)
        {
            // 补充 padding
            var padding = data.Length % 4;
            if (padding != 0)
            {
                data += new string('=', 4 - padding);
            }
            
            var base64 = data.Replace('-', '+').Replace('_', '/');
            var bytes = Convert.FromBase64String(base64);
            return Encoding.UTF8.GetString(bytes);
        }

        /// <summary>
        /// 生成商家签名（seller_signature）
        /// </summary>
        private static string GenerateSellerSignature(Dictionary<string, string> parameters, string privateKey)
        {
            // 1. 按 key 字典序排序
            var sortedKeys = parameters.Keys.OrderBy(k => k).ToList();
            
            // 2. 拼接签名内容
            var signContent = new StringBuilder();
            var first = true;
            foreach (var key in sortedKeys)
            {
                var value = parameters[key];
                if (!string.IsNullOrEmpty(value))
                {
                    if (!first)
                    {
                        signContent.Append("&");
                    }
                    signContent.Append($"{key}={value}");
                    first = false;
                }
            }

            // 3. RSA2 签名
            using (var rsa = RSA.Create())
            {
                rsa.ImportRSAPrivateKey(Convert.FromBase64String(privateKey), out _);
                var signature = rsa.SignData(Encoding.UTF8.GetBytes(signContent.ToString()), HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
                return Convert.ToBase64String(signature);
            }
        }

        // ==================== 智能收产品接入示例接口 ====================

        /// <summary>
        /// 创建 402 支付请求响应
        /// </summary>
        private static async Task CreatePaymentRequiredResponse(HttpResponse response)
        {
            try
            {
                // 1. 构造订单信息
                var outTradeNo = $"ORDER_{DateTimeOffset.Now.ToUnixTimeMilliseconds()}_{Guid.NewGuid():N}"[..40];
                var amount = "0.01";
                var currency = "CNY";
                var resourceId = ResourcePath;
                var goodsName = GoodsName;

                // 2. 计算支付截止时间（30 分钟后）
                var payBefore = DateTimeOffset.Now.AddMinutes(30).ToString("o");

                // 3. 生成商家签名
                var signParams = new Dictionary<string, string>
                {
                    ["amount"] = amount,
                    ["currency"] = currency,
                    ["goods_name"] = goodsName,
                    ["out_trade_no"] = outTradeNo,
                    ["pay_before"] = payBefore,
                    ["resource_id"] = resourceId,
                    ["seller_id"] = SellerId,
                    ["service_id"] = ServiceId
                };

                var sellerSignature = GenerateSellerSignature(signParams, MerchantPrivateKey);

                // 4. 必须在返回 402 前持久化；项目实现负责事务与 outTradeNo 唯一约束。
                await RequireOrderRepository().CreatePendingAsync(new OrderSnapshot
                {
                    OutTradeNo = outTradeNo,
                    Amount = NormalizeAmount(amount),
                    Currency = currency,
                    ResourceId = resourceId,
                    GoodsName = goodsName,
                    PayBefore = payBefore,
                    OrderStatus = "PENDING_PAYMENT",
                    FulfillStatus = "UNFULFILLED"
                });

                // 5. 持久化成功后构造 Payment-Needed Header 内容
                var paymentNeeded = new
                {
                    protocol = new
                    {
                        out_trade_no = outTradeNo,
                        amount = amount,
                        currency = currency,
                        resource_id = resourceId,
                        pay_before = payBefore,
                        seller_signature = sellerSignature,
                        seller_sign_type = "RSA2",
                        seller_unique_id = SellerId
                    },
                    method = new
                    {
                        seller_name = "测试商户",
                        seller_id = SellerId,
                        seller_app_id = AlipayConfig.AppId,
                        goods_name = goodsName,
                        seller_unique_id_key = "seller_id",
                        service_id = ServiceId
                    }
                };

                // 5. Base64URL 编码
                var paymentNeededJson = JsonSerializer.Serialize(paymentNeeded, new JsonSerializerOptions
                {
                    PropertyNamingPolicy = JsonNamingPolicy.CamelCase
                });
                var paymentNeededEncoded = Base64UrlEncode(paymentNeededJson);

                // 6. 构造 402 响应
                var responseBody = new
                {
                    code = "Payment-Needed",
                    message = "需要支付",
                    out_trade_no = outTradeNo,
                    amount = amount,
                    currency = currency,
                    goods_name = goodsName
                };

                Console.WriteLine($"创建支付订单成功：outTradeNo={outTradeNo}, amount={amount}");

                response.StatusCode = 402;
                response.Headers["Payment-Needed"] = paymentNeededEncoded;
                response.ContentType = "application/json; charset=utf-8";
                await response.WriteAsJsonAsync(responseBody);

            }
            catch (Exception ex)
            {
                Console.WriteLine($"创建订单失败：{ex.Message}");
                response.StatusCode = 500;
                response.ContentType = "application/json; charset=utf-8";
                await response.WriteAsJsonAsync(new
                {
                    code = "CREATE_ORDER_ERROR",
                    message = $"创建订单失败：{ex.Message}"
                });
            }
        }

        /// <summary>
        /// 验证支付凭证并交付资源
        /// </summary>
        private static async Task VerifyPaymentAndDeliverResource(HttpResponse response, string paymentProof)
        {
            try
            {
                // 1. 从 Payment-Proof 中解析订单信息
                string paymentProofValue = null;
                string tradeNo = null;
                string clientSession = null;

                try
                {
                    var decodedProof = Base64UrlDecode(paymentProof);
                    using (var proofJson = JsonDocument.Parse(decodedProof))
                    {
                        var root = proofJson.RootElement;
                        
                        if (root.TryGetProperty("protocol", out var protocol))
                        {
                            paymentProofValue = protocol.GetProperty("payment_proof").GetString();
                            tradeNo = protocol.GetProperty("trade_no").GetString();
                        }

                        if (root.TryGetProperty("method", out var method)
                            && method.TryGetProperty("client_session", out var clientSessionValue))
                        {
                            clientSession = clientSessionValue.GetString();
                        }
                    }

                    // 校验必要字段
                    if (string.IsNullOrWhiteSpace(paymentProofValue))
                    {
                        await CreatePaymentRequiredResponse(response);
                        return;
                    }

                    if (string.IsNullOrWhiteSpace(tradeNo))
                    {
                        await CreatePaymentRequiredResponse(response);
                        return;
                    }
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"Payment-Proof 解析失败：{ex.Message}");
                    await CreatePaymentRequiredResponse(response);
                    return;
                }

                // 2. 调用支付宝 API 验证支付凭证
                var request = new AlipayAipayAgentPaymentVerifyRequest();
                var verifyBizContent = new Dictionary<string, string>
                {
                    ["payment_proof"] = paymentProofValue,
                    ["trade_no"] = tradeNo
                };
                if (!string.IsNullOrWhiteSpace(clientSession))
                {
                    verifyBizContent["client_session"] = clientSession;
                }
                request.BizContent = JsonSerializer.Serialize(verifyBizContent);

                var verifyResponse = AlipayClient.Execute(request);

                // 3. 验证失败，返回错误
                if (verifyResponse.Code != "10000")
                {
                    Console.WriteLine($"支付凭证验证失败：{verifyResponse.SubMsg}");
                    await CreatePaymentRequiredResponse(response);
                    return;
                }

                // 4. 验证成功后，以支付宝响应和本地持久化订单共同完成严格校验。
                var returnedTradeNo = verifyResponse.TradeNo ?? "";
                var verifyOutTradeNo = verifyResponse.OutTradeNo;
                var returnedAmount = verifyResponse.Amount ?? "";
                var returnedResourceId = verifyResponse.ResourceId ?? "";
                var active = verifyResponse.Active;
                var repository = RequireOrderRepository();
                var order = string.IsNullOrWhiteSpace(verifyOutTradeNo)
                    ? null
                    : await repository.FindByOutTradeNoAsync(verifyOutTradeNo);
                var sandboxMode = IsExactSandboxMode();
                var verifyTradeNo = !string.IsNullOrWhiteSpace(returnedTradeNo)
                    ? returnedTradeNo
                    : sandboxMode ? tradeNo : "";
                var verifyAmount = !string.IsNullOrWhiteSpace(returnedAmount)
                    ? returnedAmount
                    : sandboxMode && order != null ? order.Amount : "";
                var resourceIdVerified = !string.IsNullOrWhiteSpace(returnedResourceId)
                    ? returnedResourceId
                    : sandboxMode && order != null ? order.ResourceId : "";

                Console.WriteLine($"支付凭证验证成功：tradeNo={verifyTradeNo}, outTradeNo={verifyOutTradeNo}");

                if (active != true
                    || string.IsNullOrWhiteSpace(verifyTradeNo)
                    || verifyTradeNo != tradeNo
                    || string.IsNullOrWhiteSpace(verifyOutTradeNo)
                    || string.IsNullOrWhiteSpace(resourceIdVerified))
                {
                    await CreatePaymentRequiredResponse(response);
                    return;
                }

                var amountMatches = order != null && AmountsEqual(order.Amount, verifyAmount);
                var resourceMatches = order != null
                    && order.ResourceId == ResourcePath
                    && order.ResourceId == resourceIdVerified;
                var fulfillmentInProgress = order != null
                    && new[] { "PENDING_CONFIRM", "FULFILLED" }.Contains(order.FulfillStatus);
                var orderUsable = order != null
                    && order.Currency == "CNY"
                    && new[] { "PENDING_PAYMENT", "PAID" }.Contains(order.OrderStatus)
                    && new[] { "UNFULFILLED", "PENDING_CONFIRM", "FULFILLED" }.Contains(order.FulfillStatus)
                    && (fulfillmentInProgress || IsFuture(order.PayBefore));
                if (!amountMatches || !resourceMatches || !orderUsable)
                {
                    await CreatePaymentRequiredResponse(response);
                    return;
                }

                var fulfillment = await repository.PrepareFulfillmentAsync(new FulfillmentRequest
                {
                    OutTradeNo = verifyOutTradeNo,
                    TradeNo = verifyTradeNo,
                    ExpectedAmount = NormalizeAmount(verifyAmount),
                    ExpectedResourceId = resourceIdVerified,
                    CreateResource = () => GenerateServiceResource(resourceIdVerified)
                });
                if (fulfillment == null
                    || (fulfillment.State != "PENDING_CONFIRM" && fulfillment.State != "FULFILLED")
                    || string.IsNullOrWhiteSpace(fulfillment.ServiceResult))
                {
                    throw new InvalidOperationException(
                        "IOrderRepository.PrepareFulfillmentAsync 未返回已持久化的履约结果");
                }

                if (fulfillment.State == "FULFILLED")
                {
                    await SendSuccessfulResource(response, verifyTradeNo, verifyOutTradeNo,
                        resourceIdVerified, fulfillment.ServiceResult, true);
                    return;
                }

                Console.WriteLine($"资源已生成，准备发送履约确认：outTradeNo={verifyOutTradeNo}, tradeNo={verifyTradeNo}");

                // 12. 发送履约确认到支付宝，确认成功后才返回成功交付
                var fulfillmentConfirmed = SendFulfillmentConfirm(verifyTradeNo);
                if (!fulfillmentConfirmed)
                {
                    response.StatusCode = 502;
                    response.ContentType = "application/json; charset=utf-8";
                    await response.WriteAsJsonAsync(new
                    {
                        code = "FULFILLMENT_CONFIRM_FAILED",
                        message = "资源已生成但履约确认失败，请稍后使用同一 Payment-Proof 重试"
                    });
                    return;
                }

                await repository.MarkFulfilledAsync(verifyOutTradeNo, verifyTradeNo);
                await SendSuccessfulResource(response, verifyTradeNo, verifyOutTradeNo,
                    resourceIdVerified, fulfillment.ServiceResult, false);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"支付凭证验证异常：{ex.Message}");
                response.StatusCode = 500;
                response.ContentType = "application/json; charset=utf-8";
                await response.WriteAsJsonAsync(new
                {
                    code = "VERIFY_FAILED",
                    message = $"支付凭证验证失败：{ex.Message}"
                });
            }
        }

        private static async Task SendSuccessfulResource(
            HttpResponse response,
            string tradeNo,
            string outTradeNo,
            string resourceId,
            string serviceResult,
            bool alreadyFulfilled)
        {
            var paymentValidation = new
            {
                trade_no = tradeNo,
                out_trade_no = outTradeNo,
                validated = true,
                resource_id = resourceId
            };
            response.Headers["Payment-Validation"] = Base64UrlEncode(
                JsonSerializer.Serialize(paymentValidation));
            response.ContentType = "application/json; charset=utf-8";
            await response.WriteAsJsonAsync(new
            {
                resource_id = resourceId,
                content = serviceResult,
                trade_no = tradeNo,
                out_trade_no = outTradeNo,
                already_fulfilled = alreadyFulfilled,
                fulfillment_confirmed = true
            });
        }

        /// <summary>
        /// 生成服务资源内容
        /// </summary>
        private static string GenerateServiceResource(string resourceId)
        {
            return JsonSerializer.Serialize(new
            {
                status = "success",
                service_type = "AI_CONTENT_GENERATION",
                resource_id = resourceId,
                content = "这是 AI 生成的内容示例，可根据实际业务替换为任意数字服务内容",
                generated_at = DateTime.Now.ToString("o")
            });
        }

        private static string NormalizeAmount(string value)
        {
            if (!TryParseAmount(value, out var amount))
            {
                throw new ArgumentException("金额格式非法", nameof(value));
            }
            return amount.ToString("0.00", CultureInfo.InvariantCulture);
        }

        private static bool AmountsEqual(string left, string right)
        {
            return TryParseAmount(left, out var leftAmount)
                && TryParseAmount(right, out var rightAmount)
                && leftAmount == rightAmount;
        }

        private static bool TryParseAmount(string value, out decimal amount)
        {
            amount = 0;
            if (string.IsNullOrWhiteSpace(value)
                || !System.Text.RegularExpressions.Regex.IsMatch(value.Trim(), @"^\d+(?:\.\d{1,2})?$"))
            {
                return false;
            }
            return decimal.TryParse(value, NumberStyles.AllowDecimalPoint,
                CultureInfo.InvariantCulture, out amount) && amount >= 0;
        }

        private static bool IsFuture(string value)
        {
            return DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture,
                DateTimeStyles.RoundtripKind, out var deadline)
                && deadline > DateTimeOffset.Now;
        }

        private static bool IsExactSandboxMode()
        {
            return AlipayConfig.ServerUrl == SandboxGateway && ServiceId == "api_mock_service_id";
        }

        /// <summary>
        /// 发送履约确认
        /// </summary>
        private static bool SendFulfillmentConfirm(string tradeNo)
        {
            if (string.IsNullOrWhiteSpace(tradeNo))
            {
                Console.WriteLine("履约确认失败：tradeNo 为空");
                return false;
            }

            try
            {
                Console.WriteLine($"开始发送履约确认：tradeNo={tradeNo}");

                var request = new AlipayAipayAgentFulfillmentConfirmRequest();
                request.BizContent = JsonSerializer.Serialize(new
                {
                    trade_no = tradeNo
                }, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase });

                var response = AlipayClient.Execute(request);

                if (response.Code == "10000")
                {
                    Console.WriteLine($"履约确认成功：tradeNo={tradeNo}");
                    return true;
                }
                else
                {
                    Console.WriteLine($"履约确认失败：tradeNo={tradeNo}, errorCode={response.SubCode}, errorMsg={response.SubMsg}");
                    return false;
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"履约确认异常：tradeNo={tradeNo}, error={ex.Message}");
                return false;
            }
        }
    }
}
```
