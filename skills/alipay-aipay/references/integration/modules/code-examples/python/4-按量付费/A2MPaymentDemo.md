# AI 按量付费完整接入示例 - Python

以下代码展示严格验付和幂等履约的完整控制流。生成项目代码时，请按当前项目结构拆分并绑定真实持久化实现。

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
A2M 智能收产品接入示例 - Python 版本

本示例展示 A2M 核心协议、严格验付和幂等履约流程。
必须通过 configure_order_repository 绑定项目真实持久化实现；
端口未绑定时明确失败，不使用内存订单、固定资源或验付字段缺失兜底。

本文件演示 A2M 核心协议调用流程：
1. 返回 402 Payment-Needed Header
2. 验证 Payment-Proof 支付凭证
3. 发送履约回执确认
4. 返回资源内容

依赖安装：
pip install flask alipay-sdk-python pycryptodome

注意：Python SDK 3.7+ 版本必须使用 Model 类（如 AlipayAipayAgentPaymentVerifyModel），
不能直接使用 dict 赋值给 biz_model，因为 SDK 会调用 to_alipay_dict() 方法。
"""

import base64
import json
import os
import re
import time
import uuid
from decimal import Decimal
from datetime import datetime, timedelta, timezone
from urllib.parse import quote, unquote
from Crypto.Signature import pkcs1_15
from Crypto.Hash import SHA256
from Crypto.PublicKey import RSA
from flask import Flask, request, Response
from alipay.aop.api.AlipayClientConfig import AlipayClientConfig
from alipay.aop.api.DefaultAlipayClient import DefaultAlipayClient
from alipay.aop.api.request.AlipayAipayAgentPaymentVerifyRequest import AlipayAipayAgentPaymentVerifyRequest
from alipay.aop.api.request.AlipayAipayAgentFulfillmentConfirmRequest import AlipayAipayAgentFulfillmentConfirmRequest
from alipay.aop.api.domain.AlipayAipayAgentPaymentVerifyModel import AlipayAipayAgentPaymentVerifyModel
from alipay.aop.api.domain.AlipayAipayAgentFulfillmentConfirmModel import AlipayAipayAgentFulfillmentConfirmModel

app = Flask(__name__)

# ==================== 配置信息（实际使用时请从配置中心读取）====================
ALIPAY_CONFIG = {
    'appId': '<APP_ID>',
    'privateKey': '<APP_PRIVATE_KEY>',  # 请填写您的应用私钥（PKCS#1 格式）
    'alipayPublicKey': '<ALIPAY_PUBLIC_KEY>',  # 请填写您的支付宝公钥
    # 默认用于本 Skill 的快速沙箱联调；生产部署时显式设置为 https://openapi.alipay.com/gateway.do
    'gateway': os.environ.get('ALIPAY_GATEWAY', 'https://openapi-sandbox.dl.alipaydev.com/gateway.do'),
    'sellerId': '<SELLER_ID_2088>',  # 商户 ID（2088 格式）
    'serviceId': 'api_mock_service_id',  # 仅用于沙箱联调；上线前替换为服务市场真实 serviceId
    'merchantPrivateKey': '<APP_PRIVATE_KEY>'  # 请填写您的应用私钥（用于商家签名）
}

RESOURCE_CONFIG = {
    'path': '/demo/a2m/resource',
    'goodsName': 'AI 生成内容服务'
}

ORDER_REPOSITORY = None


def configure_order_repository(repository):
    """绑定项目的真实持久化端口。

    实现必须使用数据库事务和唯一约束，并提供 create_pending、
    find_by_out_trade_no、prepare_fulfillment 和 mark_fulfilled。
    prepare_fulfillment 必须原子地校验订单、只生成一次资源，
    并返回已持久化的 PENDING_CONFIRM 或 FULFILLED 结果。
    订单快照将支付状态映射为 PENDING_PAYMENT/PAID，
    将履约状态映射为 UNFULFILLED/PENDING_CONFIRM/FULFILLED。
    """
    required_methods = (
        'create_pending',
        'find_by_out_trade_no',
        'prepare_fulfillment',
        'mark_fulfilled'
    )
    if repository is None or any(not callable(getattr(repository, name, None)) for name in required_methods):
        raise RuntimeError(f'order_repository 必须实现 {", ".join(required_methods)}')
    global ORDER_REPOSITORY
    ORDER_REPOSITORY = repository


def require_order_repository():
    if ORDER_REPOSITORY is None:
        raise RuntimeError('尚未绑定项目真实 order_repository，禁止回退到内存订单')
    return ORDER_REPOSITORY

# 初始化支付宝客户端
def init_alipay_client():
    """初始化支付宝 SDK 客户端"""
    config = AlipayClientConfig()
    config.server_url = ALIPAY_CONFIG['gateway']
    config.app_id = ALIPAY_CONFIG['appId']
    config.app_private_key = ALIPAY_CONFIG['privateKey']
    config.alipay_public_key = ALIPAY_CONFIG['alipayPublicKey']
    config.charset = 'utf-8'
    config.sign_type = 'RSA2'
    
    return DefaultAlipayClient(alipay_client_config=config)


# ==================== 工具方法 ====================

def format_alipay_timestamp(dt=None):
    """格式化支付宝时间戳：yyyy-MM-dd HH:mm:ss"""
    if dt is None:
        dt = datetime.now()
    return dt.strftime('%Y-%m-%d %H:%M:%S')


def generate_seller_signature(params, private_key):
    """
    生成商家签名（seller_signature）
    
    Args:
        params: 待签名参数字典
        private_key: 商户私钥字符串
    
    Returns:
        Base64 编码的签名
    """
    # 1. 按 key 字典序排序
    sorted_keys = sorted(params.keys())
    
    # 2. 拼接签名内容
    sign_content = []
    for key in sorted_keys:
        value = params[key]
        if value is not None and value != '':
            sign_content.append(f"{key}={value}")
    
    sign_string = '&'.join(sign_content)
    
    # 3. 将裸 PKCS#1 Base64 临时解码为 DER 密钥对象，不修改原始配置。
    key_der = base64.b64decode(private_key, validate=True)
    key = RSA.import_key(key_der)
    h = SHA256.new(sign_string.encode('utf-8'))
    signature = pkcs1_15.new(key).sign(h)
    
    return base64.b64encode(signature).decode('utf-8')


def base64url_encode(data):
    """Base64URL 编码"""
    if isinstance(data, str):
        data = data.encode('utf-8')
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode('utf-8')


def base64url_decode(data):
    """Base64URL 解码"""
    # 补充 padding
    padding = 4 - len(data) % 4
    if padding != 4:
        data += '=' * padding
    
    return base64.urlsafe_b64decode(data).decode('utf-8')


def normalize_amount(value):
    text = str(value or '').strip()
    if not re.fullmatch(r'\d+(?:\.\d{1,2})?', text):
        return None
    return f'{Decimal(text):.2f}'


def amounts_equal(left, right):
    left_amount = normalize_amount(left)
    right_amount = normalize_amount(right)
    return left_amount is not None and right_amount is not None and left_amount == right_amount


def is_future(value):
    try:
        return datetime.fromisoformat(value).timestamp() > time.time()
    except (TypeError, ValueError):
        return False


def is_exact_sandbox_mode():
    return (
        ALIPAY_CONFIG['gateway'] == 'https://openapi-sandbox.dl.alipaydev.com/gateway.do'
        and ALIPAY_CONFIG['serviceId'] == 'api_mock_service_id'
    )


def json_response(data, status_code=200, headers=None):
    """发送 JSON 响应"""
    response = Response(
        json.dumps(data, ensure_ascii=False),
        status=status_code,
        mimetype='application/json; charset=utf-8'
    )
    
    if headers:
        for key, value in headers.items():
            response.headers[key] = value
    
    return response


# ==================== 智能收产品接入示例接口 ====================

@app.route(RESOURCE_CONFIG['path'], methods=['GET'])
def handle_resource():
    """
    智能收产品统一接口
    
    核心协议流程演示：
    1. 不带 Payment-Proof Header：返回 HTTP 402 + Payment-Needed Header
    2. 带 Payment-Proof Header：验证支付 → 自动履约 → 返回资源
    """
    # 获取 Payment-Proof Header
    payment_proof = request.headers.get('Payment-Proof')
    
    # 场景 1：用户未支付，返回 402 + Payment-Needed Header
    if not payment_proof or not payment_proof.strip():
        return create_payment_required_response()
    
    # 场景 2：用户已支付，验证 Payment-Proof 并返回资源
    return verify_payment_and_deliver_resource(payment_proof)


def create_payment_required_response():
    """创建 402 支付请求响应"""
    try:
        # 1. 构造订单信息
        out_trade_no = f"ORDER_{int(time.time() * 1000)}_{uuid.uuid4().hex[:12]}"
        amount = '0.01'  # 单位：元
        currency = 'CNY'
        resource_id = RESOURCE_CONFIG['path']
        goods_name = RESOURCE_CONFIG['goodsName']
        
        # 2. 计算支付截止时间（30 分钟后），使用带时区的 ISO 8601 格式
        pay_before = (datetime.now(timezone.utc).astimezone() + timedelta(minutes=30)).isoformat()
        
        # 3. 生成商家签名
        seller_signature = generate_seller_signature({
            'amount': amount,
            'currency': currency,
            'goods_name': goods_name,
            'out_trade_no': out_trade_no,
            'pay_before': pay_before,
            'resource_id': resource_id,
            'seller_id': ALIPAY_CONFIG['sellerId'],
            'service_id': ALIPAY_CONFIG['serviceId']
        }, ALIPAY_CONFIG['merchantPrivateKey'])
        
        require_order_repository().create_pending({
            'out_trade_no': out_trade_no,
            'amount': normalize_amount(amount),
            'currency': currency,
            'resource_id': resource_id,
            'goods_name': goods_name,
            'pay_before': pay_before,
            'order_status': 'PENDING_PAYMENT',
            'fulfill_status': 'UNFULFILLED'
        })

        # 4. 持久化成功后构造 Payment-Needed Header 内容
        payment_needed = {
            'protocol': {
                'out_trade_no': out_trade_no,
                'amount': amount,
                'currency': currency,
                'resource_id': resource_id,
                'pay_before': pay_before,
                'seller_signature': seller_signature,
                'seller_sign_type': 'RSA2',
                'seller_unique_id': ALIPAY_CONFIG['sellerId']
            },
            'method': {
                'seller_name': '测试商户',
                'seller_id': ALIPAY_CONFIG['sellerId'],
                'seller_app_id': ALIPAY_CONFIG['appId'],
                'goods_name': goods_name,
                'seller_unique_id_key': 'seller_id',
                'service_id': ALIPAY_CONFIG['serviceId']
            }
        }
        
        # 5. Base64URL 编码
        payment_needed_encoded = base64url_encode(json.dumps(payment_needed, ensure_ascii=False))
        
        # 6. 构造 402 响应
        response_data = {
            'code': 'Payment-Needed',
            'message': '需要支付',
            'out_trade_no': out_trade_no,
            'amount': amount,
            'currency': currency,
            'goods_name': goods_name
        }
        
        print(f"创建支付订单成功：outTradeNo={out_trade_no}, amount={amount}")
        
        return json_response(
            response_data,
            status_code=402,
            headers={'Payment-Needed': payment_needed_encoded}
        )
        
    except Exception as e:
        print(f'创建订单失败：{str(e)}')
        return json_response({
            'code': 'CREATE_ORDER_ERROR',
            'message': f'创建订单失败：{str(e)}'
        }, status_code=500)


def verify_payment_and_deliver_resource(payment_proof):
    """验证支付凭证并交付资源"""
    try:
        # 1. 从 Payment-Proof 中解析订单信息
        try:
            decoded_proof = base64url_decode(payment_proof)
            proof_json = json.loads(decoded_proof)
            
            # 从 protocol 层获取 payment_proof 和 trade_no
            protocol = proof_json.get('protocol', {})
            payment_proof_value = protocol.get('payment_proof')
            trade_no = protocol.get('trade_no')
            
            # 从 method 层获取 client_session
            method = proof_json.get('method', {})
            client_session = method.get('client_session')
            
            # 校验必要字段
            if not payment_proof_value or not payment_proof_value.strip():
                return create_payment_required_response()
            
            if not trade_no or not trade_no.strip():
                return create_payment_required_response()
                
        except Exception as e:
            print(f'Payment-Proof 解析失败：{str(e)}')
            return create_payment_required_response()
        
        # 2. 调用支付宝 API 验证支付凭证
        # 注意：必须使用 Model 类，不能使用 dict
        # SDK 的 get_params() 方法会调用 biz_model.to_alipay_dict()
        alipay_client = init_alipay_client()
        verify_request = AlipayAipayAgentPaymentVerifyRequest()
        
        # 使用 Model 类（正确方式）
        model = AlipayAipayAgentPaymentVerifyModel()
        model.payment_proof = payment_proof_value
        model.trade_no = trade_no
        if client_session:
            model.client_session = client_session
        verify_request.biz_model = model
        
        verify_response_content = alipay_client.execute(verify_request)
        verify_response = json.loads(verify_response_content)
        
        # 3. 验证失败，返回错误
        # 注意：SDK execute() 返回的 JSON 可能是扁平结构（直接包含 code/trade_no 等字段），
        # 也可能嵌套在 alipay_aipay_agent_payment_verify_response 键下，需兼容两种情况
        response_data = verify_response.get('alipay_aipay_agent_payment_verify_response', verify_response)
        if response_data.get('code') != '10000':
            print(f'支付凭证验证失败：{response_data.get("sub_msg")}')
            return create_payment_required_response()
        
        # 4. 验证成功，获取订单信息
        returned_trade_no = response_data.get('trade_no') or response_data.get('tradeNo') or ''
        verify_out_trade_no = response_data.get('out_trade_no') or response_data.get('outTradeNo') or ''
        returned_amount = response_data.get('amount')
        returned_resource_id = response_data.get('resource_id') or response_data.get('resourceId') or ''
        active = response_data.get('active')

        repository = require_order_repository()
        order = repository.find_by_out_trade_no(verify_out_trade_no) if verify_out_trade_no else None
        sandbox_mode = is_exact_sandbox_mode()
        verify_trade_no = returned_trade_no or (trade_no if sandbox_mode else '')
        verify_amount = returned_amount or (order.get('amount') if sandbox_mode and order else '')
        resource_id_verified = returned_resource_id or (order.get('resource_id') if sandbox_mode and order else '')
        
        print(f"支付凭证验证成功：tradeNo={verify_trade_no}, outTradeNo={verify_out_trade_no}")
        
        # 5. 校验凭证有效性（active=true 表示凭证有效）
        if (
            active is not True
            or not verify_trade_no
            or verify_trade_no != trade_no
            or not verify_out_trade_no
            or not resource_id_verified
        ):
            print(f"支付凭证无效或已过期：outTradeNo={verify_out_trade_no}")
            return create_payment_required_response()

        amount_matches = order and amounts_equal(order.get('amount'), verify_amount)
        resource_matches = (
            order
            and order.get('resource_id') == resource_id_verified
            and resource_id_verified == RESOURCE_CONFIG['path']
        )
        fulfill_status = order.get('fulfill_status') if order else None
        fulfillment_in_progress = fulfill_status in ('PENDING_CONFIRM', 'FULFILLED')
        order_usable = (
            order
            and order.get('currency') == 'CNY'
            and order.get('order_status') in ('PENDING_PAYMENT', 'PAID')
            and fulfill_status in ('UNFULFILLED', 'PENDING_CONFIRM', 'FULFILLED')
            and (fulfillment_in_progress or is_future(order.get('pay_before')))
        )
        if not amount_matches or not resource_matches or not order_usable:
            return create_payment_required_response()

        fulfillment = repository.prepare_fulfillment({
            'out_trade_no': verify_out_trade_no,
            'trade_no': verify_trade_no,
            'expected_amount': normalize_amount(verify_amount),
            'expected_resource_id': resource_id_verified,
            'create_resource': lambda: generate_service_resource(resource_id_verified)
        })
        if (
            not fulfillment
            or fulfillment.get('state') not in ('PENDING_CONFIRM', 'FULFILLED')
            or not fulfillment.get('service_result')
        ):
            raise RuntimeError('order_repository.prepare_fulfillment 未返回已持久化的履约结果')
        service_result = fulfillment['service_result']
        if fulfillment['state'] == 'FULFILLED':
            return successful_resource_response(
                verify_trade_no, verify_out_trade_no, resource_id_verified, service_result, True
            )

        fulfillment_trade_no = verify_trade_no
        print(f"资源已生成，准备发送履约确认：outTradeNo={verify_out_trade_no}, tradeNo={fulfillment_trade_no}")

        # 12. 发送履约确认到支付宝，确认成功后才返回成功交付
        # 注意：同样需要使用 Model 类
        if not send_fulfillment_confirm(fulfillment_trade_no):
            return json_response({
                'code': 'FULFILLMENT_CONFIRM_FAILED',
                'message': '资源已生成但履约确认失败，请稍后使用同一 Payment-Proof 重试'
            }, status_code=502)

        repository.mark_fulfilled(verify_out_trade_no, fulfillment_trade_no)

        print(f"履约确认成功：outTradeNo={verify_out_trade_no}, tradeNo={fulfillment_trade_no}")
        
        return successful_resource_response(
            fulfillment_trade_no, verify_out_trade_no, resource_id_verified, service_result, False
        )
        
    except Exception as e:
        print(f'支付凭证验证异常：{str(e)}')
        return json_response({
            'code': 'VERIFY_FAILED',
            'message': f'支付凭证验证失败：{str(e)}'
        }, status_code=500)


def successful_resource_response(trade_no, out_trade_no, resource_id, service_result, already_fulfilled):
    payment_validation = base64url_encode(json.dumps({
        'trade_no': trade_no,
        'out_trade_no': out_trade_no,
        'validated': True,
        'resource_id': resource_id
    }, ensure_ascii=False))
    return json_response({
        'resource_id': resource_id,
        'content': service_result,
        'trade_no': trade_no,
        'out_trade_no': out_trade_no,
        'already_fulfilled': already_fulfilled,
        'fulfillment_confirmed': True
    }, headers={'Payment-Validation': payment_validation})


def generate_service_resource(resource_id):
    """生成服务资源内容"""
    return json.dumps({
        'status': 'success',
        'service_type': 'AI_CONTENT_GENERATION',
        'resource_id': resource_id,
        'content': '这是 AI 生成的内容示例，可根据实际业务替换为任意数字服务内容',
        'generated_at': datetime.now(timezone.utc).astimezone().isoformat()
    }, ensure_ascii=False)


def send_fulfillment_confirm(trade_no):
    """发送履约确认"""
    if not trade_no:
        print("履约确认失败：tradeNo 为空")
        return False

    try:
        print(f"开始发送履约确认：tradeNo={trade_no}")
        
        alipay_client = init_alipay_client()
        confirm_request = AlipayAipayAgentFulfillmentConfirmRequest()
        
        # 使用 Model 类（正确方式）
        model = AlipayAipayAgentFulfillmentConfirmModel()
        model.trade_no = trade_no
        confirm_request.biz_model = model
        
        # 备选方案：使用 biz_content
        # confirm_request.biz_content = json.dumps({
        #     'trade_no': trade_no
        # }, ensure_ascii=False)
        
        response_content = alipay_client.execute(confirm_request)
        response = json.loads(response_content)
        
        # 注意：SDK execute() 返回的 JSON 可能是扁平结构，也可能嵌套在响应键下，需兼容两种情况
        response_data = response.get('alipay_aipay_agent_fulfillment_confirm_response', response)
        if response_data.get('code') == '10000':
            print(f"履约确认成功：tradeNo={trade_no}")
            return True
        else:
            print(f"履约确认失败：tradeNo={trade_no}, errorCode={response_data.get('sub_code')}, "
                  f"errorMsg={response_data.get('sub_msg')}")
            return False
            
    except Exception as e:
        print(f"履约确认异常：tradeNo={trade_no}, error={str(e)}")
        return False


# ==================== 启动服务 ====================

if __name__ == '__main__':
    print(f"A2M 按量付费服务已启动：http://localhost:5000{RESOURCE_CONFIG['path']}")
    print('测试步骤：')
    print(f'1. 无 Payment-Proof Header: curl http://localhost:5000{RESOURCE_CONFIG["path"]}')
    print(f'2. 有 Payment-Proof Header: curl -H "Payment-Proof: <value>" http://localhost:5000{RESOURCE_CONFIG["path"]}')
    
    app.run(host='0.0.0.0', port=5000, debug=True)
```
