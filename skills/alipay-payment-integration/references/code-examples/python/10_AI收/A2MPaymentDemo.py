#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
A2M 智能收产品接入示例 - Python 版本

本文件演示完整的智能收产品接入流程：
1. 返回 402 Payment-Needed Header
2. 验证 Payment-Proof 支付凭证
3. 发送履约回执确认
4. 返回资源内容

依赖安装：
pip install flask alipay-sdk-python

注意：Python SDK 3.7+ 版本必须使用 Model 类（如 AlipayAipayAgentPaymentVerifyModel），
不能直接使用 dict 赋值给 biz_model，因为 SDK 会调用 to_alipay_dict() 方法。
"""

import json
import time
import base64
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
    'appId': '2026000123456789',
    'privateKey': 'MIIEvQIBADANBgkq...',  # 请填写您的应用私钥（PKCS#1 格式）
    'alipayPublicKey': 'MIIBIjANBgkq...',  # 请填写您的支付宝公钥
    'gateway': 'https://openapi.alipay.com/gateway.do',
    'sellerId': '2088123456789012',  # 商户 ID（2088 格式）
    'serviceId': 'service_ai_content_001',  # 商户服务 ID
    'merchantPrivateKey': 'MIIEvQIBADANBgkq...'  # 请填写您的应用私钥（用于商家签名）
}

RESOURCE_CONFIG = {
    'path': '/demo/a2m/resource',
    'goodsName': 'AI 生成内容服务'
}

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
    
    # 3. RSA2 签名
    key = RSA.import_key(private_key)
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
    
    完整流程演示：
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
        out_trade_no = f"ORDER_{int(time.time() * 1000)}"
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
        
        # 4. 构造 Payment-Needed Header 内容
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
                return json_response({
                    'code': 'INVALID_PAYMENT_PROOF_FORMAT',
                    'message': 'Payment-Proof 格式错误：缺少 payment_proof'
                }, status_code=400)
            
            if not trade_no or not trade_no.strip():
                return json_response({
                    'code': 'INVALID_PAYMENT_PROOF_FORMAT',
                    'message': 'Payment-Proof 格式错误：缺少 trade_no'
                }, status_code=400)
                
        except Exception as e:
            print(f'Payment-Proof 解析失败：{str(e)}')
            return json_response({
                'code': 'INVALID_PAYMENT_PROOF_FORMAT',
                'message': f'Payment-Proof 格式错误：{str(e)}'
            }, status_code=400)
        
        # 2. 调用支付宝 API 验证支付凭证
        # 注意：必须使用 Model 类，不能使用 dict
        # SDK 的 get_params() 方法会调用 biz_model.to_alipay_dict()
        alipay_client = init_alipay_client()
        verify_request = AlipayAipayAgentPaymentVerifyRequest()
        
        # 使用 Model 类（正确方式）
        model = AlipayAipayAgentPaymentVerifyModel()
        model.payment_proof = payment_proof_value
        model.trade_no = trade_no
        model.client_session = client_session
        verify_request.biz_model = model
        
        # 如果 SDK 版本支持直接使用 dict，也可以用 biz_content（备选方案）
        # verify_request.biz_content = json.dumps({
        #     'payment_proof': payment_proof_value,
        #     'trade_no': trade_no,
        #     'client_session': client_session
        # }, ensure_ascii=False)
        
        verify_response_content = alipay_client.execute(verify_request)
        verify_response = json.loads(verify_response_content)
        
        # 3. 验证失败，返回错误
        # 注意：SDK execute() 返回的 JSON 可能是扁平结构（直接包含 code/trade_no 等字段），
        # 也可能嵌套在 alipay_aipay_agent_payment_verify_response 键下，需兼容两种情况
        response_data = verify_response.get('alipay_aipay_agent_payment_verify_response', verify_response)
        if response_data.get('code') != '10000':
            print(f'支付凭证验证失败：{response_data.get("sub_msg")}')
            return json_response({
                'code': response_data.get('sub_code', 'VERIFY_FAILED'),
                'message': response_data.get('sub_msg', '支付凭证验证失败')
            }, status_code=400)
        
        # 4. 验证成功，获取订单信息
        verify_trade_no = response_data.get('trade_no')
        verify_out_trade_no = response_data.get('out_trade_no')
        resource_id = response_data.get('resource_id')
        active = response_data.get('active')
        
        print(f"支付凭证验证成功：tradeNo={verify_trade_no}, outTradeNo={verify_out_trade_no}")
        
        # 5. 校验凭证有效性（active=true 表示凭证有效）
        if active is not True:
            print(f"支付凭证无效或已过期：outTradeNo={verify_out_trade_no}")
            return json_response({
                'code': 'INVALID_PAYMENT_PROOF',
                'message': '支付凭证无效或已过期'
            }, status_code=400)
        
        # 6. 【TODO】查询订单是否存在（以数据库为准）
        # order = order_repository.find_by_out_trade_no(verify_out_trade_no)
        # if not order:
        #     return json_response({
        #         'code': 'ORDER_NOT_FOUND',
        #         'message': '订单不存在'
        #     }, status_code=404)
        
        # 7. 【TODO】资源防串校验
        # if resource_id != order.resource_id:
        #     return json_response({
        #         'code': 'RESOURCE_ID_MISMATCH',
        #         'message': '资源 ID 不匹配，可能存在资源串改风险'
        #     }, status_code=403)
        
        # 8. 【TODO】履约防重放校验（数据库幂等控制）
        # if order.fulfill_status == 'FULFILLED':
        #     return json_response({
        #         'code': 'ALREADY_FULFILLED',
        #         'message': '订单已履约，不重复提供',
        #         'already_fulfilled': True
        #     }, status_code=200)
        
        # 9. 生成资源内容
        service_result = generate_service_resource(resource_id)
        
        # 10. 【TODO】履约记录落库
        # fulfillment_record_repository.save({...})
        
        # 11. 【TODO】更新订单状态
        # order_repository.update(verify_out_trade_no, {...})
        
        print(f"履约成功：outTradeNo={verify_out_trade_no}, tradeNo={verify_trade_no}")
        
        # 12. 发送履约确认到支付宝
        # 注意：同样需要使用 Model 类
        send_fulfillment_confirm(verify_trade_no)
        
        # 13. 构造 Payment-Validation Header
        payment_validation = {
            'trade_no': verify_trade_no,
            'out_trade_no': verify_out_trade_no,
            'validated': True,
            'resource_id': resource_id
        }
        
        payment_validation_encoded = base64url_encode(json.dumps(payment_validation, ensure_ascii=False))
        
        # 14. 返回资源内容
        return json_response({
            'resource_id': resource_id,
            'content': service_result,
            'trade_no': verify_trade_no,
            'out_trade_no': verify_out_trade_no,
            'already_fulfilled': False
        }, headers={'Payment-Validation': payment_validation_encoded})
        
    except Exception as e:
        print(f'支付凭证验证异常：{str(e)}')
        return json_response({
            'code': 'VERIFY_FAILED',
            'message': f'支付凭证验证失败：{str(e)}'
        }, status_code=500)


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
        else:
            print(f"履约确认失败：tradeNo={trade_no}, errorCode={response_data.get('sub_code')}, "
                  f"errorMsg={response_data.get('sub_msg')}")
            
    except Exception as e:
        print(f"履约确认异常：tradeNo={trade_no}, error={str(e)}")


# ==================== 启动服务 ====================

if __name__ == '__main__':
    print(f"A2M 智能收服务已启动：http://localhost:5000{RESOURCE_CONFIG['path']}")
    print('测试步骤：')
    print(f'1. 无 Payment-Proof Header: curl http://localhost:5000{RESOURCE_CONFIG["path"]}')
    print(f'2. 有 Payment-Proof Header: curl -H "Payment-Proof: <value>" http://localhost:5000{RESOURCE_CONFIG["path"]}')
    
    app.run(host='0.0.0.0', port=5000, debug=True)
