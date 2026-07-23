#!/usr/bin/env python3
"""执行本地服务的支付宝沙箱 Payment-Needed 支付流程。"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any
from urllib.parse import quote


PAY_ENDPOINT = "http://aicashier.dl.alipaydev.com/openclawpay/agent/v1/pay"
PAY_URL_PREFIX = "https://render.alipay.com/p/yuyan/180020010001290755/pay.html?schema="
A2M_SANDBOX_SERVICE_ID = "api_mock_service_id"
DEFAULT_PAY_RETRIES = 3
DEFAULT_PAY_RETRY_DELAY_SECONDS = 2.0
RETRYABLE_PAY_ERROR_CODES = {"PAY_SUBMIT_FAILED"}
ARTIFACT_PREFIX = "alipay_local_402_sandbox_pay_"
ARTIFACT_FILES = {
    "payment_needed.txt",
    "decoded_bill.json",
    "cashier_payload.json",
    "state.json",
    "pay_headers.txt",
    "pay_status.txt",
    "pay_response.json",
    "payment_proof_body.json",
    "payment_proof_header.txt",
    "final_response.txt",
    "final_headers.txt",
    "final_status.txt",
}
KNOWN_DELIVERY_FAILURE_CODES = {
    "CREATE_ORDER_ERROR",
    "FULFILLMENT_CONFIRM_FAILED",
    "FULFILLMENT_ERROR",
    "INVALID_PAYMENT_PROOF",
    "INVALID_PAYMENT_PROOF_FORMAT",
    "MISSING_OUT_TRADE_NO",
    "MISSING_RESOURCE_ID",
    "ORDER_NOT_FOUND",
    "RESOURCE_ID_MISMATCH",
    "SIGN_ERROR",
    "VERIFY_FAILED",
}
REDACTED = "<redacted>"
SENSITIVE_KEY_PATTERNS = (
    "signature",
    "payment_proof",
    "paymentproof",
    "proof_header",
    "proofheader",
)
ACTIVE_ARTIFACT_DIRS: set[Path] = set()


def now_ms() -> str:
    return str(int(time.time() * 1000))


def secure_write_text(path: Path, value: str) -> None:
    if path.name not in ARTIFACT_FILES and path.parent.name.startswith(ARTIFACT_PREFIX):
        raise RuntimeError(f"拒绝写入未登记的过程产物文件：{path.name}")
    if path.exists() and path.is_symlink():
        raise RuntimeError(f"过程产物文件禁止使用符号链接：{path}")
    flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(path, flags, 0o600)
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8", closefd=False) as stream:
            stream.write(value)
            stream.flush()
            os.fsync(stream.fileno())
    finally:
        os.close(descriptor)


def secure_read_text(path: Path) -> str:
    info = path.lstat()
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
        raise RuntimeError(f"过程产物必须是普通文件且不能是符号链接：{path}")
    if info.st_mode & 0o077:
        raise RuntimeError(f"过程产物文件权限过宽，拒绝读取：{path}")
    return path.read_text(encoding="utf-8")


def validate_artifact_dir(artifact_dir: Path) -> None:
    if artifact_dir not in ACTIVE_ARTIFACT_DIRS:
        raise RuntimeError("过程产物不属于本次命令，拒绝读取或清理")
    info = artifact_dir.lstat()
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
        raise RuntimeError(f"过程产物路径必须是普通目录且不能是符号链接：{artifact_dir}")
    if hasattr(os, "getuid") and info.st_uid != os.getuid():
        raise RuntimeError(f"过程产物目录不属于当前用户：{artifact_dir}")
    if info.st_mode & 0o077:
        raise RuntimeError(f"过程产物目录权限过宽，拒绝使用：{artifact_dir}")


def create_artifact_dir() -> Path:
    artifact_dir = Path(tempfile.mkdtemp(prefix=ARTIFACT_PREFIX))
    os.chmod(artifact_dir, 0o700)
    ACTIVE_ARTIFACT_DIRS.add(artifact_dir)
    return artifact_dir


def cleanup_artifact_dir(path: str | Path) -> None:
    artifact_dir = Path(path)
    validate_artifact_dir(artifact_dir)
    children = list(artifact_dir.iterdir())
    unsafe = [child.name for child in children if child.name not in ARTIFACT_FILES or child.is_symlink() or child.is_dir()]
    if unsafe:
        raise RuntimeError(f"过程产物目录包含未登记内容，拒绝自动删除：{', '.join(sorted(unsafe))}")
    for child in children:
        child.unlink()
    artifact_dir.rmdir()
    ACTIVE_ARTIFACT_DIRS.discard(artifact_dir)


def cleanup_active_artifacts() -> None:
    for artifact_dir in list(ACTIVE_ARTIFACT_DIRS):
        try:
            cleanup_artifact_dir(artifact_dir)
        except (OSError, RuntimeError, ValueError):
            continue


def ensure_curl() -> None:
    if not shutil.which("curl"):
        raise SystemExit("需要 curl，但当前 PATH 中未找到 curl")


def run_curl(args: list[str]) -> str:
    ensure_curl()
    result = subprocess.run(
        ["curl", *args],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(f"curl 执行失败，退出码 {result.returncode}：\n{result.stdout}")
    return result.stdout


def prompt_missing(value: str | None, label: str, *, secret: bool = False) -> str:
    if value:
        return value
    if secret:
        import getpass

        entered = getpass.getpass(f"{label}: ").strip()
    else:
        entered = input(f"{label}: ").strip()
    if not entered:
        raise SystemExit(f"缺少必填值：{label}")
    return entered


def load_body(args: argparse.Namespace, method: str, default_body: str | None = None) -> str | None:
    if args.body_file:
        return Path(args.body_file).read_text(encoding="utf-8")
    if args.body:
        if args.body.startswith("@"):
            return Path(args.body[1:]).read_text(encoding="utf-8")
        return args.body
    if default_body is not None:
        return default_body
    if method.upper() == "POST":
        return prompt_missing(None, "POST 请求体 body")
    return None


def parse_payment_needed(headers: str) -> str | None:
    for line in headers.splitlines():
        if line.lower().startswith("payment-needed:"):
            return line.split(":", 1)[1].strip().strip('"')
    compact = headers.strip()
    if compact and "\n" not in compact and ":" not in compact:
        return compact.strip('"')
    return None


def parse_header_value(headers: str, name: str) -> str | None:
    header_prefix = f"{name.lower()}:"
    for line in headers.splitlines():
        if line.lower().startswith(header_prefix):
            return line.split(":", 1)[1].strip().strip('"')
    return None


def fetch_payment_needed(
    url: str,
    method: str,
    body: str | None,
    content_type: str,
    output_file: str | None,
) -> str:
    method = method.upper()
    if method == "GET":
        headers = run_curl(["-s", "-I", url])
        payment_needed = parse_payment_needed(headers)
        if not payment_needed:
            headers = run_curl(["-s", "-D", "-", "-o", "/dev/null", "-X", "GET", url])
            payment_needed = parse_payment_needed(headers)
    else:
        curl_args = ["-s", "-D", "-", "-o", "/dev/null", "-X", method, url]
        if body is not None:
            curl_args.extend(["-H", f"Content-Type: {content_type}", "-d", body])
        headers = run_curl(curl_args)
        payment_needed = parse_payment_needed(headers)

    if not payment_needed:
        raise RuntimeError(f"未找到 Payment-Needed 响应头。原始响应头：\n{headers}")

    if output_file:
        secure_write_text(Path(output_file).expanduser().resolve(strict=False), payment_needed)
    return payment_needed


def b64decode_json(value: str) -> dict[str, Any]:
    compact = value.strip().strip('"')
    padded = compact + ("=" * ((4 - len(compact) % 4) % 4))
    try:
        decoder = base64.urlsafe_b64decode if ("-" in compact or "_" in compact) else base64.b64decode
        decoded = decoder(padded).decode("utf-8")
        data = json.loads(decoded)
    except Exception as exc:  # noqa: BLE001 - 保留原始异常，便于定位账单解码问题。
        raise ValueError(f"无法将 Payment-Needed 按 base64 解码为 JSON：{exc}") from exc
    if not isinstance(data, dict):
        raise ValueError("解码后的 Payment-Needed JSON 必须是对象")
    return data


def snake_to_camel(key: str) -> str:
    if "_" not in key:
        return key
    first, *rest = key.split("_")
    return first + "".join(part[:1].upper() + part[1:] for part in rest if part)


def convert_keys(value: Any) -> Any:
    if isinstance(value, list):
        return [convert_keys(item) for item in value]
    if isinstance(value, dict):
        return {snake_to_camel(str(key)): convert_keys(item) for key, item in value.items()}
    return value


def timestamp_from_out_trade_no(out_trade_no: str) -> str:
    match = re.search(r"(\d{10,})$", out_trade_no or "")
    return match.group(1) if match else now_ms()


def build_cashier_payload(decoded_bill: dict[str, Any], buyer_id: str, buyer_signature: str) -> dict[str, Any]:
    converted = convert_keys(decoded_bill)
    method = converted.get("method") if isinstance(converted.get("method"), dict) else {}
    protocol = converted.get("protocol") if isinstance(converted.get("protocol"), dict) else {}
    method = dict(method)
    protocol = dict(protocol)

    out_trade_no = str(protocol.get("outTradeNo") or "")
    timestamp = timestamp_from_out_trade_no(out_trade_no)

    method["buyerUniqueIdKey"] = "buyerExternalId"
    protocol["buyerUniqueId"] = buyer_id

    return {
        "method": method,
        "protocol": protocol,
        "signature": {
            "buyerExternalId": buyer_id,
            "buyerSignature": buyer_signature,
            "timestamp": timestamp,
        },
    }


def compact_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def pretty_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2)


def redact_for_display(value: Any) -> Any:
    if isinstance(value, list):
        return [redact_for_display(item) for item in value]
    if isinstance(value, dict):
        redacted: dict[str, Any] = {}
        for key, item in value.items():
            normalized = str(key).replace("-", "_").lower()
            if any(pattern in normalized for pattern in SENSITIVE_KEY_PATTERNS):
                redacted[str(key)] = REDACTED
            else:
                redacted[str(key)] = redact_for_display(item)
        return redacted
    return value


def post_json(url: str, payload: dict[str, Any]) -> tuple[int, str, dict[str, Any]]:
    with tempfile.TemporaryDirectory() as tmp_dir:
        headers_path = Path(tmp_dir) / "headers.txt"
        body_path = Path(tmp_dir) / "body.txt"
        status_text = run_curl(
            [
                "-s",
                "-D",
                str(headers_path),
                "-o",
                str(body_path),
                "-w",
                "%{http_code}",
                "--connect-timeout",
                "10",
                "--max-time",
                "60",
                "-X",
                "POST",
                url,
                "-H",
                "Content-Type: application/json",
                "-d",
                compact_json(payload),
            ],
        ).strip()
        try:
            status_code = int(status_text)
        except ValueError as exc:
            raise RuntimeError(f"无法解析收银接口 HTTP 状态码：{status_text}") from exc
        headers = headers_path.read_text(encoding="utf-8", errors="replace")
        raw = body_path.read_text(encoding="utf-8", errors="replace")
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"收银接口返回不是 JSON：\n{raw}") from exc
    if not isinstance(data, dict):
        raise RuntimeError(f"收银接口返回的 JSON 必须是对象：\n{raw}")
    return status_code, headers, data


def is_retryable_pay_response(pay_response: dict[str, Any]) -> bool:
    error_code = str(pay_response.get("errorCode") or "")
    error_message = str(pay_response.get("errorMessage") or "")
    return (
        error_code in RETRYABLE_PAY_ERROR_CODES
        or "系统繁忙" in error_message
        or "稍后重试" in error_message
    )


def request_cashier_with_retry(
    url: str,
    payload: dict[str, Any],
    attempts: int,
    delay_seconds: float,
) -> tuple[int, str, dict[str, Any]]:
    attempts = max(1, attempts)
    last_result: tuple[int, str, dict[str, Any]] | None = None
    for attempt in range(1, attempts + 1):
        try:
            result = post_json(url, payload)
        except RuntimeError as exc:
            if attempt < attempts:
                print(f"\n收银接口请求异常，第 {attempt}/{attempts} 次：{exc}，{delay_seconds} 秒后重试...")
                time.sleep(delay_seconds)
                continue
            raise

        status_code, headers, pay_response = result
        last_result = result
        if pay_response.get("payScheme"):
            return result
        if attempt < attempts and is_retryable_pay_response(pay_response):
            error_code = pay_response.get("errorCode")
            error_message = pay_response.get("errorMessage")
            print(
                f"\n收银接口返回临时错误，第 {attempt}/{attempts} 次："
                f"HTTP {status_code} {error_code} {error_message}，{delay_seconds} 秒后重试..."
            )
            time.sleep(delay_seconds)
            continue
        return result

    if last_result is None:
        raise RuntimeError("收银接口未返回有效响应")
    return last_result


def pay_url_from_response(pay_response: dict[str, Any]) -> str:
    pay_scheme = pay_response.get("payScheme")
    if not pay_scheme:
        raise RuntimeError(f"收银接口返回中缺少 payScheme：\n{pretty_json(pay_response)}")
    return PAY_URL_PREFIX + quote(str(pay_scheme), safe="")


def trade_no_from_response(pay_response: dict[str, Any]) -> str:
    protocol = pay_response.get("protocol") if isinstance(pay_response.get("protocol"), dict) else {}
    trade_no = protocol.get("tradeNo") or protocol.get("tradeCoreTradeNo")
    if not trade_no:
        raise RuntimeError(f"收银接口返回中缺少 tradeNo：\n{pretty_json(pay_response)}")
    return str(trade_no)


def b64_json(value: dict[str, Any]) -> str:
    return base64.b64encode(compact_json(value).encode("utf-8")).decode("ascii")


def build_payment_proof_header(
    buyer_id: str,
    trade_no: str,
    payment_proof: str | None,
    buyer_signature: str,
) -> tuple[dict[str, Any], str]:
    timestamp = now_ms()
    proof = payment_proof or hashlib.sha256(f"{trade_no}|{buyer_id}|{timestamp}".encode("utf-8")).hexdigest()
    client_session = b64_json(
        {
            "externalId": buyer_id,
            "signature": buyer_signature,
            "timestamp": timestamp,
        },
    )
    proof_body = {
        "protocol": {
            "payment_proof": proof,
            "trade_no": trade_no,
        },
        "method": {
            "client_session": client_session,
        },
    }
    return proof_body, b64_json(proof_body)


def retry_original_service(
    url: str,
    method: str,
    body: str | None,
    content_type: str,
    proof_header: str,
) -> tuple[int, str, str]:
    with tempfile.TemporaryDirectory() as tmp_dir:
        headers_path = Path(tmp_dir) / "headers.txt"
        body_path = Path(tmp_dir) / "body.txt"
        args = [
            "-s",
            "-D",
            str(headers_path),
            "-o",
            str(body_path),
            "-w",
            "%{http_code}",
            "--connect-timeout",
            "10",
            "--max-time",
            "60",
            "-X",
            method.upper(),
            url,
            "-H",
            f"Payment-Proof: {proof_header}",
        ]
        if body is not None:
            args.extend(["-H", f"Content-Type: {content_type}", "-d", body])
        status_text = run_curl(args).strip()
        try:
            status_code = int(status_text)
        except ValueError as exc:
            raise RuntimeError(f"无法解析最终服务 HTTP 状态码：{status_text}") from exc
        headers = headers_path.read_text(encoding="utf-8", errors="replace")
        response_body = body_path.read_text(encoding="utf-8", errors="replace")
        return status_code, headers, response_body


def b64url_decode_json(value: str) -> dict[str, Any]:
    compact = value.strip().strip('"')
    padded = compact + ("=" * ((4 - len(compact) % 4) % 4))
    try:
        decoded = base64.urlsafe_b64decode(padded).decode("utf-8")
        result = json.loads(decoded)
    except Exception as exc:  # noqa: BLE001 - 对无效响应头统一返回确定错误。
        raise ValueError(f"Payment-Validation 不是合法的 Base64URL JSON：{exc}") from exc
    if not isinstance(result, dict):
        raise ValueError("Payment-Validation 解码结果必须是 JSON 对象")
    return result


def find_delivery_failure(value: Any) -> str | None:
    if isinstance(value, list):
        for item in value:
            failure = find_delivery_failure(item)
            if failure:
                return failure
        return None
    if not isinstance(value, dict):
        return None

    if value.get("success") is False:
        return "success=false"
    if value.get("validated") is False:
        return "validated=false"
    if value.get("fulfillment_confirmed") is False or value.get("fulfillmentConfirmed") is False:
        return "fulfillment_confirmed=false"

    for key in ("code", "errorCode", "sub_code", "subCode"):
        code = str(value.get(key) or "")
        if code in KNOWN_DELIVERY_FAILURE_CODES:
            return code
    for item in value.values():
        failure = find_delivery_failure(item)
        if failure:
            return failure
    return None


def nonempty_resource(value: Any) -> bool:
    return value not in (None, "", [], {})


def validate_delivery_response(
    status_code: int,
    response_headers: str,
    final_response: str,
    require_payment_validation: bool,
) -> tuple[bool, str]:
    if status_code != 200:
        return False, f"最终服务必须返回 HTTP 200，实际为 {status_code}"
    if not final_response.strip():
        return False, "最终服务返回空响应，未证明资源交付"

    response_json: Any = None
    try:
        response_json = json.loads(final_response)
    except json.JSONDecodeError:
        response_json = None

    response_resource_id = ""
    if response_json is not None:
        failure = find_delivery_failure(response_json)
        if failure:
            return False, f"最终服务返回明确业务失败：{failure}"
        if not isinstance(response_json, dict):
            return False, "最终服务 JSON 响应必须是对象，无法确认资源归属"
        response_resource_id = str(response_json.get("resource_id") or response_json.get("resourceId") or "")
        content = response_json.get("content")
        if not response_resource_id or not nonempty_resource(content):
            return False, "最终服务响应缺少非空 resource_id/resourceId 或 content"

    payment_validation_raw = parse_header_value(response_headers, "Payment-Validation")
    if require_payment_validation and not payment_validation_raw:
        return False, "目标服务要求 Payment-Validation，但最终响应未返回该响应头"
    if payment_validation_raw:
        try:
            payment_validation = b64url_decode_json(payment_validation_raw)
        except ValueError as exc:
            return False, str(exc)
        validation_failure = find_delivery_failure(payment_validation)
        if validation_failure:
            return False, f"Payment-Validation 返回明确失败：{validation_failure}"
        if payment_validation.get("validated") is not True:
            return False, "Payment-Validation 未明确返回 validated=true"
        validation_trade_no = str(payment_validation.get("trade_no") or payment_validation.get("tradeNo") or "")
        validation_resource_id = str(
            payment_validation.get("resource_id") or payment_validation.get("resourceId") or ""
        )
        if not validation_trade_no or not validation_resource_id:
            return False, "Payment-Validation 缺少非空 trade_no/tradeNo 或 resource_id/resourceId"
        if response_resource_id and validation_resource_id != response_resource_id:
            return False, "Payment-Validation 与响应体的 resource_id 不一致"

    if response_json is None and not payment_validation_raw:
        return False, "非 JSON 资源响应缺少可用于确认归属的 Payment-Validation"
    return True, "HTTP 200、非空可归属资源且无明确业务失败"


def write_json(path: Path, value: Any) -> None:
    secure_write_text(path, pretty_json(value) + "\n")


def command_run(args: argparse.Namespace) -> int:
    if not args.auto_complete:
        raise RuntimeError("当前流程只支持一次连续执行 run --auto-complete；不保存跨轮付款或恢复状态")
    url = prompt_missing(args.url, "本地服务请求地址")
    method = (args.method or "GET").upper()
    if method not in {"GET", "POST"}:
        raise SystemExit("当前技能只支持 GET 和 POST")
    buyer_id = prompt_missing(args.buyer_id, "沙箱买家 2088 账号")
    content_type = args.content_type or "application/json"
    body = load_body(args, method, None)
    artifact_dir = create_artifact_dir()

    try:
        payment_needed = fetch_payment_needed(url, method, body, content_type, None)

        decoded_bill = b64decode_json(payment_needed)
        method_data = decoded_bill.get("method") if isinstance(decoded_bill.get("method"), dict) else {}
        if method_data.get("service_id") != A2M_SANDBOX_SERVICE_ID:
            raise RuntimeError(
                f"沙箱联调 method.service_id 必须为 {A2M_SANDBOX_SERVICE_ID}，"
                "请修正用户服务的沙箱运行配置后重试"
            )
        cashier_payload = build_cashier_payload(decoded_bill, buyer_id, args.buyer_signature)
    except (OSError, RuntimeError, ValueError):
        cleanup_artifact_dir(artifact_dir)
        raise

    secure_write_text(artifact_dir / "payment_needed.txt", payment_needed)
    write_json(artifact_dir / "decoded_bill.json", decoded_bill)
    write_json(artifact_dir / "cashier_payload.json", cashier_payload)

    state = {
        "url": url,
        "method": method,
        "body": body,
        "contentType": content_type,
        "buyerId": buyer_id,
        "buyerSignature": args.buyer_signature,
        "payEndpoint": args.pay_endpoint,
        "requirePaymentValidation": bool(args.require_payment_validation),
    }
    write_json(artifact_dir / "state.json", state)

    print("Payment-Needed 已获取并保存到本地过程产物，不在终端输出原始值。")
    print("\n解码后的 Payment-Needed JSON（已脱敏）：")
    print(pretty_json(redact_for_display(decoded_bill)))
    print("\n收银接口请求体（已脱敏）：")
    print(pretty_json(redact_for_display(cashier_payload)))

    pay_status, pay_headers, pay_response = request_cashier_with_retry(
        args.pay_endpoint,
        cashier_payload,
        args.pay_retries,
        args.pay_retry_delay,
    )
    state["payStatus"] = pay_status
    state["payResponse"] = pay_response
    secure_write_text(artifact_dir / "pay_headers.txt", pay_headers)
    secure_write_text(artifact_dir / "pay_status.txt", str(pay_status))
    write_json(artifact_dir / "pay_response.json", pay_response)
    print("\n收银接口 HTTP 状态：")
    print(pay_status)
    print("\n收银接口返回：")
    print(pretty_json(pay_response))

    if not pay_response.get("payScheme"):
        state["payError"] = {
            "errorCode": pay_response.get("errorCode"),
            "errorMessage": pay_response.get("errorMessage"),
        }
        write_json(artifact_dir / "state.json", state)
        if not is_retryable_pay_response(pay_response):
            cleanup_artifact_dir(artifact_dir)
            raise RuntimeError("收银接口未返回 payScheme，且不是已确认的临时错误；敏感过程产物已清理")
        raise RuntimeError(
            "收银接口未返回 payScheme，无法生成付款链接。"
            "本轮敏感过程产物将立即清理；请稍后重新执行完整联调。"
        )

    pay_url = pay_url_from_response(pay_response)
    try:
        trade_no = trade_no_from_response(pay_response)
    except RuntimeError:
        cleanup_artifact_dir(artifact_dir)
        raise
    state["payUrl"] = pay_url
    state["tradeNo"] = trade_no
    write_json(artifact_dir / "state.json", state)

    if args.auto_complete:
        print("\n继续执行 Payment-Proof 服务端联调...")
        complete_args = argparse.Namespace(
            artifact_dir=str(artifact_dir),
            payment_proof=args.payment_proof,
            buyer_signature=args.buyer_signature,
            require_payment_validation=args.require_payment_validation,
        )
        result = command_complete(complete_args)
        if result == 0:
            print("\n按量付费沙箱服务端联调通过。")
            print("\n沙箱付款体验链接（可选）：")
            print(pay_url)
        return result

    raise RuntimeError("未进入自动完成分支")


def command_complete(args: argparse.Namespace) -> int:
    artifact_dir = Path(prompt_missing(args.artifact_dir, "过程产物目录"))
    validate_artifact_dir(artifact_dir)
    state_path = artifact_dir / "state.json"
    if not state_path.exists():
        cleanup_artifact_dir(artifact_dir)
        raise RuntimeError(f"缺少状态文件，无法恢复且已清理过程产物：{state_path}")
    try:
        state = json.loads(secure_read_text(state_path))
    except json.JSONDecodeError as exc:
        cleanup_artifact_dir(artifact_dir)
        raise RuntimeError("状态文件不是合法 JSON，无法恢复且已清理过程产物") from exc
    if not isinstance(state, dict):
        cleanup_artifact_dir(artifact_dir)
        raise RuntimeError(f"状态文件必须是 JSON 对象，无法恢复且已清理过程产物：{state_path}")
    missing_keys = [key for key in ("url", "method", "buyerId", "tradeNo") if not state.get(key)]
    if missing_keys:
        cleanup_artifact_dir(artifact_dir)
        raise RuntimeError(f"状态文件缺少必要字段，无法恢复且已清理过程产物：{', '.join(missing_keys)}")
    buyer_signature = args.buyer_signature if args.buyer_signature is not None else state.get("buyerSignature", "-")
    proof_body, proof_header = build_payment_proof_header(
        buyer_id=str(state["buyerId"]),
        trade_no=str(state["tradeNo"]),
        payment_proof=args.payment_proof,
        buyer_signature=str(buyer_signature),
    )

    write_json(artifact_dir / "payment_proof_body.json", proof_body)
    secure_write_text(artifact_dir / "payment_proof_header.txt", proof_header)

    print("Payment-Proof 请求体（已脱敏）：")
    print(pretty_json(redact_for_display(proof_body)))
    print("\nPayment-Proof 请求头值已生成并保存到本地过程产物，不在终端输出原始值。")

    status_code, response_headers, final_response = retry_original_service(
        url=str(state["url"]),
        method=str(state["method"]),
        body=state.get("body"),
        content_type=str(state.get("contentType") or "application/json"),
        proof_header=proof_header,
    )
    secure_write_text(artifact_dir / "final_response.txt", final_response)
    secure_write_text(artifact_dir / "final_headers.txt", response_headers)
    secure_write_text(artifact_dir / "final_status.txt", str(status_code))

    print("\n最终服务 HTTP 状态：")
    print(status_code)
    payment_validation = parse_header_value(response_headers, "Payment-Validation")
    if payment_validation:
        print("\nPayment-Validation 响应头已收到，原始值不在终端输出。")
    print("\n最终服务响应体：")
    print(final_response)
    require_payment_validation = bool(
        getattr(args, "require_payment_validation", False) or state.get("requirePaymentValidation")
    )
    passed, reason = validate_delivery_response(
        status_code,
        response_headers,
        final_response,
        require_payment_validation,
    )
    if not passed:
        print(f"\nPayment-Proof 重试未通过：{reason}。")
        print("请优先检查服务端订单映射、Payment-Proof 验证、资源防串和履约确认逻辑。")
        return 1
    print(f"\n资源交付证据校验通过：{reason}。")
    cleanup_artifact_dir(artifact_dir)
    print("敏感过程产物已安全清理。")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command")

    run_parser = subparsers.add_parser("run", help="一笔完成 Payment-Needed、沙箱收银和资源交付联调")
    run_parser.add_argument("--url", help="本地服务请求地址，GET 参数需要直接拼在 URL 中")
    run_parser.add_argument("--method", help="HTTP 方法：GET 或 POST")
    run_parser.add_argument("--body", help="POST 请求体，或用 @file 从文件读取请求体")
    run_parser.add_argument("--body-file", help="保存 POST 请求体的文件")
    run_parser.add_argument("--content-type", help="POST 请求的 Content-Type")
    run_parser.add_argument("--buyer-id", help="沙箱买家 2088 账号")
    run_parser.add_argument("--buyer-signature", default="-", help="买家签名占位值")
    run_parser.add_argument("--pay-retries", type=int, default=DEFAULT_PAY_RETRIES, help="沙箱收银接口临时失败时的重试次数")
    run_parser.add_argument(
        "--pay-retry-delay",
        type=float,
        default=DEFAULT_PAY_RETRY_DELAY_SECONDS,
        help="沙箱收银接口重试间隔秒数",
    )
    run_parser.add_argument(
        "--auto-complete",
        action="store_true",
        help="生成付款链接后连续携带 Payment-Proof 重试原始服务",
    )
    run_parser.add_argument(
        "--require-payment-validation",
        action="store_true",
        help="目标服务实现 Payment-Validation 时要求并校验该响应头",
    )
    run_parser.set_defaults(func=command_run, pay_endpoint=PAY_ENDPOINT, payment_proof=None)

    return parser


def main(argv: list[str]) -> int:
    if argv and argv[0] not in {"run", "-h", "--help"}:
        argv = ["run", *argv]
    parser = build_parser()
    args = parser.parse_args(argv)
    if not hasattr(args, "func"):
        parser.print_help()
        return 2
    try:
        return args.func(args)
    except (RuntimeError, ValueError) as exc:
        print(f"执行失败：{exc}", file=sys.stderr)
        return 1
    finally:
        cleanup_active_artifacts()


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
